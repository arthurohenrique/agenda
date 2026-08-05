import { z } from "zod";

export const metaErrorSchema = z.object({
  code: z.union([z.string(), z.number()]).transform(String),
  title: z.string().max(500).optional(),
  message: z.string().max(1000).optional(),
  error_data: z.object({ details: z.string().max(1000).optional() }).passthrough().optional(),
}).passthrough();

export const metaContactSchema = z.object({
  wa_id: z.string().min(1).max(32),
  profile: z.object({ name: z.string().max(512).optional() }).passthrough().optional(),
}).passthrough();

export const metaMessageSchema = z.object({
  id: z.string().min(1).max(300),
  from: z.string().min(1).max(32),
  timestamp: z.string().max(32).optional(),
  type: z.string().min(1).max(80),
  context: z.object({ id: z.string().max(300).optional() }).passthrough().optional(),
  text: z.object({ body: z.string().max(4096) }).passthrough().optional(),
  button: z.object({
    payload: z.string().max(256).optional(),
    text: z.string().max(256).optional(),
  }).passthrough().optional(),
  interactive: z.object({
    type: z.string().max(80).optional(),
    button_reply: z.object({
      id: z.string().max(256),
      title: z.string().max(256),
    }).passthrough().optional(),
    list_reply: z.object({
      id: z.string().max(256),
      title: z.string().max(256),
      description: z.string().max(500).optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

const metaStatusBaseSchema = z.object({
  id: z.string().min(1).max(300),
  status: z.string().min(1).max(80),
  timestamp: z.string().max(32).optional(),
  recipient_id: z.string().min(1).max(32),
  conversation: z.object({ id: z.string().max(300).optional() }).passthrough().optional(),
}).passthrough();

export const metaStatusFragmentSchema = metaStatusBaseSchema.extend({
  errors: z.unknown().optional(),
});

const metaStatusSchema = metaStatusBaseSchema.extend({
  errors: z.array(metaErrorSchema).max(100).optional(),
});

const metaValueSchema = z.object({
  messaging_product: z.string().optional(),
  metadata: z.object({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string().optional(),
  }).passthrough().optional(),
  contacts: z.array(metaContactSchema).max(1000).optional(),
  messages: z.array(metaMessageSchema).max(1000).optional(),
  statuses: z.array(metaStatusSchema).max(1000).optional(),
  errors: z.array(metaErrorSchema).max(100).optional(),
}).passthrough();

const metaChangeSchema = z.object({
  field: z.string(),
  value: metaValueSchema,
}).passthrough();

const metaEntrySchema = z.object({
  id: z.string().min(1).max(200),
  changes: z.array(metaChangeSchema).max(100),
}).passthrough();

export const metaWebhookPayloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(metaEntrySchema).max(100),
}).passthrough();

export const metaWebhookSignatureSchema = z
  .string()
  .regex(/^sha256=[a-f0-9]{64}$/i);

export const metaMessageResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) }).passthrough()).min(1),
}).passthrough();

const normalizedEventBaseSchema = z.object({
  provider: z.enum(["mock", "meta_cloud"]),
  eventId: z.string().min(1).max(300),
  externalPhoneNumberId: z.string().min(1).max(200).nullable(),
  externalWabaId: z.string().min(1).max(200).nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
});

const normalizedInboundBaseSchema = normalizedEventBaseSchema.extend({
  messageId: z.string().min(1).max(300),
  sender: z.string().min(1).max(32),
  profileName: z.string().max(512).nullable(),
  replyToMessageId: z.string().max(300).nullable(),
});

export const normalizedWhatsAppEventSchema = z.discriminatedUnion("kind", [
  normalizedInboundBaseSchema.extend({
    kind: z.literal("message.text"),
    body: z.string().max(4096),
  }),
  normalizedInboundBaseSchema.extend({
    kind: z.literal("message.button"),
    buttonId: z.string().max(256),
    title: z.string().max(256),
  }),
  normalizedInboundBaseSchema.extend({
    kind: z.literal("message.list"),
    rowId: z.string().max(256),
    title: z.string().max(256),
    description: z.string().max(500).nullable(),
  }),
  normalizedInboundBaseSchema.extend({
    kind: z.literal("message.unsupported"),
    messageType: z.string().max(80),
  }),
  normalizedEventBaseSchema.extend({
    kind: z.literal("status"),
    messageId: z.string().min(1).max(300),
    recipient: z.string().min(1).max(32),
    status: z.string().min(1).max(80),
    conversationId: z.string().max(300).nullable(),
  }),
  normalizedEventBaseSchema.extend({
    kind: z.literal("error"),
    messageId: z.string().max(300).nullable(),
    code: z.string().max(120),
    title: z.string().max(500),
    details: z.string().max(1000).nullable(),
  }),
  normalizedEventBaseSchema.extend({
    kind: z.literal("unknown"),
    reason: z.enum(["invalid_payload", "unsupported_change", "empty_payload"]),
  }),
]);

export const mockWebhookPayloadSchema = z.object({
  events: z.array(normalizedWhatsAppEventSchema).max(1000),
});

export type MetaWebhookPayload = z.infer<typeof metaWebhookPayloadSchema>;
export type MetaWebhookValue = z.infer<typeof metaValueSchema>;
export type MetaWebhookMessage = z.infer<typeof metaMessageSchema>;
export type MetaWebhookStatus = z.infer<typeof metaStatusSchema>;
export type MetaWebhookError = z.infer<typeof metaErrorSchema>;
