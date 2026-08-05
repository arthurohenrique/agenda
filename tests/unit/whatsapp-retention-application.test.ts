import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { applyWhatsAppRetention } from "@/features/whatsapp/application/apply-retention";

describe("WhatsApp retention application", () => {
  beforeEach(() => vi.resetAllMocks());

  it("preserva todos os contadores retornados pelo sweep", async () => {
    const data = {
      status: "applied",
      policyVersion: "2026-07-31.v1",
      webhookPayloadsRedacted: 1,
      outboxRowsDeleted: 2,
      messageBodiesRedacted: 3,
      conversationContextsRedacted: 4,
      pendingStatusesDeleted: 5,
      handoffsRedacted: 6,
      flowContextsRedacted: 7,
      optInEvidenceRedacted: 8,
      rateLimitRowsDeleted: 9,
      automatedSessionsExpired: 10,
      staleHandoffsExpired: 11,
      contactsAnonymized: 12,
    } as const;
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
    });

    await expect(applyWhatsAppRetention(500)).resolves.toEqual(data);
  });

  it("falha fechado quando a RPC não está disponível", async () => {
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "08006" } }),
    });

    await expect(applyWhatsAppRetention(500)).rejects.toThrow("whatsapp_retention_failed");
  });
});
