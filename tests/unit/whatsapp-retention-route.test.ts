import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyRetention: vi.fn(),
  getConfig: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/features/whatsapp/application/apply-retention", () => ({
  applyWhatsAppRetention: mocks.applyRetention,
}));
vi.mock("@/features/whatsapp/config", () => ({
  getWhatsAppConfig: mocks.getConfig,
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: mocks.loggerError },
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/internal/whatsapp/retention/route";

const secret = "w".repeat(32);

function request(body = "{}", bearer = secret) {
  return new NextRequest("http://localhost/api/internal/whatsapp/retention", {
    method: "POST",
    body,
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
  });
}

describe("WhatsApp retention worker route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getConfig.mockReturnValue({ workerSecret: secret });
    mocks.applyRetention.mockResolvedValue({
      status: "applied",
      policyVersion: "2026-07-31.v1",
      webhookPayloadsRedacted: 2,
    });
  });

  it("rejects callers without the internal bearer", async () => {
    const response = await POST(request("{}", "wrong"));
    expect(response.status).toBe(401);
    expect(mocks.applyRetention).not.toHaveBeenCalled();
  });

  it("applies a bounded batch and returns only counters", async () => {
    const response = await POST(request('{"limit":750}'));
    expect(response.status).toBe(200);
    expect(mocks.applyRetention).toHaveBeenCalledWith(750);
    await expect(response.json()).resolves.toMatchObject({
      status: "applied",
      webhookPayloadsRedacted: 2,
    });
  });

  it("rejects an excessive batch", async () => {
    const response = await POST(request('{"limit":5001}'));
    expect(response.status).toBe(400);
    expect(mocks.applyRetention).not.toHaveBeenCalled();
  });
});
