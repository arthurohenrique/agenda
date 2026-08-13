import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationContextSchema } from "@/features/whatsapp/domain/conversation";
import type { WhatsAppBookingGateway } from "@/features/whatsapp/application/booking-gateway";

const mocks = vi.hoisted(() => ({
  commitTransition: vi.fn(),
  findInboundMessage: vi.fn(),
  findLatestOutboundProviderMessageId: vi.fn(),
  findPhoneNumber: vi.fn(),
  getConversationById: vi.fn(),
  getOrCreateConversation: vi.fn(),
  ignoreInboundMessage: vi.fn(),
  lockConversation: vi.fn(),
  recordInboundMessage: vi.fn(),
  releaseConversationLock: vi.fn(),
  transitionConversation: vi.fn(),
  upsertContact: vi.fn(),
}));

vi.mock(
  "@/features/whatsapp/infrastructure/repositories/channel-repository",
  () => ({
    commitTransition: mocks.commitTransition,
    findInboundMessage: mocks.findInboundMessage,
    findLatestOutboundProviderMessageId: mocks.findLatestOutboundProviderMessageId,
    findPhoneNumber: mocks.findPhoneNumber,
    getConversationById: mocks.getConversationById,
    getOrCreateConversation: mocks.getOrCreateConversation,
    ignoreInboundMessage: mocks.ignoreInboundMessage,
    lockConversation: mocks.lockConversation,
    recordInboundMessage: mocks.recordInboundMessage,
    releaseConversationLock: mocks.releaseConversationLock,
    upsertContact: mocks.upsertContact,
  }),
);

vi.mock("@/features/whatsapp/application/transition-conversation", () => ({
  transitionConversation: mocks.transitionConversation,
}));

import { processInboundMessage } from "@/features/whatsapp/application/process-inbound-message";

const ids = {
  conversation: "11111111-1111-4111-8111-111111111111",
  successor: "88888888-8888-4888-8888-888888888888",
  phone: "22222222-2222-4222-8222-222222222222",
  contact: "33333333-3333-4333-8333-333333333333",
  tenant: "44444444-4444-4444-8444-444444444444",
  customer: "55555555-5555-4555-8555-555555555555",
  message: "66666666-6666-4666-8666-666666666666",
  location: "77777777-7777-4777-8777-777777777777",
};

function conversation(sessionExpiresAt = "2999-01-01T00:00:00.000Z") {
  return {
    id: ids.conversation,
    phoneNumberId: ids.phone,
    contactId: ids.contact,
    tenantId: ids.tenant,
    status: "waiting_customer" as const,
    currentState: "MAIN_MENU" as const,
    serviceWindowExpiresAt: "2999-01-01T00:00:00.000Z",
    sessionExpiresAt,
    lastInboundAt: "2026-07-31T11:00:00.000Z",
    context: conversationContextSchema.parse({ customerId: ids.customer }),
    version: 1,
  };
}

const message = {
  provider: "mock",
  providerMessageId: "mock:message:1",
  externalPhoneNumberId: "mock-phone",
  from: "5511988888888",
  profileName: "Ana",
  text: "Menu",
  messageType: "text" as const,
  providerReplyToId: null,
  receivedAt: "2026-07-31T12:00:00.000Z",
};

function gateway(): WhatsAppBookingGateway {
  return {
    getTenantContext: vi.fn(async () => ({
      id: ids.tenant,
      slug: "tenant",
      name: "Tenant",
      timezone: "America/Sao_Paulo",
      locationId: ids.location,
      humanHandoffEnabled: true,
      welcomeMessage: null,
      unknownMessageResponse: null,
      administrativeNotice: null,
      emergencyNotice: null,
    })),
    listServices: vi.fn(async () => []),
    listStaff: vi.fn(async () => []),
    getAvailableSlots: vi.fn(async () => []),
    createBooking: vi.fn(),
    listUpcomingBookings: vi.fn(async () => []),
    getRescheduleSlots: vi.fn(async () => []),
    cancelBooking: vi.fn(),
    rescheduleBooking: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findInboundMessage.mockResolvedValue(null);
  mocks.findLatestOutboundProviderMessageId.mockResolvedValue(null);
  mocks.findPhoneNumber.mockResolvedValue({
    id: ids.phone,
    provider: "mock",
    externalPhoneNumberId: "mock-phone",
    normalizedPhoneNumber: "+5511999999999",
    connectionMode: "shared_platform",
  });
  mocks.upsertContact.mockResolvedValue({
    id: ids.contact,
    normalizedPhone: "+5511988888888",
    whatsappUserId: "5511988888888",
    profileName: "Ana",
    customerId: ids.customer,
  });
  mocks.getOrCreateConversation.mockResolvedValue(conversation());
  mocks.getConversationById.mockResolvedValue(conversation());
  mocks.recordInboundMessage.mockResolvedValue({
    id: ids.message,
    duplicate: false,
    processed: false,
    stale: false,
  });
  mocks.lockConversation.mockImplementation(async ({ conversation: value }) => value);
  mocks.ignoreInboundMessage.mockResolvedValue(undefined);
  mocks.transitionConversation.mockImplementation(async (input) => ({
    conversation: input.conversation,
    transition: {
      state: "MAIN_MENU",
      status: "waiting_customer",
      context: input.conversation.context,
      responses: [{ kind: "text", body: "Menu" }],
    },
  }));
  mocks.commitTransition.mockImplementation(async ({ conversation: value }) => ({
    ...value,
    version: value.version + 1,
  }));
  mocks.releaseConversationLock.mockResolvedValue(undefined);
});

describe("WhatsApp inbound processing", () => {
  it("preflights a completed duplicate before creating an orphan conversation", async () => {
    mocks.findInboundMessage.mockResolvedValue({
      messageId: ids.message,
      conversationId: ids.conversation,
      tenantId: ids.tenant,
      conversationStatus: "completed",
      currentState: "BOOKING_COMPLETED",
      processed: true,
    });

    const result = await processInboundMessage(message, {
      maxReplyButtons: 3,
      maxListRows: 10,
    }, gateway(), "worker-1");

    expect(result).toMatchObject({
      conversationId: ids.conversation,
      state: "BOOKING_COMPLETED",
      duplicate: true,
      responsesQueued: 0,
    });
    expect(mocks.findPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.upsertContact).not.toHaveBeenCalled();
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
    expect(mocks.lockConversation).not.toHaveBeenCalled();
    expect(mocks.transitionConversation).not.toHaveBeenCalled();
  });

  it("reuses the original conversation for an unprocessed duplicate", async () => {
    mocks.findInboundMessage.mockResolvedValue({
      messageId: ids.message,
      conversationId: ids.conversation,
      tenantId: ids.tenant,
      conversationStatus: "waiting_customer",
      currentState: "MAIN_MENU",
      processed: false,
    });
    mocks.recordInboundMessage.mockResolvedValue({
      id: ids.message,
      duplicate: true,
      processed: false,
      stale: false,
    });

    const result = await processInboundMessage(message, {
      maxReplyButtons: 3,
      maxListRows: 10,
    }, gateway(), "worker-1");

    expect(mocks.getConversationById).toHaveBeenCalledWith(ids.conversation);
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
    expect(result.duplicate).toBe(true);
  });

  it("restarts into a platform conversation before confirming a foreign routing code", async () => {
    const confirmationContext = conversationContextSchema.parse({
      routing: { source: "routing_code" },
      options: [
        {
          key: "1",
          label: "Trocar para Tenant B",
          value: "99999999-9999-4999-8999-999999999999",
          kind: "tenant",
        },
        {
          key: "2",
          label: "Permanecer em Tenant A",
          value: ids.tenant,
          kind: "tenant",
        },
      ],
    });
    mocks.transitionConversation.mockResolvedValue({
      conversation: conversation(),
      transition: {
        state: "TENANT_CONFIRMATION",
        status: "waiting_customer",
        tenantId: null,
        restartReason: "tenant_change",
        context: confirmationContext,
        responses: [{ kind: "text", body: "Deseja trocar para Tenant B?" }],
      },
    });
    mocks.commitTransition.mockResolvedValue({
      ...conversation(),
      id: ids.successor,
      tenantId: null,
      currentState: "TENANT_CONFIRMATION",
      context: confirmationContext,
      version: 1,
    });

    const result = await processInboundMessage({
      ...message,
      text: "Código: TENANTB",
    }, {
      maxReplyButtons: 3,
      maxListRows: 10,
    }, gateway(), "worker-1");

    expect(mocks.commitTransition).toHaveBeenCalledWith({
      conversation: expect.objectContaining({
        id: ids.conversation,
        tenantId: ids.tenant,
      }),
      transition: expect.objectContaining({
        state: "TENANT_CONFIRMATION",
        tenantId: null,
        restartReason: "tenant_change",
      }),
      recipient: "+5511988888888",
      inboundMessageId: ids.message,
    });
    expect(result).toMatchObject({
      conversationId: ids.successor,
      tenantId: null,
      state: "TENANT_CONFIRMATION",
      responsesQueued: 1,
    });
  });

  it("locks before watermarking and rejects an unexpected stale event", async () => {
    mocks.recordInboundMessage.mockResolvedValue({
      id: ids.message,
      duplicate: false,
      processed: false,
      stale: true,
    });

    const result = await processInboundMessage(message, {
      maxReplyButtons: 3,
      maxListRows: 10,
    }, gateway(), "worker-1");

    expect(mocks.lockConversation).toHaveBeenCalledOnce();
    expect(mocks.ignoreInboundMessage).toHaveBeenCalledWith(ids.message);
    expect(mocks.transitionConversation).not.toHaveBeenCalled();
    expect(mocks.commitTransition).not.toHaveBeenCalled();
    expect(result.responsesQueued).toBe(0);
    expect(mocks.lockConversation.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.recordInboundMessage.mock.invocationCallOrder[0] ?? 0);
  });

  it("locks before transition and resumes an unprocessed duplicate", async () => {
    mocks.recordInboundMessage.mockResolvedValue({
      id: ids.message,
      duplicate: true,
      processed: false,
      stale: false,
    });

    const result = await processInboundMessage(message, {
      maxReplyButtons: 3,
      maxListRows: 10,
    }, gateway(), "worker-1");

    expect(mocks.lockConversation).toHaveBeenCalledWith({
      conversation: expect.objectContaining({ id: ids.conversation, version: 1 }),
      workerId: "worker-1",
    });
    expect(mocks.commitTransition).toHaveBeenCalledWith(
      expect.objectContaining({ inboundMessageId: ids.message }),
    );
    expect(result.duplicate).toBe(true);
  });

  it("restarts an expired session atomically from a clean state", async () => {
    mocks.getOrCreateConversation.mockResolvedValue(
      conversation("2020-01-01T00:00:00.000Z"),
    );

    await processInboundMessage(message, {
      maxReplyButtons: 3,
      maxListRows: 10,
    }, gateway(), "worker-1");

    expect(mocks.recordInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({ id: ids.conversation }),
      }),
    );
    expect(mocks.transitionConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({ tenantId: null, currentState: "START" }),
      }),
    );
    expect(mocks.commitTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({ id: ids.conversation, tenantId: ids.tenant }),
        transition: expect.objectContaining({
          restartReason: "session_expired",
          responses: expect.arrayContaining([
            expect.objectContaining({ body: expect.stringContaining("sessão expirou") }),
          ]),
        }),
      }),
    );
  });

  describe("toque em botão de mensagem antiga", () => {
    const withOptions = () => ({
      ...conversation(),
      currentState: "STAFF_SELECTION" as const,
      context: conversationContextSchema.parse({
        customerId: ids.customer,
        prompt: "Escolha o profissional:",
        options: [
          { key: "1", label: "Rafael", value: ids.customer, kind: "staff" },
          { key: "2", label: "Camila", value: ids.tenant, kind: "staff" },
        ],
      }),
    });

    it("não deixa um toque atrasado escolher pela pergunta atual", async () => {
      // Caso real: cliente tocou "Sem preferência" no balão antigo enquanto a
      // conversa já pedia o profissional. A chave "1" teria selecionado Rafael.
      mocks.getOrCreateConversation.mockResolvedValue(withOptions());
      mocks.lockConversation.mockResolvedValue(withOptions());
      mocks.findLatestOutboundProviderMessageId.mockResolvedValue("wamid.atual");

      await processInboundMessage(
        { ...message, text: "1", providerReplyToId: "wamid.antigo" },
        { maxReplyButtons: 3, maxListRows: 10 },
        gateway(),
        "worker-1",
      );

      expect(mocks.transitionConversation).not.toHaveBeenCalled();
      const committed = mocks.commitTransition.mock.calls[0]?.[0];
      expect(committed.transition.state).toBe("STAFF_SELECTION");
      // Reconhece o toque e repete a pergunta, sem jargão e sem culpar o cliente.
      expect(committed.transition.responses[0]).toMatchObject({ kind: "reply_buttons" });
      expect(committed.transition.responses[0].body).toContain("já foi respondida");
      expect(committed.transition.responses[0].body).toContain("Escolha o profissional:");
    });

    it("recusa o segundo toque no mesmo balão, mesmo antes de a resposta ser enviada", async () => {
      // Caso real do print: dois toques quase simultâneos. Quando o segundo é
      // processado, a resposta ao primeiro ainda está na fila sem id do
      // provedor, então o balão antigo ainda é a última saída conhecida.
      const answered = {
        ...withOptions(),
        context: conversationContextSchema.parse({
          ...withOptions().context,
          answeredPromptId: "wamid.pergunta",
        }),
      };
      mocks.getOrCreateConversation.mockResolvedValue(answered);
      mocks.lockConversation.mockResolvedValue(answered);
      mocks.findLatestOutboundProviderMessageId.mockResolvedValue("wamid.pergunta");

      await processInboundMessage(
        { ...message, text: "2", providerReplyToId: "wamid.pergunta" },
        { maxReplyButtons: 3, maxListRows: 10 },
        gateway(),
        "worker-1",
      );

      expect(mocks.transitionConversation).not.toHaveBeenCalled();
    });

    it("marca a pergunta como respondida ao consumir o primeiro toque", async () => {
      mocks.getOrCreateConversation.mockResolvedValue(withOptions());
      mocks.lockConversation.mockResolvedValue(withOptions());
      mocks.findLatestOutboundProviderMessageId.mockResolvedValue("wamid.pergunta");

      await processInboundMessage(
        { ...message, text: "1", providerReplyToId: "wamid.pergunta" },
        { maxReplyButtons: 3, maxListRows: 10 },
        gateway(),
        "worker-1",
      );

      expect(mocks.transitionConversation).toHaveBeenCalledOnce();
      const committed = mocks.commitTransition.mock.calls[0]?.[0];
      expect(committed.transition.context.answeredPromptId).toBe("wamid.pergunta");
    });

    it("processa normalmente o toque que responde à última pergunta", async () => {
      mocks.getOrCreateConversation.mockResolvedValue(withOptions());
      mocks.lockConversation.mockResolvedValue(withOptions());
      mocks.findLatestOutboundProviderMessageId.mockResolvedValue("wamid.atual");

      await processInboundMessage(
        { ...message, text: "1", providerReplyToId: "wamid.atual" },
        { maxReplyButtons: 3, maxListRows: 10 },
        gateway(),
        "worker-1",
      );

      expect(mocks.transitionConversation).toHaveBeenCalledOnce();
    });

    it("processa texto digitado, que não tem contexto de resposta", async () => {
      mocks.getOrCreateConversation.mockResolvedValue(withOptions());
      mocks.lockConversation.mockResolvedValue(withOptions());
      mocks.findLatestOutboundProviderMessageId.mockResolvedValue("wamid.atual");

      await processInboundMessage(
        { ...message, text: "1", providerReplyToId: null },
        { maxReplyButtons: 3, maxListRows: 10 },
        gateway(),
        "worker-1",
      );

      expect(mocks.transitionConversation).toHaveBeenCalledOnce();
    });
  });

  it("releases its lease when state interpretation fails", async () => {
    mocks.transitionConversation.mockRejectedValue(new Error("service_query_failed"));

    await expect(processInboundMessage(message, {
      maxReplyButtons: 3,
      maxListRows: 10,
    }, gateway(), "worker-1")).rejects.toThrow("service_query_failed");

    expect(mocks.releaseConversationLock).toHaveBeenCalledWith({
      conversationId: ids.conversation,
      workerId: "worker-1",
    });
  });
});
