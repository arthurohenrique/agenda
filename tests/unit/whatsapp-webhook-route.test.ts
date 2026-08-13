import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getConfig: vi.fn(),
  getReadiness: vi.fn(),
  consumeRateLimit: vi.fn(),
  fingerprint: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  normalizeWebhook: vi.fn(),
  processInbox: vi.fn(),
  processOutbox: vi.fn(),
  resolveProvider: vi.fn(),
  storeEnvelope: vi.fn(),
  validateSignature: vi.fn(),
}));

// `after` só existe dentro do escopo de request do Next; o teste captura o callback
// para executá-lo explicitamente e observar o dreno pós-resposta.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/features/whatsapp/application/process-inbox", () => ({
  processWhatsAppInbox: mocks.processInbox,
}));
vi.mock("@/features/whatsapp/application/process-outbox", () => ({
  processWhatsAppOutbox: mocks.processOutbox,
}));
vi.mock("@/features/whatsapp/config", () => ({
  getWhatsAppConfig: mocks.getConfig,
}));
vi.mock("@/features/whatsapp/readiness", () => ({
  getWhatsAppReadiness: mocks.getReadiness,
}));
vi.mock("@/features/whatsapp/infrastructure/providers/resolver", () => ({
  resolveWhatsAppProvider: mocks.resolveProvider,
}));
vi.mock("@/features/whatsapp/infrastructure/repositories/channel-repository", () => ({
  storeWebhookEnvelope: mocks.storeEnvelope,
}));
vi.mock("@/features/whatsapp/infrastructure/repositories/webhook-rate-limit", () => ({
  consumeWhatsAppWebhookRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/rate-limit", () => ({
  requestFingerprint: mocks.fingerprint,
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

import { NextRequest } from "next/server";
import { GET, POST, runtime } from "@/app/api/integrations/whatsapp/webhook/route";

const verifyToken = "local-verification-token";

function postRequest(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/integrations/whatsapp/webhook", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=fixture",
      ...headers,
    },
  });
}

describe("WhatsApp webhook route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getConfig.mockReturnValue({ webhookVerifyToken: verifyToken });
    mocks.getReadiness.mockReturnValue({ channel: { status: "ready" } });
    mocks.validateSignature.mockResolvedValue(true);
    mocks.normalizeWebhook.mockResolvedValue([{
      kind: "unknown",
      provider: "mock",
      eventId: "unknown:fixture",
      externalPhoneNumberId: null,
      externalWabaId: null,
      occurredAt: "2026-07-31T12:00:00.000Z",
      reason: "empty_payload",
    }]);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.fingerprint.mockReturnValue("a".repeat(64));
    mocks.resolveProvider.mockReturnValue({
      provider: "mock",
      normalizeWebhook: mocks.normalizeWebhook,
      validateWebhookSignature: mocks.validateSignature,
    });
    mocks.storeEnvelope.mockResolvedValue({
      id: "97000000-0000-4000-8000-000000000001",
      duplicate: false,
      correlationId: "97100000-0000-4000-8000-000000000001",
    });
    mocks.processInbox.mockResolvedValue({ claimed: 0, processed: 0, failed: 0 });
    mocks.processOutbox.mockResolvedValue({ claimed: 1, sent: 1, failed: 0 });
  });

  async function runScheduledDrain() {
    const callback = mocks.after.mock.calls.at(-1)?.[0] as () => Promise<void>;
    await callback();
  }

  it("returns the challenge only for the configured verification token", async () => {
    const accepted = await GET(new NextRequest(
      `http://localhost/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge-123`,
    ));
    const rejected = await GET(new NextRequest(
      "http://localhost/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123",
    ));

    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toBe("challenge-123");
    expect(rejected.status).toBe(403);
  });

  it("exposes both handlers on the Node runtime required by HMAC and the workers", () => {
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
    expect(runtime).toBe("nodejs");
  });

  it("refuses verification when hub.mode is not subscribe", async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/integrations/whatsapp/webhook?hub.mode=unsubscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge-123`,
    ));

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("challenge-123");
  });

  it("refuses verification when the challenge is absent", async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}`,
    ));

    expect(response.status).toBe(403);
  });

  it("refuses verification when no verify token is configured", async () => {
    mocks.getConfig.mockReturnValueOnce({ webhookVerifyToken: null });
    const response = await GET(new NextRequest(
      "http://localhost/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=challenge-123",
    ));

    expect(response.status).toBe(403);
  });

  it("rate limits verification attempts before comparing the token", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 37,
    });
    const response = await GET(new NextRequest(
      `http://localhost/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge-123`,
    ));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });

  it("validates the raw bytes before storing a valid envelope", async () => {
    const body = '{"entry":[]}';
    const response = await POST(postRequest(body));

    expect(response.status).toBe(200);
    expect(mocks.validateSignature).toHaveBeenCalledOnce();
    const signatureInput = mocks.validateSignature.mock.calls[0]?.[0] as {
      rawBody: Uint8Array;
      signature: string | null;
    };
    expect(new TextDecoder().decode(signatureInput.rawBody)).toBe(body);
    expect(signatureInput.signature).toBe("sha256=fixture");
    expect(mocks.storeEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      provider: "mock",
      signatureValid: true,
      payload: { entry: [] },
      orderingKeys: [expect.stringMatching(/^[0-9a-f]{64}$/)],
      orderingGlobalFallback: false,
    }));
  });

  it("persists only anonymized ordering keys derived from normalized streams", async () => {
    mocks.normalizeWebhook.mockResolvedValueOnce([{
      kind: "message.text",
      provider: "mock",
      eventId: "message-fixture",
      externalPhoneNumberId: "receiver-fixture",
      externalWabaId: null,
      occurredAt: "2026-07-31T12:00:00.000Z",
      messageId: "message-fixture",
      sender: "contact-fixture",
      profileName: null,
      replyToMessageId: null,
      body: "Mensagem fictícia",
    }]);

    const response = await POST(postRequest('{"entry":[]}'));

    expect(response.status).toBe(200);
    const storedInput = mocks.storeEnvelope.mock.calls[0]?.[0] as {
      orderingKeys: string[];
      orderingGlobalFallback: boolean;
    };
    expect(storedInput.orderingKeys).toHaveLength(1);
    expect(storedInput.orderingKeys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(storedInput.orderingGlobalFallback).toBe(false);
    expect(JSON.stringify(storedInput.orderingKeys)).not.toContain("receiver-fixture");
    expect(JSON.stringify(storedInput.orderingKeys)).not.toContain("contact-fixture");
  });

  it("stores with a provider-global fallback when normalization throws", async () => {
    mocks.normalizeWebhook.mockRejectedValueOnce(new Error("unexpected parser failure"));

    const response = await POST(postRequest('{"entry":[]}'));

    expect(response.status).toBe(200);
    expect(mocks.storeEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      orderingKeys: [expect.stringMatching(/^[0-9a-f]{64}$/)],
      orderingGlobalFallback: true,
    }));
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "whatsapp_webhook_normalization_failed",
      { operation: "receive_webhook", result: "global_ordering_fallback" },
    );
  });

  it("refuses deliveries while the channel is misconfigured, before any signature work", async () => {
    mocks.getReadiness.mockReturnValueOnce({ channel: { status: "misconfigured" } });
    const response = await POST(postRequest('{"entry":[]}'));

    expect(response.status).toBe(503);
    expect(mocks.validateSignature).not.toHaveBeenCalled();
    expect(mocks.storeEnvelope).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before parsing or persistence", async () => {
    mocks.validateSignature.mockResolvedValueOnce(false);
    const response = await POST(postRequest("not-json"));

    expect(response.status).toBe(401);
    expect(mocks.storeEnvelope).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "whatsapp_webhook_signature_invalid",
      expect.objectContaining({ result: "rejected" }),
    );
  });

  it("rejects invalid JSON after signature validation", async () => {
    const response = await POST(postRequest("not-json"));

    expect(response.status).toBe(400);
    expect(mocks.storeEnvelope).not.toHaveBeenCalled();
  });

  it("rejects a declared payload above one MiB without reading it", async () => {
    const response = await POST(postRequest("{}", {
      "content-length": String(1_048_577),
    }));

    expect(response.status).toBe(413);
    expect(mocks.validateSignature).not.toHaveBeenCalled();
  });

  it("rate limits accepted-size deliveries before reading or validating the body", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 11,
    });
    const response = await POST(postRequest('{"entry":[]}'));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("11");
    expect(mocks.validateSignature).not.toHaveBeenCalled();
    expect(mocks.storeEnvelope).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate without creating a second logical event", async () => {
    mocks.storeEnvelope.mockResolvedValueOnce({
      id: "97000000-0000-4000-8000-000000000001",
      duplicate: true,
      correlationId: "97100000-0000-4000-8000-000000000001",
    });
    const response = await POST(postRequest('{"entry":[]}'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      duplicate: true,
    });
    expect(mocks.storeEnvelope).toHaveBeenCalledOnce();
  });

  it("stores an unknown payload shape instead of failing the delivery", async () => {
    mocks.normalizeWebhook.mockResolvedValueOnce([{
      kind: "unknown",
      provider: "mock",
      eventId: "unknown:unsupported-change",
      externalPhoneNumberId: null,
      externalWabaId: null,
      occurredAt: "2026-07-31T12:00:00.000Z",
      reason: "unsupported_change",
    }]);

    const response = await POST(postRequest('{"object":"unexpected","field":1}'));

    expect(response.status).toBe(200);
    expect(mocks.storeEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      payload: { object: "unexpected", field: 1 },
      signatureValid: true,
    }));
  });

  it("processes the inbox and outbox only after the response is scheduled", async () => {
    const response = await POST(postRequest('{"entry":[]}'));

    expect(response.status).toBe(200);
    expect(mocks.processInbox).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();

    await runScheduledDrain();

    expect(mocks.processInbox).toHaveBeenCalledWith(expect.objectContaining({
      limit: 5,
      workerId: "webhook:97100000-0000-4000-8000-000000000001",
    }));
    expect(mocks.processOutbox).toHaveBeenCalledWith(expect.objectContaining({
      limit: 5,
      workerId: "webhook:97100000-0000-4000-8000-000000000001",
    }));
  });

  it("drains the outbox even when inbox processing fails, leaving retry to the inbox", async () => {
    mocks.processInbox.mockRejectedValueOnce(new Error("whatsapp_inbox_claim_failed"));
    await POST(postRequest('{"entry":[]}'));
    await runScheduledDrain();

    expect(mocks.processOutbox).toHaveBeenCalledOnce();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "whatsapp_webhook_inbox_drain_failed",
      expect.objectContaining({ result: "deferred_to_recovery" }),
    );
  });

  it("does not reject the delivery when the scheduled drain fails entirely", async () => {
    mocks.processInbox.mockRejectedValueOnce(new Error("whatsapp_inbox_claim_failed"));
    mocks.processOutbox.mockRejectedValueOnce(new Error("whatsapp_outbox_claim_failed"));
    const response = await POST(postRequest('{"entry":[]}'));

    await expect(runScheduledDrain()).resolves.toBeUndefined();
    expect(response.status).toBe(200);
  });

  it("retries the inbox when the fresh envelope is blocked by an in-flight predecessor", async () => {
    // A Meta entrega status em rajada: o dreno do segundo evento encontra o
    // primeiro em voo e a trava de ordem recusa a reivindicação. Sendo o último
    // da rajada, ele não teria entrega seguinte para recuperá-lo.
    mocks.processInbox
      .mockResolvedValueOnce({ claimed: 0, processed: 0, failed: 0 })
      .mockResolvedValueOnce({ claimed: 1, processed: 1, failed: 0 });

    await POST(postRequest('{"entry":[]}'));
    await runScheduledDrain();

    expect(mocks.processInbox).toHaveBeenCalledTimes(3);
    expect(mocks.processOutbox).toHaveBeenCalledOnce();
  });

  it("stops after a single pass when a duplicate finds nothing to claim", async () => {
    mocks.storeEnvelope.mockResolvedValueOnce({
      id: "97000000-0000-4000-8000-000000000001",
      duplicate: true,
      correlationId: "97100000-0000-4000-8000-000000000001",
    });
    await POST(postRequest('{"entry":[]}'));
    await runScheduledDrain();

    // Duplicata não garante fila pendente: repetir seria desperdício.
    expect(mocks.processInbox).toHaveBeenCalledOnce();
    expect(mocks.processOutbox).toHaveBeenCalledOnce();
  });

  it("caps the retries so the post-response work stays bounded", async () => {
    mocks.processInbox.mockResolvedValue({ claimed: 1, processed: 1, failed: 0 });

    await POST(postRequest('{"entry":[]}'));
    await runScheduledDrain();

    expect(mocks.processInbox).toHaveBeenCalledTimes(3);
  });
});
