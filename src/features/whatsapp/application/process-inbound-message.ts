import "server-only";

import { transitionConversation, type ConversationCapabilities, type InboundConversationMessage } from "./transition-conversation";
import { SupabaseWhatsAppBookingGateway, type WhatsAppBookingGateway } from "./booking-gateway";
import {
  conversationContextSchema,
  type ConversationTransition,
} from "../domain/conversation";
import {
  commitTransition,
  findInboundMessage,
  findPhoneNumber,
  getConversationById,
  getOrCreateConversation,
  ignoreInboundMessage,
  lockConversation,
  recordInboundMessage,
  releaseConversationLock,
  upsertContact,
} from "../infrastructure/repositories/channel-repository";
import { normalizePhone } from "@/lib/phone";

export interface ProcessInboundResult {
  conversationId: string;
  tenantId: string | null;
  state: string;
  duplicate: boolean;
  responsesQueued: number;
}

function normalizeProviderPhone(value: string): string | null {
  const trimmed = value.trim();
  const withPrefix = /^\d{10,15}$/.test(trimmed) ? `+${trimmed}` : trimmed;
  return normalizePhone(withPrefix);
}

export async function processInboundMessage(
  message: InboundConversationMessage,
  capabilities: ConversationCapabilities,
  gateway: WhatsAppBookingGateway = new SupabaseWhatsAppBookingGateway(),
  processingWorkerId = `inbound:${message.provider}:${message.providerMessageId}`,
): Promise<ProcessInboundResult> {
  const existingInbound = await findInboundMessage({
    provider: message.provider,
    providerMessageId: message.providerMessageId,
  });
  if (existingInbound?.processed) {
    return {
      conversationId: existingInbound.conversationId,
      tenantId: existingInbound.tenantId,
      state: existingInbound.currentState,
      duplicate: true,
      responsesQueued: 0,
    };
  }
  const phoneNumber = await findPhoneNumber({
    provider: message.provider,
    externalPhoneNumberId: message.externalPhoneNumberId,
  });
  const normalizedPhone = normalizeProviderPhone(message.from);
  if (!normalizedPhone) throw new Error("invalid_contact_phone");
  const contact = await upsertContact({
    provider: message.provider,
    normalizedPhone,
    whatsappUserId: message.from,
    profileName: message.profileName,
  });
  let conversation = existingInbound
    ? await getConversationById(existingInbound.conversationId)
    : await getOrCreateConversation({
        phoneNumberId: phoneNumber.id,
        contactId: contact.id,
        sessionTimeoutMinutes: 30,
      });
  if (
    conversation.phoneNumberId !== phoneNumber.id ||
    conversation.contactId !== contact.id
  ) {
    throw new Error("inbound_message_context_mismatch");
  }
  const receivedAt = Date.parse(message.receivedAt);
  const sessionExpiresAt = conversation.sessionExpiresAt
    ? Date.parse(conversation.sessionExpiresAt)
    : Number.NaN;
  const sessionExpired =
    conversation.status !== "human_handoff" &&
    Number.isFinite(sessionExpiresAt) &&
    sessionExpiresAt <= Math.max(Date.now(), Number.isFinite(receivedAt) ? receivedAt : 0);
  const workerId = processingWorkerId.slice(0, 120);
  conversation = await lockConversation({ conversation, workerId });
  try {
    const inbound = await recordInboundMessage({
      provider: message.provider,
      providerMessageId: message.providerMessageId,
      conversation,
      tenantId: conversation.tenantId,
      messageType: message.messageType,
      text: message.text,
      providerReplyToId: message.providerReplyToId,
      receivedAt: message.receivedAt,
    });
    if (inbound.duplicate && inbound.processed) {
      await releaseConversationLock({ conversationId: conversation.id, workerId });
      return {
        conversationId: conversation.id,
        tenantId: conversation.tenantId,
        state: conversation.currentState,
        duplicate: true,
        responsesQueued: 0,
      };
    }
    if (inbound.stale) {
      await ignoreInboundMessage(inbound.id);
      await releaseConversationLock({ conversationId: conversation.id, workerId });
      return {
        conversationId: conversation.id,
        tenantId: conversation.tenantId,
        state: conversation.currentState,
        duplicate: inbound.duplicate,
        responsesQueued: 0,
      };
    }
    const transitionView = sessionExpired
      ? {
          ...conversation,
          tenantId: null,
          status: "open" as const,
          currentState: "START" as const,
          context: conversationContextSchema.parse({}),
        }
      : conversation;
    const result = await transitionConversation({
      message,
      conversation: transitionView,
      phoneNumber,
      contact,
      gateway,
      capabilities,
    });
    const transition: ConversationTransition = {
      ...result.transition,
      ...(sessionExpired ? { restartReason: "session_expired" as const } : {}),
      context: conversationContextSchema.parse({
        ...result.transition.context,
        lastInboundMessageId: message.providerMessageId,
      }),
      responses: sessionExpired
        ? [
            {
              kind: "text",
              body: "Essa sessão expirou para proteger seu agendamento. Vamos começar novamente.",
            },
            ...result.transition.responses,
          ]
        : result.transition.responses,
    };
    conversation = await commitTransition({
      conversation,
      transition,
      recipient: contact.normalizedPhone,
      inboundMessageId: inbound.id,
    });
    return {
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      state: conversation.currentState,
      duplicate: inbound.duplicate,
      responsesQueued: transition.responses.length,
    };
  } catch (error) {
    await releaseConversationLock({
      conversationId: conversation.id,
      workerId,
    }).catch(() => undefined);
    throw error;
  }
}
