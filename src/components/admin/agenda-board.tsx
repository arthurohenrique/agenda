import { formatInTimeZone } from "date-fns-tz";
import { CheckCircle2, CircleDashed, Clock3, MoreHorizontal, UserX } from "lucide-react";
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
  checked_in: [{ label: "Iniciar", status: "in_service" }],
  in_service: [{ label: "Concluir", status: "completed" }],
};

export function AgendaBoard({
  appointments,
  currency,
  slug,
  timezone,
}: {
  appointments: AgendaAppointment[];
  currency: string;
  slug: string;
  timezone: string;
}) {
  if (!appointments.length) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-2xl border border-dashed border-zinc-300 bg-white px-5 text-center">
        <div>
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-zinc-100 text-zinc-500">
            <Clock3 aria-hidden="true" size={25} />
          </span>
          <h2 className="mt-5 text-xl font-bold">Dia livre por enquanto</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
            Novos agendamentos aparecerão aqui imediatamente. Clique em “Novo agendamento” para adicionar um atendimento.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3" role="list" aria-label="Agendamentos do período">
      {appointments.map((appointment) => {
        const presentation = statusPresentation[appointment.status];
        const StatusIcon = presentation.icon;
        return (
          <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5" key={appointment.id} role="listitem">
            <div className="flex items-start gap-4">
              <div className="w-16 shrink-0 pt-0.5 text-center">
                <p className="text-lg font-bold tabular-nums">
                  {formatInTimeZone(appointment.startsAt, timezone, "HH:mm")}
                </p>
                <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
                  {formatInTimeZone(appointment.endsAt, timezone, "HH:mm")}
                </p>
              </div>
              <div className="min-w-0 flex-1 border-l border-zinc-100 pl-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-bold text-zinc-950">{appointment.customerName}</h3>
                    <p className="mt-1 truncate text-sm text-zinc-600">{appointment.serviceName}</p>
                  </div>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", presentation.className)}>
                    <StatusIcon aria-hidden="true" size={13} /> {presentation.label}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
                  <span>{appointment.staffName ?? "Profissional a definir"}</span>
                  <span>{formatMoney(appointment.totalCents, currency)}</span>
                </div>
                {nextActions[appointment.status]?.length ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
                    {nextActions[appointment.status]?.map((action) => (
                      <form action={changeAppointmentStatus} key={action.status}>
                        <input name="slug" type="hidden" value={slug} />
                        <input name="appointmentId" type="hidden" value={appointment.id} />
                        <input name="status" type="hidden" value={action.status} />
                        <button className="min-h-9 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50">
                          {action.label}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : null}
              </div>
              <button className="grid size-9 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100" aria-label={`Mais ações para ${appointment.customerName}`} type="button">
                <MoreHorizontal aria-hidden="true" size={18} />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
