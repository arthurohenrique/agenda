"use client";

import Link from "next/link";
import { MessageCircleMore } from "lucide-react";
import {
  conversationStatusLabel,
  conversationTimestamp,
  isAwaitingReply,
} from "@/features/whatsapp/presentation/conversation-labels";
import type { WhatsAppConversationListItem } from "@/features/whatsapp/presentation/conversations";

export function WhatsAppConversationList({
  conversations,
  selectedId,
  slug,
  timezone,
  emptyLabel,
}: {
  conversations: WhatsAppConversationListItem[];
  selectedId: string | null;
  slug: string;
  timezone: string;
  emptyLabel: string;
}) {
  if (!conversations.length) {
    return (
      <section className="premium-card grid min-h-64 place-items-center p-6 text-center text-sm text-zinc-500" aria-labelledby="whatsapp-conversation-list-title">
        <h3 className="sr-only" id="whatsapp-conversation-list-title">Conversas</h3>
        {emptyLabel}
      </section>
    );
  }

  return (
    <section className="premium-card p-0" aria-labelledby="whatsapp-conversation-list-title">
      <h3 className="flex items-center gap-2 border-b border-zinc-200 p-5 font-bold" id="whatsapp-conversation-list-title">
        <MessageCircleMore aria-hidden="true" size={18} /> Conversas
      </h3>
      <ul className="max-h-[60vh] divide-y divide-zinc-100 overflow-y-auto">
        {conversations.map((conversation) => {
          const status = conversationStatusLabel(conversation.status);
          const awaiting = isAwaitingReply(conversation.lastInboundAt, conversation.lastOutboundAt);
          const selected = conversation.id === selectedId;
          return (
            <li key={conversation.id}>
              <Link
                aria-current={selected ? "true" : undefined}
                className={`block px-5 py-4 transition hover:bg-zinc-50 ${selected ? "bg-zinc-50" : ""}`}
                href={`/app/${slug}/whatsapp?aba=conversas&conversa=${conversation.id}`}
              >
                <p className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-semibold text-zinc-900">
                    {conversation.customerName ?? conversation.contactLabel}
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-400">
                    {conversationTimestamp(conversation.updatedAt, timezone)}
                  </span>
                </p>
                <p className="mt-1 truncate text-sm text-zinc-500">
                  {conversation.preview
                    ? `${conversation.previewDirection === "outbound" ? "Bot: " : ""}${conversation.preview}`
                    : "—"}
                </p>
                <p className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">{status.label}</span>
                  {awaiting ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">Aguardando resposta</span>
                  ) : null}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
