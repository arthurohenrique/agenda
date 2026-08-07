import "server-only";

import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  conversationContextSchema,
  nextAttempt,
  optionForInput,
  type ConversationContext,
  type ConversationOption,
  type ConversationState,
  type ConversationTransition,
  type PersistedConversation,
} from "../domain/conversation";
import type { ConversationResponse } from "../domain/provider";
import {
  attachContactToTenant,
  extractRoutingCode,
  getWhatsAppTenantById,
  resolveWhatsAppTenant,
  searchWhatsAppTenants,
  type TenantCandidate,
} from "./resolve-tenant";
import {
  whatsappIdempotencyKey,
  type WhatsAppBookingGateway,
} from "./booking-gateway";
import { isExplicitOptOut, recordOptOut } from "./messaging-policy";
import {
  type WhatsAppContact,
  type WhatsAppPhoneNumber,
} from "../infrastructure/repositories/channel-repository";
import {
  bookingStartResponses,
  listResponse,
  replyButtonsResponse,
  textResponse,
} from "../presentation/conversation-responses";
import { formatDateInTimezone, formatTimeInTimezone, localDateBounds } from "@/lib/dates";

export interface InboundConversationMessage {
  provider: string;
  providerMessageId: string;
  externalPhoneNumberId: string;
  from: string;
  profileName: string | null;
  text: string;
  messageType: "text" | "button" | "list" | "unsupported";
  providerReplyToId: string | null;
  receivedAt: string;
}

export interface ConversationCapabilities {
  maxReplyButtons: number;
  maxListRows: number;
}

export interface TransitionInput {
  message: InboundConversationMessage;
  conversation: PersistedConversation;
  phoneNumber: WhatsAppPhoneNumber;
  contact: WhatsAppContact;
  gateway: WhatsAppBookingGateway;
  capabilities: ConversationCapabilities;
}

type StateHandler = (input: TransitionInput) => Promise<ConversationTransition>;

function text(body: string): ConversationResponse {
  return textResponse(body);
}

function buttons(
  body: string,
  options: readonly ConversationOption[],
  maxReplyButtons: number,
): ConversationResponse {
  return replyButtonsResponse(body, options, maxReplyButtons);
}

function normalizedCommand(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/[.!?]+$/g, "");
}

function tenantLabel(tenant: TenantCandidate): string {
  const location = [tenant.district, tenant.city].filter(Boolean).join(", ");
  return location ? `${tenant.name} · ${location}` : tenant.name;
}

function pageOffset(option: ConversationOption | null, page: string): number | null {
  if (option?.kind !== "page") return null;
  const match = new RegExp(`^${page}:([0-9]{1,5})$`).exec(option.value);
  return match?.[1] ? Number(match[1]) : null;
}

function pagedOptions<T>(input: {
  items: readonly T[];
  offset: number;
  maxRows: number;
  page: string;
  reservedRows?: number;
  map: (item: T, index: number) => ConversationOption;
}): ConversationOption[] {
  const availableRows = Math.max(0, input.maxRows - (input.reservedRows ?? 0));
  const remaining = input.items.slice(input.offset);
  const needsNextPage = remaining.length > availableRows;
  const itemRows = needsNextPage && availableRows > 1
    ? availableRows - 1
    : availableRows;
  const visible = remaining
    .slice(0, itemRows)
    .map((item, index) => input.map(item, index));
  if (needsNextPage && itemRows > 0) {
    visible.push({
      key: "more",
      label: "Ver mais",
      value: `${input.page}:${input.offset + itemRows}`,
      kind: "page",
    });
  }
  return visible;
}

function tenantOptions(
  tenants: readonly TenantCandidate[],
  maxRows: number,
  offset = 0,
): ConversationOption[] {
  const visible = pagedOptions({
    items: tenants,
    offset,
    maxRows,
    page: "tenants",
    reservedRows: 1,
    map: (tenant, index) => ({
      key: String(index + 1 >= 9 ? index + 2 : index + 1),
      label: tenantLabel(tenant),
      value: tenant.id,
      kind: "tenant",
    }),
  });
  return [
    ...visible,
    { key: "9", label: "Escolher outro estabelecimento", value: "search", kind: "action" },
  ];
}

function tenantSelectionTransition(input: {
  message: InboundConversationMessage;
  capabilities: ConversationCapabilities;
  conversation: PersistedConversation;
  tenants: readonly TenantCandidate[];
  source: "history" | "search";
  searchQuery?: string;
  offset?: number;
  prompt?: string;
}): ConversationTransition {
  const options = tenantOptions(
    input.tenants,
    input.capabilities.maxListRows,
    input.offset ?? 0,
  );
  return {
    state: "TENANT_SELECTION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      routing: {
        source: input.source,
        searchQuery: input.searchQuery,
      },
      options,
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [
      listResponse(
        input.prompt ?? "Olá! Onde deseja agendar?",
        "Escolher local",
        options,
      ),
    ],
  };
}

function serviceSelectionTransition(input: {
  message: InboundConversationMessage;
  capabilities: ConversationCapabilities;
  services: Awaited<ReturnType<WhatsAppBookingGateway["listServices"]>>;
  context: ConversationContext;
  offset?: number;
  greeting?: string;
}): ConversationTransition {
  const options = pagedOptions({
    items: input.services,
    offset: input.offset ?? 0,
    maxRows: input.capabilities.maxListRows,
    page: "services",
    map: (service, index) => ({
      key: String(index + 1),
      label: service.name,
      value: service.id,
      kind: "service",
    }),
  });
  return {
    state: "SERVICE_SELECTION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.context,
      options,
      lastInboundMessageId: input.message.providerMessageId,
      lastPromptAt: new Date().toISOString(),
    }),
    responses: [
      listResponse(
        input.greeting ?? "Qual serviço deseja agendar?",
        "Escolher serviço",
        options,
      ),
    ],
  };
}

async function startBookingForTenant(
  input: TransitionInput,
  tenant: TenantCandidate,
  source: ConversationContext["routing"]["source"],
  attachCustomer = true,
): Promise<ConversationTransition> {
  const customer = attachCustomer
    ? await attachContactToTenant({
        conversationId: input.conversation.id,
        contactId: input.contact.id,
        tenantId: tenant.id,
        profileName: input.contact.profileName,
      })
    : null;
  const [services, channel] = await Promise.all([
    input.gateway.listServices(tenant.id),
    input.gateway.getTenantContext(tenant.id),
  ]);
  if (services.length === 0) {
    const scopedConversation: PersistedConversation = {
      ...input.conversation,
      tenantId: tenant.id,
      context: conversationContextSchema.parse({
        locale: input.conversation.context.locale,
        customerId: customer?.customerId,
        customerTenantId: customer?.customerTenantId,
        routing: { source },
        options: [],
        booking: {},
        lastInboundMessageId: input.message.providerMessageId,
      }),
    };
    if (channel.humanHandoffEnabled) {
      const handoff = await handoffTransition(
        { ...input, conversation: scopedConversation },
        "services_unavailable",
      );
      return {
        ...handoff,
        tenantId: tenant.id,
        responses: [
          text(
            `Olá! Você está falando com ${tenant.name}. Não há serviços disponíveis no canal agora. Vou encaminhar seu contato para atendimento.`,
          ),
        ],
      };
    }
    return {
      state: "CANCELLED",
      status: "closed",
      tenantId: tenant.id,
      context: scopedConversation.context,
      responses: [
        text(
          `Olá! Você está falando com ${tenant.name}. Não há serviços disponíveis no WhatsApp agora.`,
        ),
      ],
    };
  }
  const transition = serviceSelectionTransition({
    message: input.message,
    capabilities: input.capabilities,
    services,
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      customerId: customer?.customerId,
      customerTenantId: customer?.customerTenantId,
      routing: { source },
      booking: {},
    }),
    greeting: channel.welcomeMessage ?? `Olá! Você está falando com ${tenant.name}.`,
  });
  return {
    ...transition,
    tenantId: tenant.id,
    responses: bookingStartResponses({
      emergencyNotice: channel.emergencyNotice,
      administrativeNotice: channel.administrativeNotice,
      welcomeMessage:
        channel.welcomeMessage ?? `Olá! Você está falando com ${tenant.name}.`,
      prompt: "Qual serviço deseja agendar?",
      buttonText: "Escolher serviço",
      options: transition.context.options,
    }),
  };
}

async function resolveTenantHandler(input: TransitionInput): Promise<ConversationTransition> {
  const resolution = await resolveWhatsAppTenant({
    phoneNumber: input.phoneNumber,
    contact: input.contact,
    conversation: input.conversation,
    messageText: input.message.text,
    provider: input.message.provider,
    providerMessageId: input.message.providerMessageId,
  });
  if (resolution.kind === "resolved") {
    return startBookingForTenant(input, resolution.tenant, resolution.source);
  }
  if (resolution.kind === "confirm_history") {
    const [tenant] = resolution.tenants;
    if (!tenant) throw new Error("tenant_history_invalid");
    const options: ConversationOption[] = [
      { key: "1", label: "Sim", value: tenant.id, kind: "tenant" },
      { key: "9", label: "Escolher outro estabelecimento", value: "search", kind: "action" },
    ];
    return {
      state: "TENANT_CONFIRMATION",
      status: "waiting_customer",
      context: conversationContextSchema.parse({
        ...input.conversation.context,
        options,
        lastInboundMessageId: input.message.providerMessageId,
      }),
      responses: [
        buttons(
          `Deseja agendar novamente em ${tenant.name}?`,
          options,
          input.capabilities.maxReplyButtons,
        ),
      ],
    };
  }
  if (resolution.kind === "select_history") {
    return tenantSelectionTransition({
      message: input.message,
      capabilities: input.capabilities,
      conversation: input.conversation,
      tenants: resolution.tenants,
      source: "history",
    });
  }
  return {
    state: "TENANT_SEARCH",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      options: [],
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [text("Informe o nome ou código do estabelecimento onde deseja agendar.")],
  };
}

async function chooseTenantHandler(input: TransitionInput): Promise<ConversationTransition> {
  const option = optionForInput(input.conversation.context.options, input.message.text);
  const offset = pageOffset(option, "tenants");
  if (offset !== null) {
    const query = input.conversation.context.routing.searchQuery;
    if (input.conversation.context.routing.source === "search" && query) {
      return tenantSelectionTransition({
        message: input.message,
        capabilities: input.capabilities,
        conversation: input.conversation,
        tenants: await searchWhatsAppTenants({
          query,
          phoneNumberId: input.phoneNumber.id,
        }),
        source: "search",
        searchQuery: query,
        offset,
        prompt: "Mais estabelecimentos encontrados:",
      });
    }
    const resolution = await resolveWhatsAppTenant({
      phoneNumber: input.phoneNumber,
      contact: input.contact,
      conversation: input.conversation,
      messageText: "",
      provider: input.message.provider,
      providerMessageId: input.message.providerMessageId,
    });
    const tenants = resolution.kind === "select_history" || resolution.kind === "confirm_history"
      ? resolution.tenants
      : [];
    if (tenants.length === 0) return resolveTenantHandler(input);
    return tenantSelectionTransition({
      message: input.message,
      capabilities: input.capabilities,
      conversation: input.conversation,
      tenants,
      source: "history",
      offset,
      prompt: "Mais estabelecimentos recentes:",
    });
  }
  if (option?.value === "stay") return showMainMenu(input);
  if (option?.value === "search" || input.message.text.trim() === "9") {
    return {
      state: "TENANT_SEARCH",
      status: "waiting_customer",
      context: conversationContextSchema.parse({
        ...input.conversation.context,
        options: [],
        lastInboundMessageId: input.message.providerMessageId,
      }),
      responses: [text("Informe o nome ou código do estabelecimento.")],
    };
  }
  if (!option || option.kind !== "tenant") return invalidOption(input, "Escolha uma opção da lista.");
  const tenant = await getWhatsAppTenantById(option.value, input.phoneNumber.id);
  if (!tenant) return invalidOption(input, "Esse estabelecimento não está disponível.");
  return startBookingForTenant(
    input,
    tenant,
    input.conversation.context.routing.source ?? "history",
  );
}

async function searchTenantHandler(input: TransitionInput): Promise<ConversationTransition> {
  if (extractRoutingCode(input.message.text)) return resolveTenantHandler(input);
  const results = await searchWhatsAppTenants({
    query: input.message.text,
    phoneNumberId: input.phoneNumber.id,
  });
  if (results.length === 0) {
    return invalidOption(
      input,
      "Não encontrei um estabelecimento publicado com esse nome. Tente outro nome ou peça atendimento.",
    );
  }
  return tenantSelectionTransition({
    message: input.message,
    capabilities: input.capabilities,
    conversation: input.conversation,
    tenants: results,
    source: "search",
    searchQuery: input.message.text.trim().slice(0, 80),
    prompt: "Encontrei estas opções:",
  });
}

async function serviceHandler(input: TransitionInput): Promise<ConversationTransition> {
  if (!input.conversation.tenantId) return resolveTenantHandler(input);
  const option = optionForInput(input.conversation.context.options, input.message.text);
  const offset = pageOffset(option, "services");
  if (offset !== null) {
    return serviceSelectionTransition({
      message: input.message,
      capabilities: input.capabilities,
      services: await input.gateway.listServices(input.conversation.tenantId),
      context: input.conversation.context,
      offset,
    });
  }
  if (!option || option.kind !== "service") return invalidOption(input, "Escolha um serviço da lista.");
  const services = await input.gateway.listServices(input.conversation.tenantId);
  const service = services.find((item) => item.id === option.value);
  if (!service) return invalidOption(input, "Esse serviço não está mais disponível.");
  const customer = input.conversation.context.customerId
    && input.conversation.context.customerTenantId
    ? null
    : await attachContactToTenant({
        conversationId: input.conversation.id,
        contactId: input.contact.id,
        tenantId: input.conversation.tenantId,
        profileName: input.contact.profileName,
      });
  const options: ConversationOption[] = [
    { key: "1", label: "Qualquer profissional", value: "any", kind: "action" },
    { key: "2", label: "Escolher profissional", value: "choose", kind: "action" },
  ];
  const context = conversationContextSchema.parse({
    ...input.conversation.context,
    customerId: customer?.customerId ?? input.conversation.context.customerId,
    customerTenantId:
      customer?.customerTenantId ?? input.conversation.context.customerTenantId,
    booking: {
      ...input.conversation.context.booking,
      serviceId: service.id,
      serviceName: service.name,
    },
    options,
    lastInboundMessageId: input.message.providerMessageId,
  });
  if (!service.allowStaffSelection) return showDates(input, context, null);
  return {
    state: "STAFF_PREFERENCE",
    status: "waiting_customer",
    context,
    responses: [
      buttons(
        "Tem preferência de profissional?",
        options,
        input.capabilities.maxReplyButtons,
      ),
    ],
  };
}

function staffSelectionTransition(input: {
  message: InboundConversationMessage;
  capabilities: ConversationCapabilities;
  staff: Awaited<ReturnType<WhatsAppBookingGateway["listStaff"]>>;
  context: ConversationContext;
  offset?: number;
}): ConversationTransition {
  const options = pagedOptions({
    items: input.staff,
    offset: input.offset ?? 0,
    maxRows: input.capabilities.maxListRows,
    page: "staff",
    map: (person, index) => ({
      key: String(index + 1),
      label: person.name,
      value: person.id,
      kind: "staff",
    }),
  });
  return {
    state: "STAFF_SELECTION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.context,
      options,
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [listResponse("Escolha o profissional:", "Ver profissionais", options)],
  };
}

async function staffPreferenceHandler(input: TransitionInput): Promise<ConversationTransition> {
  const option = optionForInput(input.conversation.context.options, input.message.text);
  if (!option || !["any", "choose"].includes(option.value)) {
    return invalidOption(input, "Escolha qualquer profissional ou um nome específico.");
  }
  if (option.value === "any") return showDates(input, input.conversation.context, null);
  const { serviceId } = input.conversation.context.booking;
  if (!input.conversation.tenantId || !serviceId) throw new Error("conversation_booking_context_invalid");
  const staff = await input.gateway.listStaff(input.conversation.tenantId, serviceId);
  if (staff.length === 0) return showDates(input, input.conversation.context, null);
  return staffSelectionTransition({
    message: input.message,
    capabilities: input.capabilities,
    staff,
    context: input.conversation.context,
  });
}

async function staffHandler(input: TransitionInput): Promise<ConversationTransition> {
  const option = optionForInput(input.conversation.context.options, input.message.text);
  const offset = pageOffset(option, "staff");
  if (offset !== null) {
    const { serviceId } = input.conversation.context.booking;
    if (!input.conversation.tenantId || !serviceId) {
      throw new Error("conversation_booking_context_invalid");
    }
    return staffSelectionTransition({
      message: input.message,
      capabilities: input.capabilities,
      staff: await input.gateway.listStaff(input.conversation.tenantId, serviceId),
      context: input.conversation.context,
      offset,
    });
  }
  if (!option || option.kind !== "staff") return invalidOption(input, "Escolha um profissional da lista.");
  return showDates(
    input,
    conversationContextSchema.parse({
      ...input.conversation.context,
      booking: {
        ...input.conversation.context.booking,
        staffId: option.value,
        staffName: option.label,
      },
    }),
    option.value,
  );
}

async function showDates(
  input: TransitionInput,
  baseContext: ConversationContext,
  staffId: string | null,
): Promise<ConversationTransition> {
  if (!input.conversation.tenantId) throw new Error("conversation_tenant_missing");
  const tenant = await input.gateway.getTenantContext(input.conversation.tenantId);
  const today = formatInTimeZone(new Date(), tenant.timezone, "yyyy-MM-dd");
  const options: ConversationOption[] = Array.from(
    { length: Math.min(7, input.capabilities.maxListRows) },
    (_, index) => {
      const date = addDays(parseISO(`${today}T12:00:00`), index);
      return {
        key: String(index + 1),
        label: format(date, "EEEE, dd/MM", { locale: ptBR }),
        value: format(date, "yyyy-MM-dd"),
        kind: "date" as const,
      };
    },
  );
  return {
    state: "DATE_SELECTION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...baseContext,
      booking: { ...baseContext.booking, locationId: tenant.locationId, staffId },
      options,
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [listResponse("Qual data funciona melhor?", "Escolher data", options)],
  };
}

async function dateHandler(input: TransitionInput): Promise<ConversationTransition> {
  const option = optionForInput(input.conversation.context.options, input.message.text);
  if (!option || option.kind !== "date") return invalidOption(input, "Escolha uma data da lista.");
  const tenantId = input.conversation.tenantId;
  const serviceId = input.conversation.context.booking.serviceId;
  if (!tenantId || !serviceId) throw new Error("conversation_booking_context_invalid");
  const tenant = await input.gateway.getTenantContext(tenantId);
  const bounds = localDateBounds(option.value, tenant.timezone);
  const slots = await input.gateway.getAvailableSlots({
    tenant,
    serviceId,
    staffId: input.conversation.context.booking.staffId ?? null,
    rangeStart: bounds.from,
    rangeEnd: bounds.to,
  });
  if (slots.length === 0) {
    return {
      state: "DATE_SELECTION",
      status: "waiting_customer",
      context: conversationContextSchema.parse({
        ...input.conversation.context,
        lastInboundMessageId: input.message.providerMessageId,
      }),
      responses: [text("Não encontrei horários nessa data. Escolha outra opção da lista.")],
    };
  }
  const maxSlots = Math.min(8, input.capabilities.maxListRows - 1);
  const options: ConversationOption[] = slots.slice(0, Math.max(1, maxSlots)).map((slot, index) => ({
    key: String(index + 1),
    label: `${formatTimeInTimezone(slot.startAt, tenant.timezone)} · ${slot.staffName}`,
    value: `${slot.startAt}|${slot.endAt}|${slot.staffId}|${slot.staffName}`,
    kind: "slot",
  }));
  options.push({ key: "9", label: "Escolher outra data", value: "other_date", kind: "action" });
  return {
    state: "SLOT_SELECTION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      booking: { ...input.conversation.context.booking, date: option.value },
      options,
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [listResponse("Escolha um horário:", "Ver horários", options)],
  };
}

async function slotHandler(input: TransitionInput): Promise<ConversationTransition> {
  const option = optionForInput(input.conversation.context.options, input.message.text);
  if (option?.value === "other_date") {
    return input.conversation.context.booking.operation === "reschedule"
      ? showRescheduleDates(input)
      : showDates(input, input.conversation.context, input.conversation.context.booking.staffId ?? null);
  }
  if (!option || option.kind !== "slot") return invalidOption(input, "Escolha um horário da lista.");
  const [startsAt, endsAt, staffId, ...staffNameParts] = option.value.split("|");
  const staffName = staffNameParts.join("|");
  if (!startsAt || !endsAt || !staffId || !staffName) throw new Error("slot_option_invalid");
  if (input.conversation.context.booking.operation === "reschedule") {
    const tenantId = input.conversation.tenantId;
    if (!tenantId) throw new Error("conversation_tenant_missing");
    const tenant = await input.gateway.getTenantContext(tenantId);
    const options: ConversationOption[] = [
      { key: "1", label: "Confirmar reagendamento", value: "confirm", kind: "action" },
      { key: "2", label: "Escolher outro horário", value: "change_slot", kind: "action" },
      { key: "3", label: "Voltar ao menu", value: "cancel", kind: "action" },
    ];
    return {
      state: "BOOKING_CONFIRMATION",
      status: "waiting_customer",
      context: conversationContextSchema.parse({
        ...input.conversation.context,
        booking: {
          ...input.conversation.context.booking,
          startsAt,
          endsAt,
          staffId,
          staffName,
        },
        options,
        lastInboundMessageId: input.message.providerMessageId,
      }),
      responses: [
        buttons(
          `Reagendar para ${formatDateInTimezone(startsAt, tenant.timezone)}, às ${formatTimeInTimezone(startsAt, tenant.timezone)}, com ${staffName}?`,
          options,
          input.capabilities.maxReplyButtons,
        ),
      ],
    };
  }
  return {
    state: "CUSTOMER_IDENTIFICATION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      booking: {
        ...input.conversation.context.booking,
        startsAt,
        endsAt,
        staffId,
        staffName,
      },
      options: [],
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [text("Para concluir, informe seu nome completo.")],
  };
}

async function customerHandler(input: TransitionInput): Promise<ConversationTransition> {
  const customerName = input.message.text.trim().replace(/\s+/g, " ").slice(0, 120);
  if (customerName.length < 2) return invalidOption(input, "Informe um nome com pelo menos 2 caracteres.");
  const tenantId = input.conversation.tenantId;
  if (!tenantId) throw new Error("conversation_tenant_missing");
  const tenant = await input.gateway.getTenantContext(tenantId);
  const booking = { ...input.conversation.context.booking, customerName };
  if (!booking.startsAt || !booking.serviceName) throw new Error("conversation_booking_context_invalid");
  const options: ConversationOption[] = [
    { key: "1", label: "Confirmar agendamento", value: "confirm", kind: "action" },
    { key: "2", label: "Escolher outro horário", value: "change_slot", kind: "action" },
    { key: "3", label: "Cancelar", value: "cancel", kind: "action" },
  ];
  const summary = [
    "Revise seu agendamento:",
    `Estabelecimento: ${tenant.name}`,
    `Serviço: ${booking.serviceName}`,
    `Data: ${formatDateInTimezone(booking.startsAt, tenant.timezone)}`,
    `Horário: ${formatTimeInTimezone(booking.startsAt, tenant.timezone)}`,
    `Profissional: ${booking.staffName ?? "Qualquer profissional"}`,
    `Nome: ${customerName}`,
  ].join("\n");
  return {
    state: "BOOKING_CONFIRMATION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      booking,
      options,
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [buttons(summary, options, input.capabilities.maxReplyButtons)],
  };
}

async function confirmationHandler(input: TransitionInput): Promise<ConversationTransition> {
  const option = optionForInput(input.conversation.context.options, input.message.text);
  if (!option) return invalidOption(input, "Confirme, escolha outro horário ou cancele.");
  if (option.value === "cancel") {
    if (input.conversation.context.booking.operation === "reschedule") {
      return showMainMenu(input);
    }
    return {
      state: "CANCELLED",
      status: "closed",
      context: conversationContextSchema.parse({
        ...input.conversation.context,
        options: [],
        lastInboundMessageId: input.message.providerMessageId,
      }),
      responses: [text("Fluxo cancelado. Envie “Menu” quando quiser começar novamente.")],
    };
  }
  if (option.value === "change_slot") {
    return input.conversation.context.booking.operation === "reschedule"
      ? showRescheduleDates(input)
      : showDates(
          input,
          input.conversation.context,
          input.conversation.context.booking.staffId ?? null,
        );
  }
  if (option.value !== "confirm") return invalidOption(input, "Escolha uma opção válida.");
  const tenantId = input.conversation.tenantId;
  const booking = input.conversation.context.booking;
  if (booking.operation === "reschedule") {
    if (
      !tenantId ||
      !input.conversation.context.customerId ||
      !booking.appointmentId ||
      !booking.startsAt
    ) {
      throw new Error("conversation_reschedule_context_invalid");
    }
    const tenant = await input.gateway.getTenantContext(tenantId);
    try {
      const result = await input.gateway.rescheduleBooking({
        tenantId,
        customerId: input.conversation.context.customerId,
        appointmentId: booking.appointmentId,
        startsAt: booking.startsAt,
        staffId: booking.staffId ?? null,
        idempotencyKey: whatsappIdempotencyKey(
          input.conversation.id,
          input.message.providerMessageId,
          "reschedule",
        ),
        actor: {
          channel: "whatsapp",
          phoneNumberId: input.phoneNumber.id,
          conversationId: input.conversation.id,
          externalContactId: input.contact.whatsappUserId,
        },
      });
      return {
        state: "BOOKING_COMPLETED",
        status: "completed",
        context: conversationContextSchema.parse({
          ...input.conversation.context,
          booking: {
            ...booking,
            appointmentId: result.appointmentId,
          },
          options: [],
          lastInboundMessageId: input.message.providerMessageId,
        }),
        responses: [
          text(
            `Agendamento reagendado para ${formatDateInTimezone(result.startsAt, tenant.timezone)}, às ${formatTimeInTimezone(result.startsAt, tenant.timezone)}.`,
          ),
        ],
      };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "booking_conflict") throw error;
      return showRescheduleDates(input);
    }
  }
  if (
    !tenantId ||
    !booking.locationId ||
    !booking.serviceId ||
    !booking.startsAt ||
    !booking.customerName
  ) {
    throw new Error("conversation_booking_context_invalid");
  }
  const tenant = await input.gateway.getTenantContext(tenantId);
  try {
    const result = await input.gateway.createBooking({
      tenantId,
      locationId: booking.locationId,
      serviceIds: [booking.serviceId],
      staffId: booking.staffId ?? null,
      startsAt: booking.startsAt,
      timezone: tenant.timezone,
      customerName: booking.customerName,
      customerPhone: input.contact.normalizedPhone,
      customerEmail: booking.customerEmail || null,
      notes: booking.notes || null,
      idempotencyKey: whatsappIdempotencyKey(
        input.conversation.id,
        input.message.providerMessageId,
        "booking",
      ),
      actor: {
        channel: "whatsapp",
        phoneNumberId: input.phoneNumber.id,
        conversationId: input.conversation.id,
        externalContactId: input.contact.whatsappUserId,
      },
    });
    return {
      state: "BOOKING_COMPLETED",
      status: "completed",
      context: conversationContextSchema.parse({
        ...input.conversation.context,
        booking: {
          ...booking,
          appointmentId: result.appointmentId,
        },
        options: [],
        lastInboundMessageId: input.message.providerMessageId,
      }),
      responses: [
        text(
          `Agendamento confirmado em ${tenant.name} para ${formatDateInTimezone(result.startsAt, tenant.timezone)}, às ${formatTimeInTimezone(result.startsAt, tenant.timezone)}. Profissional: ${result.staffName}.`,
        ),
      ],
    };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "booking_conflict") throw error;
    const context = conversationContextSchema.parse({
      ...input.conversation.context,
      lastInboundMessageId: input.message.providerMessageId,
    });
    const dates = await showDates(input, context, booking.staffId ?? null);
    return {
      ...dates,
      state: "BOOKING_CONFLICT",
      responses: [
        text("Esse horário acabou de ser reservado por outra pessoa. Escolha uma nova data."),
        ...dates.responses,
      ],
    };
  }
}

async function showUpcomingBookings(
  input: TransitionInput,
  offset = 0,
): Promise<ConversationTransition> {
  const tenantId = input.conversation.tenantId;
  const customerId = input.conversation.context.customerId;
  if (!tenantId || !customerId) return resolveTenantHandler(input);
  const [tenant, bookings] = await Promise.all([
    input.gateway.getTenantContext(tenantId),
    input.gateway.listUpcomingBookings({ tenantId, customerId }),
  ]);
  if (bookings.length === 0) {
    const menu = await showMainMenu(input);
    return {
      ...menu,
      responses: [text("Você não possui agendamentos futuros neste estabelecimento."), ...menu.responses],
    };
  }
  const options = pagedOptions({
    items: bookings,
    offset,
    maxRows: input.capabilities.maxListRows,
    page: "upcoming",
    map: (booking, index) => ({
      key: String(index + 1),
      label: `${formatInTimeZone(booking.startsAt, tenant.timezone, "dd/MM")} ${formatTimeInTimezone(booking.startsAt, tenant.timezone)} · ${booking.serviceNames.join(" + ")}`,
      value: booking.id,
      kind: "action",
    }),
  });
  return {
    state: "UPCOMING_APPOINTMENT_ACTION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      booking: {},
      options,
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [listResponse("Escolha um agendamento:", "Ver agendamentos", options)],
  };
}

async function upcomingActionHandler(input: TransitionInput): Promise<ConversationTransition> {
  const option = optionForInput(input.conversation.context.options, input.message.text);
  if (!option) return invalidOption(input, "Escolha uma opção da lista.");
  const offset = pageOffset(option, "upcoming");
  if (offset !== null) return showUpcomingBookings(input, offset);
  const appointmentId = input.conversation.context.booking.appointmentId;
  if (!appointmentId) {
    const options: ConversationOption[] = [
      { key: "1", label: "Reagendar", value: "reschedule", kind: "action" },
      { key: "2", label: "Cancelar agendamento", value: "cancel_booking", kind: "action" },
      { key: "3", label: "Novo agendamento", value: "new_booking", kind: "action" },
    ];
    return {
      state: "UPCOMING_APPOINTMENT_ACTION",
      status: "waiting_customer",
      context: conversationContextSchema.parse({
        ...input.conversation.context,
        booking: { appointmentId: option.value },
        options,
        lastInboundMessageId: input.message.providerMessageId,
      }),
      responses: [
        buttons("O que deseja fazer?", options, input.capabilities.maxReplyButtons),
      ],
    };
  }
  if (option.value === "reschedule") return showRescheduleDates(input);
  if (option.value === "cancel_booking") {
    const options: ConversationOption[] = [
      { key: "1", label: "Confirmar cancelamento", value: "confirm_cancel", kind: "action" },
      { key: "2", label: "Voltar", value: "back", kind: "action" },
    ];
    return {
      state: "CANCELLATION_CONFIRMATION",
      status: "waiting_customer",
      context: conversationContextSchema.parse({
        ...input.conversation.context,
        options,
        lastInboundMessageId: input.message.providerMessageId,
      }),
      responses: [
        buttons(
          "Deseja cancelar este agendamento?",
          options,
          input.capabilities.maxReplyButtons,
        ),
      ],
    };
  }
  if (option.value === "new_booking") {
    const tenant = input.conversation.tenantId
      ? await getWhatsAppTenantById(
          input.conversation.tenantId,
          input.phoneNumber.id,
        )
      : null;
    return tenant ? startBookingForTenant(input, tenant, "active_session") : resolveTenantHandler(input);
  }
  return invalidOption(input, "Escolha uma ação válida.");
}

async function cancellationHandler(input: TransitionInput): Promise<ConversationTransition> {
  const option = optionForInput(input.conversation.context.options, input.message.text);
  if (option?.value === "back") return showUpcomingBookings(input);
  if (option?.value !== "confirm_cancel") return invalidOption(input, "Confirme o cancelamento ou volte.");
  const tenantId = input.conversation.tenantId;
  const customerId = input.conversation.context.customerId;
  const appointmentId = input.conversation.context.booking.appointmentId;
  if (!tenantId || !customerId || !appointmentId) throw new Error("conversation_cancellation_context_invalid");
  await input.gateway.cancelBooking({
    tenantId,
    customerId,
    appointmentId,
    reason: "Cancelado pelo cliente no WhatsApp",
    idempotencyKey: whatsappIdempotencyKey(
      input.conversation.id,
      input.message.providerMessageId,
      "cancel",
    ),
    actor: {
      channel: "whatsapp",
      phoneNumberId: input.phoneNumber.id,
      conversationId: input.conversation.id,
      externalContactId: input.contact.whatsappUserId,
    },
  });
  return {
    state: "BOOKING_COMPLETED",
    status: "completed",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      options: [],
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [text("Agendamento cancelado.")],
  };
}

async function showRescheduleDates(input: TransitionInput): Promise<ConversationTransition> {
  const tenantId = input.conversation.tenantId;
  const appointmentId = input.conversation.context.booking.appointmentId;
  if (!tenantId || !appointmentId) throw new Error("conversation_reschedule_context_invalid");
  const tenant = await input.gateway.getTenantContext(tenantId);
  const today = formatInTimeZone(new Date(), tenant.timezone, "yyyy-MM-dd");
  const options: ConversationOption[] = Array.from(
    { length: Math.min(7, input.capabilities.maxListRows) },
    (_, index) => {
      const date = addDays(parseISO(`${today}T12:00:00`), index);
      return {
        key: String(index + 1),
        label: format(date, "EEEE, dd/MM", { locale: ptBR }),
        value: format(date, "yyyy-MM-dd"),
        kind: "date" as const,
      };
    },
  );
  return {
    state: "RESCHEDULE_SELECTION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      booking: {
        ...input.conversation.context.booking,
        operation: "reschedule",
        appointmentId,
      },
      options,
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [listResponse("Escolha a nova data:", "Ver datas", options)],
  };
}

async function rescheduleDateHandler(input: TransitionInput): Promise<ConversationTransition> {
  const option = optionForInput(input.conversation.context.options, input.message.text);
  if (!option || option.kind !== "date") return invalidOption(input, "Escolha uma data da lista.");
  const tenantId = input.conversation.tenantId;
  const customerId = input.conversation.context.customerId;
  const appointmentId = input.conversation.context.booking.appointmentId;
  if (!tenantId || !customerId || !appointmentId) throw new Error("conversation_reschedule_context_invalid");
  const tenant = await input.gateway.getTenantContext(tenantId);
  const bounds = localDateBounds(option.value, tenant.timezone);
  const slots = await input.gateway.getRescheduleSlots({
    tenantId,
    customerId,
    appointmentId,
    rangeStart: bounds.from,
    rangeEnd: bounds.to,
    staffId: null,
  });
  if (slots.length === 0) return invalidOption(input, "Não há horários nessa data. Escolha outra.");
  const options: ConversationOption[] = slots
    .slice(0, Math.max(1, Math.min(8, input.capabilities.maxListRows - 1)))
    .map((slot, index) => ({
      key: String(index + 1),
      label: `${formatTimeInTimezone(slot.startAt, tenant.timezone)} · ${slot.staffName}`,
      value: `${slot.startAt}|${slot.endAt}|${slot.staffId}|${slot.staffName}`,
      kind: "slot",
    }));
  options.push({ key: "9", label: "Escolher outra data", value: "other_date", kind: "action" });
  return {
    state: "SLOT_SELECTION",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      booking: { ...input.conversation.context.booking, date: option.value },
      options,
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [listResponse("Escolha o novo horário:", "Ver horários", options)],
  };
}

async function mainMenuHandler(input: TransitionInput): Promise<ConversationTransition> {
  if (!input.conversation.tenantId) return resolveTenantHandler(input);
  const option = optionForInput(input.conversation.context.options, input.message.text);
  if (!option) return showMainMenu(input);
  if (option.value === "new_booking") {
    const tenant = await getWhatsAppTenantById(
      input.conversation.tenantId,
      input.phoneNumber.id,
    );
    if (!tenant) return resolveTenantHandler(input);
    return startBookingForTenant(input, tenant, "active_session");
  }
  if (option.value === "upcoming") return showUpcomingBookings(input);
  if (option.value === "handoff") return handoffTransition(input, "customer_request");
  if (option.value === "switch_tenant") {
    return {
      state: "TENANT_SEARCH",
      status: "waiting_customer",
      tenantId: null,
      restartReason: "tenant_change",
      context: conversationContextSchema.parse({
        routing: { source: "search" },
        lastInboundMessageId: input.message.providerMessageId,
      }),
      responses: [text("Informe o nome ou código do novo estabelecimento.")],
    };
  }
  return invalidOption(input, "Escolha uma opção do menu.");
}

async function showMainMenu(input: TransitionInput): Promise<ConversationTransition> {
  if (!input.conversation.tenantId) return resolveTenantHandler(input);
  const options: ConversationOption[] = [
    { key: "1", label: "Novo agendamento", value: "new_booking", kind: "action" },
    { key: "2", label: "Meus agendamentos", value: "upcoming", kind: "action" },
    { key: "3", label: "Falar com atendente", value: "handoff", kind: "action" },
    { key: "9", label: "Trocar estabelecimento", value: "switch_tenant", kind: "action" },
  ];
  return {
    state: "MAIN_MENU",
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      options,
      booking: {},
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [text(["Menu", ...options.map((option) => `${option.key} — ${option.label}`)].join("\n"))],
  };
}

async function invalidOption(input: TransitionInput, message: string): Promise<ConversationTransition> {
  const { attempts, context } = nextAttempt(input.conversation.context, input.conversation.currentState);
  if (attempts >= 3) return handoffTransition({ ...input, conversation: { ...input.conversation, context } }, "repeated_invalid_input");
  const configuredMessage = input.conversation.tenantId
    ? (await input.gateway.getTenantContext(input.conversation.tenantId)).unknownMessageResponse
    : null;
  return {
    state: input.conversation.currentState,
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...context,
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [text(configuredMessage ?? message)],
  };
}

async function handoffTransition(
  input: TransitionInput,
  reason: string,
): Promise<ConversationTransition> {
  if (input.conversation.tenantId) {
    const channel = await input.gateway.getTenantContext(input.conversation.tenantId);
    if (!channel.humanHandoffEnabled) {
      return {
        state: input.conversation.currentState,
        status: "waiting_customer",
        context: conversationContextSchema.parse({
          ...input.conversation.context,
          options: [],
          lastInboundMessageId: input.message.providerMessageId,
        }),
        responses: [
          text(
            channel.unknownMessageResponse
              ?? "O atendimento humano não está disponível neste canal agora.",
          ),
        ],
      };
    }
  }
  return {
    state: "HUMAN_HANDOFF",
    status: "human_handoff",
    context: conversationContextSchema.parse({
      ...input.conversation.context,
      handoff: {
        reason,
        requestedBy: reason === "customer_request" ? "customer" : "automation",
      },
      options: [],
      lastInboundMessageId: input.message.providerMessageId,
    }),
    responses: [
      text(
        input.conversation.tenantId
          ? "Encaminhei sua conversa para a equipe do estabelecimento. O atendimento automático ficou pausado."
          : "Encaminhei sua conversa para o suporte da plataforma.",
      ),
    ],
  };
}

const handlers: Partial<Record<ConversationState, StateHandler>> = {
  START: resolveTenantHandler,
  TENANT_RESOLUTION: resolveTenantHandler,
  TENANT_CONFIRMATION: chooseTenantHandler,
  TENANT_SEARCH: searchTenantHandler,
  TENANT_SELECTION: chooseTenantHandler,
  UPCOMING_APPOINTMENT_ACTION: upcomingActionHandler,
  MAIN_MENU: mainMenuHandler,
  SERVICE_SELECTION: serviceHandler,
  STAFF_PREFERENCE: staffPreferenceHandler,
  STAFF_SELECTION: staffHandler,
  DATE_SELECTION: dateHandler,
  SLOT_SELECTION: slotHandler,
  CUSTOMER_IDENTIFICATION: customerHandler,
  BOOKING_REVIEW: confirmationHandler,
  BOOKING_CONFIRMATION: confirmationHandler,
  BOOKING_CONFLICT: dateHandler,
  RESCHEDULE_SELECTION: rescheduleDateHandler,
  CANCELLATION_CONFIRMATION: cancellationHandler,
};

export async function transitionConversation(input: TransitionInput): Promise<{
  conversation: PersistedConversation;
  transition: ConversationTransition;
}> {
  const conversation = input.conversation;
  const command = normalizedCommand(input.message.text);
  if (isExplicitOptOut(input.message.text) && conversation.tenantId) {
    await recordOptOut({
      contactId: input.contact.id,
      tenantId: conversation.tenantId,
      sourceMessageId: input.message.providerMessageId,
    });
    return {
      conversation,
      transition: {
        state: conversation.currentState,
        status: conversation.status,
        context: conversationContextSchema.parse({
          ...conversation.context,
          lastInboundMessageId: input.message.providerMessageId,
        }),
        responses: [
          text("Preferência atualizada. Você não receberá novas notificações proativas deste estabelecimento."),
        ],
      },
    };
  }
  if (conversation.status === "human_handoff") {
    return {
      conversation,
      transition: {
        state: "HUMAN_HANDOFF",
        status: "human_handoff",
        context: conversationContextSchema.parse({
          ...conversation.context,
          lastInboundMessageId: input.message.providerMessageId,
        }),
        responses: [],
      },
    };
  }
  if (conversation.tenantId && extractRoutingCode(input.message.text)) {
    const resolution = await resolveWhatsAppTenant({
      phoneNumber: input.phoneNumber,
      contact: input.contact,
      conversation,
      messageText: input.message.text,
      provider: input.message.provider,
      providerMessageId: input.message.providerMessageId,
    });
    if (resolution.kind === "resolved" && resolution.tenant.id !== conversation.tenantId) {
      const currentTenant = await getWhatsAppTenantById(
        conversation.tenantId,
        input.phoneNumber.id,
      );
      const options: ConversationOption[] = [
        {
          key: "1",
          label: `Trocar para ${resolution.tenant.name}`,
          value: resolution.tenant.id,
          kind: "tenant",
        },
        ...(currentTenant
          ? [{
              key: "2",
              label: `Permanecer em ${currentTenant.name}`,
              value: currentTenant.id,
              kind: "tenant" as const,
            }]
          : [{
              key: "9",
              label: "Escolher outro estabelecimento",
              value: "search",
              kind: "action" as const,
            }]),
      ];
      return {
        conversation,
        transition: {
          state: "TENANT_CONFIRMATION",
          status: "waiting_customer",
          tenantId: null,
          restartReason: "tenant_change",
          context: conversationContextSchema.parse({
            locale: conversation.context.locale,
            routing: { source: "routing_code" },
            options,
            booking: {},
            lastInboundMessageId: input.message.providerMessageId,
          }),
          responses: [
            buttons(
              `Deseja trocar para ${resolution.tenant.name}?`,
              options,
              input.capabilities.maxReplyButtons,
            ),
          ],
        },
      };
    }
  }
  // A comparação é da mensagem inteira, de propósito: casar por substring faria um
  // nome ou observação com "ajuda" cair em handoff. As variações naturais entram na
  // lista em vez de a comparação ser afrouxada.
  if ([
    "atendente",
    "pessoa",
    "ajuda",
    "falar com alguem",
    "falar com atendente",
    "quero falar com atendente",
    "quero atendente",
    "falar com humano",
    "atendimento humano",
  ].includes(command)) {
    return { conversation, transition: await handoffTransition(input, "customer_request") };
  }
  if (["menu", "inicio"].includes(command)) {
    return { conversation, transition: await showMainMenu(input) };
  }
  if (command === "meus agendamentos") {
    return { conversation, transition: await showUpcomingBookings(input) };
  }
  if (command === "voltar") {
    return { conversation, transition: await showMainMenu({ ...input, conversation }) };
  }
  if (command === "cancelar") {
    return {
      conversation,
      transition: {
        state: "CANCELLED",
        status: "closed",
        context: conversationContextSchema.parse({
          ...conversation.context,
          options: [],
          booking: {},
          lastInboundMessageId: input.message.providerMessageId,
        }),
        responses: [
          text("Fluxo cancelado. Envie “Menu” quando quiser começar novamente."),
        ],
      },
    };
  }
  if (command === "trocar estabelecimento") {
    return {
      conversation,
      transition: {
        state: "TENANT_SEARCH",
        status: "waiting_customer",
        tenantId: null,
        restartReason: "tenant_change",
        context: conversationContextSchema.parse({
          routing: { source: "search" },
          lastInboundMessageId: input.message.providerMessageId,
        }),
        responses: [text("Informe o nome ou código do novo estabelecimento.")],
      },
    };
  }
  const handler = handlers[conversation.currentState] ?? resolveTenantHandler;
  return {
    conversation,
    transition: await handler({ ...input, conversation }),
  };
}
