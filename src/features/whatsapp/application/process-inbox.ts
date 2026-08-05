import "server-only";

import { randomUUID } from "node:crypto";
import type {
  NormalizedWhatsAppEvent,
  WhatsAppProvider,
} from "../domain/provider";
import { isNormalizedInboundWhatsAppEvent } from "../domain/provider";
import { resolveWhatsAppProvider } from "../infrastructure/providers/resolver";
import {
  claimWebhookEvents,
  completeWebhookEvent,
  deferWebhookEvent,
  findInboundMessage,
  ignoreInboundMessage,
  updateMessageStatus,
} from "../infrastructure/repositories/channel-repository";
import { processInboundMessage } from "./process-inbound-message";
import { escalateWhatsAppTechnicalFailure } from "./escalate-technical-failure";
import { classifyWhatsAppError } from "../domain/errors";
import {
  normalizeWhatsAppWorkerLimit,
} from "./worker-policy";
import { logger } from "@/lib/observability/logger";

export interface ProcessWhatsAppInboxOptions {
  limit?: number;
  workerId?: string;
  provider?: WhatsAppProvider;
  scope?: { provider: string; correlationId: string };
}

function inboundText(event: NormalizedWhatsAppEvent): string {
  if (event.kind === "message.text") return event.body;
  if (event.kind === "message.button") return event.buttonId;
  if (event.kind === "message.list") return event.rowId;
  return "";
}

export function orderNormalizedWhatsAppEvents(
  events: readonly NormalizedWhatsAppEvent[],
): NormalizedWhatsAppEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const occurredAt = Date.parse(left.event.occurredAt) - Date.parse(right.event.occurredAt);
      return occurredAt || left.index - right.index;
    })
    .map(({ event }) => event);
}

async function processNormalizedEvent(
  event: NormalizedWhatsAppEvent,
  provider: WhatsAppProvider,
  workerId: string,
): Promise<void> {
  if (isNormalizedInboundWhatsAppEvent(event)) {
    if (!event.externalPhoneNumberId) throw new Error("phone_number_not_found");
    await processInboundMessage(
      {
        provider: event.provider,
        providerMessageId: event.messageId,
        externalPhoneNumberId: event.externalPhoneNumberId,
        from: event.sender,
        profileName: event.profileName,
        text: inboundText(event),
        messageType:
          event.kind === "message.text"
            ? "text"
            : event.kind === "message.button"
              ? "button"
              : event.kind === "message.list"
                ? "list"
                : "unsupported",
        providerReplyToId: event.replyToMessageId,
        receivedAt: event.occurredAt,
      },
      provider.capabilities,
      undefined,
      workerId,
    );
    await provider.markAsRead({
      externalPhoneNumberId: event.externalPhoneNumberId,
      messageId: event.messageId,
    });
    return;
  }
  if (event.kind === "status") {
    if (!["sent", "delivered", "read", "failed"].includes(event.status)) return;
    const applied = await updateMessageStatus({
      provider: event.provider,
      providerMessageId: event.messageId,
      status: event.status as "sent" | "delivered" | "read" | "failed",
      timestamp: event.occurredAt,
    });
    if (!applied) {
      logger.info("whatsapp_status_buffered", {
        providerMessageId: event.messageId,
        operation: "process_inbox",
      });
    }
    return;
  }
  if (event.kind === "error") {
    logger.warn("whatsapp_provider_error", {
      errorCode: event.code,
      providerMessageId: event.messageId,
      operation: "process_inbox",
    });
    return;
  }
  if (event.kind === "unknown") {
    logger.info("whatsapp_event_ignored", { operation: event.reason });
  }
}

export async function processWhatsAppInbox(
  options: ProcessWhatsAppInboxOptions = {},
): Promise<{ claimed: number; processed: number; failed: number }> {
  const provider = options.provider ?? resolveWhatsAppProvider();
  if (options.scope && options.scope.provider !== provider.provider) {
    throw new Error("provider_scope_mismatch");
  }
  const workerId = options.workerId ?? `next:${randomUUID()}`;
  const limit = normalizeWhatsAppWorkerLimit(options.limit);
  const events = await claimWebhookEvents(
    limit,
    workerId,
    provider.provider,
    options.scope,
  );
  let processed = 0;
  let failed = 0;
  for (const envelope of events) {
    const startedAt = performance.now();
    try {
      const normalized = orderNormalizedWhatsAppEvents(
        await provider.normalizeWebhook(envelope.payload),
      );
      for (const event of normalized) {
        try {
          await processNormalizedEvent(event, provider, workerId);
        } catch (error) {
          const classified = classifyWhatsAppError(error);
          const shouldEscalate = isNormalizedInboundWhatsAppEvent(event) && (
            classified.kind === "permanent" ||
            (classified.kind === "transient" && envelope.attempts >= 7)
          );
          if (shouldEscalate) {
            const escalated = await escalateWhatsAppTechnicalFailure({
              event,
              workerId,
            });
            if (escalated) {
              await provider.markAsRead({
                externalPhoneNumberId: event.externalPhoneNumberId!,
                messageId: event.messageId,
              }).catch((markError) => {
                logger.warn("whatsapp_escalated_message_read_marker_failed", {
                  providerMessageId: event.messageId,
                  errorCode: classifyWhatsAppError(markError).code,
                  operation: "process_inbox",
                  result: "ignored",
                });
              });
              logger.error("whatsapp_inbound_escalated_after_technical_failure", {
                providerMessageId: event.messageId,
                errorCode: classified.code,
                operation: "process_inbox",
                result: "human_handoff",
              });
              continue;
            }
          }
          if (classified.kind === "transient") throw error;

          if (isNormalizedInboundWhatsAppEvent(event)) {
            const inbound = await findInboundMessage({
              provider: event.provider,
              providerMessageId: event.messageId,
            });
            if (inbound && !inbound.processed) {
              await ignoreInboundMessage(inbound.messageId);
            }
          }
          logger.warn("whatsapp_event_fragment_ignored", {
            stage: event.kind,
            errorCode: classified.code,
            operation: "process_inbox",
            result: "ignored",
          });
        }
      }
      await completeWebhookEvent(envelope.id, workerId);
      processed += 1;
      logger.info("whatsapp_webhook_processed", {
        eventId: envelope.id,
        correlationId: envelope.correlation_id,
        durationMs: Math.round(performance.now() - startedAt),
        result: "processed",
      });
    } catch (error) {
      failed += 1;
      const classified = classifyWhatsAppError(error);
      const retry = classified.kind === "transient";
      await deferWebhookEvent({
        eventId: envelope.id,
        workerId,
        errorCode: classified.code,
        retry,
      });
      const result = retry
        ? envelope.attempts >= 8 ? "dead_letter" : "retry"
        : "failed";
      logger[result === "retry" ? "warn" : "error"]("whatsapp_webhook_failed", {
        eventId: envelope.id,
        correlationId: envelope.correlation_id,
        errorCode: classified.code,
        attempt: envelope.attempts,
        durationMs: Math.round(performance.now() - startedAt),
        result,
      });
    }
  }
  return { claimed: events.length, processed, failed };
}
