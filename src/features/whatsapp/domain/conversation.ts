import { z } from "zod";
import { normalizeCommand, normalizeWords } from "@/lib/text/normalize";

export const conversationStates = [
  "START",
  "TENANT_RESOLUTION",
  "TENANT_CONFIRMATION",
  "TENANT_SEARCH",
  "TENANT_SELECTION",
  "UPCOMING_APPOINTMENT_ACTION",
  "MAIN_MENU",
  "SERVICE_SELECTION",
  "ADDON_SELECTION",
  "STAFF_PREFERENCE",
  "STAFF_SELECTION",
  "DATE_SELECTION",
  "SLOT_SELECTION",
  "CUSTOMER_IDENTIFICATION",
  "CUSTOMER_DATA_CONFIRMATION",
  "APPOINTMENT_NOTES",
  "BOOKING_REVIEW",
  "BOOKING_CONFIRMATION",
  "BOOKING_PROCESSING",
  "BOOKING_COMPLETED",
  "BOOKING_CONFLICT",
  "RESCHEDULE_SELECTION",
  "CANCELLATION_CONFIRMATION",
  "HUMAN_HANDOFF",
  "CANCELLED",
  "EXPIRED",
  "ERROR_RECOVERY",
] as const;

export const conversationStateSchema = z.enum(conversationStates);
export type ConversationState = z.infer<typeof conversationStateSchema>;

export const conversationStatuses = [
  "open",
  "waiting_customer",
  "processing",
  "human_handoff",
  "completed",
  "expired",
  "closed",
  "failed",
] as const;

export const conversationStatusSchema = z.enum(conversationStatuses);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const conversationOptionSchema = z.object({
  key: z.string().min(1).max(32),
  label: z.string().min(1).max(160),
  value: z.string().min(1).max(400),
  kind: z.enum(["tenant", "service", "staff", "date", "slot", "action", "page"]),
});

export type ConversationOption = z.infer<typeof conversationOptionSchema>;

const bookingDraftSchema = z.object({
  operation: z.enum(["create", "reschedule"]).default("create"),
  appointmentId: z.guid().optional(),
  locationId: z.guid().optional(),
  serviceId: z.guid().optional(),
  serviceName: z.string().max(160).optional(),
  staffId: z.guid().nullable().optional(),
  staffName: z.string().max(160).optional(),
  date: z.iso.date().optional(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  customerName: z.string().max(120).optional(),
  customerEmail: z.union([z.email(), z.literal("")]).optional(),
  notes: z.string().max(800).optional(),
  // Modo texto: hora ou período pedidos numa frase antes de a data ou o serviço
  // estarem definidos. Aplicados quando os horários do dia são consultados.
  requestedTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  requestedPeriod: z.enum(["morning", "afternoon", "evening"]).optional(),
  // Nome de profissional pedido que não existe no cadastro. Fica até o
  // profissional ser resolvido, para o aviso sair no passo certo.
  requestedStaffName: z.string().max(80).optional(),
});

export const conversationContextSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  locale: z.string().min(2).max(16).default("pt-BR"),
  options: z.array(conversationOptionSchema).max(100).default([]),
  attempts: z.record(z.string(), z.number().int().min(0).max(20)).default({}),
  booking: bookingDraftSchema.default({ operation: "create" }),
  routing: z
    .object({
      source: z.enum(["direct_number", "routing_code", "active_session", "history", "search"])
        .optional(),
      code: z.string().max(64).optional(),
      searchQuery: z.string().max(80).optional(),
    })
    .default({}),
  handoff: z
    .object({
      reason: z.string().min(1).max(1000),
      requestedBy: z.enum(["customer", "automation"]),
    })
    .optional(),
  customerId: z.guid().optional(),
  customerTenantId: z.guid().optional(),
  lastInboundMessageId: z.string().max(300).optional(),
  lastPromptAt: z.iso.datetime({ offset: true }).optional(),
  // Última pergunta feita ao cliente. Permite repeti-la quando ele toca num
  // botão de mensagem antiga, em vez de responder com um aviso técnico.
  prompt: z.string().max(1024).optional(),
  // Mensagem cujo botão já foi consumido. Cada pergunta interativa vale um
  // toque: sem isso, dois toques no mesmo balão avançam dois passos.
  answeredPromptId: z.string().max(300).optional(),
});

export type ConversationContext = z.infer<typeof conversationContextSchema>;

export interface PersistedConversation {
  id: string;
  phoneNumberId: string;
  contactId: string;
  tenantId: string | null;
  status: ConversationStatus;
  currentState: ConversationState;
  serviceWindowExpiresAt: string | null;
  sessionExpiresAt: string | null;
  lastInboundAt: string | null;
  version: number;
  context: ConversationContext;
}

export interface ConversationTransition {
  state: ConversationState;
  status?: ConversationStatus;
  context: ConversationContext;
  responses: import("./provider").ConversationResponse[];
  tenantId?: string | null;
  restartReason?: "tenant_change" | "session_expired";
}

export interface ConversationStateHandler<Input> {
  readonly state: ConversationState;
  handle(input: Input): Promise<ConversationTransition>;
}

export function optionForInput(
  options: readonly ConversationOption[],
  input: string,
): ConversationOption | null {
  const normalized = input.trim();
  return options.find((option) => option.key === normalized) ?? null;
}

// Modo texto: além da chave ("2"), aceita o rótulo da opção escrito por
// extenso ("quero escolher", "sim, cancelar") e "mais" para a paginação. A
// comparação é da mensagem inteira, como nos comandos globais: casar por
// substring faria "corte" escolher "Corte e barba".
export function optionForTextInput(
  options: readonly ConversationOption[],
  input: string,
): ConversationOption | null {
  const exact = optionForInput(options, input);
  if (exact) return exact;
  const command = normalizeCommand(input);
  if (!command) return null;
  if (["mais", "ver mais", "more"].includes(command)) {
    return options.find((option) => option.kind === "page") ?? null;
  }
  const words = normalizeWords(input);
  return options.find(
    (option) => option.kind !== "page" && normalizeWords(option.label) === words,
  ) ?? null;
}

export function nextAttempt(context: ConversationContext, state: ConversationState) {
  const attempts = (context.attempts[state] ?? 0) + 1;
  return {
    attempts,
    context: {
      ...context,
      attempts: { ...context.attempts, [state]: attempts },
    },
  };
}
