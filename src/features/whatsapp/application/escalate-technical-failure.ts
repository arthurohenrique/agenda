import "server-only";

import { normalizePhone } from "@/lib/phone";
import { conversationContextSchema } from "../domain/conversation";
import type { NormalizedWhatsAppEvent } from "../domain/provider";
import { isNormalizedInboundWhatsAppEvent } from "../domain/provider";
import {
  commitTransition,
  findInboundMessage,
  getConversationById,
  lockConversation,
  releaseConversationLock,
} from "../infrastructure/repositories/channel-repository";

function recipientFromSender(sender: string): string | null {
  const trimmed = sender.trim();
  return normalizePhone(/^\d{10,15}$/.test(trimmed) ? `+${trimmed}` : trimmed);
}

export async function escalateWhatsAppTechnicalFailure(input: {
  event: NormalizedWhatsAppEvent;
  workerId: string;
}): Promise<boolean> {
  if (!isNormalizedInboundWhatsAppEvent(input.event)) return false;

  const inbound = await findInboundMessage({
    provider: input.event.provider,
    providerMessageId: input.event.messageId,
  });
  if (!inbound || inbound.processed) return false;

  const recipient = recipientFromSender(input.event.sender);
  if (!recipient) return false;

  const workerId = `technical-handoff:${input.workerId}`.slice(0, 120);
  let conversation = await getConversationById(inbound.conversationId);
  conversation = await lockConversation({ conversation, workerId });

  try {
    const alreadyInHandoff = conversation.status === "human_handoff";
    await commitTransition({
      conversation,
      inboundMessageId: inbound.messageId,
      recipient,
      transition: {
        state: "HUMAN_HANDOFF",
        status: "human_handoff",
        tenantId: conversation.tenantId,
        context: conversationContextSchema.parse({
          ...conversation.context,
          handoff: conversation.context.handoff ?? {
            reason: "technical_failure",
            requestedBy: "automation",
          },
          options: [],
          lastInboundMessageId: input.event.messageId,
        }),
        responses: alreadyInHandoff
          ? []
          : [{
              kind: "text",
              body: conversation.tenantId
                ? "Tivemos uma falha técnica e encaminhamos sua conversa para a equipe do estabelecimento. O atendimento automático ficou pausado."
                : "Tivemos uma falha técnica e encaminhamos sua conversa para o suporte da plataforma.",
            }],
      },
    });
    return true;
  } catch (error) {
    await releaseConversationLock({
      conversationId: conversation.id,
      workerId,
    }).catch(() => undefined);
    throw error;
  }
}
