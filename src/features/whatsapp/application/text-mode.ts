import "server-only";

import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  conversationContextSchema,
  optionForTextInput,
  type ConversationContext,
  type ConversationOption,
  type ConversationState,
  type ConversationTransition,
} from "../domain/conversation";
import { parseIntent, periodHours, type DayPeriod, type ParsedIntent } from "../domain/intent";
import { textResponse } from "../presentation/conversation-responses";
import type {
  AvailableSlot,
  BookingTenantContext,
  ServiceOption,
  StaffOption,
} from "./booking-gateway";
import { attachContactToTenant } from "./resolve-tenant";
import type { TransitionInput } from "./transition-conversation";
import { formatDateInTimezone, formatTimeInTimezone, localDateBounds } from "@/lib/dates";

// Estados em que uma frase é uma instrução de agendamento. Fora deles o texto
// é nome, busca ou resposta sim/não, e interpretar palavras soltas ali faria
// "ajuda maria" virar pedido de atendente em vez de nome — a mesma razão pela
// qual os comandos globais comparam a mensagem inteira.
export const INTENT_CAPABLE_STATES: ReadonlySet<ConversationState> = new Set<ConversationState>([
  "MAIN_MENU",
  "SERVICE_SELECTION",
  "STAFF_PREFERENCE",
  "STAFF_SELECTION",
  "DATE_SELECTION",
  "SLOT_SELECTION",
  "BOOKING_CONFLICT",
  "RESCHEDULE_SELECTION",
]);

// Passos da conversa reutilizados pelo modo texto. Ficam em
// `transition-conversation.ts` e chegam aqui por injeção para que os dois
// módulos não se importem em círculo.
export interface TextModeSteps {
  serviceSelection(
    input: TransitionInput,
    context: ConversationContext,
    services: readonly ServiceOption[],
    greeting?: string,
  ): ConversationTransition;
  staffPreference(input: TransitionInput, context: ConversationContext): ConversationTransition;
  staffSelection(
    input: TransitionInput,
    context: ConversationContext,
    staff: readonly StaffOption[],
  ): ConversationTransition;
  showDates(
    input: TransitionInput,
    context: ConversationContext,
    staffId: string | null,
  ): Promise<ConversationTransition>;
  slotSelection(
    input: TransitionInput,
    context: ConversationContext,
    tenant: BookingTenantContext,
    date: string,
    slots: readonly AvailableSlot[],
    prompt: string,
  ): ConversationTransition;
  customerIdentification(input: TransitionInput, context: ConversationContext): ConversationTransition;
  bookingReview(
    input: TransitionInput,
    context: ConversationContext,
    tenant: BookingTenantContext,
  ): ConversationTransition;
  rescheduleConfirmation(
    input: TransitionInput,
    context: ConversationContext,
    tenant: BookingTenantContext,
  ): ConversationTransition;
  showRescheduleDates(input: TransitionInput): Promise<ConversationTransition>;
  handoff(input: TransitionInput, reason: string): Promise<ConversationTransition>;
  showUpcomingBookings(input: TransitionInput): Promise<ConversationTransition>;
}

export type TextModeResult =
  | { transition: ConversationTransition }
  // Mensagem reescrita (rótulo → chave) para o handler do estado tratar.
  | { input: TransitionInput };

type Booking = ConversationContext["booking"];

function withBooking(context: ConversationContext, booking: Partial<Booking>): ConversationContext {
  return conversationContextSchema.parse({ ...context, booking: { ...context.booking, ...booking } });
}

function withContext(input: TransitionInput, context: ConversationContext): TransitionInput {
  return { ...input, conversation: { ...input.conversation, context } };
}

function prepend(transition: ConversationTransition, body: string): ConversationTransition {
  return { ...transition, responses: [textResponse(body), ...transition.responses] };
}

function localDate(date: string, timezone: string): string {
  return formatDateInTimezone(parseISO(`${date}T12:00:00`), timezone);
}

function slotHour(slot: AvailableSlot, timezone: string): number {
  return Number(formatInTimeZone(slot.startAt, timezone, "H"));
}

function minutesOf(time: string): number {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function nearestSlots(
  slots: readonly AvailableSlot[],
  time: string,
  timezone: string,
  limit: number,
): AvailableSlot[] {
  const wanted = minutesOf(time);
  return [...slots]
    .map((slot) => ({
      slot,
      distance: Math.abs(minutesOf(formatTimeInTimezone(slot.startAt, timezone)) - wanted),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, limit)
    .map(({ slot }) => slot)
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
}

const periodLabels: Record<DayPeriod, string> = {
  morning: "de manhã",
  afternoon: "à tarde",
  evening: "à noite",
};

async function ensureCustomer(
  input: TransitionInput,
  context: ConversationContext,
): Promise<ConversationContext> {
  if (context.customerId && context.customerTenantId) return context;
  if (!input.conversation.tenantId) throw new Error("conversation_tenant_missing");
  const customer = await attachContactToTenant({
    conversationId: input.conversation.id,
    contactId: input.contact.id,
    tenantId: input.conversation.tenantId,
    profileName: input.contact.profileName,
  });
  return conversationContextSchema.parse({
    ...context,
    customerId: customer.customerId,
    customerTenantId: customer.customerTenantId,
  });
}

// Uma linha confirmando o que a frase entregou. Sem ela, "sexta" respondido
// com "Qual serviço deseja agendar?" parece que a data foi ignorada.
function acknowledgement(
  parsed: ParsedIntent<ServiceOption, StaffOption>,
  timezone: string,
): string | null {
  const parts = [
    parsed.service?.name,
    parsed.date ? localDate(parsed.date, timezone) : null,
    parsed.time,
    parsed.period && !parsed.time ? periodLabels[parsed.period] : null,
    parsed.staff ? `com ${parsed.staff.name}` : parsed.staffAny ? "sem preferência de profissional" : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? `Anotei: ${parts.join(" · ")}.` : null;
}

// Decide o próximo passo pela primeira lacuna do rascunho. Serve tanto à frase
// interpretada quanto à opção numerada: nos dois casos o rascunho pode já ter
// data ou hora pedidas antes, e o fluxo pula o que já foi respondido.
async function advanceBookingDraft(
  input: TransitionInput,
  context: ConversationContext,
  tenant: BookingTenantContext,
  services: readonly ServiceOption[],
  steps: TextModeSteps,
): Promise<ConversationTransition> {
  const { booking } = context;
  const service = booking.serviceId
    ? services.find((item) => item.id === booking.serviceId)
    : undefined;
  if (!service) {
    return steps.serviceSelection(
      input,
      withBooking(context, { serviceId: undefined, serviceName: undefined }),
      services,
    );
  }

  if (typeof booking.staffId === "string") {
    const eligible = await input.gateway.listStaff(tenant.id, service.id);
    if (!eligible.some((person) => person.id === booking.staffId)) {
      const name = booking.staffName ?? "Esse profissional";
      const cleared = withBooking(context, { staffId: undefined, staffName: undefined });
      if (eligible.length === 0) {
        return prepend(
          await steps.showDates(input, cleared, null),
          `${name} não atende ${service.name}. Vamos seguir sem preferência de profissional.`,
        );
      }
      return prepend(
        steps.staffSelection(input, cleared, eligible),
        `${name} não atende ${service.name}. Quem pode atender:`,
      );
    }
  } else if (booking.staffId === undefined && service.allowStaffSelection) {
    return steps.staffPreference(input, context);
  }

  const staffId = booking.staffId ?? null;
  if (!booking.date) return steps.showDates(input, context, staffId);

  const bounds = localDateBounds(booking.date, tenant.timezone);
  const slots = await input.gateway.getAvailableSlots({
    tenant,
    serviceId: service.id,
    staffId,
    rangeStart: bounds.from,
    rangeEnd: bounds.to,
  });
  if (slots.length === 0) {
    return prepend(
      await steps.showDates(input, withBooking(context, { date: undefined }), staffId),
      `Não encontrei horários em ${localDate(booking.date, tenant.timezone)}.`,
    );
  }

  if (booking.requestedTime) {
    const exact = slots.find(
      (slot) => formatTimeInTimezone(slot.startAt, tenant.timezone) === booking.requestedTime,
    );
    if (exact) {
      const filled = withBooking(context, {
        locationId: tenant.locationId,
        startsAt: exact.startAt,
        endsAt: exact.endAt,
        staffId: exact.staffId,
        staffName: exact.staffName,
      });
      return booking.customerName
        ? steps.bookingReview(input, filled, tenant)
        : steps.customerIdentification(input, filled);
    }
    return steps.slotSelection(
      input,
      context,
      tenant,
      booking.date,
      nearestSlots(slots, booking.requestedTime, tenant.timezone, 5),
      `Não tenho ${booking.requestedTime} em ${localDate(booking.date, tenant.timezone)}. Horários mais próximos:`,
    );
  }

  if (booking.requestedPeriod) {
    const { from, to } = periodHours(booking.requestedPeriod);
    const inPeriod = slots.filter((slot) => {
      const hour = slotHour(slot, tenant.timezone);
      return hour >= from && hour < to;
    });
    if (inPeriod.length > 0) {
      return steps.slotSelection(input, context, tenant, booking.date, inPeriod, "Escolha um horário:");
    }
    return steps.slotSelection(
      input,
      context,
      tenant,
      booking.date,
      slots,
      `Não há horários ${periodLabels[booking.requestedPeriod]} nesse dia. Outros horários:`,
    );
  }

  return steps.slotSelection(input, context, tenant, booking.date, slots, "Escolha um horário:");
}

// Reagendamento em modo texto: só data e hora são interpretadas.
async function advanceReschedule(
  input: TransitionInput,
  context: ConversationContext,
  tenant: BookingTenantContext,
  steps: TextModeSteps,
): Promise<ConversationTransition> {
  const { booking } = context;
  if (!booking.date) return steps.showRescheduleDates(withContext(input, context));
  const { customerId } = context;
  const { appointmentId } = booking;
  if (!customerId || !appointmentId) throw new Error("conversation_reschedule_context_invalid");
  const bounds = localDateBounds(booking.date, tenant.timezone);
  const slots = await input.gateway.getRescheduleSlots({
    tenantId: tenant.id,
    customerId,
    appointmentId,
    rangeStart: bounds.from,
    rangeEnd: bounds.to,
    staffId: null,
  });
  if (slots.length === 0) {
    return prepend(
      await steps.showRescheduleDates(withContext(input, withBooking(context, { date: undefined }))),
      `Não há horários em ${localDate(booking.date, tenant.timezone)}.`,
    );
  }
  if (booking.requestedTime) {
    const exact = slots.find(
      (slot) => formatTimeInTimezone(slot.startAt, tenant.timezone) === booking.requestedTime,
    );
    if (exact) {
      return steps.rescheduleConfirmation(
        input,
        withBooking(context, {
          startsAt: exact.startAt,
          endsAt: exact.endAt,
          staffId: exact.staffId,
          staffName: exact.staffName,
        }),
        tenant,
      );
    }
    return steps.slotSelection(
      input,
      context,
      tenant,
      booking.date,
      nearestSlots(slots, booking.requestedTime, tenant.timezone, 5),
      `Não tenho ${booking.requestedTime} em ${localDate(booking.date, tenant.timezone)}. Horários mais próximos:`,
    );
  }
  return steps.slotSelection(input, context, tenant, booking.date, slots, "Escolha o novo horário:");
}

// Opção escolhida por número ou rótulo num passo do agendamento. Reproduz o
// efeito do handler do estado sobre o rascunho e deixa `advanceBookingDraft`
// decidir o próximo passo, para que data ou hora pedidas antes sejam
// aproveitadas. Paginação e ações sem efeito no rascunho voltam ao handler.
async function applyOption(
  input: TransitionInput,
  option: ConversationOption,
  tenant: BookingTenantContext,
  steps: TextModeSteps,
): Promise<ConversationTransition | null> {
  const { context } = input.conversation;
  const state = input.conversation.currentState;
  if (context.booking.operation === "reschedule") {
    if (state === "RESCHEDULE_SELECTION" && option.kind === "date") {
      return advanceReschedule(input, withBooking(context, { date: option.value }), tenant, steps);
    }
    return null;
  }
  if (state === "SERVICE_SELECTION" && option.kind === "service") {
    const services = await input.gateway.listServices(tenant.id);
    const service = services.find((item) => item.id === option.value);
    if (!service) return null;
    const next = await ensureCustomer(
      input,
      withBooking(context, { serviceId: service.id, serviceName: service.name }),
    );
    return advanceBookingDraft(input, next, tenant, services, steps);
  }
  if (state === "STAFF_PREFERENCE" && (option.value === "any" || option.value === "choose")) {
    const services = await input.gateway.listServices(tenant.id);
    if (option.value === "any") {
      return advanceBookingDraft(
        input,
        withBooking(context, { staffId: null, staffName: undefined }),
        tenant,
        services,
        steps,
      );
    }
    const { serviceId } = context.booking;
    if (!serviceId) throw new Error("conversation_booking_context_invalid");
    const staff = await input.gateway.listStaff(tenant.id, serviceId);
    if (staff.length === 0) {
      return advanceBookingDraft(input, withBooking(context, { staffId: null }), tenant, services, steps);
    }
    return steps.staffSelection(input, context, staff);
  }
  if (state === "STAFF_SELECTION" && option.kind === "staff") {
    const services = await input.gateway.listServices(tenant.id);
    return advanceBookingDraft(
      input,
      withBooking(context, { staffId: option.value, staffName: option.label }),
      tenant,
      services,
      steps,
    );
  }
  if ((state === "DATE_SELECTION" || state === "BOOKING_CONFLICT") && option.kind === "date") {
    const services = await input.gateway.listServices(tenant.id);
    return advanceBookingDraft(input, withBooking(context, { date: option.value }), tenant, services, steps);
  }
  return null;
}

// Entrada do modo texto. Devolve `null` quando o modo não se aplica ou nada foi
// reconhecido — aí o handler do estado segue como sempre, e a entrada inválida
// conta tentativa como no modo botões.
export async function handleTextModeMessage(
  input: TransitionInput,
  steps: TextModeSteps,
): Promise<TextModeResult | null> {
  const { conversation, message } = input;
  const tenantId = conversation.tenantId;
  if (!tenantId || message.messageType !== "text") return null;
  const tenant = await input.gateway.getTenantContext(tenantId);
  if (tenant.interactionMode !== "text") return null;
  const state = conversation.currentState;

  const option = optionForTextInput(conversation.context.options, message.text);
  if (option) {
    const rewritten = option.key === message.text.trim()
      ? input
      : { ...input, message: { ...message, text: option.key } };
    if (!INTENT_CAPABLE_STATES.has(state)) return { input: rewritten };
    const transition = await applyOption(rewritten, option, tenant, steps);
    return transition ? { transition } : { input: rewritten };
  }
  if (!INTENT_CAPABLE_STATES.has(state)) return null;

  const [services, staff] = await Promise.all([
    input.gateway.listServices(tenantId),
    input.gateway.listAllStaff(tenantId),
  ]);
  const today = formatInTimeZone(new Date(), tenant.timezone, "yyyy-MM-dd");
  const parsed = parseIntent(message.text, { today, services, staff });
  if (!parsed.matched) return null;

  if (parsed.intent === "human") {
    return { transition: await steps.handoff(input, "customer_request") };
  }
  const rescheduling = conversation.context.booking.operation === "reschedule";
  if (
    !rescheduling
    && (parsed.intent === "upcoming" || parsed.intent === "cancel" || parsed.intent === "reschedule")
  ) {
    return { transition: await steps.showUpcomingBookings(input) };
  }

  const draft: Partial<Booking> = {};
  if (parsed.date) draft.date = parsed.date;
  if (parsed.time) draft.requestedTime = parsed.time;
  if (parsed.period) draft.requestedPeriod = parsed.period;
  const note = acknowledgement(parsed, tenant.timezone);
  const finish = (transition: ConversationTransition) => ({
    transition: note ? prepend(transition, note) : transition,
  });

  if (rescheduling) {
    return finish(await advanceReschedule(
      input,
      withBooking(conversation.context, draft),
      tenant,
      steps,
    ));
  }

  // No menu o rascunho anterior já foi limpo; uma frase de agendamento começa
  // um pedido novo.
  const base = state === "MAIN_MENU"
    ? conversationContextSchema.parse({ ...conversation.context, booking: { operation: "create" } })
    : conversation.context;
  if (parsed.serviceCandidates.length > 0) {
    return finish(steps.serviceSelection(
      input,
      withBooking(base, draft),
      parsed.serviceCandidates,
      "Encontrei mais de um serviço parecido. Qual deles?",
    ));
  }
  if (parsed.service) {
    draft.serviceId = parsed.service.id;
    draft.serviceName = parsed.service.name;
  }
  if (parsed.staff) {
    draft.staffId = parsed.staff.id;
    draft.staffName = parsed.staff.name;
  } else if (parsed.staffAny) {
    draft.staffId = null;
    draft.staffName = undefined;
  }
  let context = withBooking(base, draft);
  if (parsed.staffCandidates.length > 0) {
    return finish(prepend(
      steps.staffSelection(input, context, parsed.staffCandidates),
      "Há mais de um profissional com esse nome. Qual deles?",
    ));
  }
  if (context.booking.serviceId) context = await ensureCustomer(input, context);
  return finish(await advanceBookingDraft(input, context, tenant, services, steps));
}
