import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commitTransition: vi.fn(),
  findInboundMessage: vi.fn(),
  getConversationById: vi.fn(),
  lockConversation: vi.fn(),
  releaseConversationLock: vi.fn(),
}));

vi.mock("@/features/whatsapp/infrastructure/repositories/channel-repository", () => ({
  commitTransition: mocks.commitTransition,
  findInboundMessage: mocks.findInboundMessage,
  getConversationById: mocks.getConversationById,
  lockConversation: mocks.lockConversation,
  releaseConversationLock: mocks.releaseConversationLock,
}));

import { escalateWhatsAppTechnicalFailure } from "@/features/whatsapp/application/escalate-technical-failure";
import type { NormalizedWhatsAppEvent } from "@/features/whatsapp/domain/provider";

const event: NormalizedWhatsAppEvent = {
  kind: "message.text",
  provider: "mock",
  eventId: "technical-event",
  externalPhoneNumberId: "mock-central",
  externalWabaId: "mock-waba",
  occurredAt: "2026-07-31T12:00:00.000Z",
  messageId: "technical-message",
  sender: "5511999999999",
  profileName: null,
  replyToMessageId: null,
  body: "Quero agendar",
};

const conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  phoneNumberId: "22222222-2222-4222-8222-222222222222",
  contactId: "33333333-3333-4333-8333-333333333333",
  tenantId: "44444444-4444-4444-8444-444444444444",
  status: "waiting_customer" as const,
  currentState: "SERVICE_SELECTION" as const,
  serviceWindowExpiresAt: "2026-08-01T12:00:00.000Z",
  sessionExpiresAt: "2026-07-31T12:30:00.000Z",
  lastInboundAt: "2026-07-31T12:00:00.000Z",
  version: 2,
  context: {
    schemaVersion: 1 as const,
    locale: "pt-BR",
    options: [],
    attempts: {},
    booking: { operation: "create" as const },
    routing: {},
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findInboundMessage.mockResolvedValue({
    messageId: "55555555-5555-4555-8555-555555555555",
    conversationId: conversation.id,
    tenantId: conversation.tenantId,
    conversationStatus: conversation.status,
    currentState: conversation.currentState,
    processed: false,
  });
  mocks.getConversationById.mockResolvedValue(conversation);
  mocks.lockConversation.mockResolvedValue(conversation);
  mocks.commitTransition.mockResolvedValue(conversation);
});

describe("WhatsApp technical failure handoff", () => {
  it("atomically queues a generic acknowledgement and pauses automation", async () => {
    await expect(escalateWhatsAppTechnicalFailure({
      event,
      workerId: "inbox-worker",
    })).resolves.toBe(true);

    expect(mocks.commitTransition).toHaveBeenCalledWith(expect.objectContaining({
      conversation,
      inboundMessageId: "55555555-5555-4555-8555-555555555555",
      recipient: "+5511999999999",
      transition: expect.objectContaining({
        state: "HUMAN_HANDOFF",
        status: "human_handoff",
        context: expect.objectContaining({
          handoff: {
            reason: "technical_failure",
            requestedBy: "automation",
          },
        }),
        responses: [expect.objectContaining({ kind: "text" })],
      }),
    }));
  });

  it("does nothing when the inbound was already finalized", async () => {
    mocks.findInboundMessage.mockResolvedValueOnce({
      messageId: "55555555-5555-4555-8555-555555555555",
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      conversationStatus: conversation.status,
      currentState: conversation.currentState,
      processed: true,
    });

    await expect(escalateWhatsAppTechnicalFailure({
      event,
      workerId: "inbox-worker",
    })).resolves.toBe(false);
    expect(mocks.lockConversation).not.toHaveBeenCalled();
    expect(mocks.commitTransition).not.toHaveBeenCalled();
  });
});
