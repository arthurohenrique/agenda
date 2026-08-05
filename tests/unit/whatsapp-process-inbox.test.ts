import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimWebhookEvents: vi.fn(),
  completeWebhookEvent: vi.fn(),
  deferWebhookEvent: vi.fn(),
  findInboundMessage: vi.fn(),
  ignoreInboundMessage: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  escalateWhatsAppTechnicalFailure: vi.fn(),
  processInboundMessage: vi.fn(),
  updateMessageStatus: vi.fn(),
}));

vi.mock("@/features/whatsapp/infrastructure/repositories/channel-repository", () => ({
  claimWebhookEvents: mocks.claimWebhookEvents,
  completeWebhookEvent: mocks.completeWebhookEvent,
  deferWebhookEvent: mocks.deferWebhookEvent,
  findInboundMessage: mocks.findInboundMessage,
  ignoreInboundMessage: mocks.ignoreInboundMessage,
  updateMessageStatus: mocks.updateMessageStatus,
}));

vi.mock("@/features/whatsapp/application/process-inbound-message", () => ({
  processInboundMessage: mocks.processInboundMessage,
}));

vi.mock("@/features/whatsapp/application/escalate-technical-failure", () => ({
  escalateWhatsAppTechnicalFailure: mocks.escalateWhatsAppTechnicalFailure,
}));

vi.mock("@/features/whatsapp/infrastructure/providers/resolver", () => ({
  resolveWhatsAppProvider: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

import { processWhatsAppInbox } from "@/features/whatsapp/application/process-inbox";
import type {
  NormalizedWhatsAppEvent,
  WhatsAppProvider,
} from "@/features/whatsapp/domain/provider";

const unknown: NormalizedWhatsAppEvent = {
  kind: "unknown",
  provider: "meta_cloud",
  eventId: "unknown-fixture",
  externalPhoneNumberId: null,
  externalWabaId: "account-fixture",
  occurredAt: "2026-07-31T12:00:00.000Z",
  reason: "invalid_payload",
};

const validInbound: NormalizedWhatsAppEvent = {
  kind: "message.text",
  provider: "meta_cloud",
  eventId: "valid-message",
  externalPhoneNumberId: "receiver-fixture",
  externalWabaId: "account-fixture",
  occurredAt: "2026-07-31T12:00:01.000Z",
  messageId: "valid-message",
  sender: "party-fixture",
  profileName: null,
  replyToMessageId: null,
  body: "Mensagem válida",
};

function provider(events: NormalizedWhatsAppEvent[]): WhatsAppProvider {
  return {
    provider: "meta_cloud",
    capabilities: {
      maxReplyButtons: 3,
      maxListRows: 10,
      supportsFlows: false,
      supportsTemplates: true,
    },
    normalizeWebhook: vi.fn().mockResolvedValue(events),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn(),
    sendInteractive: vi.fn(),
    sendTemplate: vi.fn(),
    validateWebhookSignature: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimWebhookEvents.mockResolvedValue([{
    id: "11111111-1111-4111-8111-111111111111",
    provider: "meta_cloud",
    payload: {},
    attempts: 1,
    correlation_id: "22222222-2222-4222-8222-222222222222",
  }]);
  mocks.completeWebhookEvent.mockResolvedValue(undefined);
  mocks.processInboundMessage.mockResolvedValue({});
  mocks.findInboundMessage.mockResolvedValue(null);
  mocks.ignoreInboundMessage.mockResolvedValue(undefined);
  mocks.escalateWhatsAppTechnicalFailure.mockResolvedValue(false);
});

describe("WhatsApp inbox fragment isolation", () => {
  it("ignores an unknown fragment and still processes its valid sibling", async () => {
    const adapter = provider([unknown, validInbound]);

    await expect(processWhatsAppInbox({
      provider: adapter,
      workerId: "worker-fixture",
    })).resolves.toEqual({ claimed: 1, processed: 1, failed: 0 });

    expect(mocks.processInboundMessage).toHaveBeenCalledOnce();
    expect(mocks.processInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: "valid-message",
        externalPhoneNumberId: "receiver-fixture",
      }),
      adapter.capabilities,
      undefined,
      "worker-fixture",
    );
    expect(adapter.markAsRead).toHaveBeenCalledWith({
      externalPhoneNumberId: "receiver-fixture",
      messageId: "valid-message",
    });
    expect(mocks.completeWebhookEvent).toHaveBeenCalledOnce();
    expect(mocks.deferWebhookEvent).not.toHaveBeenCalled();
  });

  it("isolates a permanent receiver failure and processes the following sibling", async () => {
    const unknownReceiver = {
      ...validInbound,
      eventId: "unknown-receiver",
      messageId: "unknown-receiver",
      externalPhoneNumberId: "not-configured",
      occurredAt: "2026-07-31T11:59:59.000Z",
    } satisfies NormalizedWhatsAppEvent;
    mocks.processInboundMessage.mockImplementation(async (message: {
      externalPhoneNumberId: string;
    }) => {
      if (message.externalPhoneNumberId === "not-configured") {
        throw new Error("phone_number_not_found");
      }
      return {};
    });
    const adapter = provider([unknownReceiver, validInbound]);

    await expect(processWhatsAppInbox({
      provider: adapter,
      workerId: "worker-fixture",
    })).resolves.toEqual({ claimed: 1, processed: 1, failed: 0 });

    expect(mocks.processInboundMessage).toHaveBeenCalledTimes(2);
    expect(adapter.markAsRead).toHaveBeenCalledTimes(1);
    expect(adapter.markAsRead).toHaveBeenCalledWith({
      externalPhoneNumberId: "receiver-fixture",
      messageId: "valid-message",
    });
    expect(mocks.completeWebhookEvent).toHaveBeenCalledOnce();
    expect(mocks.deferWebhookEvent).not.toHaveBeenCalled();
  });

  it("retries the envelope on a transient fragment before later siblings", async () => {
    const locked = {
      ...validInbound,
      eventId: "locked-message",
      messageId: "locked-message",
      occurredAt: "2026-07-31T11:59:59.000Z",
    } satisfies NormalizedWhatsAppEvent;
    mocks.processInboundMessage.mockRejectedValueOnce(new Error("conversation_locked"));
    const adapter = provider([locked, validInbound]);

    await expect(processWhatsAppInbox({
      provider: adapter,
      workerId: "worker-fixture",
    })).resolves.toEqual({ claimed: 1, processed: 0, failed: 1 });

    expect(mocks.processInboundMessage).toHaveBeenCalledOnce();
    expect(mocks.completeWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.deferWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
      retry: true,
      errorCode: "conversation_locked",
    }));
  });

  it("moves a recorded inbound to human handoff on the final transient attempt", async () => {
    mocks.claimWebhookEvents.mockResolvedValueOnce([{
      id: "11111111-1111-4111-8111-111111111111",
      provider: "meta_cloud",
      payload: {},
      attempts: 8,
      correlation_id: "22222222-2222-4222-8222-222222222222",
    }]);
    mocks.processInboundMessage.mockRejectedValueOnce(new Error("conversation_locked"));
    mocks.escalateWhatsAppTechnicalFailure.mockResolvedValueOnce(true);
    const adapter = provider([validInbound]);

    await expect(processWhatsAppInbox({
      provider: adapter,
      workerId: "worker-fixture",
    })).resolves.toEqual({ claimed: 1, processed: 1, failed: 0 });

    expect(mocks.escalateWhatsAppTechnicalFailure).toHaveBeenCalledWith({
      event: validInbound,
      workerId: "worker-fixture",
    });
    expect(mocks.completeWebhookEvent).toHaveBeenCalledOnce();
    expect(mocks.deferWebhookEvent).not.toHaveBeenCalled();
    expect(adapter.markAsRead).toHaveBeenCalledWith({
      externalPhoneNumberId: "receiver-fixture",
      messageId: "valid-message",
    });
  });

  it("reserves the final retry when technical escalation is still locked", async () => {
    mocks.claimWebhookEvents
      .mockResolvedValueOnce([{
        id: "11111111-1111-4111-8111-111111111111",
        provider: "meta_cloud",
        payload: {},
        attempts: 7,
        correlation_id: "22222222-2222-4222-8222-222222222222",
      }])
      .mockResolvedValueOnce([{
        id: "11111111-1111-4111-8111-111111111111",
        provider: "meta_cloud",
        payload: {},
        attempts: 8,
        correlation_id: "22222222-2222-4222-8222-222222222222",
      }]);
    mocks.processInboundMessage.mockRejectedValue(new Error("conversation_locked"));
    mocks.escalateWhatsAppTechnicalFailure
      .mockRejectedValueOnce(new Error("conversation_locked"))
      .mockResolvedValueOnce(true);
    const adapter = provider([validInbound]);

    await expect(processWhatsAppInbox({
      provider: adapter,
      workerId: "worker-fixture",
    })).resolves.toEqual({ claimed: 1, processed: 0, failed: 1 });
    await expect(processWhatsAppInbox({
      provider: adapter,
      workerId: "worker-fixture",
    })).resolves.toEqual({ claimed: 1, processed: 1, failed: 0 });

    expect(mocks.escalateWhatsAppTechnicalFailure).toHaveBeenCalledTimes(2);
    expect(mocks.deferWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
      retry: true,
      errorCode: "conversation_locked",
    }));
    expect(mocks.completeWebhookEvent).toHaveBeenCalledOnce();
  });

  it("dead-letters the envelope when the final technical escalation cannot persist", async () => {
    mocks.claimWebhookEvents.mockResolvedValueOnce([{
      id: "11111111-1111-4111-8111-111111111111",
      provider: "meta_cloud",
      payload: {},
      attempts: 8,
      correlation_id: "22222222-2222-4222-8222-222222222222",
    }]);
    mocks.processInboundMessage.mockRejectedValueOnce(new Error("conversation_locked"));
    mocks.escalateWhatsAppTechnicalFailure.mockRejectedValueOnce(
      new Error("conversation_locked"),
    );
    const adapter = provider([validInbound]);

    await expect(processWhatsAppInbox({
      provider: adapter,
      workerId: "worker-fixture",
    })).resolves.toEqual({ claimed: 1, processed: 0, failed: 1 });

    expect(mocks.deferWebhookEvent).toHaveBeenCalledWith({
      eventId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-fixture",
      errorCode: "conversation_locked",
      retry: true,
    });
    expect(mocks.completeWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "whatsapp_webhook_failed",
      expect.objectContaining({
        attempt: 8,
        errorCode: "conversation_locked",
        result: "dead_letter",
      }),
    );
  });
});
