import { describe, expect, it } from "vitest";
import { MockWhatsAppProvider } from "@/features/whatsapp/infrastructure/providers/mock-provider";

const fixedDate = new Date("2026-07-31T12:00:00.000Z");
const textInput = {
  idempotencyKey: "conversation:1:reply:1",
  externalPhoneNumberId: "phone-1",
  recipient: "+5511999999999",
  body: "Olá",
};

describe("mock WhatsApp provider", () => {
  it("returns deterministic IDs and records one send per idempotency key", async () => {
    const first = new MockWhatsAppProvider({ now: () => fixedDate });
    const second = new MockWhatsAppProvider({ now: () => fixedDate });

    const firstResult = await first.sendText(textInput);
    const duplicateResult = await first.sendText(textInput);
    const secondResult = await second.sendText(textInput);

    expect(duplicateResult).toEqual(firstResult);
    expect(secondResult.providerMessageId).toBe(firstResult.providerMessageId);
    expect(first.sentMessages).toHaveLength(1);
  });

  it("simulates transient failures before recording a successful retry", async () => {
    const adapter = new MockWhatsAppProvider({
      transientFailures: { sendText: 1 },
      now: () => fixedDate,
    });

    await expect(adapter.sendText(textInput)).rejects.toMatchObject({
      message: "whatsapp_mock_transient_failure",
      retryable: true,
    });
    await expect(adapter.sendText(textInput)).resolves.toMatchObject({ provider: "mock" });
    expect(adapter.sentMessages).toHaveLength(1);
  });

  it("duplicates and reverses normalized events on demand", async () => {
    const adapter = new MockWhatsAppProvider({
      duplicateEvents: true,
      outOfOrderEvents: true,
      now: () => fixedDate,
    });
    const first = adapter.simulateInboundText({
      idempotencyKey: "in:1",
      externalPhoneNumberId: "phone-1",
      sender: "5511999999999",
      body: "Primeira",
    });
    const second = adapter.simulateInboundText({
      idempotencyKey: "in:2",
      externalPhoneNumberId: "phone-1",
      sender: "5511999999999",
      body: "Segunda",
    });

    const events = await adapter.normalizeWebhook({ events: [first, second] });

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.eventId)).toEqual([
      second.eventId,
      second.eventId,
      first.eventId,
      first.eventId,
    ]);
  });

  it("uses injected capabilities for interactive limits", async () => {
    const adapter = new MockWhatsAppProvider({
      capabilities: { maxReplyButtons: 1, supportsTemplates: false },
    });

    await expect(adapter.sendInteractive({
      idempotencyKey: "buttons:1",
      externalPhoneNumberId: "phone-1",
      recipient: "+5511999999999",
      response: {
        kind: "reply_buttons",
        body: "Escolha",
        buttons: [{ id: "1", title: "Um" }, { id: "2", title: "Dois" }],
      },
    })).rejects.toThrow("whatsapp_buttons_invalid");
    expect(adapter.capabilities).toMatchObject({
      maxReplyButtons: 1,
      supportsTemplates: false,
    });
  });

  it("provides deterministic Flow fixtures without external calls", async () => {
    const adapter = new MockWhatsAppProvider({
      flowExchangeFixture: { screen: "CONFIRMATION", data: { available: true } },
    });
    const created = await adapter.createFlow({
      idempotencyKey: "flow:1",
      externalWabaId: "waba-1",
      name: "booking_flow",
      categories: ["APPOINTMENT_BOOKING"],
    });

    await expect(adapter.publishFlow({
      idempotencyKey: "flow:publish:1",
      externalWabaId: "waba-1",
      externalFlowId: created.externalFlowId,
    })).resolves.toMatchObject({ status: "published" });
    await expect(adapter.handleFlowExchange({
      flowToken: "flow-token",
      action: "data_exchange",
      screen: "SERVICE",
      data: {},
    })).resolves.toEqual({ screen: "CONFIRMATION", data: { available: true } });
  });
});
