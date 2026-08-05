import "server-only";

import { createHash } from "node:crypto";
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
import { mockWebhookPayloadSchema } from "../../schemas/webhook";

type MockOperation =
  | "sendText"
  | "sendInteractive"
  | "sendTemplate"
  | "sendFlow"
  | "markAsRead";

export type MockSentMessage =
  | { kind: "text"; input: SendTextInput; result: ProviderMessageResult }
  | { kind: "interactive"; input: SendInteractiveInput; result: ProviderMessageResult }
  | { kind: "template"; input: SendTemplateInput; result: ProviderMessageResult }
  | { kind: "flow"; input: SendWhatsAppFlowInput; result: ProviderMessageResult };

export interface MockWhatsAppProviderOptions {
  capabilities?: Partial<WhatsAppProviderCapabilities>;
  transientFailures?: number | Partial<Record<MockOperation, number>>;
  duplicateEvents?: boolean;
  outOfOrderEvents?: boolean;
  signatureValid?: boolean;
  flowExchangeFixture?: HandleWhatsAppFlowExchangeResult;
  now?: () => Date;
}

export interface SimulateInboundTextInput {
  idempotencyKey: string;
  externalPhoneNumberId: string;
  externalWabaId?: string | null;
  sender: string;
  body: string;
  profileName?: string | null;
  replyToMessageId?: string | null;
  occurredAt?: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableDigest(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? String(value);
  } catch {
    serialized = Object.prototype.toString.call(value);
  }
  return digest(serialized);
}

export class MockWhatsAppProvider implements WhatsAppFlowProvider {
  readonly provider = "mock" as const;
  readonly capabilities: WhatsAppProviderCapabilities;

  private duplicateEvents: boolean;
  private readonly flowExchangeFixture: HandleWhatsAppFlowExchangeResult | null;
  private outOfOrderEvents: boolean;
  private readonly idempotentResults = new Map<string, ProviderMessageResult>();
  private readonly messages: MockSentMessage[] = [];
  private readonly now: () => Date;
  private readonly readReceipts: MarkAsReadInput[] = [];
  private readonly remainingFailures: Partial<Record<MockOperation, number>> = {};
  private sharedFailures = 0;
  private signatureValid: boolean;

  constructor(options: MockWhatsAppProviderOptions = {}) {
    this.capabilities = {
      maxReplyButtons: options.capabilities?.maxReplyButtons ?? 3,
      maxListRows: options.capabilities?.maxListRows ?? 10,
      supportsFlows: options.capabilities?.supportsFlows ?? true,
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

    if (typeof options.transientFailures === "number") {
      this.sharedFailures = Math.max(0, Math.trunc(options.transientFailures));
    } else if (options.transientFailures) {
      for (const [operation, count] of Object.entries(options.transientFailures)) {
        this.remainingFailures[operation as MockOperation] = Math.max(0, Math.trunc(count));
      }
    }
    this.duplicateEvents = options.duplicateEvents ?? false;
    this.outOfOrderEvents = options.outOfOrderEvents ?? false;
    this.signatureValid = options.signatureValid ?? true;
    this.flowExchangeFixture = options.flowExchangeFixture ?? null;
    this.now = options.now ?? (() => new Date());
  }

  get sentMessages(): readonly MockSentMessage[] {
    return this.messages;
  }

  get markedAsRead(): readonly MarkAsReadInput[] {
    return this.readReceipts;
  }

  async sendText(input: SendTextInput): Promise<ProviderMessageResult> {
    if (!input.body.trim()) {
      throw new WhatsAppProviderError("whatsapp_text_invalid", { retryable: false });
    }
    return this.send("text", input, "sendText");
  }

  async sendInteractive(input: SendInteractiveInput): Promise<ProviderMessageResult> {
    if (
      input.response.kind === "reply_buttons" &&
      (input.response.buttons.length < 1 ||
        input.response.buttons.length > this.capabilities.maxReplyButtons)
    ) {
      throw new WhatsAppProviderError("whatsapp_buttons_invalid", { retryable: false });
    }
    if (input.response.kind === "list") {
      const rows = input.response.sections.reduce(
        (total, section) => total + section.rows.length,
        0,
      );
      if (rows < 1 || rows > this.capabilities.maxListRows) {
        throw new WhatsAppProviderError("whatsapp_list_invalid", { retryable: false });
      }
    }
    return this.send("interactive", input, "sendInteractive");
  }

  async sendTemplate(input: SendTemplateInput): Promise<ProviderMessageResult> {
    if (!this.capabilities.supportsTemplates) {
      throw new WhatsAppProviderError("whatsapp_templates_unsupported", {
        retryable: false,
      });
    }
    return this.send("template", input, "sendTemplate");
  }

  async markAsRead(input: MarkAsReadInput): Promise<void> {
    this.maybeFail("markAsRead");
    this.readReceipts.push({ ...input });
  }

  async createFlow(input: CreateWhatsAppFlowInput): Promise<CreateWhatsAppFlowResult> {
    this.assertFlowsSupported();
    return {
      provider: this.provider,
      externalFlowId: `mock:flow:${digest(
        `${input.externalWabaId}:${input.name}:${input.idempotencyKey}`,
      ).slice(0, 32)}`,
      status: "draft",
    };
  }

  async publishFlow(
    input: PublishWhatsAppFlowInput,
  ): Promise<PublishWhatsAppFlowResult> {
    this.assertFlowsSupported();
    return {
      provider: this.provider,
      externalFlowId: input.externalFlowId,
      status: "published",
    };
  }

  async sendFlow(input: SendWhatsAppFlowInput): Promise<ProviderMessageResult> {
    this.assertFlowsSupported();
    return this.send("flow", input, "sendFlow");
  }

  async handleFlowExchange(
    input: HandleWhatsAppFlowExchangeInput,
  ): Promise<HandleWhatsAppFlowExchangeResult> {
    this.assertFlowsSupported();
    if (this.flowExchangeFixture) {
      return {
        screen: this.flowExchangeFixture.screen,
        data: { ...this.flowExchangeFixture.data },
      };
    }
    return { screen: input.screen ?? "SUCCESS", data: { ...input.data } };
  }

  async validateWebhookSignature(input: ValidateWebhookInput): Promise<boolean> {
    void input;
    return this.signatureValid;
  }

  async normalizeWebhook(payload: unknown): Promise<NormalizedWhatsAppEvent[]> {
    const parsed = mockWebhookPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return [{
        kind: "unknown",
        provider: this.provider,
        eventId: `mock:unknown:${stableDigest(payload)}`,
        externalPhoneNumberId: null,
        externalWabaId: null,
        occurredAt: this.now().toISOString(),
        reason: "invalid_payload",
      }];
    }

    let events = parsed.data.events.map((event) => ({
      ...event,
      provider: this.provider,
    })) as NormalizedWhatsAppEvent[];
    if (this.duplicateEvents) events = events.flatMap((event) => [event, { ...event }]);
    if (this.outOfOrderEvents) events = [...events].reverse();
    return events;
  }

  simulateInboundText(input: SimulateInboundTextInput): NormalizedWhatsAppEvent {
    const eventId = `mock:in:${digest(
      `${input.externalPhoneNumberId}:${input.sender}:${input.idempotencyKey}`,
    ).slice(0, 32)}`;
    return {
      kind: "message.text",
      provider: this.provider,
      eventId,
      externalPhoneNumberId: input.externalPhoneNumberId,
      externalWabaId: input.externalWabaId ?? null,
      occurredAt: input.occurredAt ?? this.now().toISOString(),
      messageId: eventId,
      sender: input.sender,
      profileName: input.profileName ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      body: input.body,
    };
  }

  failNext(operation: MockOperation, count = 1): void {
    this.remainingFailures[operation] = Math.max(0, Math.trunc(count));
  }

  setDuplicateEvents(enabled: boolean): void {
    this.duplicateEvents = enabled;
  }

  setOutOfOrderEvents(enabled: boolean): void {
    this.outOfOrderEvents = enabled;
  }

  setSignatureValid(valid: boolean): void {
    this.signatureValid = valid;
  }

  clear(): void {
    this.messages.length = 0;
    this.readReceipts.length = 0;
    this.idempotentResults.clear();
  }

  private async send(
    kind: MockSentMessage["kind"],
    input: SendTextInput | SendInteractiveInput | SendTemplateInput | SendWhatsAppFlowInput,
    operation: MockOperation,
  ): Promise<ProviderMessageResult> {
    if (!/^\+[1-9][0-9]{7,14}$/.test(input.recipient)) {
      throw new WhatsAppProviderError("whatsapp_recipient_invalid", {
        retryable: false,
      });
    }
    const idempotencyScope = `${kind}:${input.idempotencyKey}`;
    const existing = this.idempotentResults.get(idempotencyScope);
    if (existing) return existing;

    this.maybeFail(operation);
    const result: ProviderMessageResult = {
      provider: this.provider,
      providerMessageId: `mock:out:${digest(
        `${kind}:${input.externalPhoneNumberId}:${input.recipient}:${input.idempotencyKey}`,
      ).slice(0, 32)}`,
      idempotencyKey: input.idempotencyKey,
      acceptedAt: this.now().toISOString(),
    };
    this.idempotentResults.set(idempotencyScope, result);
    if (kind === "text") {
      this.messages.push({ kind, input: input as SendTextInput, result });
    } else if (kind === "interactive") {
      this.messages.push({ kind, input: input as SendInteractiveInput, result });
    } else if (kind === "template") {
      this.messages.push({ kind, input: input as SendTemplateInput, result });
    } else {
      this.messages.push({ kind, input: input as SendWhatsAppFlowInput, result });
    }
    return result;
  }

  private maybeFail(operation: MockOperation): void {
    const operationFailures = this.remainingFailures[operation] ?? 0;
    if (operationFailures > 0) {
      this.remainingFailures[operation] = operationFailures - 1;
      throw new WhatsAppProviderError("whatsapp_mock_transient_failure", {
        retryable: true,
      });
    }
    if (this.sharedFailures > 0) {
      this.sharedFailures -= 1;
      throw new WhatsAppProviderError("whatsapp_mock_transient_failure", {
        retryable: true,
      });
    }
  }

  private assertFlowsSupported(): void {
    if (!this.capabilities.supportsFlows) {
      throw new WhatsAppProviderError("whatsapp_flows_unsupported", {
        retryable: false,
      });
    }
  }
}
