"use client";

import { useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { CheckCircle2, ChevronRight, CircleDashed, Clock3, UserRound, UserX } from "lucide-react";
import { changeAppointmentStatus } from "@/app/actions/appointments";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AgendaAppointment, AppointmentStatus } from "@/types/domain";

const statusPresentation: Record<
  AppointmentStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  pending: { label: "Pendente", className: "bg-amber-50 text-amber-800 border-amber-200", icon: CircleDashed },
  awaiting_approval: { label: "Aprovação", className: "bg-orange-50 text-orange-800 border-orange-200", icon: Clock3 },
  confirmed: { label: "Confirmado", className: "bg-blue-50 text-blue-800 border-blue-200", icon: CheckCircle2 },
  checked_in: { label: "Chegou", className: "bg-violet-50 text-violet-800 border-violet-200", icon: CheckCircle2 },
  in_service: { label: "Em atendimento", className: "bg-purple-50 text-purple-800 border-purple-200", icon: Clock3 },
  completed: { label: "Concluído", className: "bg-green-50 text-green-800 border-green-200", icon: CheckCircle2 },
  cancelled_by_customer: { label: "Cancelado pelo cliente", className: "bg-zinc-100 text-zinc-600 border-zinc-200", icon: UserX },
  cancelled_by_business: { label: "Cancelado", className: "bg-zinc-100 text-zinc-600 border-zinc-200", icon: UserX },
  no_show: { label: "Faltou", className: "bg-red-50 text-red-800 border-red-200", icon: UserX },
};

const nextActions: Partial<Record<AppointmentStatus, Array<{ label: string; status: AppointmentStatus }>>> = {
  pending: [
    { label: "Confirmar", status: "confirmed" },
    { label: "Cancelar", status: "cancelled_by_business" },
  ],
  awaiting_approval: [
    { label: "Aprovar", status: "confirmed" },
    { label: "Recusar", status: "cancelled_by_business" },
  ],
  confirmed: [
    { label: "Check-in", status: "checked_in" },
    { label: "Faltou", status: "no_show" },
    { label: "Cancelar", status: "cancelled_by_business" },
  ],
  checked_in: [{ label: "Iniciar atendimento", status: "in_service" }],
  in_service: [{ label: "Concluir atendimento", status: "completed" }],
};

export function AgendaBoard({
  appointments,
  currency,
  periodLabel,
  slug,
  timezone,
}: {
  appointments: AgendaAppointment[];
  currency: string;
  periodLabel: string;
  slug: string;
  timezone: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedId) ?? null,
    [appointments, selectedId],
  );

  if (!appointments.length) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-2xl border border-dashed border-zinc-300 bg-white px-5 text-center">
        <div>
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-zinc-100 text-zinc-500">
            <Clock3 aria-hidden="true" size={22} />
          </span>
          <h2 className="mt-4 text-lg font-bold">Nenhum atendimento neste período</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
            Quando houver movimento em {periodLabel}, os horários aparecerão aqui.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white" aria-labelledby="schedule-title">
        <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-bold" id="schedule-title">Horários</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Selecione um atendimento para ver detalhes.</p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold tabular-nums text-zinc-600">
            {appointments.length}
          </span>
        </header>

        <ol className="divide-y divide-zinc-100" aria-label="Atendimentos do período">
          {appointments.map((appointment) => {
            const presentation = statusPresentation[appointment.status];
            const StatusIcon = presentation.icon;
            const isSelected = selectedId === appointment.id;
            return (
              <li key={appointment.id}>
                <button
                  aria-controls="appointment-details"
                  aria-expanded={isSelected}
                  aria-pressed={isSelected}
                  className={cn(
                    "grid w-full grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 text-left transition sm:px-5",
                    isSelected ? "bg-zinc-950 text-white" : "hover:bg-zinc-50",
                  )}
                  onClick={() => setSelectedId((current) => (current === appointment.id ? null : appointment.id))}
                  type="button"
                >
                  <time className={cn("text-sm font-bold tabular-nums", isSelected ? "text-white" : "text-zinc-950")} dateTime={appointment.startsAt}>
                    {formatInTimeZone(appointment.startsAt, timezone, "HH:mm")}
                  </time>
                  <span className="min-w-0 border-l border-zinc-200 pl-3">
                    <span className="block truncate text-sm font-bold">{appointment.customerName}</span>
                    <span className={cn("mt-0.5 block truncate text-xs", isSelected ? "text-zinc-300" : "text-zinc-500")}>
                      {appointment.serviceName}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cn("hidden items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-bold sm:inline-flex", isSelected ? "border-white/25 bg-white/10 text-white" : presentation.className)}>
                      <StatusIcon aria-hidden="true" size={12} />
                      {presentation.label}
                    </span>
                    <ChevronRight aria-hidden="true" className={cn("size-4", isSelected ? "text-white" : "text-zinc-400")} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <aside className="rounded-2xl border border-zinc-200 bg-white p-5 xl:sticky xl:top-20" id="appointment-details">
        {selectedAppointment ? (
          <AppointmentDetails appointment={selectedAppointment} currency={currency} slug={slug} timezone={timezone} />
        ) : (
          <div className="grid min-h-52 place-items-center text-center">
            <div>
              <span className="mx-auto grid size-10 place-items-center rounded-xl bg-zinc-100 text-zinc-500">
                <UserRound aria-hidden="true" size={19} />
              </span>
              <h2 className="mt-3 font-bold">Atendimento em foco</h2>
              <p className="mt-1.5 text-sm leading-6 text-zinc-500">Selecione um horário para revelar cliente, profissional e ações.</p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function AppointmentDetails({
  appointment,
  currency,
  slug,
  timezone,
}: {
  appointment: AgendaAppointment;
  currency: string;
  slug: string;
  timezone: string;
}) {
  const presentation = statusPresentation[appointment.status];
  const StatusIcon = presentation.icon;
  const actions = nextActions[appointment.status] ?? [];

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Atendimento selecionado</p>
      <h2 className="mt-2 text-xl font-bold tracking-[-0.025em]">{appointment.customerName}</h2>
      <p className="mt-1 text-sm text-zinc-600">{appointment.serviceName}</p>

      <span className={cn("mt-5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold", presentation.className)}>
        <StatusIcon aria-hidden="true" size={13} /> {presentation.label}
      </span>

      <dl className="mt-5 grid gap-4 border-y border-zinc-100 py-5 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-zinc-500">Horário</dt>
          <dd className="font-bold tabular-nums">
            {formatInTimeZone(appointment.startsAt, timezone, "HH:mm")} – {formatInTimeZone(appointment.endsAt, timezone, "HH:mm")}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-zinc-500">Profissional</dt>
          <dd className="text-right font-bold">{appointment.staffName ?? "A definir"}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-zinc-500">Valor</dt>
          <dd className="font-bold">{formatMoney(appointment.totalCents, currency)}</dd>
        </div>
      </dl>

      {actions.length ? (
        <div className="mt-5 grid gap-2">
          {actions.map((action, index) => (
            <form action={changeAppointmentStatus} key={action.status}>
              <input name="slug" type="hidden" value={slug} />
              <input name="appointmentId" type="hidden" value={appointment.id} />
              <input name="status" type="hidden" value={action.status} />
              <button
                className={cn(
                  "min-h-11 w-full rounded-xl px-4 text-sm font-bold",
                  index === 0 ? "bg-zinc-950 text-white hover:bg-zinc-800" : "border border-zinc-200 text-zinc-700 hover:bg-zinc-50",
                )}
              >
                {action.label}
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-500">Este atendimento não tem próxima ação operacional.</p>
      )}
    </div>
  );
}
