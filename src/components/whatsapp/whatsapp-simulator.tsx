"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  CopyPlus,
  FlaskConical,
  MessageCircle,
  RotateCcw,
  Send,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  whatsappSimulatorInputSchema,
  whatsappSimulatorResponseSchema,
  type WhatsAppSimulatorResponse,
} from "@/features/whatsapp/presentation/simulator-contract";

export interface SimulatorPhoneOption {
  id: string;
  label: string;
  connectionMode: string;
}

interface TranscriptEntry {
  id: string;
  direction: "inbound" | "outbound" | "system";
  body: string;
}

function messageBody(message: WhatsAppSimulatorResponse["messages"][number]) {
  return message.body ?? message.text ?? message.content ?? message.kind ?? "Mensagem processada";
}

function responseBody(response: WhatsAppSimulatorResponse["responses"][number]) {
  return response.body ?? response.text ?? `Resposta ${response.kind}`;
}

export function WhatsAppSimulator({
  enabled,
  phoneNumbers,
}: {
  enabled: boolean;
  phoneNumbers: SimulatorPhoneOption[];
}) {
  const firstPhone = phoneNumbers[0]?.id ?? "";
  const [receiverPhoneNumberId, setReceiverPhoneNumberId] = useState(firstPhone);
  const [customerPhone, setCustomerPhone] = useState("+5511999990001");
  const [message, setMessage] = useState("Olá, quero agendar.");
  const [routingCode, setRoutingCode] = useState("");
  const [interactionType, setInteractionType] = useState<"text" | "button" | "list">("text");
  const [selectionId, setSelectionId] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [providerFailure, setProviderFailure] = useState(false);
  const [outOfOrder, setOutOfOrder] = useState(false);
  const [delayMs, setDelayMs] = useState<0 | 500 | 2000>(0);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [result, setResult] = useState<WhatsAppSimulatorResponse | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagePreview = useMemo(() => {
    const trimmedCode = routingCode.trim();
    return trimmedCode ? `${message.trim()} Código: ${trimmedCode}` : message.trim();
  }, [message, routingCode]);

  function reset() {
    setConversationId(undefined);
    setResult(null);
    setTranscript([]);
    setError(null);
    setDuplicate(false);
    setProviderFailure(false);
    setOutOfOrder(false);
    setDelayMs(0);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = whatsappSimulatorInputSchema.safeParse({
      receiverPhoneNumberId,
      customerPhone,
      message: messagePreview,
      interactionType,
      selectionId: interactionType === "text" ? undefined : selectionId || undefined,
      conversationId,
      simulation: { duplicate, providerFailure, outOfOrder, delayMs },
    });
    if (!parsed.success) {
      setError("Revise número receptor, telefone E.164 e conteúdo da mensagem.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/app/platform/whatsapp/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(response.status === 404 ? "simulator_unavailable" : "simulation_failed");
      }
      const output = whatsappSimulatorResponseSchema.safeParse(payload);
      if (!output.success) throw new Error("invalid_simulator_response");

      setResult(output.data);
      setConversationId(output.data.conversation?.id ?? conversationId);
      const inbound: TranscriptEntry = {
        id: crypto.randomUUID(),
        direction: "inbound",
        body: messagePreview,
      };
      const outboundMessages: TranscriptEntry[] = [
        ...output.data.responses.map((item) => ({
          id: crypto.randomUUID(),
          direction: "outbound" as const,
          body: responseBody(item),
        })),
        ...output.data.messages
          .filter((item) => item.direction !== "inbound")
          .map((item) => ({
            id: item.id ?? crypto.randomUUID(),
            direction: "outbound" as const,
            body: messageBody(item),
          })),
      ];
      setTranscript((current) => [...current, inbound, ...outboundMessages]);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message === "simulator_unavailable"
          ? "Endpoint do simulador ainda não está disponível neste ambiente."
          : "Não foi possível processar o evento simulado.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const state = result?.conversation?.currentState ?? result?.conversation?.state ?? "Sem conversa";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
      <form className="premium-card h-fit p-6 xl:sticky xl:top-24" onSubmit={submit}>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-zinc-100"><FlaskConical aria-hidden="true" size={19} /></span>
          <div><p className="text-sm text-zinc-500">Evento recebido</p><h2 className="font-bold">Nova interação</h2></div>
        </div>

        <fieldset className="mt-6 grid gap-4" disabled={!enabled || submitting || phoneNumbers.length === 0}>
          <label className="grid gap-2 text-sm font-semibold" htmlFor="simulator-receiver">
            Número receptor
            <select className="form-control" id="simulator-receiver" onChange={(event) => setReceiverPhoneNumberId(event.target.value)} value={receiverPhoneNumberId}>
              {phoneNumbers.map((phone) => <option key={phone.id} value={phone.id}>{phone.label} · {phone.connectionMode}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold" htmlFor="simulator-customer-phone">
            Telefone fictício do cliente
            <input className="form-control" id="simulator-customer-phone" inputMode="tel" onChange={(event) => setCustomerPhone(event.target.value)} value={customerPhone} />
            <span className="font-normal text-zinc-500">Formato E.164, sem usar dados reais.</span>
          </label>
          <label className="grid gap-2 text-sm font-semibold" htmlFor="simulator-message">
            Mensagem
            <textarea className="min-h-28 rounded-xl border border-[var(--control-border)] bg-[var(--surface)] p-3" id="simulator-message" maxLength={4096} onChange={(event) => setMessage(event.target.value)} value={message} />
          </label>
          <label className="grid gap-2 text-sm font-semibold" htmlFor="simulator-routing-code">
            Código do estabelecimento <span className="font-normal text-zinc-500">(opcional)</span>
            <input className="form-control" id="simulator-routing-code" maxLength={80} onChange={(event) => setRoutingCode(event.target.value)} value={routingCode} />
          </label>
          <label className="grid gap-2 text-sm font-semibold" htmlFor="simulator-interaction">
            Tipo de interação
            <select className="form-control" id="simulator-interaction" onChange={(event) => setInteractionType(event.target.value as "text" | "button" | "list")} value={interactionType}>
              <option value="text">Texto</option>
              <option value="button">Clique em botão</option>
              <option value="list">Escolha em lista</option>
            </select>
          </label>
          {interactionType !== "text" ? (
            <label className="grid gap-2 text-sm font-semibold" htmlFor="simulator-selection-id">
              Identificador da opção
              <input className="form-control" id="simulator-selection-id" maxLength={200} onChange={(event) => setSelectionId(event.target.value)} value={selectionId} />
            </label>
          ) : null}

          <fieldset className="rounded-xl bg-zinc-50 p-4">
            <legend className="px-1 text-sm font-bold">Condições simuladas</legend>
            <div className="mt-2 grid gap-3 text-sm">
              <label className="flex min-h-11 items-center gap-3"><input checked={duplicate} className="size-5" onChange={(event) => setDuplicate(event.target.checked)} type="checkbox" />Webhook duplicado</label>
              <label className="flex min-h-11 items-center gap-3"><input checked={providerFailure} className="size-5" onChange={(event) => setProviderFailure(event.target.checked)} type="checkbox" />Falha transitória do provedor</label>
              <label className="flex min-h-11 items-center gap-3"><input checked={outOfOrder} className="size-5" onChange={(event) => setOutOfOrder(event.target.checked)} type="checkbox" />Evento fora de ordem</label>
              <label className="grid gap-2 font-semibold" htmlFor="simulator-delay">Atraso<select className="form-control" id="simulator-delay" onChange={(event) => setDelayMs(Number(event.target.value) as 0 | 500 | 2000)} value={delayMs}><option value={0}>Sem atraso</option><option value={500}>500 ms</option><option value={2000}>2 s</option></select></label>
            </div>
          </fieldset>
        </fieldset>

        {!enabled ? <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="status">Simulador desativado pela configuração do servidor.</p> : null}
        {enabled && phoneNumbers.length === 0 ? <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="status">Cadastre um número simulado antes de enviar eventos.</p> : null}
        {error ? <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">{error}</p> : null}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button disabled={!enabled || submitting || phoneNumbers.length === 0} type="submit">
            <Send aria-hidden="true" size={17} />{submitting ? "Processando…" : "Enviar evento"}
          </Button>
          <Button onClick={reset} type="button" variant="secondary"><RotateCcw aria-hidden="true" size={17} />Nova conversa</Button>
        </div>
      </form>

      <div className="grid content-start gap-5">
        <section className="grid gap-3 sm:grid-cols-3" aria-label="Estado da simulação">
          <article className="premium-card p-5"><Bot aria-hidden="true" className="text-zinc-500" size={19} /><p className="mt-4 text-xs font-semibold text-zinc-500">ESTADO</p><p className="mt-1 break-words font-bold">{state}</p></article>
          <article className="premium-card p-5"><UserRound aria-hidden="true" className="text-zinc-500" size={19} /><p className="mt-4 text-xs font-semibold text-zinc-500">TENANT</p><p className="mt-1 break-words font-bold">{result?.tenant?.name ?? "Não resolvido"}</p></article>
          <article className="premium-card p-5"><Clock3 aria-hidden="true" className="text-zinc-500" size={19} /><p className="mt-4 text-xs font-semibold text-zinc-500">CONVERSA</p><p className="mt-1 break-all text-sm font-bold">{conversationId ?? "Não iniciada"}</p></article>
        </section>

        <section className="premium-card p-6" aria-labelledby="simulator-transcript-title">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-sm text-zinc-500">Mensagens normalizadas</p><h2 className="font-bold" id="simulator-transcript-title">Conversa</h2></div>
            <span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Sem envio real</span>
          </div>
          {transcript.length ? (
            <ol className="mt-6 grid gap-3" aria-live="polite">
              {transcript.map((entry) => (
                <li className={`flex ${entry.direction === "inbound" ? "justify-end" : "justify-start"}`} key={entry.id}>
                  <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${entry.direction === "inbound" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-zinc-100"}`}>
                    <p className="mb-1 text-xs font-semibold opacity-70">{entry.direction === "inbound" ? "Cliente simulado" : "Agenda"}</p>
                    <p className="whitespace-pre-wrap break-words">{entry.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-6 rounded-xl bg-zinc-50 p-8 text-center">
              <MessageCircle aria-hidden="true" className="mx-auto text-zinc-400" size={32} />
              <h3 className="mt-4 font-semibold">Nenhuma interação processada</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">Envie mensagem fictícia para ver tenant, estado e respostas.</p>
            </div>
          )}
        </section>

        {result?.appointment ? (
          <section className="rounded-2xl border border-green-200 bg-green-50 p-5" aria-labelledby="simulator-appointment-title">
            <div className="flex items-start gap-3"><CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-green-700" size={20} /><div><h2 className="font-bold text-green-800" id="simulator-appointment-title">Agendamento criado</h2><p className="mt-1 break-all text-sm text-green-800">{result.appointment.id}</p>{result.tenant?.slug ? <Link className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-green-900 px-4 text-sm font-bold text-white" href={`/app/${result.tenant.slug}`}><CopyPlus aria-hidden="true" size={17} />Ver na agenda</Link> : null}</div></div>
          </section>
        ) : null}

        <p className="flex items-start gap-2 text-sm leading-6 text-zinc-500"><AlertTriangle aria-hidden="true" className="mt-1 shrink-0" size={16} />Use somente telefones e mensagens fictícios. O simulador persiste estado técnico no ambiente local.</p>
      </div>
    </div>
  );
}
