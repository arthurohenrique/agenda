import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationContextSchema } from "@/features/whatsapp/domain/conversation";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import {
  claimOutboxMessages,
  claimWebhookEvents,
  commitTransition,
  completeOutboxMessage,
  findInboundMessage,
  lockConversation,
  recordInboundMessage,
  storeWebhookEnvelope,
  updateMessageStatus,
} from "@/features/whatsapp/infrastructure/repositories/channel-repository";

const ids = {
  conversation: "11111111-1111-4111-8111-111111111111",
  nextConversation: "22222222-2222-4222-8222-222222222222",
  phone: "33333333-3333-4333-8333-333333333333",
  contact: "44444444-4444-4444-8444-444444444444",
  tenant: "55555555-5555-4555-8555-555555555555",
  message: "66666666-6666-4666-8666-666666666666",
};

function conversationRow(id = ids.conversation) {
  return {
    id,
    phone_number_id: ids.phone,
    contact_id: ids.contact,
    tenant_id: ids.tenant,
    status: "waiting_customer",
    current_state: "MAIN_MENU",
    service_window_expires_at: "2026-08-01T12:00:00.000Z",
    session_expires_at: "2026-07-31T13:00:00.000Z",
    last_inbound_at: "2026-07-31T12:00:00.000Z",
    context: conversationContextSchema.parse({}),
    version: 2,
  };
}

function conversation() {
  return {
    id: ids.conversation,
    phoneNumberId: ids.phone,
    contactId: ids.contact,
    tenantId: ids.tenant,
    status: "waiting_customer" as const,
    currentState: "MAIN_MENU" as const,
    serviceWindowExpiresAt: "2026-08-01T12:00:00.000Z",
    sessionExpiresAt: "2026-07-31T13:00:00.000Z",
    lastInboundAt: "2026-07-31T12:00:00.000Z",
    context: conversationContextSchema.parse({}),
    version: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WhatsApp channel repository contracts", () => {
  it("stores bounded anonymous ordering keys and the wildcard marker", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: ids.message },
      error: null,
    });
    const select = vi.fn(() => ({ maybeSingle }));
    const insert = vi.fn(() => ({ select }));
    mocks.from.mockReturnValue({ insert });
    const orderingKey = "a".repeat(64);

    await expect(storeWebhookEnvelope({
      provider: "meta_cloud",
      rawBody: "{}",
      payload: {},
      signatureValid: true,
      orderingKeys: [orderingKey],
      orderingGlobalFallback: true,
      correlationId: ids.conversation,
    })).resolves.toEqual({
      id: ids.message,
      duplicate: false,
      correlationId: ids.conversation,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      ordering_keys: [orderingKey],
      ordering_global_fallback: true,
    }));
  });

  it("rejects duplicate ordering keys before persistence", async () => {
    const orderingKey = "b".repeat(64);

    await expect(storeWebhookEnvelope({
      provider: "meta_cloud",
      rawBody: "{}",
      payload: {},
      signatureValid: true,
      orderingKeys: [orderingKey, orderingKey],
      orderingGlobalFallback: false,
    })).rejects.toThrow("whatsapp_ordering_keys_invalid");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("preflights duplicate inbound against its original terminal conversation", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        message_id: ids.message,
        conversation_id: ids.conversation,
        tenant_id: ids.tenant,
        conversation_status: "completed",
        current_state: "BOOKING_COMPLETED",
        processed: true,
      }],
      error: null,
    });

    await expect(findInboundMessage({
      provider: "meta_cloud",
      providerMessageId: "wamid.duplicate",
    })).resolves.toMatchObject({
      conversationId: ids.conversation,
      currentState: "BOOKING_COMPLETED",
      processed: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("find_whatsapp_inbound_message", {
      p_provider: "meta_cloud",
      p_provider_message_id: "wamid.duplicate",
    });
  });

  it("records inbound message and monotonic window through one atomic RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        message_id: ids.message,
        duplicate: true,
        processed: false,
        stale: true,
      }],
      error: null,
    });

    const result = await recordInboundMessage({
      provider: "meta_cloud",
      providerMessageId: "wamid.123",
      conversation: conversation(),
      tenantId: ids.tenant,
      messageType: "text",
      text: "Olá",
      providerReplyToId: null,
      receivedAt: "2026-07-31T12:00:00.000Z",
    });

    expect(result).toEqual({
      id: ids.message,
      duplicate: true,
      processed: false,
      stale: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("record_whatsapp_inbound_message", {
      p_provider: "meta_cloud",
      p_provider_message_id: "wamid.123",
      p_conversation_id: ids.conversation,
      p_message_type: "text",
      p_text: "Olá",
      p_provider_reply_to_id: null,
      p_received_at: "2026-07-31T12:00:00.000Z",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("scopes global inbox and outbox claims to the active provider", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await claimWebhookEvents(10, "worker-1", "meta_cloud");
    await claimOutboxMessages(10, "worker-1", "meta_cloud");

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "claim_whatsapp_webhook_events", {
      p_limit: 10,
      p_worker_id: "worker-1",
      p_provider: "meta_cloud",
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "claim_whatsapp_outbox", {
      p_limit: 10,
      p_worker_id: "worker-1",
      p_provider: "meta_cloud",
    });
  });

  it("keeps the retry classification code while preserving the Postgres cause", async () => {
    const postgrest = {
      code: "40P01",
      message: "deadlock detected",
      details: null,
      hint: null,
    };
    mocks.rpc.mockResolvedValue({ data: null, error: postgrest });

    // A mensagem alimenta `classifyWhatsAppError`, que decide retry contra a
    // tabela de códigos transitórios: mudá-la transformaria uma falha
    // recuperável em permanente. O código do Postgres viaja em `cause`.
    const failure = await claimOutboxMessages(10, "worker-1", "meta_cloud")
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("whatsapp_outbox_claim_failed");
    expect((failure as Error).cause).toBe(postgrest);
  });

  it("reports a contract violation when the RPC resolves without an error object", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const failure = await completeOutboxMessage({
      outboxId: ids.conversation,
      workerId: "worker-1",
      providerMessageId: "wamid.fixture",
    })
      .then(() => null)
      .catch((error: unknown) => error);

    expect((failure as Error).message).toBe("whatsapp_outbox_complete_failed");
    expect((failure as Error).cause).toBeUndefined();
  });

  it("commits a platform-owned tenant restart with the original inbound in one RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...conversationRow(ids.nextConversation),
        tenant_id: null,
        current_state: "TENANT_CONFIRMATION",
      },
      error: null,
    });

    const result = await commitTransition({
      conversation: conversation(),
      inboundMessageId: ids.message,
      recipient: "+5511999999999",
      transition: {
        state: "TENANT_CONFIRMATION",
        status: "waiting_customer",
        tenantId: null,
        restartReason: "tenant_change",
        context: conversationContextSchema.parse({ routing: { source: "search" } }),
        responses: [{ kind: "text", body: "Informe o estabelecimento." }],
      },
    });

    expect(result).toMatchObject({
      id: ids.nextConversation,
      tenantId: null,
      currentState: "TENANT_CONFIRMATION",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "commit_whatsapp_conversation_restart",
      expect.objectContaining({
        p_conversation_id: ids.conversation,
        p_inbound_message_id: ids.message,
        p_expected_version: 1,
        p_restart_reason: "tenant_change",
        p_tenant_id: null,
        p_recipient: "+5511999999999",
      }),
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("locks the expected conversation version before interpreting state", async () => {
    mocks.rpc.mockResolvedValue({ data: conversationRow(), error: null });

    const locked = await lockConversation({
      conversation: conversation(),
      workerId: "worker-1",
    });

    expect(locked.version).toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith("lock_whatsapp_conversation", {
      p_conversation_id: ids.conversation,
      p_expected_version: 1,
      p_worker_id: "worker-1",
    });
  });

  it("treats a buffered orphan status as non-fatal", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(updateMessageStatus({
      provider: "meta_cloud",
      providerMessageId: "wamid.orphan",
      status: "delivered",
      timestamp: "2026-07-31T12:00:00.000Z",
    })).resolves.toBe(false);
  });
});
