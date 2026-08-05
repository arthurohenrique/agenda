import { Mail, UserRoundCheck } from "lucide-react";
import {
  acceptPlatformWhatsAppHandoffAction,
  acceptTenantWhatsAppHandoffAction,
  resolvePlatformWhatsAppHandoffAction,
  resolveTenantWhatsAppHandoffAction,
} from "@/app/actions/whatsapp";
import { WhatsAppFormSubmit } from "@/components/whatsapp/whatsapp-form-submit";
import type { WhatsAppHandoffView } from "@/features/whatsapp/presentation/queries";

function requestedByLabel(value: WhatsAppHandoffView["requestedBy"]) {
  if (value === "customer") return "Solicitado pelo cliente";
  if (value === "automation") return "Encaminhado pela automação";
  return "Encaminhado pela equipe";
}

function dateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horário indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function WhatsAppHandoffQueue({
  handoffs,
  scope,
  slug,
}: {
  handoffs: WhatsAppHandoffView[];
  scope: "platform" | "tenant";
  slug?: string;
}) {
  const isPlatform = scope === "platform";
  const titleId = isPlatform ? "platform-whatsapp-handoff-queue" : "tenant-whatsapp-handoff-queue";
  const acceptAction = isPlatform
    ? acceptPlatformWhatsAppHandoffAction
    : acceptTenantWhatsAppHandoffAction;
  const resolveAction = isPlatform
    ? resolvePlatformWhatsAppHandoffAction
    : resolveTenantWhatsAppHandoffAction;

  return (
    <section className="premium-card p-6" aria-labelledby={titleId}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-zinc-100">
          <UserRoundCheck aria-hidden="true" size={19} />
        </span>
        <div>
          <p className="text-sm text-zinc-500">Atendimento humano</p>
          <h2 className="font-bold" id={titleId}>
            {isPlatform ? "Fila sem estabelecimento" : "Fila pendente"}
          </h2>
        </div>
      </div>

      {handoffs.length ? (
        <div className="mt-5 grid gap-4">
          {handoffs.map((handoff) => (
            <article className="rounded-2xl border border-[var(--border)] p-5" key={handoff.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-bold">{handoff.contactLabel}</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Conversa {handoff.conversationReference} · {dateTime(handoff.requestedAt)}
                  </p>
                </div>
                <span className="w-fit rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                  {handoff.status === "accepted" ? "Em atendimento" : "Aguardando"}
                </span>
              </div>
              <p className="mt-3 text-sm font-medium">{requestedByLabel(handoff.requestedBy)}</p>
              {handoff.reason ? (
                <p className="mt-2 rounded-xl bg-zinc-50 p-3 text-sm leading-6 text-zinc-700">
                  {handoff.reason}
                </p>
              ) : null}

              {handoff.status === "requested" ? (
                <form action={acceptAction} className="mt-4">
                  {!isPlatform && slug ? <input name="slug" type="hidden" value={slug} /> : null}
                  <input name="handoffId" type="hidden" value={handoff.id} />
                  <WhatsAppFormSubmit idleLabel="Assumir atendimento" pendingLabel="Assumindo…" variant="secondary" />
                </form>
              ) : (
                <form action={resolveAction} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
                  {!isPlatform && slug ? <input name="slug" type="hidden" value={slug} /> : null}
                  <input name="handoffId" type="hidden" value={handoff.id} />
                  <label className="grid gap-2 text-sm font-semibold" htmlFor={`${scope}-resolution-${handoff.id}`}>
                    Nota de conclusão
                    <input
                      className="min-h-11 rounded-xl border border-[var(--control-border)] bg-white px-3 font-normal"
                      id={`${scope}-resolution-${handoff.id}`}
                      maxLength={3000}
                      name="resolutionNotes"
                      placeholder="Opcional"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-semibold" htmlFor={`${scope}-resolution-mode-${handoff.id}`}>
                    Depois de concluir
                    <select
                      className="min-h-11 rounded-xl border border-[var(--control-border)] bg-white px-3 font-normal"
                      defaultValue="return_to_bot"
                      id={`${scope}-resolution-mode-${handoff.id}`}
                      name="resolutionMode"
                    >
                      <option value="return_to_bot">Retornar ao bot</option>
                      <option value="close">Encerrar conversa</option>
                    </select>
                  </label>
                  <WhatsAppFormSubmit idleLabel="Concluir" pendingLabel="Concluindo…" variant="secondary" />
                </form>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl bg-zinc-50 p-6 text-center">
          <Mail aria-hidden="true" className="mx-auto text-zinc-400" size={24} />
          <p className="mt-3 font-semibold">
            {isPlatform ? "Nenhuma conversa aguardando a plataforma" : "Nenhuma conversa aguardando a equipe"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Novos pedidos de atendimento aparecerão aqui.
          </p>
        </div>
      )}
    </section>
  );
}
