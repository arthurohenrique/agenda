"use client";

import type { RefObject } from "react";
import { Bot, ShieldOff, User } from "lucide-react";
import {
  conversationStateLabel,
  conversationStatusLabel,
  dayLabel,
  messageBody,
  messageTime,
  outboundDeliveryLabel,
  serviceWindowLabel,
} from "@/features/whatsapp/presentation/conversation-labels";
import type { WhatsAppTranscript, WhatsAppTranscriptMessage } from "@/features/whatsapp/presentation/conversations";

function toneClass(tone: ReturnType<typeof conversationStatusLabel>["tone"]) {
  if (tone === "attention") return "bg-amber-100 text-amber-900";
  if (tone === "active") return "bg-emerald-100 text-emerald-900";
  if (tone === "closed") return "bg-zinc-200 text-zinc-700";
  return "bg-zinc-100 text-zinc-700";
}

function MessageBubble({
  message,
  timezone,
}: {
  message: WhatsAppTranscriptMessage;
  timezone: string;
}) {
  const body = messageBody({ messageType: message.messageType, content: message.content });
  const inbound = message.direction === "inbound";
  const delivery = inbound ? null : outboundDeliveryLabel(message.status, message.errorCode);
  const redacted = body.kind === "redacted";
  const muted = inbound || redacted;

  return (
    <div className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[70%]",
          redacted
            ? "border border-dashed border-zinc-300 bg-zinc-50 italic text-zinc-500"
            : inbound
              ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200"
              : "bg-emerald-600 text-white",
        ].join(" ")}
      >
        <p className={`flex items-center gap-1.5 text-xs font-semibold ${muted ? "text-zinc-500" : "text-emerald-50"}`}>
          {redacted
            ? <ShieldOff aria-hidden="true" size={13} />
            : inbound
              ? <User aria-hidden="true" size={13} />
              : <Bot aria-hidden="true" size={13} />}
          {inbound ? "Cliente" : "Bot"}
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words">{body.text}</p>
        <p className={`mt-1.5 text-[11px] ${muted ? "text-zinc-400" : "text-emerald-100"}`}>
          {messageTime(message.createdAt, timezone)}
          {delivery ? ` · ${delivery}` : ""}
        </p>
      </div>
    </div>
  );
}

export function WhatsAppTranscriptView({
  transcript,
  messages,
  timezone,
  emptyLabel,
  scrollRef,
}: {
  transcript: WhatsAppTranscript | null;
  messages: WhatsAppTranscriptMessage[];
  timezone: string;
  emptyLabel: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  if (!transcript) {
    return (
      <section className="premium-card grid min-h-64 place-items-center p-6 text-center text-sm text-zinc-500">
        {emptyLabel}
      </section>
    );
  }

  const status = conversationStatusLabel(transcript.status);
  const state = conversationStateLabel(transcript.currentState);
  const serviceWindow = serviceWindowLabel(transcript.serviceWindowExpiresAt, timezone);
  const entries = messages.map((message, index) => {
    const previousCreatedAt = messages[index - 1]?.createdAt;
    const day = dayLabel(message.createdAt, timezone);
    const previousDay = previousCreatedAt ? dayLabel(previousCreatedAt, timezone) : null;
    return { message, separator: day === previousDay ? null : day };
  });

  return (
    <section className="premium-card flex min-h-64 flex-col p-0" aria-labelledby="whatsapp-transcript-title">
      <header className="border-b border-zinc-200 p-5">
        <h3 className="font-bold" id="whatsapp-transcript-title">
          {transcript.customerName ?? transcript.contactLabel}
        </h3>
        <p className="mt-0.5 text-xs text-zinc-500">{transcript.contactLabel}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <span className={`rounded-full px-2.5 py-1 ${toneClass(status.tone)}`}>{status.label}</span>
          {state ? <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-700">{state}</span> : null}
          <span className={`rounded-full px-2.5 py-1 ${serviceWindow.open ? "bg-emerald-100 text-emerald-900" : "bg-zinc-200 text-zinc-700"}`}>
            {serviceWindow.label}
          </span>
        </div>
      </header>
      <div
        aria-live="polite"
        className="grid max-h-[60vh] gap-3 overflow-y-auto bg-zinc-50 p-5"
        ref={scrollRef}
        role="log"
      >
        {transcript.hasMore ? (
          <p className="text-center text-xs text-zinc-500">
            Mostrando as mensagens mais recentes desta conversa.
          </p>
        ) : null}
        {entries.map(({ message, separator }) => (
          <div className="grid gap-3" key={message.id}>
            {separator ? (
              <p className="text-center text-xs font-semibold text-zinc-400">{separator}</p>
            ) : null}
            <MessageBubble message={message} timezone={timezone} />
          </div>
        ))}
        {messages.length ? null : (
          <p className="text-center text-sm text-zinc-500">Nenhuma mensagem registrada nesta conversa.</p>
        )}
      </div>
    </section>
  );
}
