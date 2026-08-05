import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  WhatsAppProviderError,
  type CreateWhatsAppFlowInput,
  type CreateWhatsAppFlowResult,
  type HandleWhatsAppFlowExchangeInput,
  type HandleWhatsAppFlowExchangeResult,
  type MarkAsReadInput,
  type NormalizedWhatsAppEvent,
  type ProviderMessageResult,
  type PublishWhatsAppFlowInput,
  type PublishWhatsAppFlowResult,
  type SendInteractiveInput,
  type SendTemplateInput,
  type SendTextInput,
  type SendWhatsAppFlowInput,
  type ValidateWebhookInput,
  type WhatsAppFlowProvider,
  type WhatsAppProviderCapabilities,
} from "../../domain/provider";
import {
  metaContactSchema,
  metaErrorSchema,
  metaMessageResponseSchema,
  metaMessageSchema,
  metaStatusFragmentSchema,
  metaWebhookSignatureSchema,
  type MetaWebhookError,
  type MetaWebhookMessage,
} from "../../schemas/webhook";

const graphApiOrigin = "https://graph.facebook.com";
const MAX_META_ENTRIES = 100;
const MAX_META_CHANGES_PER_ENTRY = 100;
const MAX_META_CONTACTS_PER_CHANGE = 1_000;
const MAX_META_MESSAGES_PER_CHANGE = 1_000;
const MAX_META_STATUSES_PER_CHANGE = 1_000;
const MAX_META_ERRORS_PER_FRAGMENT = 100;
const MAX_META_INSPECTED_FRAGMENTS = 4_096;
const MAX_META_NORMALIZED_EVENTS = 4_096;

const metaMetadataFragmentSchema = z.object({
  phone_number_id: z.string().min(1).max(200).optional(),
}).passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalArray(
  value: Record<string, unknown>,
  key: string,
): unknown[] | null {
  const candidate = value[key];
  if (candidate === undefined) return [];
  return Array.isArray(candidate) ? candidate : null;
}

export interface MetaCloudWhatsAppProviderOptions {
  graphApiVersion: string;
  accessToken: string;
  appSecret: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
  capabilities?: Partial<WhatsAppProviderCapabilities>;
}

function stableDigest(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? String(value);
  } catch {
    serialized = Object.prototype.toString.call(value);
  }
  return createHash("sha256").update(serialized).digest("hex");
}

function timestampToIso(timestamp: string | undefined, now: () => Date): string {
  if (timestamp) {
    const epochSeconds = Number(timestamp);
    if (Number.isFinite(epochSeconds) && epochSeconds >= 0) {
      const date = new Date(epochSeconds * 1000);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
  }
  return now().toISOString();
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isAmbiguousSendStatus(status: number): boolean {
  return status === 408 || status === 425 || status >= 500;
}

function metaRecipient(recipient: string): string {
  if (!/^\+[1-9][0-9]{7,14}$/.test(recipient)) {
    throw new WhatsAppProviderError("whatsapp_recipient_invalid", {
      retryable: false,
    });
  }
  return recipient.slice(1);
}

export class MetaCloudWhatsAppProvider implements WhatsAppFlowProvider {
  readonly provider = "meta_cloud" as const;
  readonly capabilities: WhatsAppProviderCapabilities;

  private readonly accessToken: string;
  private readonly appSecret: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly graphApiVersion: string;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: MetaCloudWhatsAppProviderOptions) {
    if (
      !/^v[1-9][0-9]*[.][0-9]+$/.test(options.graphApiVersion) ||
      options.accessToken.length < 20 ||
      options.appSecret.length < 16 ||
      (options.timeoutMs !== undefined &&
        (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0))
    ) {
      throw new WhatsAppProviderError("whatsapp_meta_configuration_invalid", {
        retryable: false,
      });
    }
    this.graphApiVersion = options.graphApiVersion;
    this.accessToken = options.accessToken;
    this.appSecret = options.appSecret;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.capabilities = {
      maxReplyButtons: options.capabilities?.maxReplyButtons ?? 3,
      maxListRows: options.capabilities?.maxListRows ?? 10,
      supportsFlows: options.capabilities?.supportsFlows ?? false,
      supportsTemplates: options.capabilities?.supportsTemplates ?? true,
    };
    if (
      !Number.isInteger(this.capabilities.maxReplyButtons) ||
      this.capabilities.maxReplyButtons < 1 ||
      !Number.isInteger(this.capabilities.maxListRows) ||
      this.capabilities.maxListRows < 1
    ) {
      throw new WhatsAppProviderError("whatsapp_capabilities_invalid", {
        retryable: false,
      });
    }
  }

  async sendText(input: SendTextInput): Promise<ProviderMessageResult> {
    if (!input.body.trim() || input.body.length > 4096) {
      throw new WhatsAppProviderError("whatsapp_text_invalid", { retryable: false });
    }
    return this.sendMessage(input, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: metaRecipient(input.recipient),
      type: "text",
      text: { preview_url: false, body: input.body },
      ...(input.replyToMessageId
        ? { context: { message_id: input.replyToMessageId } }
        : {}),
    });
  }

  async sendInteractive(input: SendInteractiveInput): Promise<ProviderMessageResult> {
    const { response } = input;
    if (response.kind === "reply_buttons") {
      if (
        response.buttons.length < 1 ||
        response.buttons.length > this.capabilities.maxReplyButtons
      ) {
        throw new WhatsAppProviderError("whatsapp_buttons_invalid", { retryable: false });
      }
      return this.sendMessage(input, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: metaRecipient(input.recipient),
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: response.body },
          action: {
            buttons: response.buttons.map((button) => ({
              type: "reply",
              reply: { id: button.id, title: button.title },
            })),
          },
        },
        ...(input.replyToMessageId
          ? { context: { message_id: input.replyToMessageId } }
          : {}),
      });
    }

    const rows = response.sections.reduce((count, section) => count + section.rows.length, 0);
    if (!response.sections.length || rows < 1 || rows > this.capabilities.maxListRows) {
      throw new WhatsAppProviderError("whatsapp_list_invalid", { retryable: false });
    }
    return this.sendMessage(input, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: metaRecipient(input.recipient),
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: response.body },
        action: {
          button: response.buttonText,
          sections: response.sections.map((section) => ({
            title: section.title,
            rows: section.rows.map((row) => ({
              id: row.id,
              title: row.title,
              ...(row.description ? { description: row.description } : {}),
            })),
          })),
        },
      },
      ...(input.replyToMessageId
        ? { context: { message_id: input.replyToMessageId } }
        : {}),
    });
  }

  async sendTemplate(input: SendTemplateInput): Promise<ProviderMessageResult> {
    if (!this.capabilities.supportsTemplates) {
      throw new WhatsAppProviderError("whatsapp_templates_unsupported", {
        retryable: false,
      });
    }
    const { response } = input;
    if (!response.name.trim() || !response.language.trim()) {
      throw new WhatsAppProviderError("whatsapp_template_invalid", { retryable: false });
    }
    return this.sendMessage(input, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: metaRecipient(input.recipient),
      type: "template",
      template: {
        name: response.name,
        language: { code: response.language },
        components: response.components,
      },
    });
  }

  async markAsRead(input: MarkAsReadInput): Promise<void> {
    await this.request(input.externalPhoneNumberId, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: input.messageId,
    });
  }

  async createFlow(input: CreateWhatsAppFlowInput): Promise<CreateWhatsAppFlowResult> {
    void input;
    throw new WhatsAppProviderError("whatsapp_flows_unsupported", { retryable: false });
  }

  async publishFlow(
    input: PublishWhatsAppFlowInput,
  ): Promise<PublishWhatsAppFlowResult> {
    void input;
    throw new WhatsAppProviderError("whatsapp_flows_unsupported", { retryable: false });
  }

  async sendFlow(input: SendWhatsAppFlowInput): Promise<ProviderMessageResult> {
    void input;
    throw new WhatsAppProviderError("whatsapp_flows_unsupported", { retryable: false });
  }

  async handleFlowExchange(
    input: HandleWhatsAppFlowExchangeInput,
  ): Promise<HandleWhatsAppFlowExchangeResult> {
    void input;
    throw new WhatsAppProviderError("whatsapp_flows_unsupported", { retryable: false });
  }

  async validateWebhookSignature(input: ValidateWebhookInput): Promise<boolean> {
    const parsed = metaWebhookSignatureSchema.safeParse(input.signature);
    if (!parsed.success) return false;

    const expected = createHmac("sha256", this.appSecret)
      .update(input.rawBody)
      .digest();
    const provided = Buffer.from(parsed.data.slice("sha256=".length), "hex");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }

  async normalizeWebhook(payload: unknown): Promise<NormalizedWhatsAppEvent[]> {
    if (
      !isRecord(payload) ||
      payload.object !== "whatsapp_business_account" ||
      !Array.isArray(payload.entry)
    ) {
      return [this.unknownEvent(payload, "invalid_payload", null, null)];
    }

    const events: NormalizedWhatsAppEvent[] = [];
    let inspectedFragments = 0;
    let boundedOverflow = payload.entry.length > MAX_META_ENTRIES;
    const consumeFragment = (): boolean => {
      if (inspectedFragments >= MAX_META_INSPECTED_FRAGMENTS) {
        boundedOverflow = true;
        return false;
      }
      inspectedFragments += 1;
      return true;
    };
    const emitUnknown = (
      value: unknown,
      reason: "invalid_payload" | "unsupported_change",
      phoneNumberId: string | null,
      wabaId: string | null,
    ): void => {
      if (events.length >= MAX_META_NORMALIZED_EVENTS) {
        boundedOverflow = true;
        return;
      }
      events.push(this.unknownEvent(value, reason, phoneNumberId, wabaId));
    };
    const bounded = (values: unknown[], maximum: number): unknown[] => {
      if (values.length > maximum) boundedOverflow = true;
      return values.slice(0, maximum);
    };

    entryLoop:
    for (const rawEntry of bounded(payload.entry, MAX_META_ENTRIES)) {
      if (!consumeFragment()) break;
      if (
        !isRecord(rawEntry) ||
        typeof rawEntry.id !== "string" ||
        rawEntry.id.length < 1 ||
        rawEntry.id.length > 200 ||
        !Array.isArray(rawEntry.changes)
      ) {
        emitUnknown(rawEntry, "invalid_payload", null, null);
        continue;
      }
      const wabaId = rawEntry.id;
      if (rawEntry.changes.length > MAX_META_CHANGES_PER_ENTRY) {
        boundedOverflow = true;
      }
      for (const rawChange of bounded(
        rawEntry.changes,
        MAX_META_CHANGES_PER_ENTRY,
      )) {
        if (!consumeFragment()) break entryLoop;
        if (
          !isRecord(rawChange) ||
          typeof rawChange.field !== "string" ||
          rawChange.field.length < 1 ||
          rawChange.field.length > 200 ||
          !isRecord(rawChange.value)
        ) {
          emitUnknown(rawChange, "invalid_payload", null, wabaId);
          continue;
        }
        const value = rawChange.value;
        const initialCount = events.length;
        let phoneNumberId: string | null = null;
        if (value.metadata !== undefined) {
          const metadata = metaMetadataFragmentSchema.safeParse(value.metadata);
          if (metadata.success) {
            phoneNumberId = metadata.data.phone_number_id ?? null;
          } else {
            emitUnknown(
              { fragment: "metadata", digest: stableDigest(value.metadata) },
              "invalid_payload",
              null,
              wabaId,
            );
          }
        }

        const profiles = new Map<string, string | null>();
        const contacts = optionalArray(value, "contacts");
        if (contacts === null) {
          emitUnknown(
            { fragment: "contacts", change: stableDigest(rawChange) },
            "invalid_payload",
            phoneNumberId,
            wabaId,
          );
        } else {
          for (const rawContact of bounded(
            contacts,
            MAX_META_CONTACTS_PER_CHANGE,
          )) {
            if (!consumeFragment()) break entryLoop;
            const contact = metaContactSchema.safeParse(rawContact);
            if (!contact.success) {
              emitUnknown(rawContact, "invalid_payload", phoneNumberId, wabaId);
              continue;
            }
            profiles.set(
              contact.data.wa_id,
              contact.data.profile?.name ?? null,
            );
          }
        }

        const messages = optionalArray(value, "messages");
        if (messages === null) {
          emitUnknown(
            { fragment: "messages", change: stableDigest(rawChange) },
            "invalid_payload",
            phoneNumberId,
            wabaId,
          );
        } else {
          for (const rawMessage of bounded(
            messages,
            MAX_META_MESSAGES_PER_CHANGE,
          )) {
            if (!consumeFragment()) break entryLoop;
            const message = metaMessageSchema.safeParse(rawMessage);
            if (!message.success) {
              emitUnknown(rawMessage, "invalid_payload", phoneNumberId, wabaId);
              continue;
            }
            if (!phoneNumberId) {
              emitUnknown(
                {
                  fragment: "message_without_phone_number",
                  message: stableDigest(message.data.id),
                },
                "invalid_payload",
                null,
                wabaId,
              );
              continue;
            }
            if (events.length >= MAX_META_NORMALIZED_EVENTS) {
              boundedOverflow = true;
              break entryLoop;
            }
            events.push(this.normalizeMessage(message.data, wabaId, phoneNumberId, profiles));
          }
        }

        const statuses = optionalArray(value, "statuses");
        if (statuses === null) {
          emitUnknown(
            { fragment: "statuses", change: stableDigest(rawChange) },
            "invalid_payload",
            phoneNumberId,
            wabaId,
          );
        } else {
          for (const rawStatus of bounded(
            statuses,
            MAX_META_STATUSES_PER_CHANGE,
          )) {
            if (!consumeFragment()) break entryLoop;
            const parsedStatus = metaStatusFragmentSchema.safeParse(rawStatus);
            if (!parsedStatus.success) {
              emitUnknown(rawStatus, "invalid_payload", phoneNumberId, wabaId);
              continue;
            }
            const status = parsedStatus.data;
            const occurredAt = timestampToIso(status.timestamp, this.now);
            if (events.length >= MAX_META_NORMALIZED_EVENTS) {
              boundedOverflow = true;
              break entryLoop;
            }
            events.push({
              kind: "status",
              provider: this.provider,
              eventId: `${status.id}:status:${status.status}:${status.timestamp ?? "unknown"}`,
              externalPhoneNumberId: phoneNumberId,
              externalWabaId: wabaId,
              occurredAt,
              messageId: status.id,
              recipient: status.recipient_id,
              status: status.status,
              conversationId: status.conversation?.id ?? null,
            });

            if (!isRecord(rawStatus)) continue;
            const statusErrors = optionalArray(rawStatus, "errors");
            if (statusErrors === null) {
              emitUnknown(
                { fragment: "status_errors", statusId: status.id },
                "invalid_payload",
                phoneNumberId,
                wabaId,
              );
              continue;
            }
            for (const rawError of bounded(
              statusErrors,
              MAX_META_ERRORS_PER_FRAGMENT,
            )) {
              if (!consumeFragment()) break entryLoop;
              const error = metaErrorSchema.safeParse(rawError);
              if (!error.success) {
                emitUnknown(rawError, "invalid_payload", phoneNumberId, wabaId);
                continue;
              }
              if (events.length >= MAX_META_NORMALIZED_EVENTS) {
                boundedOverflow = true;
                break entryLoop;
              }
              events.push(
                this.normalizeError(
                  error.data,
                  wabaId,
                  phoneNumberId,
                  status.id,
                  occurredAt,
                ),
              );
            }
          }
        }

        const changeErrors = optionalArray(value, "errors");
        if (changeErrors === null) {
          emitUnknown(
            { fragment: "errors", change: stableDigest(rawChange) },
            "invalid_payload",
            phoneNumberId,
            wabaId,
          );
        } else {
          for (const rawError of bounded(
            changeErrors,
            MAX_META_ERRORS_PER_FRAGMENT,
          )) {
            if (!consumeFragment()) break entryLoop;
            const error = metaErrorSchema.safeParse(rawError);
            if (!error.success) {
              emitUnknown(rawError, "invalid_payload", phoneNumberId, wabaId);
              continue;
            }
            if (events.length >= MAX_META_NORMALIZED_EVENTS) {
              boundedOverflow = true;
              break entryLoop;
            }
            events.push(
              this.normalizeError(
                error.data,
                wabaId,
                phoneNumberId,
                null,
                this.now().toISOString(),
              ),
            );
          }
        }

        if (events.length === initialCount) {
          emitUnknown(
            rawChange,
            "unsupported_change",
            phoneNumberId,
            wabaId,
          );
        }
      }
    }

    if (boundedOverflow && events.length < MAX_META_NORMALIZED_EVENTS) {
      events.push(this.unknownEvent(
        { fragment: "normalization_limit" },
        "invalid_payload",
        null,
        null,
      ));
    }
    if (!events.length) {
      return [this.unknownEvent(payload, "empty_payload", null, null)];
    }
    return events;
  }

  private normalizeMessage(
    message: MetaWebhookMessage,
    wabaId: string,
    phoneNumberId: string | null,
    profiles: Map<string, string | null>,
  ): NormalizedWhatsAppEvent {
    const base = {
      provider: this.provider,
      eventId: message.id,
      externalPhoneNumberId: phoneNumberId,
      externalWabaId: wabaId,
      occurredAt: timestampToIso(message.timestamp, this.now),
      messageId: message.id,
      sender: message.from,
      profileName: profiles.get(message.from) ?? null,
      replyToMessageId: message.context?.id ?? null,
    } as const;

    if (message.type === "text" && message.text) {
      return { ...base, kind: "message.text", body: message.text.body };
    }
    const buttonReply = message.interactive?.button_reply;
    if (message.type === "interactive" && buttonReply) {
      return {
        ...base,
        kind: "message.button",
        buttonId: buttonReply.id,
        title: buttonReply.title,
      };
    }
    const listReply = message.interactive?.list_reply;
    if (message.type === "interactive" && listReply) {
      return {
        ...base,
        kind: "message.list",
        rowId: listReply.id,
        title: listReply.title,
        description: listReply.description ?? null,
      };
    }
    if (message.type === "button" && message.button) {
      return {
        ...base,
        kind: "message.button",
        buttonId: message.button.payload ?? message.button.text ?? message.id,
        title: message.button.text ?? message.button.payload ?? "",
      };
    }
    return { ...base, kind: "message.unsupported", messageType: message.type };
  }

  private normalizeError(
    error: MetaWebhookError,
    wabaId: string,
    phoneNumberId: string | null,
    messageId: string | null,
    occurredAt: string,
  ): NormalizedWhatsAppEvent {
    return {
      kind: "error",
      provider: this.provider,
      eventId: `${messageId ?? "provider"}:error:${error.code}:${stableDigest(error).slice(0, 12)}`,
      externalPhoneNumberId: phoneNumberId,
      externalWabaId: wabaId,
      occurredAt,
      messageId,
      code: error.code,
      title: error.title ?? error.message ?? "Provider error",
      details: error.error_data?.details ?? error.message ?? null,
    };
  }

  private unknownEvent(
    value: unknown,
    reason: Extract<NormalizedWhatsAppEvent, { kind: "unknown" }>["reason"],
    phoneNumberId: string | null,
    wabaId: string | null,
  ): NormalizedWhatsAppEvent {
    return {
      kind: "unknown",
      provider: this.provider,
      eventId: `unknown:${stableDigest(value)}`,
      externalPhoneNumberId: phoneNumberId,
      externalWabaId: wabaId,
      occurredAt: this.now().toISOString(),
      reason,
    };
  }

  private async sendMessage(
    input: Pick<SendTextInput, "externalPhoneNumberId" | "idempotencyKey">,
    body: Record<string, unknown>,
  ): Promise<ProviderMessageResult> {
    const responseBody = await this.request(input.externalPhoneNumberId, body, {
      deliveryUnknownOnSendFailure: true,
    });
    const parsed = metaMessageResponseSchema.safeParse(responseBody);
    if (!parsed.success) {
      throw new WhatsAppProviderError("whatsapp_meta_response_invalid", {
        retryable: false,
        deliveryUnknown: true,
      });
    }
    return {
      provider: this.provider,
      providerMessageId: parsed.data.messages[0]!.id,
      idempotencyKey: input.idempotencyKey,
      acceptedAt: this.now().toISOString(),
    };
  }

  private async request(
    externalPhoneNumberId: string,
    body: Record<string, unknown>,
    options: { deliveryUnknownOnSendFailure?: boolean } = {},
  ): Promise<unknown> {
    if (!externalPhoneNumberId.trim()) {
      throw new WhatsAppProviderError("whatsapp_phone_number_invalid", { retryable: false });
    }
    const url = `${graphApiOrigin}/${this.graphApiVersion}/${encodeURIComponent(externalPhoneNumberId)}/messages`;
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      const deliveryUnknown = options.deliveryUnknownOnSendFailure === true;
      throw new WhatsAppProviderError("whatsapp_meta_unavailable", {
        retryable: !deliveryUnknown,
        deliveryUnknown,
      });
    }

    if (!response.ok) {
      const deliveryUnknown = options.deliveryUnknownOnSendFailure === true &&
        isAmbiguousSendStatus(response.status);
      throw new WhatsAppProviderError(`whatsapp_meta_http_${response.status}`, {
        // 429 is an explicit rate-limit rejection. Timeout/gateway responses can
        // arrive after Meta accepted the write, so only the former is safe to retry.
        retryable: !deliveryUnknown && isRetryableStatus(response.status),
        status: response.status,
        deliveryUnknown,
      });
    }
    return response.json().catch(() => null);
  }
}
