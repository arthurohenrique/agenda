import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import {
  extractRoutingCode,
  normalizeRoutingCode,
  resolveWhatsAppTenant,
} from "@/features/whatsapp/application/resolve-tenant";

beforeEach(() => vi.clearAllMocks());

describe("WhatsApp tenant routing code", () => {
  it.each([
    ["Código: aBc-123!", "ABC123"],
    ["codigo ABC123 por favor", "ABC123"],
    ["Use #ZXCVB9, por favor", "ZXCVB9"],
    ["CODE: qwert7", "QWERT7"],
    ["BARB01", "BARB01"],
  ])("extracts a normalized explicit code from %s", (message, expected) => {
    expect(extractRoutingCode(message)).toBe(expected);
  });

  it("rejects short or unmarked prose", () => {
    expect(extractRoutingCode("Código: A1")).toBeNull();
    expect(extractRoutingCode("Quero")).toBeNull();
    expect(extractRoutingCode("Quero agendar na Barbearia Central")).toBeNull();
  });

  it("normalizes accents, punctuation and length deterministically", () => {
    expect(normalizeRoutingCode(" ábc 12-3_!* ")).toBe("ABC123");
    expect(normalizeRoutingCode("a".repeat(40))).toHaveLength(32);
  });

  it("distinguishes a routing RPC outage from an unknown code", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: "P0002", message: "whatsapp_routing_code_not_found" },
      })
      .mockResolvedValueOnce({ data: null, error: { message: "network unavailable" } });
    mocks.createAdminClient.mockReturnValue({ rpc });
    const input = {
      phoneNumber: {
        id: "11111111-1111-4111-8111-111111111111",
        provider: "mock" as const,
        externalPhoneNumberId: "receiver",
        normalizedPhoneNumber: "+551130000000",
        connectionMode: "shared_platform" as const,
      },
      contact: {
        id: "22222222-2222-4222-8222-222222222222",
        normalizedPhone: "+5511999999999",
        whatsappUserId: "5511999999999",
        profileName: null,
        customerId: null,
      },
      conversation: {
        id: "33333333-3333-4333-8333-333333333333",
        phoneNumberId: "11111111-1111-4111-8111-111111111111",
        contactId: "22222222-2222-4222-8222-222222222222",
        tenantId: null,
        status: "open" as const,
        currentState: "START" as const,
        serviceWindowExpiresAt: null,
        sessionExpiresAt: null,
        lastInboundAt: null,
        version: 1,
        context: {
          schemaVersion: 1 as const,
          locale: "pt-BR",
          options: [],
          attempts: {},
          booking: { operation: "create" as const },
          routing: {},
        },
      },
      messageText: "Código: ABC123",
      provider: "mock",
      providerMessageId: "message-1",
    };

    await expect(resolveWhatsAppTenant(input)).resolves.toEqual({ kind: "search" });
    await expect(resolveWhatsAppTenant(input)).rejects.toThrow(
      "routing_code_query_failed",
    );
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_usage_key: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});
