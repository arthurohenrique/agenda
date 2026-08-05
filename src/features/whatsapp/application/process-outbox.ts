import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  WhatsAppProviderError,
  type ConversationResponse,
  type ProviderMessageResult,
  type WhatsAppProvider,
} from "../domain/provider";
import { resolveWhatsAppProvider } from "../infrastructure/providers/resolver";
import {
  claimOutboxMessages,
  completeOutboxMessage,
  deferOutboxMessage,
  getConversationDeliveryContext,
  getPhoneNumberById,
  markOutboxDeliveryAmbiguous,
  validateOutboxDelivery,
} from "../infrastructure/repositories/channel-repository";
import { classifyWhatsAppError } from "../domain/errors";
import { getMessagingPermission, messagePurposes } from "./messaging-policy";
import {
  normalizeWhatsAppWorkerLimit,
} from "./worker-policy";
import { logger } from "@/lib/observability/logger";

const responseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), body: z.string().min(1).max(4096) }),
  z.object({
    kind: z.literal("reply_buttons"),
    body: z.string().min(1).max(1024),
    buttons: z.array(z.object({ id: z.string(), title: z.string() })).min(1),
  }),
  z.object({
    kind: z.literal("list"),
    body: z.string().min(1).max(1024),
    buttonText: z.string().min(1).max(64),
    sections: z.array(
      z.object({
        title: z.string(),
        rows: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string().optional(),
          }),
        ),
      }),
    ),
  }),
  z.object({
    kind: z.literal("template"),
    name: z.string(),
    language: z.string(),
    components: z.array(z.record(z.string(), z.unknown())),
  }),
  z.object({
    kind: z.literal("flow"),
    flowId: z.string(),
    flowToken: z.string(),
    body: z.string(),
  }),
]);

const outboxPayloadSchema = z.object({
  recipient: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  response: responseSchema,
  idempotencyKey: z.string().min(1).max(256),
  purpose: z.enum(messagePurposes).default("conversation_reply"),
});

async function deliver(
  provider: WhatsAppProvider,
  externalPhoneNumberId: string,
  payload: z.infer<typeof outboxPayloadSchema>,
): Promise<ProviderMessageResult> {
  const base = {
    idempotencyKey: payload.idempotencyKey,
    externalPhoneNumberId,
    recipient: payload.recipient,
  };
  const response = payload.response as ConversationResponse;
  if (response.kind === "text") {
    return provider.sendText({ ...base, body: response.body });
  }
  if (response.kind === "reply_buttons" || response.kind === "list") {
    return provider.sendInteractive({ ...base, response });
  }
  if (response.kind === "template") {
    return provider.sendTemplate({ ...base, response });
  }
  throw new WhatsAppProviderError("whatsapp_flow_send_not_enabled", {
    retryable: false,
  });
}

export async function processWhatsAppOutbox(options: {
  limit?: number;
  workerId?: string;
  provider?: WhatsAppProvider;
  scope?: { provider: string; conversationId: string };
} = {}): Promise<{ claimed: number; sent: number; failed: number }> {
  const provider = options.provider ?? resolveWhatsAppProvider();
  if (options.scope && options.scope.provider !== provider.provider) {
    throw new Error("provider_scope_mismatch");
  }
  const workerId = options.workerId ?? `next:${randomUUID()}`;
  const limit = normalizeWhatsAppWorkerLimit(options.limit);
  const items = await claimOutboxMessages(
    limit,
    workerId,
    provider.provider,
    options.scope,
  );
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    const startedAt = performance.now();
    try {
      const payload = outboxPayloadSchema.parse(item.payload);
      const [phoneNumber, conversation] = await Promise.all([
        getPhoneNumberById(item.phone_number_id),
        getConversationDeliveryContext(item.conversation_id),
      ]);
      if (
        item.provider !== provider.provider ||
        phoneNumber.provider !== provider.provider
      ) {
        throw new Error("provider_context_mismatch");
      }
      if (
        conversation.tenantId !== item.tenant_id ||
        conversation.phoneNumberId !== item.phone_number_id
      ) {
        throw new Error("tenant_context_mismatch");
      }
      const permission = await getMessagingPermission({
        contactId: conversation.contactId,
        tenantId: conversation.tenantId,
        conversationId: item.conversation_id,
        messagePurpose: payload.purpose,
        now: new Date(),
        provider: provider.provider,
      });
      if (!permission.allowed) throw new Error(permission.reason);
      if (permission.mode === "template") {
        if (payload.response.kind !== "template") {
          throw new Error("template_required");
        }
        if (
          payload.response.name !== permission.templateName ||
          payload.response.language !== permission.language
        ) {
          throw new Error("approved_template_mismatch");
        }
      }
      const deliveryStillValid = await validateOutboxDelivery({
        outboxId: item.id,
        workerId,
      });
      if (!deliveryStillValid) {
        logger.info("whatsapp_message_cancelled_before_send", {
          conversationId: item.conversation_id,
          tenantId: item.tenant_id,
          phoneNumberId: item.phone_number_id,
          operation: "validate_outbox",
          result: "ignored",
        });
        continue;
      }
      const result = await deliver(
        provider,
        phoneNumber.externalPhoneNumberId,
        payload,
      );
      try {
        await completeOutboxMessage({
          outboxId: item.id,
          workerId,
          providerMessageId: result.providerMessageId,
        });
      } catch (completionError) {
        const errorCode = classifyWhatsAppError(completionError).code;
        await markOutboxDeliveryAmbiguous({
          outboxId: item.id,
          workerId,
          providerMessageId: result.providerMessageId,
          errorCode,
        }).catch(async () => {
          await deferOutboxMessage({
            outboxId: item.id,
            workerId,
            errorCode: "delivery_unknown",
            retry: false,
          }).catch(() => undefined);
        });
        failed += 1;
        logger.error("whatsapp_message_delivery_unknown", {
          conversationId: item.conversation_id,
          tenantId: item.tenant_id,
          phoneNumberId: item.phone_number_id,
          providerMessageId: result.providerMessageId,
          errorCode,
          operation: "complete_outbox",
          durationMs: Math.round(performance.now() - startedAt),
          result: "delivery_unknown",
        });
        continue;
      }
      sent += 1;
      logger.info("whatsapp_message_sent", {
        conversationId: item.conversation_id,
        tenantId: item.tenant_id,
        phoneNumberId: item.phone_number_id,
        providerMessageId: result.providerMessageId,
        operation: "send_outbox",
        durationMs: Math.round(performance.now() - startedAt),
        result: "accepted",
      });
    } catch (error) {
      failed += 1;
      const classified = classifyWhatsAppError(error);
      if (error instanceof WhatsAppProviderError && error.deliveryUnknown) {
        await markOutboxDeliveryAmbiguous({
          outboxId: item.id,
          workerId,
          providerMessageId: null,
          errorCode: classified.code,
        }).catch(async () => {
          await deferOutboxMessage({
            outboxId: item.id,
            workerId,
            errorCode: "delivery_unknown",
            retry: false,
          }).catch(() => undefined);
        });
        logger.error("whatsapp_message_delivery_unknown", {
          conversationId: item.conversation_id,
          tenantId: item.tenant_id,
          phoneNumberId: item.phone_number_id,
          providerMessageId: null,
          errorCode: classified.code,
          operation: "send_outbox",
          durationMs: Math.round(performance.now() - startedAt),
          result: "delivery_unknown",
        });
        continue;
      }
      const retry = classified.kind === "transient";
      await deferOutboxMessage({
        outboxId: item.id,
        workerId,
        errorCode: classified.code,
        retry,
      });
      const result = retry
        ? item.attempt_count >= 8 ? "dead_letter" : "retry"
        : "failed";
      logger[result === "retry" ? "warn" : "error"]("whatsapp_message_failed", {
        conversationId: item.conversation_id,
        tenantId: item.tenant_id,
        phoneNumberId: item.phone_number_id,
        errorCode: classified.code,
        attempt: item.attempt_count,
        operation: "send_outbox",
        durationMs: Math.round(performance.now() - startedAt),
        result,
      });
    }
  }
  return { claimed: items.length, sent, failed };
}
