import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimOutboxMessages: vi.fn(),
  completeOutboxMessage: vi.fn(),
  deferOutboxMessage: vi.fn(),
  getConversationDeliveryContext: vi.fn(),
  getPhoneNumberById: vi.fn(),
  markOutboxDeliveryAmbiguous: vi.fn(),
  validateOutboxDelivery: vi.fn(),
  getMessagingPermission: vi.fn(),
}));

vi.mock("@/features/whatsapp/infrastructure/repositories/channel-repository", () => ({
  claimOutboxMessages: mocks.claimOutboxMessages,
  completeOutboxMessage: mocks.completeOutboxMessage,
  deferOutboxMessage: mocks.deferOutboxMessage,
  getConversationDeliveryContext: mocks.getConversationDeliveryContext,
  getPhoneNumberById: mocks.getPhoneNumberById,
  markOutboxDeliveryAmbiguous: mocks.markOutboxDeliveryAmbiguous,
  validateOutboxDelivery: mocks.validateOutboxDelivery,
}));

vi.mock("@/features/whatsapp/application/messaging-policy", () => ({
  getMessagingPermission: mocks.getMessagingPermission,
  messagePurposes: [
    "conversation_reply",
    "handoff_acknowledgement",
    "appointment_created",
    "appointment_confirmed",
    "appointment_reminder",
    "appointment_rescheduled",
    "appointment_cancelled",
    "appointment_confirmation_request",
    "human_follow_up",
  ],
}));

vi.mock("@/features/whatsapp/infrastructure/providers/resolver", () => ({
  resolveWhatsAppProvider: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processWhatsAppOutbox } from "@/features/whatsapp/application/process-outbox";
import {
  WhatsAppProviderError,
  type WhatsAppProvider,
} from "@/features/whatsapp/domain/provider";

const ids = {
  outbox: "11111111-1111-4111-8111-111111111111",
  tenant: "22222222-2222-4222-8222-222222222222",
  phone: "33333333-3333-4333-8333-333333333333",
  conversation: "44444444-4444-4444-8444-444444444444",
  message: "55555555-5555-4555-8555-555555555555",
  contact: "66666666-6666-4666-8666-666666666666",
};

const item = {
  id: ids.outbox,
  provider: "meta_cloud" as const,
  tenant_id: ids.tenant,
  phone_number_id: ids.phone,
  conversation_id: ids.conversation,
  message_id: ids.message,
  message_kind: "text",
  payload: {
    recipient: "+5511999999999",
    response: { kind: "text", body: "Olá" },
    idempotencyKey: "outbox-key",
    purpose: "conversation_reply",
  },
  attempt_count: 1,
};

function provider(sendText: WhatsAppProvider["sendText"]): WhatsAppProvider {
  return {
    provider: "meta_cloud",
    capabilities: {
      maxReplyButtons: 3,
      maxListRows: 10,
      supportsFlows: false,
      supportsTemplates: true,
    },
    sendText,
    sendInteractive: vi.fn(),
    sendTemplate: vi.fn(),
    markAsRead: vi.fn(),
    validateWebhookSignature: vi.fn(),
    normalizeWebhook: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimOutboxMessages.mockResolvedValue([item]);
  mocks.getPhoneNumberById.mockResolvedValue({
    id: ids.phone,
    provider: "meta_cloud",
    externalPhoneNumberId: "meta-phone-1",
    normalizedPhoneNumber: "+551130000000",
    connectionMode: "shared_platform",
  });
  mocks.getConversationDeliveryContext.mockResolvedValue({
    contactId: ids.contact,
    tenantId: ids.tenant,
    phoneNumberId: ids.phone,
  });
  mocks.getMessagingPermission.mockResolvedValue({ allowed: true, mode: "free_form" });
  mocks.validateOutboxDelivery.mockResolvedValue(true);
  mocks.markOutboxDeliveryAmbiguous.mockResolvedValue(undefined);
});

describe("WhatsApp outbox delivery ambiguity", () => {
  it("delivers the reactive handoff acknowledgement instead of dead-lettering it", async () => {
    mocks.claimOutboxMessages.mockResolvedValueOnce([{
      ...item,
      payload: { ...item.payload, purpose: "handoff_acknowledgement" },
    }]);
    const sendText = vi.fn<WhatsAppProvider["sendText"]>().mockResolvedValue({
      provider: "meta_cloud",
      providerMessageId: "wamid.handoff-ack",
      idempotencyKey: item.payload.idempotencyKey,
      acceptedAt: "2026-07-31T12:00:00.000Z",
    });

    await expect(processWhatsAppOutbox({
      provider: provider(sendText),
      workerId: "worker-handoff",
    })).resolves.toEqual({ claimed: 1, sent: 1, failed: 0 });

    expect(mocks.getMessagingPermission).toHaveBeenCalledWith(expect.objectContaining({
      messagePurpose: "handoff_acknowledgement",
    }));
    expect(sendText).toHaveBeenCalledOnce();
    expect(mocks.completeOutboxMessage).toHaveBeenCalledOnce();
    expect(mocks.deferOutboxMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["messaging policy", "tenant_settings_query_failed"],
    ["final delivery validation", "whatsapp_outbox_validation_failed"],
  ])("retries a transient database failure in %s", async (stage, errorCode) => {
    const sendText = vi.fn<WhatsAppProvider["sendText"]>();
    if (stage === "messaging policy") {
      mocks.getMessagingPermission.mockRejectedValueOnce(new Error(errorCode));
    } else {
      mocks.validateOutboxDelivery.mockRejectedValueOnce(new Error(errorCode));
    }

    await expect(processWhatsAppOutbox({
      provider: provider(sendText),
      workerId: "worker-db-failure",
    })).resolves.toEqual({ claimed: 1, sent: 0, failed: 1 });

    expect(mocks.deferOutboxMessage).toHaveBeenCalledWith({
      outboxId: ids.outbox,
      workerId: "worker-db-failure",
      errorCode,
      retry: true,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("dead-letters an uncertain Meta send and never schedules a retry", async () => {
    const sendText = vi.fn<WhatsAppProvider["sendText"]>().mockRejectedValue(
      new WhatsAppProviderError("whatsapp_meta_unavailable", {
        retryable: false,
        deliveryUnknown: true,
      }),
    );

    await expect(processWhatsAppOutbox({
      provider: provider(sendText),
      workerId: "worker-1",
    })).resolves.toEqual({ claimed: 1, sent: 0, failed: 1 });

    expect(mocks.markOutboxDeliveryAmbiguous).toHaveBeenCalledWith({
      outboxId: ids.outbox,
      workerId: "worker-1",
      providerMessageId: null,
      errorCode: "whatsapp_meta_unavailable",
    });
    expect(mocks.deferOutboxMessage).not.toHaveBeenCalled();
    expect(mocks.completeOutboxMessage).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledOnce();
  });

  it.each([408, 500])(
    "never defers or retries an ambiguous HTTP %s send",
    async (status) => {
      const sendText = vi.fn<WhatsAppProvider["sendText"]>().mockRejectedValue(
        new WhatsAppProviderError(`whatsapp_meta_http_${status}`, {
          retryable: false,
          deliveryUnknown: true,
          status,
        }),
      );

      await processWhatsAppOutbox({
        provider: provider(sendText),
        workerId: `worker-${status}`,
      });

      expect(mocks.markOutboxDeliveryAmbiguous).toHaveBeenCalledWith({
        outboxId: ids.outbox,
        workerId: `worker-${status}`,
        providerMessageId: null,
        errorCode: `whatsapp_meta_http_${status}`,
      });
      expect(mocks.deferOutboxMessage).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledOnce();
    },
  );

  it("does not send the same ambiguous item on a later worker pass", async () => {
    mocks.claimOutboxMessages
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([]);
    const sendText = vi.fn<WhatsAppProvider["sendText"]>().mockRejectedValue(
      new WhatsAppProviderError("whatsapp_meta_unavailable", {
        retryable: false,
        deliveryUnknown: true,
      }),
    );
    const adapter = provider(sendText);

    await processWhatsAppOutbox({ provider: adapter, workerId: "worker-1" });
    await processWhatsAppOutbox({ provider: adapter, workerId: "worker-2" });

    expect(sendText).toHaveBeenCalledOnce();
    expect(mocks.deferOutboxMessage).not.toHaveBeenCalled();
  });
});
