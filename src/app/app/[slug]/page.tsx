import Link from "next/link";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { fromZonedTime } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { AgendaBoard } from "@/components/admin/agenda-board";
import { AgendaRealtime } from "@/components/admin/agenda-realtime";
import { QuickBooking } from "@/components/admin/quick-booking";
import { QuickBlock } from "@/components/admin/quick-block";
import { getAppointments } from "@/features/appointments/queries";
import { getAdminServices, getAdminStaff, getPrimaryLocationId } from "@/features/catalog/admin-queries";
import { requireTenantAccess } from "@/features/tenants/access";

interface AgendaPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; view?: string }>;
}

function validDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : format(new Date(), "yyyy-MM-dd");
}

export default async function AgendaPage({ params, searchParams }: AgendaPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const tenant = await requireTenantAccess(slug);
  const selectedDate = validDate(query.date);
  const view = query.view === "week" || query.view === "month" ? query.view : "day";
  const date = parseISO(`${selectedDate}T12:00:00`);
  const localStart = view === "week" ? startOfWeek(date, { weekStartsOn: 1 }) : date;
  const days = view === "month" ? 31 : view === "week" ? 7 : 1;
  const localEnd = addDays(localStart, days);
  const rangeStart = fromZonedTime(format(localStart, "yyyy-MM-dd'T'00:00:00"), tenant.timezone).toISOString();
  const rangeEnd = fromZonedTime(format(localEnd, "yyyy-MM-dd'T'00:00:00"), tenant.timezone).toISOString();
  const [appointments, services, staff, locationId] = await Promise.all([
    getAppointments(tenant.id, rangeStart, rangeEnd),
    getAdminServices(tenant.id),
    getAdminStaff(tenant.id),
    getPrimaryLocationId(tenant.id),
  ]);
  const previousDate = format(addDays(date, view === "week" ? -7 : view === "month" ? -30 : -1), "yyyy-MM-dd");
  const nextDate = format(addDays(date, view === "week" ? 7 : view === "month" ? 30 : 1), "yyyy-MM-dd");
  const today = format(new Date(), "yyyy-MM-dd");
  const canOperate = ["owner", "admin", "receptionist"].includes(tenant.role);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-500">Operação</p>
            <h1 className="mt-1 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">Agenda</h1>
            <p className="mt-2 text-sm capitalize text-zinc-500">
              {view === "day"
                ? format(date, "EEEE, d 'de' MMMM", { locale: ptBR })
                : `${appointments.length} atendimentos no período`}
            </p>
          </div>
          <div className="flex gap-2">
            <label className="relative hidden sm:block">
              <span className="sr-only">Buscar cliente</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" size={17} />
              <input className="min-h-11 w-52 rounded-xl border border-zinc-200 bg-white pl-10 pr-3 text-sm" placeholder="Buscar cliente" type="search" />
            </label>
            {canOperate ? (
              <>
                <QuickBooking
                  initialDate={today}
                  locationId={locationId}
                  services={services}
                  slug={slug}
                  staff={staff}
                  timezone={tenant.timezone}
                />
                <QuickBlock date={selectedDate} locationId={locationId} slug={slug} staff={staff} />
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <Link className="grid size-10 place-items-center rounded-xl text-zinc-600 hover:bg-zinc-100" href={`/app/${slug}?date=${previousDate}&view=${view}`} aria-label="Período anterior">
              <ChevronLeft aria-hidden="true" size={20} />
            </Link>
            <Link className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-bold hover:bg-zinc-100" href={`/app/${slug}?date=${today}&view=${view}`}>
              Hoje
            </Link>
            <Link className="grid size-10 place-items-center rounded-xl text-zinc-600 hover:bg-zinc-100" href={`/app/${slug}?date=${nextDate}&view=${view}`} aria-label="Próximo período">
              <ChevronRight aria-hidden="true" size={20} />
            </Link>
          </div>
          <div className="grid grid-cols-3 rounded-xl bg-zinc-100 p-1 text-sm font-semibold">
            {(["day", "week", "month"] as const).map((item) => (
              <Link
                className={`rounded-lg px-4 py-2 text-center ${view === item ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-950"}`}
                href={`/app/${slug}?date=${selectedDate}&view=${item}`}
                key={item}
              >
                {item === "day" ? "Dia" : item === "week" ? "Semana" : "Mês"}
              </Link>
            ))}
          </div>
        </div>

        <section className="mt-4" aria-label="Agenda">
          <AgendaRealtime tenantId={tenant.id} />
          <AgendaBoard appointments={appointments} currency={tenant.currency} slug={slug} timezone={tenant.timezone} />
        </section>
      </div>
    </main>
  );
}
