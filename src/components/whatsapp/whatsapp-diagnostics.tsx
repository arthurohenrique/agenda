import type { Route } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  Inbox,
  MessageCircleMore,
  PhoneCall,
  Send,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { WhatsAppCopyValue } from "@/components/whatsapp/whatsapp-copy-value";
import { WhatsAppHandoffQueue } from "@/components/whatsapp/whatsapp-handoff-queue";
import type { PlatformWhatsAppOverview } from "@/features/whatsapp/presentation/queries";

function number(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("pt-BR").format(value);
}

function modeLabel(mode: PlatformWhatsAppOverview["phoneNumbers"][number]["connectionMode"]) {
  if (mode === "shared_platform") return "Central compartilhado";
  if (mode === "exclusive_platform") return "Exclusivo da plataforma";
  return "Número do estabelecimento";
}

function dateTime(value: string | null) {
  if (!value) return "Ainda não recebido";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function percentage(value: number | null) {
  return value === null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 })
        .format(value);
}

export function WhatsAppDiagnostics({ overview }: { overview: PlatformWhatsAppOverview }) {
  const schemaReady = !overview.warnings.some((warning) => warning.includes("Cadastros"));
  const mockReady = overview.readiness.provider === "mock"
    && (overview.readiness.channelStatus === "ready" || overview.readiness.simulatorStatus === "ready");
  const simulatorReady = overview.readiness.simulatorStatus === "ready";
  const readiness = [
    ["Código e migrations", schemaReady ? "Pronto" : "Pendente", schemaReady],
    ["Provedor mock", mockReady ? "Preparado" : "Desativado", mockReady],
    ["Simulador", simulatorReady ? "Pronto" : "Desativado", simulatorReady],
    ["Webhook local", overview.diagnostics.webhookUrl ? "Pronto" : "Pendente", Boolean(overview.diagnostics.webhookUrl)],
    ["Conta Meta", "Pendente", false],
    ["Aplicativo Meta", "Pendente", false],
    ["WABA real", "Pendente", false],
    ["Número registrado", "Pendente", false],
    ["Templates aprovados", "Pendente", false],
    ["Produção", "Desativada", false],
  ] as const;
  const metrics = [
    ["Inbox pendente", number(overview.counts.inboxPending), Inbox],
    ["Outbox pendente", number(overview.counts.outboxPending), Send],
    ["Dead letter", number(overview.counts.deadLetter), AlertTriangle],
    ["Mensagens com falha", number(overview.counts.failedMessages), MessageCircleMore],
    ["Taxa de falha", percentage(overview.diagnostics.failureRate), Activity],
  ] as const;
  const checklistText = readiness
    .map(([label, status]) => `${label}: ${status}`)
    .join("\n");

  return (
    <div className="grid gap-7">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6" aria-labelledby="whatsapp-readiness-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-800">
              <ShieldCheck aria-hidden="true" size={21} />
            </span>
            <div>
              <p className="text-sm font-semibold text-amber-800">Cloud API oficial</p>
              <h2 className="mt-1 text-xl font-bold text-amber-900" id="whatsapp-readiness-title">
                Estrutura preparada — conexão com a Meta pendente.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-amber-900">
                Ambiente atual usa simulação. Nenhuma mensagem real sai desta tela.
              </p>
            </div>
          </div>
          <Link className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-950 px-4 text-sm font-bold text-white" href={"/app/platform/whatsapp/simulator" as Route}>
            <FlaskConical aria-hidden="true" size={17} />
            Abrir simulador
          </Link>
        </div>
      </section>

      {overview.warnings.length ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5" aria-labelledby="whatsapp-warnings-title">
          <h2 className="font-bold text-amber-900" id="whatsapp-warnings-title">Pendências do ambiente</h2>
          <ul className="mt-3 grid gap-2 text-sm leading-6 text-amber-900">
            {overview.warnings.map((warning) => <li className="flex gap-2" key={warning}><AlertTriangle aria-hidden="true" className="mt-1 shrink-0" size={16} />{warning}</li>)}
          </ul>
        </section>
      ) : null}

      {overview.readiness.missingConfiguration.length ? (
        <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5" aria-labelledby="whatsapp-missing-config-title">
          <h2 className="font-bold" id="whatsapp-missing-config-title">Configurações reais ausentes</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">Somente nomes são exibidos; valores secretos permanecem no servidor.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {overview.readiness.missingConfiguration.map((field) => <li className="rounded-lg bg-zinc-100 px-2.5 py-1.5 font-mono text-xs" key={field}>{field}</li>)}
          </ul>
        </section>
      ) : null}

      <WhatsAppHandoffQueue handoffs={overview.handoffs} scope="platform" />

      <section aria-labelledby="whatsapp-operations-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="page-eyebrow">Operação simulada</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight" id="whatsapp-operations-title">Filas e falhas</h2>
          </div>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Provedor {overview.readiness.provider === "mock" ? "mock" : "Meta Cloud"}</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map(([label, value, Icon]) => (
            <article className="premium-card p-5" key={label}>
              <Icon aria-hidden="true" className="text-zinc-500" size={19} />
              <p className="mt-5 text-3xl font-bold tabular-nums">{value}</p>
              <p className="mt-1 text-sm text-zinc-500">{label}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <div className="premium-card p-6" aria-labelledby="whatsapp-webhook-title">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-zinc-100"><Webhook aria-hidden="true" size={19} /></span>
            <div><p className="text-sm text-zinc-500">Recebimento oficial</p><h2 className="font-bold" id="whatsapp-webhook-title">Webhook</h2></div>
          </div>
          <div className="mt-5 grid gap-4">
            {overview.diagnostics.webhookUrl ? (
              <WhatsAppCopyValue label="URL de callback" value={overview.diagnostics.webhookUrl} />
            ) : <p className="text-sm text-zinc-500">Configure a URL pública da aplicação.</p>}
            <div className="rounded-xl bg-zinc-50 p-4">
              <p className="text-xs font-semibold text-zinc-500">ÚLTIMO EVENTO RECEBIDO</p>
              <p className="mt-1 font-semibold">{dateTime(overview.diagnostics.lastWebhookAt)}</p>
            </div>
            <p className="text-xs leading-5 text-zinc-500">O verify token e as credenciais não são públicos e nunca aparecem neste painel.</p>
          </div>
        </div>

        <div className="premium-card p-6" aria-labelledby="whatsapp-templates-title">
          <h2 className="font-bold" id="whatsapp-templates-title">Templates sincronizados</h2>
          <p className="mt-4 text-3xl font-bold tabular-nums">
            {number(overview.diagnostics.templatesApproved)}
            <span className="ml-2 text-base font-medium text-zinc-500">aprovados de {number(overview.diagnostics.templatesTotal)}</span>
          </p>
          <p className="mt-3 text-sm text-zinc-500">Última sincronização: {dateTime(overview.diagnostics.templatesLastSyncedAt)}</p>
          <div className="mt-5"><WhatsAppCopyValue label="Checklist de ativação" value={checklistText} /></div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <div className="premium-card p-6" aria-labelledby="whatsapp-assets-title">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-zinc-100"><PhoneCall aria-hidden="true" size={19} /></span>
            <div><p className="text-sm text-zinc-500">Ativos cadastrados</p><h2 className="font-bold" id="whatsapp-assets-title">WABAs e números</h2></div>
          </div>

          {overview.businessAccounts.length || overview.phoneNumbers.length ? (
            <div className="mt-5 grid gap-3">
              {overview.businessAccounts.map((account) => (
                <div className="rounded-xl bg-zinc-50 p-4" key={account.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{account.displayName ?? "Conta sem nome de exibição"}</p>
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold capitalize">{account.status}</span>
                  </div>
                  <p className="mt-2 break-all text-sm text-zinc-500">WABA: {account.externalWabaId ?? "identificador pendente"}</p>
                  {account.externalWabaId ? <div className="mt-3"><WhatsAppCopyValue label={`WABA ${account.displayName ?? account.id}`} value={account.externalWabaId} /></div> : null}
                </div>
              ))}
              {overview.phoneNumbers.map((phone) => (
                <div className="rounded-xl border border-zinc-200 p-4" key={phone.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{phone.displayPhoneNumber ?? phone.normalizedPhoneNumber ?? "Número sem exibição"}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-500">{modeLabel(phone.connectionMode)}</span>
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold capitalize">{phone.status}</span>
                    </div>
                  </div>
                  <p className="mt-2 break-all text-sm text-zinc-500">phone_number_id: {phone.externalPhoneNumberId}</p>
                  <p className="mt-1 text-xs text-zinc-500">Provedor: {phone.provider === "mock" ? "mock" : "Meta Cloud"}</p>
                  {phone.qualityStatus ? <p className="mt-1 text-xs text-zinc-500">Qualidade: {phone.qualityStatus}</p> : null}
                  <div className="mt-3"><WhatsAppCopyValue label={`ID do número ${phone.displayPhoneNumber ?? phone.id}`} value={phone.externalPhoneNumberId} /></div>
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-zinc-500">TENANTS ASSOCIADOS</p>
                    {phone.associatedTenants?.length ? (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {phone.associatedTenants.map((tenant) => (
                          <li className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-semibold" key={tenant.id}>{tenant.name} · {tenant.slug}</li>
                        ))}
                      </ul>
                    ) : <p className="mt-2 text-sm text-zinc-500">Nenhum tenant vinculado.</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-xl bg-zinc-50 p-5">
              <h3 className="font-semibold">Nenhum ativo real conectado</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">Cadastre WABA e número somente após concluir checklist oficial da Meta.</p>
            </div>
          )}
        </div>

        <div className="premium-card p-6" aria-labelledby="whatsapp-checklist-title">
          <h2 className="font-bold" id="whatsapp-checklist-title">Checklist de prontidão</h2>
          <div className="mt-4 grid gap-2">
            {readiness.map(([label, status, ready]) => (
              <div className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-3" key={label}>
                {ready ? <CheckCircle2 aria-hidden="true" className="shrink-0 text-green-700" size={18} /> : <CircleDashed aria-hidden="true" className="shrink-0 text-amber-700" size={18} />}
                <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
                <span className="text-xs text-zinc-500">{status}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
