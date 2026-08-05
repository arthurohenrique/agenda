import { describe, expect, it } from "vitest";
import {
  getWhatsAppOrdering,
  MAX_WHATSAPP_ORDERING_KEYS,
} from "@/features/whatsapp/application/webhook-ordering";
import type { NormalizedWhatsAppEvent } from "@/features/whatsapp/domain/provider";

function inbound(party: string, index = 0): NormalizedWhatsAppEvent {
  return {
    kind: "message.text",
    provider: "meta_cloud",
    eventId: `message-${index}`,
    externalPhoneNumberId: "receiver-fixture",
    externalWabaId: "account-fixture",
    occurredAt: "2026-07-31T12:00:00.000Z",
    messageId: `message-${index}`,
    sender: party,
    profileName: null,
    replyToMessageId: null,
    body: "Mensagem fictícia",
  };
}

function status(party: string): NormalizedWhatsAppEvent {
  return {
    kind: "status",
    provider: "meta_cloud",
    eventId: "status-fixture",
    externalPhoneNumberId: "receiver-fixture",
    externalWabaId: "account-fixture",
    occurredAt: "2026-07-31T12:00:01.000Z",
    messageId: "outbound-fixture",
    recipient: party,
    status: "delivered",
    conversationId: null,
  };
}

describe("WhatsApp webhook ordering keys", () => {
  it("maps inbound and status for one stream to one stable anonymous key", () => {
    const first = getWhatsAppOrdering("meta_cloud", [
      inbound("party-fixture"),
      status("party-fixture"),
    ]);
    const repeated = getWhatsAppOrdering("meta_cloud", [
      status("party-fixture"),
      inbound("party-fixture"),
    ]);

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ globalFallback: false });
    expect(first.keys).toHaveLength(1);
    expect(first.keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(first.keys[0]).not.toContain("receiver-fixture");
    expect(first.keys[0]).not.toContain("party-fixture");
  });

  it("keeps independent conversation streams eligible for parallel claims", () => {
    const ordering = getWhatsAppOrdering("meta_cloud", [
      inbound("party-a"),
      inbound("party-b", 1),
    ]);

    expect(ordering.globalFallback).toBe(false);
    expect(ordering.keys).toHaveLength(2);
    expect(new Set(ordering.keys).size).toBe(2);
    expect(ordering.keys).toEqual([...ordering.keys].sort());
  });

  it("uses one provider-wide wildcard when an envelope exceeds the bounded key set", () => {
    const events = Array.from(
      { length: MAX_WHATSAPP_ORDERING_KEYS + 1 },
      (_, index) => inbound(`party-${index}`, index),
    );

    expect(getWhatsAppOrdering("meta_cloud", events)).toEqual({
      keys: [expect.stringMatching(/^[0-9a-f]{64}$/)],
      globalFallback: true,
    });
  });
});
