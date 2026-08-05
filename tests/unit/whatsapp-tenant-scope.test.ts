import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationContextSchema } from "@/features/whatsapp/domain/conversation";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

import {
  attachContactToTenant,
  getWhatsAppTenantById,
  resolveWhatsAppTenant,
  searchWhatsAppTenants,
} from "@/features/whatsapp/application/resolve-tenant";

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  otherTenant: "22222222-2222-4222-8222-222222222222",
  phone: "33333333-3333-4333-8333-333333333333",
  contact: "44444444-4444-4444-8444-444444444444",
  conversation: "55555555-5555-4555-8555-555555555555",
  customer: "66666666-6666-4666-8666-666666666666",
  customerTenant: "77777777-7777-4777-8777-777777777777",
};

function builder(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(async () => result);
  query.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query as {
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

function tenantRow(id = ids.tenant) {
  return {
    id,
    slug: `tenant-${id.slice(0, 4)}`,
    name: "Tenant permitido",
    timezone: "America/Sao_Paulo",
    city_search: "sao paulo",
    district_search: null,
    tenant_whatsapp_settings: { enabled: true, booking_enabled: true },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WhatsApp tenant receiver scope", () => {
  it("loads a tenant only after proving an active link to the receiver", async () => {
    const link = builder({ data: { tenant_id: ids.tenant }, error: null });
    const tenant = builder({ data: tenantRow(), error: null });
    mocks.from.mockImplementationOnce(() => link).mockImplementationOnce(() => tenant);

    await expect(getWhatsAppTenantById(ids.tenant, ids.phone)).resolves.toMatchObject({
      id: ids.tenant,
    });

    expect(link.eq).toHaveBeenCalledWith("phone_number_id", ids.phone);
    expect(link.eq).toHaveBeenCalledWith("tenant_id", ids.tenant);
    expect(link.eq).toHaveBeenCalledWith("status", "active");
  });

  it("does not query tenant details when the receiver link is absent", async () => {
    const link = builder({ data: null, error: null });
    mocks.from.mockReturnValue(link);

    await expect(getWhatsAppTenantById(ids.otherTenant, ids.phone)).resolves.toBeNull();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("intersects search and history with active receiver tenant ids", async () => {
    const searchLinks = builder({ data: [{ tenant_id: ids.tenant }], error: null });
    const searchTenants = builder({ data: [tenantRow()], error: null });
    mocks.from
      .mockImplementationOnce(() => searchLinks)
      .mockImplementationOnce(() => searchTenants);

    await expect(searchWhatsAppTenants({
      query: "Tenant",
      phoneNumberId: ids.phone,
    })).resolves.toHaveLength(1);
    expect(searchTenants.in).toHaveBeenCalledWith("id", [ids.tenant]);

    const historyLinks = builder({ data: [{ tenant_id: ids.tenant }], error: null });
    const history = builder({
      data: [{ tenants: tenantRow() }],
      error: null,
    });
    mocks.from
      .mockImplementationOnce(() => historyLinks)
      .mockImplementationOnce(() => history);

    const result = await resolveWhatsAppTenant({
      phoneNumber: {
        id: ids.phone,
        provider: "mock",
        externalPhoneNumberId: "mock-phone",
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
      conversation: {
        id: ids.conversation,
        phoneNumberId: ids.phone,
        contactId: ids.contact,
        tenantId: null,
        status: "waiting_customer",
        currentState: "START",
        serviceWindowExpiresAt: null,
        sessionExpiresAt: null,
        lastInboundAt: null,
        context: conversationContextSchema.parse({}),
        version: 1,
      },
      messageText: "Olá",
      provider: "mock",
      providerMessageId: "message-1",
    });

    expect(result).toMatchObject({ kind: "confirm_history" });
    expect(history.in).toHaveBeenCalledWith("tenant_id", [ids.tenant]);
  });

  it("passes the exact conversation into customer-tenant resolution and parses table output", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        customer_id: ids.customer,
        customer_tenant_id: ids.customerTenant,
      }],
      error: null,
    });

    await expect(attachContactToTenant({
      conversationId: ids.conversation,
      contactId: ids.contact,
      tenantId: ids.tenant,
      profileName: "Ana",
    })).resolves.toEqual({
      customerId: ids.customer,
      customerTenantId: ids.customerTenant,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_whatsapp_customer_tenant", {
      p_conversation_id: ids.conversation,
      p_contact_id: ids.contact,
      p_tenant_id: ids.tenant,
      p_profile_name: "Ana",
    });
  });
});
