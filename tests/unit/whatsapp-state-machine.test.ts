import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationContextSchema } from "@/features/whatsapp/domain/conversation";
import type { PersistedConversation } from "@/features/whatsapp/domain/conversation";
import type { WhatsAppBookingGateway } from "@/features/whatsapp/application/booking-gateway";
import type { TransitionInput } from "@/features/whatsapp/application/transition-conversation";
import type {
  TenantCandidate,
  TenantResolution,
} from "@/features/whatsapp/application/resolve-tenant";

const mocks = vi.hoisted(() => ({
  attachContactToTenant: vi.fn(),
  extractRoutingCode: vi.fn(),
  getWhatsAppTenantById: vi.fn(),
  isExplicitOptOut: vi.fn(),
  recordOptOut: vi.fn(),
  resolveWhatsAppTenant: vi.fn(),
  searchWhatsAppTenants: vi.fn(),
}));

vi.mock("@/features/whatsapp/application/resolve-tenant", () => ({
  attachContactToTenant: mocks.attachContactToTenant,
  extractRoutingCode: mocks.extractRoutingCode,
  getWhatsAppTenantById: mocks.getWhatsAppTenantById,
  resolveWhatsAppTenant: mocks.resolveWhatsAppTenant,
  searchWhatsAppTenants: mocks.searchWhatsAppTenants,
}));

vi.mock("@/features/whatsapp/application/messaging-policy", () => ({
  isExplicitOptOut: mocks.isExplicitOptOut,
  recordOptOut: mocks.recordOptOut,
}));

import { transitionConversation } from "@/features/whatsapp/application/transition-conversation";

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  phone: "22222222-2222-4222-8222-222222222222",
  contact: "33333333-3333-4333-8333-333333333333",
  conversation: "44444444-4444-4444-8444-444444444444",
  customer: "55555555-5555-4555-8555-555555555555",
  appointment: "66666666-6666-4666-8666-666666666666",
  location: "77777777-7777-4777-8777-777777777777",
};

function tenant(index = 1): TenantCandidate {
  return {
    id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    slug: `tenant-${index}`,
    name: `Tenant ${index}`,
    timezone: "America/Sao_Paulo",
    city: "São Paulo",
    district: null,
  };
}

function gateway(): WhatsAppBookingGateway {
  return {
    getTenantContext: vi.fn(async () => ({
      id: ids.tenant,
      slug: "tenant",
      name: "Tenant",
      timezone: "America/Sao_Paulo",
      locationId: ids.location,
      humanHandoffEnabled: true,
      welcomeMessage: null,
      unknownMessageResponse: null,
      administrativeNotice: null,
      emergencyNotice: null,
    })),
    listServices: vi.fn(async () => []),
    listStaff: vi.fn(async () => []),
    getAvailableSlots: vi.fn(async () => []),
    createBooking: vi.fn(),
    listUpcomingBookings: vi.fn(async () => []),
    getRescheduleSlots: vi.fn(async () => []),
    cancelBooking: vi.fn(),
    rescheduleBooking: vi.fn(),
  };
}

function conversation(
  input: Partial<PersistedConversation> = {},
): PersistedConversation {
  return {
    id: ids.conversation,
    phoneNumberId: ids.phone,
    contactId: ids.contact,
    tenantId: ids.tenant,
    status: "waiting_customer",
    currentState: "SERVICE_SELECTION",
    serviceWindowExpiresAt: "2026-08-01T12:00:00.000Z",
    sessionExpiresAt: "2026-08-01T12:00:00.000Z",
    lastInboundAt: "2026-07-31T11:00:00.000Z",
    version: 1,
    context: conversationContextSchema.parse({}),
    ...input,
  };
}

function transitionInput(input: {
  text: string;
  conversation?: PersistedConversation;
  bookingGateway?: WhatsAppBookingGateway;
  capabilities?: { maxReplyButtons: number; maxListRows: number };
}): TransitionInput {
  return {
    message: {
      provider: "mock",
      providerMessageId: `message:${input.text}`,
      externalPhoneNumberId: "external-phone",
      from: "5511999999999",
      profileName: "Ana",
      text: input.text,
      messageType: "text",
      providerReplyToId: null,
      receivedAt: "2026-07-31T12:00:00.000Z",
    },
    conversation: input.conversation ?? conversation(),
    phoneNumber: {
      id: ids.phone,
      provider: "mock",
      externalPhoneNumberId: "external-phone",
      normalizedPhoneNumber: "+5511999999999",
      connectionMode: "shared_platform",
    },
    contact: {
      id: ids.contact,
      normalizedPhone: "+5511988888888",
      whatsappUserId: "5511988888888",
      profileName: "Ana",
      customerId: ids.customer,
    },
    gateway: input.bookingGateway ?? gateway(),
    capabilities: input.capabilities ?? { maxReplyButtons: 3, maxListRows: 10 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extractRoutingCode.mockReturnValue(null);
  mocks.isExplicitOptOut.mockReturnValue(false);
  mocks.recordOptOut.mockResolvedValue(undefined);
  mocks.searchWhatsAppTenants.mockResolvedValue([]);
});

describe("WhatsApp conversation state machine", () => {
  it("handles Menu, Voltar and Cancelar as explicit global commands", async () => {
    for (const command of ["Menu!", "VOLTAR"] as const) {
      const result = await transitionConversation(transitionInput({ text: command }));
      expect(result.transition.state).toBe("MAIN_MENU");
      expect(result.transition.context.booking).toEqual({ operation: "create" });
    }

    const cancelled = await transitionConversation(
      transitionInput({ text: "Cancelar" }),
    );
    expect(cancelled.transition).toMatchObject({
      state: "CANCELLED",
      status: "closed",
    });
  });

  it("suspends automation while a human handoff remains active", async () => {
    const result = await transitionConversation(
      transitionInput({
        text: "Menu",
        conversation: conversation({
          status: "human_handoff",
          currentState: "HUMAN_HANDOFF",
        }),
      }),
    );

    expect(result.transition).toMatchObject({
      state: "HUMAN_HANDOFF",
      status: "human_handoff",
      responses: [],
    });
    expect(mocks.resolveWhatsAppTenant).not.toHaveBeenCalled();
  });

  it("describes tenant handoff for the atomic transition commit", async () => {
    const result = await transitionConversation(
      transitionInput({ text: "Atendente" }),
    );

    expect(result.transition.state).toBe("HUMAN_HANDOFF");
    expect(result.transition.context.handoff).toEqual({
      reason: "customer_request",
      requestedBy: "customer",
    });
  });

  it("routes a tenantless handoff to the platform queue", async () => {
    const result = await transitionConversation(
      transitionInput({
        text: "Ajuda",
        conversation: conversation({ tenantId: null, currentState: "START" }),
      }),
    );

    expect(result.transition.state).toBe("HUMAN_HANDOFF");
    expect(result.transition.context.handoff).toEqual({
      reason: "customer_request",
      requestedBy: "customer",
    });
    expect(result.transition.responses[0]).toMatchObject({
      kind: "text",
      body: "Encaminhei sua conversa para o suporte da plataforma.",
    });
  });

  it("applies opt-out before state-specific input handling", async () => {
    mocks.isExplicitOptOut.mockReturnValue(true);
    const result = await transitionConversation(
      transitionInput({ text: "Não quero receber" }),
    );

    expect(mocks.recordOptOut).toHaveBeenCalledWith({
      contactId: ids.contact,
      tenantId: ids.tenant,
      sourceMessageId: "message:Não quero receber",
    });
    expect(result.transition.state).toBe("SERVICE_SELECTION");
  });

  it("hands off after the third invalid state input", async () => {
    const context = conversationContextSchema.parse({
      attempts: { SERVICE_SELECTION: 2 },
      options: [],
    });
    const result = await transitionConversation(
      transitionInput({
        text: "inválido",
        conversation: conversation({ context }),
      }),
    );

    expect(result.transition.state).toBe("HUMAN_HANDOFF");
    expect(result.transition.context.handoff).toMatchObject({
      requestedBy: "automation",
      reason: "repeated_invalid_input",
    });
  });

  it("returns rescheduling to reschedule dates when changing a slot", async () => {
    const bookingGateway = gateway();
    const context = conversationContextSchema.parse({
      customerId: ids.customer,
      booking: {
        operation: "reschedule",
        appointmentId: ids.appointment,
      },
      options: [
        { key: "2", label: "Escolher outro horário", value: "change_slot", kind: "action" },
      ],
    });
    const result = await transitionConversation(
      transitionInput({
        text: "2",
        bookingGateway,
        conversation: conversation({ currentState: "BOOKING_CONFIRMATION", context }),
      }),
    );

    expect(result.transition.state).toBe("RESCHEDULE_SELECTION");
    expect(bookingGateway.getTenantContext).toHaveBeenCalledWith(ids.tenant);
  });

  it("reserves option 9 for tenant search without duplicate keys", async () => {
    const candidates = Array.from({ length: 9 }, (_, index) => tenant(index + 1));
    mocks.resolveWhatsAppTenant.mockResolvedValue({
      kind: "select_history",
      tenants: candidates,
    } satisfies TenantResolution);
    const result = await transitionConversation(
      transitionInput({
        text: "Olá",
        conversation: conversation({ tenantId: null, currentState: "START" }),
      }),
    );
    const keys = result.transition.context.options.map((option) => option.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(result.transition.context.options.find((option) => option.key === "9"))
      .toMatchObject({ value: "search" });
  });

  it("moves a foreign routing-code confirmation out of the active tenant immediately", async () => {
    const target = tenant(2);
    const current = { ...tenant(1), id: ids.tenant };
    mocks.extractRoutingCode.mockReturnValue("TARGET2");
    mocks.getWhatsAppTenantById.mockResolvedValue(current);
    mocks.resolveWhatsAppTenant.mockResolvedValue({
      kind: "resolved",
      tenant: target,
      source: "routing_code",
    } satisfies TenantResolution);

    const confirmation = await transitionConversation(
      transitionInput({
        text: "Código: TARGET2",
        conversation: conversation({
          context: conversationContextSchema.parse({
            booking: { customerName: "Dado do tenant A" },
            options: [{ key: "1", label: "Privado A", value: ids.tenant, kind: "tenant" }],
          }),
        }),
      }),
    );

    expect(confirmation.transition).toMatchObject({
      state: "TENANT_CONFIRMATION",
      tenantId: null,
      restartReason: "tenant_change",
    });
    expect(confirmation.transition.context.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "1", value: target.id, kind: "tenant" }),
        expect.objectContaining({ key: "2", value: current.id, kind: "tenant" }),
      ]),
    );
    expect(confirmation.transition.context.booking.customerName).toBeUndefined();
    expect(confirmation.transition.context.routing.code).toBeUndefined();
    expect(JSON.stringify(confirmation.transition.context)).not.toContain("Privado A");
    expect(mocks.attachContactToTenant).not.toHaveBeenCalled();
  });

  it("attaches the customer only after choosing a tenant in the platform successor", async () => {
    const target = tenant(2);
    const service = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Corte",
      durationMinutes: 30,
      priceCents: 5_000,
      allowStaffSelection: false,
    };
    const bookingGateway = gateway();
    vi.mocked(bookingGateway.listServices).mockResolvedValue([service]);
    mocks.getWhatsAppTenantById.mockResolvedValue(target);
    mocks.attachContactToTenant.mockResolvedValue({
      customerId: ids.customer,
      customerTenantId: "99999999-9999-4999-8999-999999999999",
    });
    const successorId = "88888888-8888-4888-8888-888888888888";
    const confirmationContext = conversationContextSchema.parse({
      routing: { source: "routing_code" },
      options: [
        { key: "1", label: "Trocar", value: target.id, kind: "tenant" },
        { key: "2", label: "Permanecer", value: ids.tenant, kind: "tenant" },
      ],
    });

    const selected = await transitionConversation(
      transitionInput({
        text: "1",
        bookingGateway,
        conversation: conversation({
          id: successorId,
          tenantId: null,
          currentState: "TENANT_CONFIRMATION",
          context: confirmationContext,
        }),
      }),
    );

    expect(selected.transition).toMatchObject({
      state: "SERVICE_SELECTION",
      tenantId: target.id,
    });
    expect(mocks.attachContactToTenant).toHaveBeenCalledWith({
      conversationId: successorId,
      contactId: ids.contact,
      tenantId: target.id,
      profileName: "Ana",
    });
    expect(selected.transition.context).toMatchObject({
      customerId: ids.customer,
      customerTenantId: "99999999-9999-4999-8999-999999999999",
    });
  });

  it("clears tenant options and draft data when the selected catalog is empty", async () => {
    const target = tenant(3);
    const bookingGateway = gateway();
    vi.mocked(bookingGateway.getTenantContext).mockResolvedValue({
      id: target.id,
      slug: target.slug,
      name: target.name,
      timezone: target.timezone,
      locationId: ids.location,
      humanHandoffEnabled: false,
      welcomeMessage: null,
      unknownMessageResponse: null,
      administrativeNotice: null,
      emergencyNotice: null,
    });
    mocks.getWhatsAppTenantById.mockResolvedValue(target);
    mocks.attachContactToTenant.mockResolvedValue({
      customerId: ids.customer,
      customerTenantId: "99999999-9999-4999-8999-999999999999",
    });

    const result = await transitionConversation(transitionInput({
      text: "1",
      bookingGateway,
      conversation: conversation({
        tenantId: null,
        currentState: "TENANT_SELECTION",
        context: conversationContextSchema.parse({
          routing: { source: "search", code: "FOREIGN", searchQuery: "outro tenant" },
          booking: { customerName: "Rascunho anterior", notes: "privado" },
          options: [{ key: "1", label: "Tenant alheio", value: target.id, kind: "tenant" }],
        }),
      }),
    }));

    expect(result.transition).toMatchObject({ state: "CANCELLED", tenantId: target.id });
    expect(result.transition.context.options).toEqual([]);
    expect(result.transition.context.booking).toEqual({ operation: "create" });
    expect(result.transition.context.routing).toEqual({ source: "search" });
    expect(JSON.stringify(result.transition.context)).not.toContain("Tenant alheio");
    expect(JSON.stringify(result.transition.context)).not.toContain("Rascunho anterior");
  });

  it("consumes routing codes entered during tenant search", async () => {
    const target = tenant(3);
    mocks.extractRoutingCode.mockReturnValue("TARGET3");
    mocks.resolveWhatsAppTenant.mockResolvedValue({
      kind: "resolved",
      tenant: target,
      source: "routing_code",
    } satisfies TenantResolution);
    mocks.attachContactToTenant.mockResolvedValue({
      customerId: ids.customer,
      customerTenantId: "99999999-9999-4999-8999-999999999999",
    });
    const bookingGateway = gateway();
    vi.mocked(bookingGateway.listServices).mockResolvedValue([{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Corte",
      durationMinutes: 30,
      priceCents: 5_000,
      allowStaffSelection: false,
    }]);

    const result = await transitionConversation(
      transitionInput({
        text: "TARGET3",
        bookingGateway,
        conversation: conversation({ tenantId: null, currentState: "TENANT_SEARCH" }),
      }),
    );

    expect(result.transition).toMatchObject({
      state: "SERVICE_SELECTION",
      tenantId: target.id,
    });
    expect(mocks.searchWhatsAppTenants).not.toHaveBeenCalled();
  });

  it("paginates services and staff beyond the provider row limit", async () => {
    const target = tenant(1);
    mocks.resolveWhatsAppTenant.mockResolvedValue({
      kind: "resolved",
      tenant: target,
      source: "routing_code",
    } satisfies TenantResolution);
    mocks.attachContactToTenant.mockResolvedValue({
      customerId: ids.customer,
      customerTenantId: "99999999-9999-4999-8999-999999999999",
    });
    const bookingGateway = gateway();
    const services = Array.from({ length: 12 }, (_, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
      name: `Serviço ${index + 1}`,
      durationMinutes: 30,
      priceCents: 5_000,
      allowStaffSelection: true,
    }));
    vi.mocked(bookingGateway.listServices).mockResolvedValue(services);

    const firstServices = await transitionConversation(
      transitionInput({
        text: "ABC123",
        bookingGateway,
        conversation: conversation({ tenantId: null, currentState: "START" }),
      }),
    );
    expect(firstServices.transition.context.options).toHaveLength(10);
    expect(firstServices.transition.context.options.at(-1)).toMatchObject({
      key: "more",
      kind: "page",
      value: "services:9",
    });

    const secondServices = await transitionConversation(
      transitionInput({
        text: "more",
        bookingGateway,
        conversation: conversation({
          tenantId: target.id,
          currentState: "SERVICE_SELECTION",
          context: firstServices.transition.context,
        }),
      }),
    );
    expect(secondServices.transition.context.options.map((option) => option.value))
      .toEqual(services.slice(9).map((service) => service.id));
    expect(mocks.attachContactToTenant).toHaveBeenCalledWith({
      conversationId: ids.conversation,
      contactId: ids.contact,
      tenantId: target.id,
      profileName: "Ana",
    });

    const staff = Array.from({ length: 12 }, (_, index) => ({
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`,
      name: `Profissional ${index + 1}`,
    }));
    vi.mocked(bookingGateway.listStaff).mockResolvedValue(staff);
    const staffPreference = conversationContextSchema.parse({
      booking: { serviceId: services[0]?.id },
      options: [
        { key: "1", label: "Qualquer", value: "any", kind: "action" },
        { key: "2", label: "Escolher", value: "choose", kind: "action" },
      ],
    });
    const firstStaff = await transitionConversation(
      transitionInput({
        text: "2",
        bookingGateway,
        conversation: conversation({ currentState: "STAFF_PREFERENCE", context: staffPreference }),
      }),
    );
    expect(firstStaff.transition.context.options.at(-1)).toMatchObject({
      value: "staff:9",
      kind: "page",
    });
    const secondStaff = await transitionConversation(
      transitionInput({
        text: "more",
        bookingGateway,
        conversation: conversation({
          currentState: "STAFF_SELECTION",
          context: firstStaff.transition.context,
        }),
      }),
    );
    expect(secondStaff.transition.context.options.map((option) => option.value))
      .toEqual(staff.slice(9).map((person) => person.id));
  });

  it("paginates search, history and upcoming appointments without silent truncation", async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => tenant(index + 1));
    mocks.searchWhatsAppTenants.mockResolvedValue(candidates);
    const searchFirst = await transitionConversation(
      transitionInput({
        text: "barbearia",
        conversation: conversation({ tenantId: null, currentState: "TENANT_SEARCH" }),
      }),
    );
    expect(searchFirst.transition.context.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "tenants:8", kind: "page" })]),
    );
    const searchSecond = await transitionConversation(
      transitionInput({
        text: "more",
        conversation: conversation({
          tenantId: null,
          currentState: "TENANT_SELECTION",
          context: searchFirst.transition.context,
        }),
      }),
    );
    expect(searchSecond.transition.context.options.map((option) => option.value))
      .toEqual(expect.arrayContaining(candidates.slice(8).map((candidate) => candidate.id)));
    expect(mocks.searchWhatsAppTenants).toHaveBeenLastCalledWith({
      query: "barbearia",
      phoneNumberId: ids.phone,
    });

    mocks.resolveWhatsAppTenant.mockResolvedValue({
      kind: "select_history",
      tenants: candidates,
    } satisfies TenantResolution);
    const historyFirst = await transitionConversation(
      transitionInput({
        text: "Olá",
        conversation: conversation({ tenantId: null, currentState: "START" }),
      }),
    );
    const historySecond = await transitionConversation(
      transitionInput({
        text: "more",
        conversation: conversation({
          tenantId: null,
          currentState: "TENANT_SELECTION",
          context: historyFirst.transition.context,
        }),
      }),
    );
    expect(historySecond.transition.context.options.map((option) => option.value))
      .toEqual(expect.arrayContaining(candidates.slice(8).map((candidate) => candidate.id)));

    const bookingGateway = gateway();
    const upcoming = Array.from({ length: 12 }, (_, index) => ({
      id: `cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, "0")}`,
      startsAt: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
      status: "confirmed",
      staffName: null,
      serviceNames: [`Serviço ${index + 1}`],
    }));
    vi.mocked(bookingGateway.listUpcomingBookings).mockResolvedValue(upcoming);
    const upcomingContext = conversationContextSchema.parse({ customerId: ids.customer });
    const upcomingFirst = await transitionConversation(
      transitionInput({
        text: "Meus agendamentos",
        bookingGateway,
        conversation: conversation({ context: upcomingContext }),
      }),
    );
    expect(upcomingFirst.transition.context.options.at(-1)).toMatchObject({
      value: "upcoming:9",
      kind: "page",
    });
    const upcomingSecond = await transitionConversation(
      transitionInput({
        text: "more",
        bookingGateway,
        conversation: conversation({
          currentState: "UPCOMING_APPOINTMENT_ACTION",
          context: upcomingFirst.transition.context,
        }),
      }),
    );
    expect(upcomingSecond.transition.context.options.map((option) => option.value))
      .toEqual(upcoming.slice(9).map((booking) => booking.id));
  });

  it("persists the created appointment id for simulator and follow-up actions", async () => {
    const bookingGateway = gateway();
    vi.mocked(bookingGateway.createBooking).mockResolvedValue({
      appointmentId: ids.appointment,
      managementToken: "management-token-that-is-long-enough",
      status: "confirmed",
      startsAt: "2026-08-01T12:00:00.000Z",
      endsAt: "2026-08-01T12:30:00.000Z",
      staffName: "Bia",
    });
    const context = conversationContextSchema.parse({
      customerId: ids.customer,
      booking: {
        locationId: ids.location,
        serviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        serviceName: "Corte",
        staffId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        staffName: "Bia",
        startsAt: "2026-08-01T12:00:00.000Z",
        endsAt: "2026-08-01T12:30:00.000Z",
        customerName: "Ana Silva",
      },
      options: [{ key: "1", label: "Confirmar", value: "confirm", kind: "action" }],
    });

    const result = await transitionConversation(
      transitionInput({
        text: "1",
        bookingGateway,
        conversation: conversation({ currentState: "BOOKING_CONFIRMATION", context }),
      }),
    );

    expect(result.transition.context.booking.appointmentId).toBe(ids.appointment);
  });

  it("honors welcome notices and disabled human handoff settings", async () => {
    const bookingGateway = gateway();
    vi.mocked(bookingGateway.getTenantContext).mockResolvedValue({
      ...await bookingGateway.getTenantContext(ids.tenant),
      humanHandoffEnabled: false,
      welcomeMessage: "Boas-vindas personalizadas.",
      unknownMessageResponse: "Use as opções disponíveis.",
      administrativeNotice: "Aviso administrativo.",
      emergencyNotice: "Aviso emergencial.",
    });
    vi.mocked(bookingGateway.listServices).mockResolvedValue([{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Corte",
      durationMinutes: 30,
      priceCents: 5_000,
      allowStaffSelection: false,
    }]);
    mocks.resolveWhatsAppTenant.mockResolvedValue({
      kind: "resolved",
      tenant: tenant(1),
      source: "active_session",
    } satisfies TenantResolution);
    mocks.attachContactToTenant.mockResolvedValue({
      customerId: ids.customer,
      customerTenantId: "99999999-9999-4999-8999-999999999999",
    });

    const welcome = await transitionConversation(
      transitionInput({
        text: "Olá",
        bookingGateway,
        conversation: conversation({ tenantId: null, currentState: "START" }),
      }),
    );
    expect(welcome.transition.responses[0]).toMatchObject({
      kind: "list",
      body: expect.stringContaining("Aviso emergencial."),
    });
    expect(welcome.transition.responses[0]).toMatchObject({
      body: expect.stringContaining("Aviso administrativo."),
    });
    expect(welcome.transition.responses[0]).toMatchObject({
      body: expect.stringContaining("Boas-vindas personalizadas."),
    });

    const handoff = await transitionConversation(
      transitionInput({ text: "Atendente", bookingGateway }),
    );
    expect(handoff.transition).toMatchObject({
      state: "SERVICE_SELECTION",
      status: "waiting_customer",
      responses: [{ kind: "text", body: "Use as opções disponíveis." }],
    });
    expect(handoff.transition.context.handoff).toBeUndefined();
  });

  it("preserves maximum notices while keeping the service list body valid", async () => {
    const bookingGateway = gateway();
    const emergencyNotice = "E".repeat(2000);
    const administrativeNotice = "A".repeat(2000);
    const welcomeMessage = "W".repeat(2000);
    vi.mocked(bookingGateway.getTenantContext).mockResolvedValue({
      ...await bookingGateway.getTenantContext(ids.tenant),
      emergencyNotice,
      administrativeNotice,
      welcomeMessage,
    });
    vi.mocked(bookingGateway.listServices).mockResolvedValue([{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Corte",
      durationMinutes: 30,
      priceCents: 5_000,
      allowStaffSelection: false,
    }]);
    mocks.resolveWhatsAppTenant.mockResolvedValue({
      kind: "resolved",
      tenant: tenant(1),
      source: "active_session",
    } satisfies TenantResolution);
    mocks.attachContactToTenant.mockResolvedValue({
      customerId: ids.customer,
      customerTenantId: "99999999-9999-4999-8999-999999999999",
    });

    const result = await transitionConversation(
      transitionInput({
        text: "Olá",
        bookingGateway,
        conversation: conversation({ tenantId: null, currentState: "START" }),
      }),
    );

    expect(result.transition.responses).toHaveLength(1);
    const [response] = result.transition.responses;
    expect(response?.kind).toBe("list");
    if (response?.kind !== "list") throw new Error("expected_list_response");
    const parts = response.body.split("\n\n");
    expect(parts).toHaveLength(4);
    expect(parts[0]?.startsWith("E")).toBe(true);
    expect(parts[1]?.startsWith("A")).toBe(true);
    expect(parts[2]?.startsWith("W")).toBe(true);
    expect(parts.slice(0, 3).every((part) => part.endsWith("…"))).toBe(true);
    expect(parts[0]!.length).toBeGreaterThan(parts[1]!.length);
    expect(parts[1]!.length).toBeGreaterThan(parts[2]!.length);
    expect(parts[3]).toBe("Qual serviço deseja agendar?");
    expect(response.body).toHaveLength(1024);
    for (const response of result.transition.responses) {
      if (response.kind !== "list" && response.kind !== "reply_buttons") continue;
      expect(response.body.length).toBeLessThanOrEqual(1024);
    }
  });
});
