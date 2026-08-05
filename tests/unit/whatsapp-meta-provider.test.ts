import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaCloudWhatsAppProvider } from "@/features/whatsapp/infrastructure/providers/meta-cloud-provider";
import sanitizedFixtures from "../fixtures/whatsapp/sanitized-webhooks.json";

const fixedDate = new Date("2026-07-31T12:00:00.000Z");
const appSecret = "app-secret-value-long-enough";

function provider(fetchImplementation = vi.fn<typeof fetch>()) {
  return new MetaCloudWhatsAppProvider({
    graphApiVersion: "v99.1",
    accessToken: "access-token-value-long-enough",
    appSecret,
    fetchImplementation,
    now: () => fixedDate,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Meta Cloud WhatsApp provider", () => {
  it("validates the raw body with HMAC-SHA256 and a timing-safe comparison", async () => {
    const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
    const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
    const adapter = provider();

    await expect(
      adapter.validateWebhookSignature({ rawBody, signature }),
    ).resolves.toBe(true);
    await expect(
      adapter.validateWebhookSignature({ rawBody: `${rawBody} `, signature }),
    ).resolves.toBe(false);
    await expect(
      adapter.validateWebhookSignature({ rawBody, signature: "sha256=invalid" }),
    ).resolves.toBe(false);
  });

  it("sends text only to the configured Graph API origin", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const adapter = provider(fetchMock);

    await expect(adapter.sendText({
      idempotencyKey: "booking:1",
      externalPhoneNumberId: "123456",
      recipient: "+5511999999999",
      body: "Olá",
    })).resolves.toEqual({
      provider: "meta_cloud",
      providerMessageId: "wamid.1",
      idempotencyKey: "booking:1",
      acceptedAt: fixedDate.toISOString(),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v99.1/123456/messages");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: "Bearer access-token-value-long-enough",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "text",
      text: { body: "Olá", preview_url: false },
    });
  });

  it("normalizes text, button, list, status and provider errors", async () => {
    const adapter = provider();
    const payload = {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-1" },
            contacts: [{ wa_id: "5511999999999", profile: { name: "Ana" } }],
            messages: [
              {
                id: "msg-text",
                from: "5511999999999",
                timestamp: "1785508800",
                type: "text",
                text: { body: "Olá" },
              },
              {
                id: "msg-button",
                from: "5511999999999",
                timestamp: "1785508801",
                type: "interactive",
                interactive: { button_reply: { id: "confirm", title: "Confirmar" } },
              },
              {
                id: "msg-list",
                from: "5511999999999",
                timestamp: "1785508802",
                type: "interactive",
                interactive: {
                  list_reply: { id: "service-1", title: "Corte", description: "45 min" },
                },
              },
            ],
            statuses: [{
              id: "wamid.1",
              status: "failed",
              timestamp: "1785508803",
              recipient_id: "5511999999999",
              conversation: { id: "conversation-1" },
              errors: [{ code: 131026, title: "Undeliverable", error_data: { details: "blocked" } }],
            }],
          },
        }],
      }],
    };

    const events = await adapter.normalizeWebhook(payload);

    expect(events.map((event) => event.kind)).toEqual([
      "message.text",
      "message.button",
      "message.list",
      "status",
      "error",
    ]);
    expect(events[0]).toMatchObject({
      eventId: "msg-text",
      sender: "5511999999999",
      profileName: "Ana",
      body: "Olá",
      externalPhoneNumberId: "phone-1",
      externalWabaId: "waba-1",
    });
    expect(events[2]).toMatchObject({ rowId: "service-1", description: "45 min" });
    expect(events[4]).toMatchObject({ code: "131026", details: "blocked" });
  });

  it("normalizes malformed and unsupported payloads without throwing", async () => {
    const adapter = provider();
    await expect(adapter.normalizeWebhook({ invalid: true })).resolves.toEqual([
      expect.objectContaining({ kind: "unknown", reason: "invalid_payload" }),
    ]);

    await expect(adapter.normalizeWebhook({
      object: "whatsapp_business_account",
      entry: [{ id: "waba-1", changes: [{ field: "account_update", value: {} }] }],
    })).resolves.toEqual([
      expect.objectContaining({ kind: "unknown", reason: "unsupported_change" }),
    ]);
  });

  it("keeps valid siblings when nested webhook fragments are malformed", async () => {
    const adapter = provider();
    const events = await adapter.normalizeWebhook({
      object: "whatsapp_business_account",
      entry: [
        { invalid: true },
        {
          id: "account-fixture",
          changes: [
            { field: "messages", invalid: true },
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "receiver-fixture" },
                messages: [
                  {
                    id: "valid-message-a",
                    from: "party-fixture",
                    type: "text",
                    text: { body: "Primeira" },
                  },
                  { id: "malformed-message" },
                  {
                    id: "valid-message-b",
                    from: "party-fixture",
                    type: "text",
                    text: { body: "Segunda" },
                  },
                ],
                statuses: [
                  {
                    id: "valid-status",
                    status: "delivered",
                    recipient_id: "party-fixture",
                    errors: [{ invalid: true }, { code: 131026 }],
                  },
                  { id: "malformed-status" },
                ],
                errors: [{ invalid: true }, { code: 131000 }],
              },
            },
          ],
        },
      ],
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "message.text", eventId: "valid-message-a" }),
      expect.objectContaining({ kind: "message.text", eventId: "valid-message-b" }),
      expect.objectContaining({ kind: "status", messageId: "valid-status" }),
      expect.objectContaining({ kind: "error", code: "131026" }),
      expect.objectContaining({ kind: "error", code: "131000" }),
    ]));
    expect(events.filter((event) => event.kind === "unknown").length)
      .toBeGreaterThanOrEqual(5);
  });

  it("isolates an inbound fragment without receiver metadata and keeps the next change", async () => {
    const adapter = provider();
    const events = await adapter.normalizeWebhook({
      object: "whatsapp_business_account",
      entry: [{
        id: "account-fixture",
        changes: [
          {
            field: "messages",
            value: {
              messages: [{
                id: "message-without-receiver",
                from: "party-a",
                type: "text",
                text: { body: "Sem metadata" },
              }],
            },
          },
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "receiver-fixture" },
              messages: [{
                id: "message-with-receiver",
                from: "party-b",
                type: "text",
                text: { body: "Com metadata" },
              }],
            },
          },
        ],
      }],
    });

    expect(events).toEqual([
      expect.objectContaining({
        kind: "unknown",
        reason: "invalid_payload",
        externalPhoneNumberId: null,
      }),
      expect.objectContaining({
        kind: "message.text",
        eventId: "message-with-receiver",
        externalPhoneNumberId: "receiver-fixture",
      }),
    ]);
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "message.text",
        eventId: "message-without-receiver",
      }),
    ]));
  });

  it("normalizes every sanitized webhook fixture used by integration tests", async () => {
    const adapter = provider();
    const cases = [
      [sanitizedFixtures.text, "message.text"],
      [sanitizedFixtures.button, "message.button"],
      [sanitizedFixtures.list, "message.list"],
      [sanitizedFixtures.sent, "status"],
      [sanitizedFixtures.delivered, "status"],
      [sanitizedFixtures.read, "status"],
      [sanitizedFixtures.failed, "status"],
      [sanitizedFixtures.unknown, "unknown"],
      [sanitizedFixtures.invalid, "unknown"],
    ] as const;

    for (const [fixture, expectedKind] of cases) {
      const events = await adapter.normalizeWebhook(fixture);
      expect(events[0]?.kind).toBe(expectedKind);
    }
    expect(sanitizedFixtures.duplicate).toEqual(["text", "text"]);
  });

  it("classifies HTTP failures without exposing provider response bodies", async () => {
    const adapter = provider(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("secret provider detail", { status: 429 })),
    );

    await expect(adapter.sendText({
      idempotencyKey: "booking:1",
      externalPhoneNumberId: "123456",
      recipient: "+5511999999999",
      body: "Olá",
    })).rejects.toMatchObject({
      message: "whatsapp_meta_http_429",
      retryable: true,
      status: 429,
      deliveryUnknown: false,
    });
  });

  it("marks a network failure after starting a send as delivery-unknown", async () => {
    const adapter = provider(
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network reset")),
    );

    await expect(adapter.sendText({
      idempotencyKey: "booking:ambiguous",
      externalPhoneNumberId: "123456",
      recipient: "+5511999999999",
      body: "Olá",
    })).rejects.toMatchObject({
      message: "whatsapp_meta_unavailable",
      retryable: false,
      deliveryUnknown: true,
    });
  });

  it.each([408, 425, 500, 503])(
    "marks ambiguous HTTP %s send responses as delivery-unknown",
    async (status) => {
      const adapter = provider(
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
      );

      await expect(adapter.sendText({
        idempotencyKey: `booking:http:${status}`,
        externalPhoneNumberId: "123456",
        recipient: "+5511999999999",
        body: "Olá",
      })).rejects.toMatchObject({
        message: `whatsapp_meta_http_${status}`,
        retryable: false,
        deliveryUnknown: true,
        status,
      });
    },
  );

  it("keeps an HTTP 500 mark-as-read response retryable and delivery-known", async () => {
    const adapter = provider(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    );

    await expect(adapter.markAsRead({
      externalPhoneNumberId: "123456",
      messageId: "wamid.1",
    })).rejects.toMatchObject({
      message: "whatsapp_meta_http_500",
      retryable: true,
      deliveryUnknown: false,
    });
  });

  it("keeps a network failure before mark-as-read retryable", async () => {
    const adapter = provider(
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network reset")),
    );

    await expect(adapter.markAsRead({
      externalPhoneNumberId: "123456",
      messageId: "wamid.1",
    })).rejects.toMatchObject({
      message: "whatsapp_meta_unavailable",
      retryable: true,
      deliveryUnknown: false,
    });
  });

  it("keeps real Flows unsupported while the feature has no live implementation", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = provider(fetchMock);

    expect(adapter.capabilities.supportsFlows).toBe(false);
    await expect(adapter.createFlow({
      idempotencyKey: "flow:1",
      externalWabaId: "waba-1",
      name: "booking_flow",
      categories: ["APPOINTMENT_BOOKING"],
    })).rejects.toThrow("whatsapp_flows_unsupported");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
