import "server-only";

import { formatInTimeZone } from "date-fns-tz";
import {
  conversationContextSchema,
  optionForTextInput,
  type ConversationContext,
  type ConversationOption,
  type ConversationState,
  type ConversationTransition,
} from "../domain/conversation";
import {
  mentionsOtherDate,
  parseAffirmation,
  parseIntent,
  parseSlotShortcut,
  parseTime,
  periodHours,
  type DayPeriod,
  type ParsedIntent,
} from "../domain/intent";
import * as copy from "../presentation/text-mode-copy";
import { textResponse } from "../presentation/conversation-responses";
import type {
  AvailableSlot,
  BookingTenantContext,
  ServiceOption,
  StaffOption,
} from "./booking-gateway";
import { attachContactToTenant } from "./resolve-tenant";
import type { TransitionInput } from "./transition-conversation";
import { formatTimeInTimezone, localDateBounds } from "@/lib/dates";

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

// Estados de pergunta fechada: só sim/não/trocar/cancelar são interpretados,
// nunca o parser completo — "sim, com a Maria" é confirmação, não novo pedido.
export const AFFIRMATION_STATES: ReadonlySet<ConversationState> = new Set<ConversationState>([
  "BOOKING_CONFIRMATION",
  "CANCELLATION_CONFIRMATION",
]);

// Passos da conversa reutilizados pelo modo texto. Ficam em
// `transition-conversation.ts` e chegam aqui por injeção para que os dois
// módulos não se importem em círculo. `body` é o texto em prosa (copy) que
// substitui a pergunta padrão do passo.
export interface TextModeSteps {
  serviceSelection(
    input: TransitionInput,
    context: ConversationContext,
    services: readonly ServiceOption[],
    body?: string,
  ): ConversationTransition;
  staffSelection(
    input: TransitionInput,
    context: ConversationContext,
    staff: readonly StaffOption[],
    body?: string,
  ): ConversationTransition;
  showDates(
    input: TransitionInput,
    context: ConversationContext,
    staffId: string | null,
    body?: string,
  ): Promise<ConversationTransition>;
  slotSelection(
    input: TransitionInput,
    context: ConversationContext,
    tenant: BookingTenantContext,
    date: string,
    slots: readonly AvailableSlot[],
    body: string,
  ): ConversationTransition;
  customerIdentification(
    input: TransitionInput,
    context: ConversationContext,
    tenant: BookingTenantContext,
    body?: string,
  ): ConversationTransition;
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

function withText(input: TransitionInput, text: string): TransitionInput {
  return text === input.message.text ? input : { ...input, message: { ...input.message, text } };
}

function today(tenant: BookingTenantContext): string {
  return formatInTimeZone(new Date(), tenant.timezone, "yyyy-MM-dd");
}

function dayLabel(date: string, tenant: BookingTenantContext): string {
  return copy.relativeDay(date, today(tenant));
}

function slotHour(slot: AvailableSlot, timezone: string): number {
  return Number(formatInTimeZone(slot.startAt, timezone, "H"));
}

function minutesOf(time: string): number {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function slotItems(slots: readonly AvailableSlot[], timezone: string): copy.SlotCopyItem[] {
  return slots.slice(0, 8).map((slot, index) => {
    const time = formatTimeInTimezone(slot.startAt, timezone);
    return { key: String(index + 1), label: `${time} · ${slot.staffName}`, time, staffName: slot.staffName };
  });
}

function items(list: readonly { id: string; name: string }[]): copy.CopyItem[] {
  return list.map((entry, index) => ({ key: String(index + 1), label: entry.name }));
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

// O que a frase entregou, em linguagem natural, para abrir a resposta
// seguinte: "corte e barba hoje às 14:00 com Rafael". Sem isso, "sexta"
// respondido com "Qual serviço?" parece que a data foi ignorada.
function describeUnderstood(
  parsed: ParsedIntent<ServiceOption, StaffOption>,
  tenant: BookingTenantContext,
): string | null {
  const parts = [
    parsed.service ? copy.decapitalize(parsed.service.name) : null,
    parsed.date ? dayLabel(parsed.date, tenant) : null,
    parsed.time ? `às ${parsed.time}` : parsed.period ? periodLabels[parsed.period] : null,
    parsed.staff ? `com ${parsed.staff.name}` : parsed.staffAny ? "sem preferência de profissional" : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" ") : null;
}

// Aviso pendente sobre um nome que não existe, consumido no passo em que a
// escolha do profissional acontece.
function pendingStaffNote(booking: Booking): string | null {
  return booking.requestedStaffName ? copy.staffNotFoundNote(booking.requestedStaffName) : null;
}

// Decide o próximo passo pela primeira lacuna do rascunho. Serve tanto à frase
// interpretada quanto à opção escolhida: nos dois casos o rascunho pode já ter
// data ou hora pedidas antes, e o fluxo pula o que já foi respondido.
async function advanceBookingDraft(
  input: TransitionInput,
  context: ConversationContext,
  tenant: BookingTenantContext,
  services: readonly ServiceOption[],
  steps: TextModeSteps,
  understood: string | null = null,
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
      copy.askService({ services: items(services), understood, note: pendingStaffNote(booking) }),
    );
  }

  if (typeof booking.staffId === "string") {
    const eligible = await input.gateway.listStaff(tenant.id, service.id);
    if (!eligible.some((person) => person.id === booking.staffId)) {
      const name = booking.staffName ?? "Esse profissional";
      const cleared = withBooking(context, { staffId: undefined, staffName: undefined });
      if (eligible.length === 0) {
        return steps.showDates(
          input,
          withBooking(cleared, { staffId: null }),
          null,
          copy.askDate({ understood, note: `${name} não atende ${copy.decapitalize(service.name)}, então vou seguir sem preferência.` }),
        );
      }
      return steps.staffSelection(
        input,
        cleared,
        eligible,
        copy.staffNotEligible({ name, service: service.name, staff: items(eligible), understood }),
      );
    }
  } else if (booking.staffId === undefined && service.allowStaffSelection) {
    // Uma pergunta só: quem, ou tanto faz. O nome que não existe entra aqui.
    const eligible = await input.gateway.listStaff(tenant.id, service.id);
    const requested = booking.requestedStaffName;
    const cleared = withBooking(context, { requestedStaffName: undefined });
    if (eligible.length === 0) {
      return advanceBookingDraft(input, withBooking(cleared, { staffId: null }), tenant, services, steps, understood);
    }
    return steps.staffSelection(
      input,
      cleared,
      eligible,
      requested
        ? copy.staffNotFound({ name: requested, service: service.name, staff: items(eligible), understood })
        : copy.askStaff({ service: service.name, staff: items(eligible), understood }),
    );
  }

  const staffId = booking.staffId ?? null;
  const note = pendingStaffNote(booking);
  const settled = note ? withBooking(context, { requestedStaffName: undefined }) : context;
  if (!booking.date) {
    return steps.showDates(input, settled, staffId, copy.askDate({ understood, note }));
  }
  // Na hora de oferecer horários o rascunho está completo: a recapitulação
  // ("corte e barba hoje com Rafael") vem dele, não só da última frase.
  const recap = [
    copy.decapitalize(service.name),
    dayLabel(booking.date, tenant),
    booking.staffName ? `com ${booking.staffName}` : null,
  ].filter((part): part is string => Boolean(part)).join(" ");

  const bounds = localDateBounds(booking.date, tenant.timezone);
  const slots = await input.gateway.getAvailableSlots({
    tenant,
    serviceId: service.id,
    staffId,
    rangeStart: bounds.from,
    rangeEnd: bounds.to,
  });
  const day = dayLabel(booking.date, tenant);
  if (slots.length === 0) {
    return steps.showDates(
      input,
      withBooking(settled, { date: undefined }),
      staffId,
      copy.askDate({ understood, note: [note, copy.noSlotsOnDate(day)].filter(Boolean).join(" ") }),
    );
  }

  if (booking.requestedTime) {
    const exact = slots.find(
      (slot) => formatTimeInTimezone(slot.startAt, tenant.timezone) === booking.requestedTime,
    );
    if (exact) {
      const filled = withBooking(settled, {
        locationId: tenant.locationId,
        startsAt: exact.startAt,
        endsAt: exact.endAt,
        staffId: exact.staffId,
        staffName: exact.staffName,
      });
      return booking.customerName
        ? steps.bookingReview(input, filled, tenant)
        : steps.customerIdentification(
          input,
          filled,
          tenant,
          copy.askName({ understood: `${day} às ${booking.requestedTime} com ${exact.staffName}` }),
        );
    }
    const nearest = nearestSlots(slots, booking.requestedTime, tenant.timezone, 5);
    return steps.slotSelection(
      input,
      settled,
      tenant,
      booking.date,
      nearest,
      copy.slotUnavailable({
        time: booking.requestedTime,
        dayLabel: day,
        slots: slotItems(nearest, tenant.timezone),
        understood: recap,
      }),
    );
  }

  if (booking.requestedPeriod) {
    const { from, to } = periodHours(booking.requestedPeriod);
    const inPeriod = slots.filter((slot) => {
      const hour = slotHour(slot, tenant.timezone);
      return hour >= from && hour < to;
    });
    if (inPeriod.length > 0) {
      return steps.slotSelection(
        input,
        settled,
        tenant,
        booking.date,
        inPeriod,
        copy.offerSlots({ understood: recap, note, dayLabel: day, slots: slotItems(inPeriod, tenant.timezone) }),
      );
    }
    return steps.slotSelection(
      input,
      settled,
      tenant,
      booking.date,
      slots,
      copy.noSlotsInPeriod({
        periodLabel: periodLabels[booking.requestedPeriod],
        dayLabel: day,
        slots: slotItems(slots, tenant.timezone),
        understood: recap,
      }),
    );
  }

  return steps.slotSelection(
    input,
    settled,
    tenant,
    booking.date,
    slots,
    copy.offerSlots({ understood: recap, note, dayLabel: day, slots: slotItems(slots, tenant.timezone) }),
  );
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
  const day = dayLabel(booking.date, tenant);
  if (slots.length === 0) {
    const dates = await steps.showRescheduleDates(
      withContext(input, withBooking(context, { date: undefined })),
    );
    return { ...dates, responses: [textResponse(`${copy.noSlotsOnDate(day)} ${copy.askRescheduleDate()}`)] };
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
    const nearest = nearestSlots(slots, booking.requestedTime, tenant.timezone, 5);
    return steps.slotSelection(
      input,
      context,
      tenant,
      booking.date,
      nearest,
      copy.slotUnavailable({ time: booking.requestedTime, dayLabel: day, slots: slotItems(nearest, tenant.timezone) }),
    );
  }
  return steps.slotSelection(
    input,
    context,
    tenant,
    booking.date,
    slots,
    copy.offerSlots({ dayLabel: day, slots: slotItems(slots, tenant.timezone) }),
  );
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
    return advanceBookingDraft(input, next, tenant, services, steps, copy.decapitalize(service.name));
  }
  if (state === "STAFF_PREFERENCE" && (option.value === "any" || option.value === "choose")) {
    // Conversas abertas antes de a pergunta de profissional virar uma só.
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
      withBooking(context, { staffId: option.value, staffName: option.label, requestedStaffName: undefined }),
      tenant,
      services,
      steps,
      `com ${option.label}`,
    );
  }
  if ((state === "DATE_SELECTION" || state === "BOOKING_CONFLICT") && option.kind === "date") {
    const services = await input.gateway.listServices(tenant.id);
    return advanceBookingDraft(
      input,
      withBooking(context, { date: option.value }),
      tenant,
      services,
      steps,
      dayLabel(option.value, tenant),
    );
  }
  return null;
}

// Resposta a uma pergunta fechada, mapeada para a opção equivalente. `null`
// quando a frase não é sim nem não — vira entrada inválida como sempre.
function affirmationOption(
  state: ConversationState,
  text: string,
  options: readonly ConversationOption[],
): ConversationOption | "clarify" | null {
  const answer = parseAffirmation(text);
  if (!answer) return null;
  const byValue = (value: string) => options.find((option) => option.value === value) ?? null;
  if (state === "CANCELLATION_CONFIRMATION") {
    return answer === "yes" || answer === "cancel" ? byValue("confirm_cancel") : byValue("back");
  }
  if (answer === "yes") return byValue("confirm");
  if (answer === "change") return byValue("change_slot");
  if (answer === "cancel") return byValue("cancel");
  // "não" sozinho no resumo não diz se é trocar o horário ou desistir.
  return "clarify";
}

// Ao escolher horário: hora escrita, "o primeiro", "o último", "outro dia".
function slotOption(
  text: string,
  options: readonly ConversationOption[],
  tenant: BookingTenantContext,
): ConversationOption | null {
  const slots = options.filter((option) => option.kind === "slot");
  if (mentionsOtherDate(text)) return options.find((option) => option.value === "other_date") ?? null;
  const shortcut = parseSlotShortcut(text);
  if (shortcut === "first") return slots[0] ?? null;
  if (shortcut === "last") return slots.at(-1) ?? null;
  const time = parseTime(text);
  if (!time) return null;
  return slots.find((option) => {
    const [startsAt] = option.value.split("|");
    return startsAt ? formatTimeInTimezone(startsAt, tenant.timezone) === time.time : false;
  }) ?? null;
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
  const { options } = conversation.context;

  if (AFFIRMATION_STATES.has(state)) {
    const answer = affirmationOption(state, message.text, options);
    if (answer === "clarify") {
      return {
        transition: {
          state,
          status: "waiting_customer",
          context: conversationContextSchema.parse({
            ...conversation.context,
            lastInboundMessageId: message.providerMessageId,
          }),
          responses: [textResponse(copy.clarifyConfirmation())],
        },
      };
    }
    if (answer) return { input: withText(input, answer.key) };
  }

  let option = optionForTextInput(options, message.text);
  if (!option && state === "SLOT_SELECTION") option = slotOption(message.text, options, tenant);
  if (option) {
    const rewritten = withText(input, option.key);
    if (!INTENT_CAPABLE_STATES.has(state)) return { input: rewritten };
    const transition = await applyOption(rewritten, option, tenant, steps);
    return transition ? { transition } : { input: rewritten };
  }
  if (!INTENT_CAPABLE_STATES.has(state)) return null;

  const [services, staff] = await Promise.all([
    input.gateway.listServices(tenantId),
    input.gateway.listAllStaff(tenantId),
  ]);
  const parsed = parseIntent(message.text, { today: today(tenant), services, staff });
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
  const understood = describeUnderstood(parsed, tenant);

  if (rescheduling) {
    return { transition: await advanceReschedule(input, withBooking(conversation.context, draft), tenant, steps) };
  }

  // No menu o rascunho anterior já foi limpo; uma frase de agendamento começa
  // um pedido novo.
  const base = state === "MAIN_MENU"
    ? conversationContextSchema.parse({ ...conversation.context, booking: { operation: "create" } })
    : conversation.context;
  if (parsed.serviceCandidates.length > 0) {
    return {
      transition: steps.serviceSelection(
        input,
        withBooking(base, draft),
        parsed.serviceCandidates,
        copy.serviceAmbiguous({ services: items(parsed.serviceCandidates), understood }),
      ),
    };
  }
  if (parsed.service) {
    draft.serviceId = parsed.service.id;
    draft.serviceName = parsed.service.name;
  }
  if (parsed.staff) {
    draft.staffId = parsed.staff.id;
    draft.staffName = parsed.staff.name;
    draft.requestedStaffName = undefined;
  } else if (parsed.staffAny) {
    draft.staffId = null;
    draft.staffName = undefined;
    draft.requestedStaffName = undefined;
  } else if (parsed.requestedStaffName) {
    draft.staffId = undefined;
    draft.requestedStaffName = parsed.requestedStaffName;
  }
  let context = withBooking(base, draft);
  if (parsed.staffCandidates.length > 0) {
    const [first] = parsed.staffCandidates;
    return {
      transition: steps.staffSelection(
        input,
        context,
        parsed.staffCandidates,
        copy.staffAmbiguous({ name: first?.name ?? "profissional", staff: items(parsed.staffCandidates), understood }),
      ),
    };
  }
  if (context.booking.serviceId) context = await ensureCustomer(input, context);
  return { transition: await advanceBookingDraft(input, context, tenant, services, steps, understood) };
}
