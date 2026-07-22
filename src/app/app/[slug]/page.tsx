import Link from "next/link";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { fromZonedTime } from "date-fns-tz";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AgendaBoard } from "@/components/admin/agenda-board";
import { AgendaRealtime } from "@/components/admin/agenda-realtime";
import { QuickBooking } from "@/components/admin/quick-booking";
import { QuickBlock } from "@/components/admin/quick-block";
import { getAppointments, getCalendarBlocks } from "@/features/appointments/queries";
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
  const [appointments, blocks, services, staff, locationId] = await Promise.all([
    getAppointments(tenant.id, rangeStart, rangeEnd),
    getCalendarBlocks(tenant.id, rangeStart, rangeEnd),
    getAdminServices(tenant.id),
    getAdminStaff(tenant.id),
    getPrimaryLocationId(tenant.id),
  ]);
  const previousDate = format(addDays(date, view === "week" ? -7 : view === "month" ? -30 : -1), "yyyy-MM-dd");
  const nextDate = format(addDays(date, view === "week" ? 7 : view === "month" ? 30 : 1), "yyyy-MM-dd");
  const today = format(new Date(), "yyyy-MM-dd");
  const canOperate = ["owner", "admin", "receptionist"].includes(tenant.role);
  const periodLabel =
    view === "day"
      ? format(date, "EEEE, d 'de' MMMM", { locale: ptBR })
      : view === "week"
        ? `Semana de ${format(localStart, "d 'de' MMMM", { locale: ptBR })}`
        : format(date, "MMMM 'de' yyyy", { locale: ptBR });

  return (
    <main className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-500">Agenda</p>
            <h1 className="mt-1 text-xl font-bold capitalize tracking-[-0.025em] sm:text-2xl">{periodLabel}</h1>
          </div>
          <div className="flex items-center gap-2">
            {canOperate ? (
              <>
                <QuickBooking
                  initialDate={selectedDate}
                  locationId={locationId}
                  services={services}
                  slug={slug}
                  staff={staff}
                  timezone={tenant.timezone}
                />
                <QuickBlock blocks={blocks} date={selectedDate} locationId={locationId} slug={slug} staff={staff} timezone={tenant.timezone} />
              </>
            ) : null}
          </div>
        </header>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-zinc-200 py-3">
          <div className="flex items-center gap-1" aria-label="Navegação de período">
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
          <div className="grid grid-cols-3 rounded-xl bg-zinc-100 p-1 text-sm font-semibold" aria-label="Modo de visualização">
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
          <AgendaBoard
            appointments={appointments}
            currency={tenant.currency}
            periodLabel={periodLabel}
            slug={slug}
            timezone={tenant.timezone}
          />
        </section>
      </div>
    </main>
  );
}
