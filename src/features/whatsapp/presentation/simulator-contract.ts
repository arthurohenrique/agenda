import { z } from "zod";

export const whatsappSimulatorInputSchema = z.object({
  receiverPhoneNumberId: z.string().min(1).max(160),
  customerPhone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  message: z.string().trim().min(1).max(4096),
  interactionType: z.enum(["text", "button", "list"]),
  selectionId: z.string().trim().max(200).optional(),
  conversationId: z.guid().optional(),
  simulation: z.object({
    duplicate: z.boolean(),
    providerFailure: z.boolean(),
    outOfOrder: z.boolean(),
    delayMs: z.union([z.literal(0), z.literal(500), z.literal(2000)]),
  }),
}).superRefine((input, context) => {
  if (input.interactionType !== "text" && !input.selectionId) {
    context.addIssue({
      code: "custom",
      path: ["selectionId"],
      message: "Identificador obrigatório para botão ou lista.",
    });
  }
});

export type WhatsAppSimulatorInput = z.infer<typeof whatsappSimulatorInputSchema>;

const conversationResponseSchema = z.object({
  kind: z.enum(["text", "reply_buttons", "list", "template", "flow"]),
  body: z.string().optional(),
  text: z.string().optional(),
}).passthrough();

const transcriptMessageSchema = z.object({
  id: z.string().optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  body: z.string().optional(),
  text: z.string().optional(),
  content: z.string().optional(),
  kind: z.string().optional(),
}).passthrough();

const deliveryAttemptSchema = z.object({
  claimed: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const whatsappSimulatorResponseSchema = z.object({
  correlationId: z.string().optional(),
  conversation: z.object({
    id: z.guid(),
    currentState: z.string().optional(),
    state: z.string().optional(),
    status: z.string().optional(),
    options: z.array(z.object({
      key: z.string(),
      label: z.string(),
      value: z.string(),
      kind: z.string(),
    })).optional(),
  }).nullable().optional(),
  tenant: z.object({
    id: z.guid().optional(),
    name: z.string(),
    slug: z.string().optional(),
  }).nullable().optional(),
  messages: z.array(transcriptMessageSchema).optional().default([]),
  responses: z.array(conversationResponseSchema).optional().default([]),
  appointment: z.object({
    id: z.guid(),
    startsAt: z.string().optional(),
  }).nullable().optional(),
  delivery: z.object({
    providerFailureInjected: z.boolean(),
    attempts: z.union([z.literal(1), z.literal(2)]),
    firstAttempt: deliveryAttemptSchema,
    retryAttempt: deliveryAttemptSchema.nullable(),
    recovered: z.boolean(),
  }).nullable().optional(),
}).passthrough();

export type WhatsAppSimulatorResponse = z.infer<typeof whatsappSimulatorResponseSchema>;
