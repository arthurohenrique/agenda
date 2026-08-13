import "server-only";

import { transitionConversation, type ConversationCapabilities, type InboundConversationMessage } from "./transition-conversation";
import { SupabaseWhatsAppBookingGateway, type WhatsAppBookingGateway } from "./booking-gateway";
import {
  conversationContextSchema,
  type ConversationTransition,
} from "../domain/conversation";
import { repromptResponse } from "../presentation/conversation-responses";
import type { PersistedConversation } from "../domain/conversation";
import {
  commitTransition,
  findInboundMessage,
  findLatestOutboundProviderMessageId,
  findPhoneNumber,
  findUnprocessedRepliesToPrompt,
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

// Tempo que um toque espera antes de virar transição. Toques em rajada chegam
// em menos de meio segundo; um segundo cobre com folga sem pesar na conversa.
const TAP_SETTLE_MS = 1_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Só o corpo de uma pergunta com opções vale guardar: texto solto não é algo a
// repetir, e repetir a última fala do robô sem opção confundiria mais.
function promptFromResponses(transition: ConversationTransition): string | null {
  if (transition.context.options.length === 0) return null;
  for (const response of [...transition.responses].reverse()) {
    if (response.kind === "reply_buttons" || response.kind === "list") return response.body;
  }
  return null;
}

async function isStaleInteractiveReply(
  message: InboundConversationMessage,
  conversation: PersistedConversation,
): Promise<boolean> {
  // Sem contexto de resposta é texto digitado, não toque em balão antigo.
  if (!message.providerReplyToId) return false;
  // Sem opção de pé não há escolha a proteger.
  if (conversation.context.options.length === 0) return false;
  // Cada pergunta interativa vale um toque. Comparar com a última saída não
  // basta: dois toques no mesmo balão chegam juntos, e quando o segundo é
  // processado a resposta ao primeiro ainda está na fila, sem id do provedor —
  // então o balão antigo ainda é a última saída conhecida e o toque passa.
  if (conversation.context.answeredPromptId === message.providerReplyToId) return true;
  const latest = await findLatestOutboundProviderMessageId(conversation.id);
  // Última saída ainda sem id do provedor: sem base para comparar, deixa passar.
  if (!latest) return false;
  return message.providerReplyToId !== latest;
}

function repeatCurrentPrompt(
  conversation: PersistedConversation,
  message: InboundConversationMessage,
  capabilities: ConversationCapabilities,
  reason: "multiple" | "already_answered",
): ConversationTransition {
  return {
    state: conversation.currentState,
    status: "waiting_customer",
    context: conversationContextSchema.parse({
      ...conversation.context,
      lastInboundMessageId: message.providerMessageId,
    }),
    // Repetir a pergunta em silêncio parece bot travado: o cliente tocou e
    // aparentemente nada mudou. Uma linha curta reconhece o toque e mostra onde
    // ele está, sem falar em mensagem antiga nem em opção expirada — jargão que
    // faz quem não é técnico achar que errou.
    responses: [
      repromptResponse(
        [
          reason === "multiple"
            ? "Recebi mais de uma opção. Toque em apenas uma para continuar:"
            : "Essa pergunta já foi respondida. Vamos continuar daqui:",
          conversation.context.prompt ?? "",
        ].filter(Boolean).join("\n\n"),
        conversation.context.options,
        capabilities.maxReplyButtons,
      ),
    ],
  };
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
  // Gravar antes de travar é o que torna possível enxergar toques concorrentes.
  // Enquanto a gravação acontecia sob trava, o segundo toque ficava bloqueado e
  // o primeiro nunca sabia da existência dele. A gravação é idempotente por
  // `provider_message_id` e a transição continua acontecendo sob trava.
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
    return {
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      state: conversation.currentState,
      duplicate: inbound.duplicate,
      responsesQueued: 0,
    };
  }
  // Janela de acomodação. Toque em botão vira transição imediata, então sem
  // esperar não há como saber se o cliente tocou em mais de uma opção. Só vale
  // para toque: texto digitado não tem contexto de resposta e segue direto.
  if (message.providerReplyToId) await delay(TAP_SETTLE_MS);
  conversation = await lockConversation({ conversation, workerId });
  try {
    const transitionView = sessionExpired
      ? {
          ...conversation,
          tenantId: null,
          status: "open" as const,
          currentState: "START" as const,
          context: conversationContextSchema.parse({}),
        }
      : conversation;
    // Toque em botão de mensagem antiga. As chaves são ordinais por estado, então
    // um "1" atrasado casaria com a primeira opção da pergunta atual e escolheria
    // algo que o cliente não pediu — foi assim que "Sem preferência" virou seleção
    // de profissional. Fora do caso claro de atraso, processa normalmente.
    // Mais de um toque na mesma pergunta dentro da janela. Escolher o primeiro
    // seria arbitrário — vence quem chegou antes, não a intenção do cliente.
    // Nenhum é considerado, os irmãos saem de cena e a pergunta é repetida
    // pedindo uma escolha só.
    const siblings = message.providerReplyToId
      ? await findUnprocessedRepliesToPrompt({
        conversationId: conversation.id,
        providerReplyToId: message.providerReplyToId,
        excludeMessageId: inbound.id,
      })
      : [];
    for (const siblingId of siblings) await ignoreInboundMessage(siblingId);
    const staleTap = siblings.length > 0 ||
      await isStaleInteractiveReply(message, transitionView);
    const result = staleTap
      ? {
        conversation: transitionView,
        transition: repeatCurrentPrompt(
          transitionView,
          message,
          capabilities,
          siblings.length > 0 ? "multiple" : "already_answered",
        ),
      }
      : await transitionConversation({
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
        // Guarda a pergunta corrente para poder repeti-la ao cliente perdido.
        prompt: promptFromResponses(result.transition) ?? result.transition.context.prompt,
        // Marca a pergunta como respondida para que um segundo toque no mesmo
        // balão não avance de novo.
        answeredPromptId: staleTap
          ? transitionView.context.answeredPromptId
          : message.providerReplyToId ?? result.transition.context.answeredPromptId,
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
