import Link from "next/link";
import {
  AlertTriangle,
  BellRing,
  Bot,
  CalendarCheck2,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  Headphones,
  MapPin,
  MessageCircleMore,
  PhoneCall,
  RefreshCw,
  Scissors,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { updateTenantWhatsAppSettingsAction } from "@/app/actions/whatsapp";
import { Button } from "@/components/ui/button";
import { WhatsAppBookingLink } from "@/components/whatsapp/whatsapp-booking-link";
import { WhatsAppFormSubmit } from "@/components/whatsapp/whatsapp-form-submit";
import { WhatsAppHandoffQueue } from "@/components/whatsapp/whatsapp-handoff-queue";
import type { TenantWhatsAppPresentation } from "@/features/whatsapp/presentation/queries";

function count(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("pt-BR").format(value);
}

function connectionLabel(mode: NonNullable<TenantWhatsAppPresentation["phoneNumber"]>["connectionMode"]) {
  if (mode === "shared_platform") return "Número central compartilhado";
  if (mode === "exclusive_platform") return "Número exclusivo gerenciado pela plataforma";
  return "Número próprio do estabelecimento";
}

export function TenantWhatsAppPanel({
  presentation,
  slug,
  canUsePlatformSimulator = false,
  canManageSettings = true,
}: {
  presentation: TenantWhatsAppPresentation;
  slug: string;
  canUsePlatformSimulator?: boolean;
  canManageSettings?: boolean;
}) {
  const selectedServices = new Set(presentation.selectedServiceIds);
  const selectedLocations = new Set(presentation.selectedLocationIds);
  const capabilities = [
    { label: "Agendamento", name: "bookingEnabled", enabled: presentation.settings.bookingEnabled, Icon: CalendarCheck2 },
    { label: "Lembretes", name: "remindersEnabled", enabled: presentation.settings.remindersEnabled, Icon: BellRing },
    { label: "Cancelamento", name: "cancellationsEnabled", enabled: presentation.settings.cancellationsEnabled, Icon: XCircle },
    { label: "Reagendamento", name: "reschedulingEnabled", enabled: presentation.settings.reschedulingEnabled, Icon: RefreshCw },
    { label: "Atendimento humano", name: "humanHandoffEnabled", enabled: presentation.settings.humanHandoffEnabled, Icon: Headphones },
  ] as const;

  return (
    <div className="grid gap-6">
      {presentation.warnings.length ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5" aria-labelledby="tenant-whatsapp-warnings">
          <h2 className="flex items-center gap-2 font-bold text-amber-900" id="tenant-whatsapp-warnings"><AlertTriangle aria-hidden="true" size={18} />Configuração incompleta</h2>
          <ul className="mt-3 grid gap-2 text-sm leading-6 text-amber-900">
            {presentation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </section>
      ) : null}

      {canManageSettings ? <>
      <section className="grid gap-4 md:grid-cols-3" aria-label="Resumo do WhatsApp">
        <article className="premium-card p-5 md:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-zinc-100"><PhoneCall aria-hidden="true" size={20} /></span>
              <div>
                <p className="text-sm text-zinc-500">Número de atendimento</p>
                <h2 className="mt-1 text-lg font-bold">{presentation.phoneNumber?.displayPhoneNumber ?? presentation.phoneNumber?.normalizedPhoneNumber ?? "Ainda não vinculado"}</h2>
                <p className="mt-1 text-sm text-zinc-500">{presentation.phoneNumber ? connectionLabel(presentation.phoneNumber.connectionMode) : "Conexão pendente"}</p>
              </div>
            </div>
            <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${presentation.settings.enabled ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
              {presentation.settings.enabled ? <CheckCircle2 aria-hidden="true" size={15} /> : <CircleDashed aria-hidden="true" size={15} />}
              {presentation.settings.enabled ? "Canal habilitado" : "Canal desabilitado"}
            </span>
          </div>
          {presentation.phoneNumber?.connectionMode === "exclusive_platform" ? null : (
            <div className="mt-5 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4">
              <p className="text-sm font-semibold">Número exclusivo</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">A solicitação comercial ainda não é registrada por este painel. Fale com o suporte para iniciar a ativação.</p>
              <Button className="mt-3" disabled size="small" type="button" variant="secondary">Solicitar número exclusivo</Button>
            </div>
          )}
          {presentation.phoneNumber?.connectionMode === "tenant_owned" ? null : (
            <div className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4">
              <p className="text-sm font-semibold">Número próprio</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">Conexão por Embedded Signup está preparada como evolução, mas permanece desativada até a revisão oficial e a conta Meta.</p>
              <Button className="mt-3" disabled size="small" type="button" variant="secondary">Conectar futuramente</Button>
            </div>
          )}
        </article>
        <article className="premium-card p-5">
          <MessageCircleMore aria-hidden="true" className="text-zinc-500" size={20} />
          <p className="mt-5 text-3xl font-bold tabular-nums">{count(presentation.counts.conversations)}</p>
          <p className="mt-1 text-sm text-zinc-500">Conversas atribuídas</p>
          <p className="mt-3 text-xs text-zinc-500">Falhas: {count(presentation.counts.failedMessages)}</p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
        <form action={updateTenantWhatsAppSettingsAction} className="premium-card p-6" aria-labelledby="tenant-whatsapp-settings">
          <input name="slug" type="hidden" value={slug} />
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-zinc-100"><Bot aria-hidden="true" size={19} /></span>
            <div><p className="text-sm text-zinc-500">Políticas do canal</p><h2 className="font-bold" id="tenant-whatsapp-settings">Configuração do estabelecimento</h2></div>
          </div>

          <fieldset className="mt-6">
            <legend className="text-sm font-bold">Recursos permitidos</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {capabilities.map(({ label, name, enabled, Icon }) => (
                <label className="flex min-h-12 items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3" key={label}>
                  <Icon aria-hidden="true" className="shrink-0 text-zinc-500" size={18} />
                  <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
                  <input className="size-5" defaultChecked={enabled} name={name} type="checkbox" />
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-5 flex min-h-12 items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold">
            <input className="size-5" defaultChecked={presentation.settings.enabled} name="enabled" type="checkbox" />
            Habilitar canal para este estabelecimento
          </label>

          <div className="mt-7 grid gap-6 lg:grid-cols-2">
            <fieldset>
              <legend className="flex items-center gap-2 text-sm font-bold"><Scissors aria-hidden="true" size={17} />Serviços disponíveis</legend>
              <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto rounded-xl border border-[var(--border)] p-3">
                {presentation.availableServices.length ? presentation.availableServices.map((service) => (
                  <label className="flex min-h-11 items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm" key={service.id}>
                    <input className="size-5" defaultChecked={selectedServices.has(service.id)} name="serviceIds" type="checkbox" value={service.id} />
                    <span>{service.name}</span>
                  </label>
                )) : <p className="p-2 text-sm text-zinc-500">Nenhum serviço público ativo.</p>}
              </div>
            </fieldset>
            <fieldset>
              <legend className="flex items-center gap-2 text-sm font-bold"><MapPin aria-hidden="true" size={17} />Unidades disponíveis</legend>
              <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto rounded-xl border border-[var(--border)] p-3">
                {presentation.availableLocations.length ? presentation.availableLocations.map((location) => (
                  <label className="flex min-h-11 items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm" key={location.id}>
                    <input className="size-5" defaultChecked={selectedLocations.has(location.id)} name="locationIds" type="checkbox" value={location.id} />
                    <span>{location.name}</span>
                  </label>
                )) : <p className="p-2 text-sm text-zinc-500">Nenhuma unidade ativa.</p>}
              </div>
            </fieldset>
          </div>

          <fieldset className="mt-7 rounded-2xl bg-zinc-50 p-4">
            <legend className="flex items-center gap-2 px-1 text-sm font-bold"><Clock3 aria-hidden="true" size={17} />Lembretes e silêncio</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-3 text-sm"><input className="size-5" defaultChecked={presentation.settings.reminder24Hours} name="reminder24Hours" type="checkbox" />Lembrete 24 horas antes</label>
              <label className="flex min-h-11 items-center gap-3 text-sm"><input className="size-5" defaultChecked={presentation.settings.reminder2Hours} name="reminder2Hours" type="checkbox" />Lembrete 2 horas antes</label>
            </div>
            <label className="mt-2 flex min-h-11 items-center gap-3 text-sm font-semibold">
              <input className="size-5" defaultChecked={presentation.settings.quietHoursEnabled} name="quietHoursEnabled" type="checkbox" />Adiar mensagens durante o horário silencioso
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-sm" htmlFor="quiet-hours-start">Início<input className="min-h-11 rounded-xl border border-[var(--control-border)] bg-white px-3" defaultValue={presentation.settings.quietHoursStart} id="quiet-hours-start" name="quietHoursStart" required type="time" /></label>
              <label className="grid gap-2 text-sm" htmlFor="quiet-hours-end">Fim<input className="min-h-11 rounded-xl border border-[var(--control-border)] bg-white px-3" defaultValue={presentation.settings.quietHoursEnd} id="quiet-hours-end" name="quietHoursEnd" required type="time" /></label>
            </div>
          </fieldset>

          <fieldset className="mt-7">
            <legend className="flex items-center gap-2 text-sm font-bold"><Headphones aria-hidden="true" size={17} />Contato humano</legend>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Destino informado ao cliente quando a conversa precisar da equipe.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold" htmlFor="human-handoff-phone">Telefone<input autoComplete="tel" className="min-h-11 rounded-xl border border-[var(--control-border)] bg-white px-3 font-normal" defaultValue={presentation.settings.humanHandoffPhone ?? ""} id="human-handoff-phone" name="humanHandoffPhone" placeholder="(11) 99999-0000" type="tel" /></label>
              <label className="grid gap-2 text-sm font-semibold" htmlFor="human-handoff-email">E-mail<input autoComplete="email" className="min-h-11 rounded-xl border border-[var(--control-border)] bg-white px-3 font-normal" defaultValue={presentation.settings.humanHandoffEmail ?? ""} id="human-handoff-email" name="humanHandoffEmail" placeholder="equipe@empresa.com" type="email" /></label>
            </div>
          </fieldset>

          <div className="mt-7 grid gap-4">
            <label className="grid gap-2 text-sm font-semibold" htmlFor="whatsapp-welcome-message">Saudação<textarea className="min-h-24 rounded-xl border border-[var(--control-border)] bg-[var(--surface)] p-3 font-normal leading-6" defaultValue={presentation.settings.welcomeMessage ?? ""} id="whatsapp-welcome-message" maxLength={2000} name="welcomeMessage" /></label>
            <label className="grid gap-2 text-sm font-semibold" htmlFor="whatsapp-unknown-message">Resposta quando a entrada não for compreendida<textarea className="min-h-20 rounded-xl border border-[var(--control-border)] bg-[var(--surface)] p-3 font-normal leading-6" defaultValue={presentation.settings.unknownMessageResponse ?? ""} id="whatsapp-unknown-message" maxLength={2000} name="unknownMessageResponse" placeholder="Ex.: Não entendi. Escolha uma opção ou digite Ajuda." /></label>
            <label className="grid gap-2 text-sm font-semibold" htmlFor="whatsapp-administrative-notice">Aviso administrativo<textarea className="min-h-20 rounded-xl border border-[var(--control-border)] bg-[var(--surface)] p-3 font-normal leading-6" defaultValue={presentation.settings.administrativeNotice ?? ""} id="whatsapp-administrative-notice" maxLength={2000} name="administrativeNotice" placeholder="Ex.: atendimento reduzido no feriado" /></label>
            <label className="grid gap-2 text-sm font-semibold" htmlFor="whatsapp-emergency-notice">Aviso de emergência<textarea className="min-h-20 rounded-xl border border-red-200 bg-red-50 p-3 font-normal leading-6" defaultValue={presentation.settings.emergencyNotice ?? ""} id="whatsapp-emergency-notice" maxLength={2000} name="emergencyNotice" placeholder="Ex.: unidade temporariamente fechada" /></label>
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-500">Os avisos ficam salvos como referência do canal; salvar não dispara mensagens. Credenciais Meta continuam restritas aos processos internos.</p>
          <div className="mt-5"><WhatsAppFormSubmit idleLabel="Salvar configuração" pendingLabel="Salvando…" /></div>
        </form>

        <div className="grid content-start gap-6">
          <WhatsAppBookingLink
            bookingLink={presentation.bookingLink}
            bookingMessage={presentation.bookingMessage}
            canGenerate={Boolean(presentation.phoneNumber)}
            routingCode={presentation.routingCode?.code ?? null}
            routingUsesCount={presentation.routingCode?.usesCount ?? 0}
            recentLinks={presentation.recentRoutingLinks}
            slug={slug}
          />
          <section className="premium-card p-5" aria-labelledby="whatsapp-simulator-title">
            <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-zinc-100"><ShieldAlert aria-hidden="true" size={18} /></span><div><h2 className="font-bold" id="whatsapp-simulator-title">Teste controlado</h2><p className="mt-1 text-sm leading-6 text-zinc-500">O simulador usa apenas o provedor mock e não envia mensagem real.</p></div></div>
            {canUsePlatformSimulator ? (
              <Link className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]" href="/app/platform/whatsapp/simulator">Abrir simulador<ExternalLink aria-hidden="true" size={16} /></Link>
            ) : (
              <><Button className="mt-4" disabled size="small" type="button" variant="secondary">Solicite teste ao operador</Button><p className="mt-2 text-xs leading-5 text-zinc-500">Acesso restrito ao operador da plataforma.</p></>
            )}
          </section>
        </div>
      </section>
      </> : null}

      <WhatsAppHandoffQueue handoffs={presentation.handoffs} scope="tenant" slug={slug} />
    </div>
  );
}
