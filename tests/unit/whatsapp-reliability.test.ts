import { describe, expect, it } from "vitest";
import { whatsappIdempotencyKey } from "@/features/whatsapp/application/booking-gateway";
import {
  getWhatsAppRetryBackoffRange,
  normalizeWhatsAppWorkerLimit,
} from "@/features/whatsapp/application/worker-policy";
import { orderNormalizedWhatsAppEvents } from "@/features/whatsapp/application/process-inbox";
import {
  WhatsAppApplicationError,
  classifyWhatsAppError,
} from "@/features/whatsapp/domain/errors";
import {
  WhatsAppProviderError,
  type NormalizedWhatsAppEvent,
} from "@/features/whatsapp/domain/provider";
import {
  serializeConversationResponse,
  webhookExternalKey,
} from "@/features/whatsapp/infrastructure/repositories/channel-repository";

function unknownEvent(eventId: string, occurredAt: string): NormalizedWhatsAppEvent {
  return {
    kind: "unknown",
    provider: "mock",
    eventId,
    externalPhoneNumberId: null,
    externalWabaId: null,
    occurredAt,
    reason: "unsupported_change",
  };
}

describe("WhatsApp reliability policy", () => {
  it("creates deterministic, scoped UUID idempotency keys", () => {
    const first = whatsappIdempotencyKey("conversation-1", "message-1", "booking");

    expect(first).toBe(
      whatsappIdempotencyKey("conversation-1", "message-1", "booking"),
    );
    expect(first).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(first).not.toBe(
      whatsappIdempotencyKey("conversation-1", "message-2", "booking"),
    );
  });

  it("serializes conversation responses to the SQL contract", () => {
    expect(serializeConversationResponse({
      kind: "reply_buttons",
      body: "Confirma?",
      buttons: [{ id: "yes", title: "Sim" }],
    }, "conversation:2:0")).toEqual({
      idempotency_key: "conversation:2:0",
      message_type: "button",
      content: { text: "Confirma?" },
      normalized_content: { text: "Confirma?" },
      payload: {
        kind: "reply_buttons",
        body: "Confirma?",
        buttons: [{ id: "yes", title: "Sim" }],
      },
    });
  });

  it("hashes exact webhook bytes for duplicate detection", () => {
    const bytes = new TextEncoder().encode("{\"event\":1}");

    expect(webhookExternalKey("meta_cloud", bytes)).toBe(
      webhookExternalKey("meta_cloud", "{\"event\":1}"),
    );
    expect(webhookExternalKey("meta_cloud", bytes)).not.toBe(
      webhookExternalKey("meta_cloud", new Uint8Array([...bytes, 32])),
    );
  });

  it("mirrors exponential backoff with jitter and terminal attempt", () => {
    expect(getWhatsAppRetryBackoffRange(1)).toEqual({
      minSeconds: 30,
      maxSeconds: 45,
    });
    expect(getWhatsAppRetryBackoffRange(7)).toEqual({
      minSeconds: 1_920,
      maxSeconds: 1_935,
    });
    expect(getWhatsAppRetryBackoffRange(8)).toBeNull();
    expect(() => getWhatsAppRetryBackoffRange(0)).toThrow(
      "whatsapp_retry_attempt_invalid",
    );
  });

  it("keeps worker batches within the five-minute lease budget", () => {
    expect(normalizeWhatsAppWorkerLimit(undefined)).toBe(10);
    expect(normalizeWhatsAppWorkerLimit(50)).toBe(10);
    expect(normalizeWhatsAppWorkerLimit(2.9)).toBe(2);
    expect(normalizeWhatsAppWorkerLimit(Number.NaN)).toBe(10);
  });

  it("classifies provider, transient, business and unsafe errors", () => {
    expect(classifyWhatsAppError(new WhatsAppProviderError(
      "whatsapp_meta_unavailable",
      { retryable: true },
    ))).toEqual({ code: "whatsapp_meta_unavailable", kind: "transient" });
    expect(classifyWhatsAppError(new WhatsAppApplicationError(
      "booking_conflict",
      "business",
    ))).toEqual({ code: "booking_conflict", kind: "business" });
    expect(classifyWhatsAppError(new Error("service_query_failed"))).toEqual({
      code: "service_query_failed",
      kind: "transient",
    });
    for (const code of [
      "booking_transient_failure",
      "cancellation_transient_failure",
      "reschedule_transient_failure",
      "phone_number_query_failed",
      "routing_code_query_failed",
      "tenant_settings_query_failed",
      "whatsapp_outbox_validation_failed",
    ]) {
      expect(classifyWhatsAppError(new Error(code))).toEqual({
        code,
        kind: "transient",
      });
    }
    expect(classifyWhatsAppError(new Error("token=secret value"))).toEqual({
      code: "unknown_whatsapp_error",
      kind: "permanent",
    });
  });

  it("orders out-of-order events without mutating equal-time order", () => {
    const events = [
      unknownEvent("late", "2026-07-31T12:00:02.000Z"),
      unknownEvent("early-a", "2026-07-31T12:00:01.000Z"),
      unknownEvent("early-b", "2026-07-31T12:00:01.000Z"),
    ];

    expect(orderNormalizedWhatsAppEvents(events).map((event) => event.eventId))
      .toEqual(["early-a", "early-b", "late"]);
    expect(events.map((event) => event.eventId)).toEqual([
      "late",
      "early-a",
      "early-b",
    ]);
  });
});
