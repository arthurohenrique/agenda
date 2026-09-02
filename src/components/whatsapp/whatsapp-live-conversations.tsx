"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Radio, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppConversationList } from "@/components/whatsapp/whatsapp-conversation-list";
import { WhatsAppTranscriptView } from "@/components/whatsapp/whatsapp-transcript";
import type { WhatsAppMessageType } from "@/features/whatsapp/presentation/conversation-labels";
import { messageBody } from "@/features/whatsapp/presentation/conversation-labels";
import type {
  WhatsAppConversationListItem,
  WhatsAppConversationsView,
  WhatsAppTranscriptMessage,
} from "@/features/whatsapp/presentation/conversations";
import {
  useWhatsAppMessageStream,
  type StreamedWhatsAppMessage,
} from "@/hooks/use-whatsapp-message-stream";

const REFRESH_THROTTLE_MS = 5_000;
const DEGRADED_POLL_MS = 30_000;
const SCROLL_PIN_TOLERANCE_PX = 80;
// Teto do buffer vindo pelo socket. A página fica aberta o dia inteiro e o
// histórico completo é papel do servidor, não deste array.
const LIVE_MESSAGE_BUFFER = 300;

interface LiveActivity {
  updatedAt: string;
  preview: string;
  previewDirection: "inbound" | "outbound";
}

function toTranscriptMessage(message: StreamedWhatsAppMessage): WhatsAppTranscriptMessage {
  return {
    id: message.id,
    conversationId: message.conversation_id,
    direction: message.direction,
    messageType: message.message_type as WhatsAppMessageType,
    status: message.status,
    errorCode: message.error_code ?? null,
    content: message.content,
    createdAt: message.created_at,
  };
}

export function WhatsAppLiveConversations({
  view,
  slug,
  tenantId,
  timezone,
}: {
  view: WhatsAppConversationsView;
  slug: string;
  tenantId: string;
  timezone: string;
}) {
  const router = useRouter();
  const [activity, setActivity] = useState<Record<string, LiveActivity>>({});
  const [liveMessages, setLiveMessages] = useState<WhatsAppTranscriptMessage[]>([]);
  const [pendingBelow, setPendingBelow] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const lastRefreshRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedId = view.transcript?.conversationId ?? null;
  const serverMessages = useMemo(() => view.transcript?.messages ?? [], [view.transcript]);

  // O servidor é a fonte da verdade: quando um refresh traz a mensagem que já
  // havia chegado pelo socket, a versão do servidor sobrescreve a do socket em
  // vez de virar um segundo balão.
  const messages = useMemo(() => {
    if (!selectedId) return [];
    const merged = [
      ...liveMessages.filter((message) => message.conversationId === selectedId),
      ...serverMessages,
    ];
    const byId = new Map(merged.map((message) => [message.id, message]));
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [liveMessages, selectedId, serverMessages]);

  const conversations = useMemo(() => {
    const merged: WhatsAppConversationListItem[] = view.conversations.map((conversation) => {
      const live = activity[conversation.id];
      if (!live || live.updatedAt <= conversation.updatedAt) return conversation;
      return {
        ...conversation,
        updatedAt: live.updatedAt,
        preview: live.preview,
        previewDirection: live.previewDirection,
      };
    });
    return merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [activity, view.conversations]);

  const refresh = useCallback(() => {
    const elapsed = Date.now() - lastRefreshRef.current;
    if (refreshTimerRef.current) return;
    if (elapsed >= REFRESH_THROTTLE_MS) {
      lastRefreshRef.current = Date.now();
      router.refresh();
      return;
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      lastRefreshRef.current = Date.now();
      router.refresh();
    }, REFRESH_THROTTLE_MS - elapsed);
  }, [router]);

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  const knownConversationIds = useMemo(
    () => new Set(view.conversations.map(({ id }) => id)),
    [view.conversations],
  );

  const handleMessage = useCallback((message: StreamedWhatsAppMessage) => {
    const preview = messageBody({
      messageType: message.message_type as WhatsAppMessageType,
      content: message.content,
    }).text;

    setActivity((current) => {
      const existing = current[message.conversation_id];
      if (existing && existing.updatedAt >= message.created_at) return current;
      return {
        ...current,
        [message.conversation_id]: {
          updatedAt: message.created_at,
          preview,
          previewDirection: message.direction,
        },
      };
    });

    setLiveMessages((current) => (
      current.some((item) => item.id === message.id)
        ? current
        : [...current, toTranscriptMessage(message)].slice(-LIVE_MESSAGE_BUFFER)
    ));

    // Conversa fora da lista carregada precisa dos joins de contato e cliente
    // que o cliente não faz — só o servidor sabe montar a linha.
    if (!knownConversationIds.has(message.conversation_id)) refresh();
  }, [knownConversationIds, refresh]);

  const streamStatus = useWhatsAppMessageStream({
    tenantId,
    onMessage: handleMessage,
    onReconnect: refresh,
  });

  useEffect(() => {
    if (streamStatus !== "degraded") return;
    const timer = setInterval(() => router.refresh(), DEGRADED_POLL_MS);
    return () => clearInterval(timer);
  }, [router, streamStatus]);

  const trackScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    pinnedRef.current = distance <= SCROLL_PIN_TOLERANCE_PX;
    if (pinnedRef.current) setPendingBelow(false);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.addEventListener("scroll", trackScroll, { passive: true });
    return () => node.removeEventListener("scroll", trackScroll);
  }, [trackScroll, selectedId]);

  // Só cola no fim quando o gestor já estava no fim. Puxar a rolagem embaixo de
  // quem está lendo o histórico é a regressão clássica desta tela.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (pinnedRef.current) {
      node.scrollTop = node.scrollHeight;
      return;
    }
    setPendingBelow(true);
  }, [messages.length]);

  const scrollToEnd = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    pinnedRef.current = true;
    setPendingBelow(false);
  }, []);

  const emptyListLabel = view.handoffOnly
    ? "Nenhuma conversa aguardando atendimento humano agora."
    : "Nenhuma conversa registrada para este estabelecimento ainda.";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className={[
            "inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold",
            streamStatus === "live"
              ? "bg-emerald-50 text-emerald-800"
              : streamStatus === "degraded"
                ? "bg-amber-50 text-amber-900"
                : "bg-zinc-100 text-zinc-600",
          ].join(" ")}
          role="status"
        >
          {streamStatus === "degraded"
            ? <WifiOff aria-hidden="true" size={14} />
            : <Radio aria-hidden="true" size={14} />}
          {streamStatus === "live"
            ? "Acompanhando ao vivo"
            : streamStatus === "degraded"
              ? "Atualização ao vivo indisponível — use Atualizar"
              : "Conectando atualizações ao vivo…"}
        </p>
        <Button onClick={() => router.refresh()} type="button" variant="secondary">
          <RefreshCw aria-hidden="true" size={15} /> Atualizar
        </Button>
      </div>

      {view.warnings.map((warning) => (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" key={warning}>
          {warning}
        </p>
      ))}

      {view.handoffOnly ? (
        <p className="text-sm text-zinc-500">
          Sua permissão mostra apenas as conversas encaminhadas para atendimento humano.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <WhatsAppConversationList
          conversations={conversations}
          emptyLabel={emptyListLabel}
          selectedId={selectedId}
          slug={slug}
          timezone={timezone}
        />
        <div className="relative">
          <WhatsAppTranscriptView
            emptyLabel="Escolha uma conversa para acompanhar as mensagens."
            messages={messages}
            scrollRef={scrollRef}
            timezone={timezone}
            transcript={view.transcript}
          />
          {pendingBelow ? (
            <button
              className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-lg"
              onClick={scrollToEnd}
              type="button"
            >
              <ArrowDown aria-hidden="true" size={14} /> Novas mensagens
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
