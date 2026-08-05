import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  fingerprint: vi.fn(),
  isConfigured: vi.fn(),
  isTrusted: vi.fn(),
  publicRpc: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isSupabaseConfigured: mocks.isConfigured }));
vi.mock("@/lib/rate-limit", () => ({ requestFingerprint: mocks.fingerprint }));
vi.mock("@/lib/security/origin", () => ({
  isTrustedMutationRequest: mocks.isTrusted,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/public/bookings/route";

const booking = {
  slug: "barbearia-central",
  locationId: "00000000-0000-4000-8000-000000000001",
  serviceIds: ["00000000-0000-4000-8000-000000000002"],
  staffId: null,
  startsAt: "2026-08-03T12:00:00.000Z",
  timezone: "America/Sao_Paulo",
  customer: { name: "Cliente Fictício", phone: "+5511999990001", email: "" },
  notes: "",
  idempotencyKey: "00000000-0000-4000-8000-000000000003",
  website: "",
};

function request(whatsappConsent: boolean) {
  return new NextRequest("http://localhost/api/public/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ ...booking, whatsappConsent }),
  });
}

describe("public booking WhatsApp consent boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isTrusted.mockReturnValue(true);
    mocks.isConfigured.mockReturnValue(true);
    mocks.fingerprint.mockReturnValue("server-derived-rate-key");
    mocks.publicRpc.mockResolvedValue({ data: { appointmentId: "appointment" }, error: null });
    mocks.adminRpc.mockResolvedValue({ data: { appointmentId: "appointment" }, error: null });
    mocks.createClient.mockResolvedValue({ rpc: mocks.publicRpc });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.adminRpc });
  });

  it("uses the service-only atomic wrapper only after explicit consent", async () => {
    const response = await POST(request(true));

    expect(response.status).toBe(201);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "create_public_booking_with_whatsapp_consent",
      expect.objectContaining({
        p_whatsapp_consent: true,
        p_rate_limit_key: "server-derived-rate-key",
        p_whatsapp_consent_evidence: expect.objectContaining({
          policyId: "booking_transactional_updates",
          tenantSlug: booking.slug,
        }),
      }),
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps an ordinary booking on the existing anonymous RPC", async () => {
    const response = await POST(request(false));

    expect(response.status).toBe(201);
    expect(mocks.publicRpc).toHaveBeenCalledWith(
      "create_public_booking",
      expect.not.objectContaining({ p_whatsapp_consent: expect.anything() }),
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the service credential is unavailable for consent", async () => {
    mocks.createAdminClient.mockImplementationOnce(() => {
      throw new Error("secret details");
    });

    const response = await POST(request(true));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Serviço indisponível." });
    expect(mocks.publicRpc).not.toHaveBeenCalled();
  });
});
