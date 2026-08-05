import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

import { SupabaseWhatsAppBookingGateway } from "@/features/whatsapp/application/booking-gateway";

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  primaryLocation: "22222222-2222-4222-8222-222222222222",
  allowedLocation: "33333333-3333-4333-8333-333333333333",
  service: "44444444-4444-4444-8444-444444444444",
  otherService: "55555555-5555-4555-8555-555555555555",
  customer: "66666666-6666-4666-8666-666666666666",
  appointment: "77777777-7777-4777-8777-777777777777",
  conversation: "88888888-8888-4888-8888-888888888888",
};

const actor = {
  channel: "whatsapp" as const,
  phoneNumberId: "mock-phone",
  conversationId: ids.conversation,
  externalContactId: "+5511999999999",
};

function queryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit", "gt"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

function settings(metadata: Record<string, unknown>) {
  return {
    data: {
      enabled: true,
      booking_enabled: true,
      human_handoff_enabled: true,
      welcome_message: "Olá.",
      unknown_message_response: null,
      metadata,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Supabase WhatsApp booking scope", () => {
  it("chooses an allowed active location instead of an unallowed primary", async () => {
    const tenantQuery = queryBuilder({
      data: {
        id: ids.tenant,
        slug: "tenant",
        name: "Tenant",
        timezone: "America/Sao_Paulo",
        locations: [
          { id: ids.primaryLocation, is_primary: true },
          { id: ids.allowedLocation, is_primary: false },
        ],
      },
      error: null,
    });
    const settingsQuery = queryBuilder(settings({
      allowed_location_ids: [ids.allowedLocation],
      allowed_service_ids: [ids.service],
      administrative_notice: "Aviso.",
      emergency_notice: "Emergência.",
    }));
    mocks.from.mockImplementation((table: string) =>
      table === "tenants" ? tenantQuery : settingsQuery);

    const result = await new SupabaseWhatsAppBookingGateway()
      .getTenantContext(ids.tenant);

    expect(result).toMatchObject({
      locationId: ids.allowedLocation,
      welcomeMessage: "Olá.",
      administrativeNotice: "Aviso.",
      emergencyNotice: "Emergência.",
      humanHandoffEnabled: true,
    });
  });

  it("fails closed when configured location metadata is invalid", async () => {
    const tenantQuery = queryBuilder({
      data: {
        id: ids.tenant,
        slug: "tenant",
        name: "Tenant",
        timezone: "America/Sao_Paulo",
        locations: [{ id: ids.primaryLocation, is_primary: true }],
      },
      error: null,
    });
    const settingsQuery = queryBuilder(settings({ allowed_location_ids: ["not-a-uuid"] }));
    mocks.from.mockImplementation((table: string) =>
      table === "tenants" ? tenantQuery : settingsQuery);

    await expect(new SupabaseWhatsAppBookingGateway().getTenantContext(ids.tenant))
      .rejects.toThrow("tenant_location_not_found");
  });

  it("filters public services by allowed_service_ids", async () => {
    const settingsQuery = queryBuilder(settings({ allowed_service_ids: [ids.service] }));
    const serviceQuery = queryBuilder({
      data: [{
        id: ids.service,
        name: "Corte",
        duration_minutes: 30,
        price_cents: 5_000,
        promotional_price_cents: null,
        allow_staff_selection: true,
      }],
      error: null,
    });
    mocks.from.mockImplementation((table: string) =>
      table === "tenant_whatsapp_settings" ? settingsQuery : serviceQuery);

    const result = await new SupabaseWhatsAppBookingGateway().listServices(ids.tenant);

    expect(result).toHaveLength(1);
    expect(serviceQuery.in).toHaveBeenCalledWith("id", [ids.service]);
  });

  it("returns no services for an empty or malformed explicit allowlist", async () => {
    for (const allowed_service_ids of [[], ["not-a-uuid"]]) {
      vi.clearAllMocks();
      const settingsQuery = queryBuilder(settings({ allowed_service_ids }));
      mocks.from.mockImplementation((table: string) => {
        if (table !== "tenant_whatsapp_settings") {
          throw new Error("services_query_must_not_run");
        }
        return settingsQuery;
      });

      await expect(new SupabaseWhatsAppBookingGateway().listServices(ids.tenant))
        .resolves.toEqual([]);
      expect(mocks.from).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps backward-compatible all-services behavior only when the key is absent", async () => {
    const settingsQuery = queryBuilder(settings({}));
    const serviceQuery = queryBuilder({
      data: [ids.service, ids.otherService].map((id, index) => ({
        id,
        name: `Serviço ${index + 1}`,
        duration_minutes: 30,
        price_cents: 5_000,
        promotional_price_cents: null,
        allow_staff_selection: false,
      })),
      error: null,
    });
    mocks.from.mockImplementation((table: string) =>
      table === "tenant_whatsapp_settings" ? settingsQuery : serviceQuery);

    const result = await new SupabaseWhatsAppBookingGateway().listServices(ids.tenant);

    expect(result).toHaveLength(2);
    expect(serviceQuery.in).not.toHaveBeenCalled();
  });
});

describe("Supabase WhatsApp booking transient failures", () => {
  it.each([
    {
      operation: "create",
      error: { code: "40001", message: "serialization failure" },
      expected: "booking_transient_failure",
    },
    {
      operation: "cancel",
      error: { code: "40P01", message: "deadlock detected" },
      expected: "cancellation_transient_failure",
    },
    {
      operation: "reschedule",
      error: { code: "08006", message: "connection failure" },
      expected: "reschedule_transient_failure",
    },
  ] as const)("classifies $operation RPC infrastructure errors as retryable", async ({
    operation,
    error,
    expected,
  }) => {
    mocks.rpc.mockResolvedValue({ data: null, error });
    const gateway = new SupabaseWhatsAppBookingGateway();

    const request = operation === "create"
      ? gateway.createBooking({
          tenantId: ids.tenant,
          locationId: ids.primaryLocation,
          serviceIds: [ids.service],
          staffId: null,
          startsAt: "2026-08-01T12:00:00.000Z",
          timezone: "America/Sao_Paulo",
          customerName: "Ana",
          customerPhone: "+5511999999999",
          customerEmail: null,
          notes: null,
          idempotencyKey: "booking-key",
          actor,
        })
      : operation === "cancel"
        ? gateway.cancelBooking({
            tenantId: ids.tenant,
            customerId: ids.customer,
            appointmentId: ids.appointment,
            reason: null,
            idempotencyKey: "cancel-key",
            actor,
          })
        : gateway.rescheduleBooking({
            tenantId: ids.tenant,
            customerId: ids.customer,
            appointmentId: ids.appointment,
            startsAt: "2026-08-02T12:00:00.000Z",
            staffId: null,
            idempotencyKey: "reschedule-key",
            actor,
          });

    await expect(request).rejects.toThrow(expected);
  });

  it("keeps deterministic RPC validation failures terminal", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "invalid appointment" },
    });

    await expect(new SupabaseWhatsAppBookingGateway().cancelBooking({
      tenantId: ids.tenant,
      customerId: ids.customer,
      appointmentId: ids.appointment,
      reason: null,
      idempotencyKey: "cancel-key",
      actor,
    })).rejects.toThrow("cancellation_failed");
  });
});
