export type WhatsAppProviderName = "meta_cloud" | "mock";

export interface WhatsAppProviderCapabilities {
  maxReplyButtons: number;
  maxListRows: number;
  supportsFlows: boolean;
  supportsTemplates: boolean;
}

export interface ReplyButton {
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export type TemplateComponent = Record<string, unknown>;

export type ConversationResponse =
  | { kind: "text"; body: string }
  | { kind: "reply_buttons"; body: string; buttons: ReplyButton[] }
  | {
      kind: "list";
      body: string;
      buttonText: string;
      sections: ListSection[];
    }
  | {
      kind: "template";
      name: string;
      language: string;
      components: TemplateComponent[];
    }
  | {
      kind: "flow";
      flowId: string;
      flowToken: string;
      body: string;
    };

export interface OutboundMessageInput {
  idempotencyKey: string;
  externalPhoneNumberId: string;
  recipient: string;
}

export interface SendTextInput extends OutboundMessageInput {
  body: string;
  replyToMessageId?: string;
}

export interface SendInteractiveInput extends OutboundMessageInput {
  response: Extract<ConversationResponse, { kind: "reply_buttons" | "list" }>;
  replyToMessageId?: string;
}

export interface SendTemplateInput extends OutboundMessageInput {
  response: Extract<ConversationResponse, { kind: "template" }>;
}

export interface MarkAsReadInput {
  externalPhoneNumberId: string;
  messageId: string;
}

export interface CreateWhatsAppFlowInput {
  idempotencyKey: string;
  externalWabaId: string;
  name: string;
  categories: string[];
}

export interface CreateWhatsAppFlowResult {
  provider: WhatsAppProviderName;
  externalFlowId: string;
  status: "draft";
}

export interface PublishWhatsAppFlowInput {
  idempotencyKey: string;
  externalWabaId: string;
  externalFlowId: string;
}

export interface PublishWhatsAppFlowResult {
  provider: WhatsAppProviderName;
  externalFlowId: string;
  status: "published";
}

export interface SendWhatsAppFlowInput extends OutboundMessageInput {
  response: Extract<ConversationResponse, { kind: "flow" }>;
}

export interface HandleWhatsAppFlowExchangeInput {
  flowToken: string;
  action: string;
  screen: string | null;
  data: Record<string, unknown>;
}

export interface HandleWhatsAppFlowExchangeResult {
  screen: string;
  data: Record<string, unknown>;
}

export interface ValidateWebhookInput {
  rawBody: string | Uint8Array;
  signature: string | null;
}

export interface ProviderMessageResult {
  provider: WhatsAppProviderName;
  providerMessageId: string;
  idempotencyKey: string;
  acceptedAt: string;
}

interface NormalizedEventBase {
  provider: WhatsAppProviderName;
  eventId: string;
  externalPhoneNumberId: string | null;
  externalWabaId: string | null;
  occurredAt: string;
}

interface NormalizedInboundMessageBase extends NormalizedEventBase {
  messageId: string;
  sender: string;
  profileName: string | null;
  replyToMessageId: string | null;
}

export type NormalizedWhatsAppEvent =
  | (NormalizedInboundMessageBase & {
      kind: "message.text";
      body: string;
    })
  | (NormalizedInboundMessageBase & {
      kind: "message.button";
      buttonId: string;
      title: string;
    })
  | (NormalizedInboundMessageBase & {
      kind: "message.list";
      rowId: string;
      title: string;
      description: string | null;
    })
  | (NormalizedInboundMessageBase & {
      kind: "message.unsupported";
      messageType: string;
    })
  | (NormalizedEventBase & {
      kind: "status";
      messageId: string;
      recipient: string;
      status: string;
      conversationId: string | null;
    })
  | (NormalizedEventBase & {
      kind: "error";
      messageId: string | null;
      code: string;
      title: string;
      details: string | null;
    })
  | (NormalizedEventBase & {
      kind: "unknown";
      reason: "invalid_payload" | "unsupported_change" | "empty_payload";
    });

export type NormalizedInboundWhatsAppEvent = Extract<
  NormalizedWhatsAppEvent,
  {
    kind:
      | "message.text"
      | "message.button"
      | "message.list"
      | "message.unsupported";
  }
>;

export function isNormalizedInboundWhatsAppEvent(
  event: NormalizedWhatsAppEvent,
): event is NormalizedInboundWhatsAppEvent {
  return event.kind.startsWith("message.");
}

export interface WhatsAppProvider {
  readonly provider: WhatsAppProviderName;
  readonly capabilities: WhatsAppProviderCapabilities;
  sendText(input: SendTextInput): Promise<ProviderMessageResult>;
  sendInteractive(input: SendInteractiveInput): Promise<ProviderMessageResult>;
  sendTemplate(input: SendTemplateInput): Promise<ProviderMessageResult>;
  markAsRead(input: MarkAsReadInput): Promise<void>;
  validateWebhookSignature(input: ValidateWebhookInput): Promise<boolean>;
  normalizeWebhook(payload: unknown): Promise<NormalizedWhatsAppEvent[]>;
}

export interface WhatsAppFlowProvider extends WhatsAppProvider {
  createFlow(input: CreateWhatsAppFlowInput): Promise<CreateWhatsAppFlowResult>;
  publishFlow(input: PublishWhatsAppFlowInput): Promise<PublishWhatsAppFlowResult>;
  sendFlow(input: SendWhatsAppFlowInput): Promise<ProviderMessageResult>;
  handleFlowExchange(
    input: HandleWhatsAppFlowExchangeInput,
  ): Promise<HandleWhatsAppFlowExchangeResult>;
}

export class WhatsAppProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly deliveryUnknown: boolean;

  constructor(code: string, options: {
    retryable: boolean;
    status?: number;
    deliveryUnknown?: boolean;
  }) {
    super(code);
    this.name = "WhatsAppProviderError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.deliveryUnknown = options.deliveryUnknown ?? false;
  }
}
