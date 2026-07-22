import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Clock3, MapPin, UserRound } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { notFound } from "next/navigation";
import { ManageBookingActions } from "@/components/booking/manage-booking-actions";
import { getManagedBooking } from "@/features/booking/manage";
import { formatDateInTimezone, formatTimeInTimezone } from "@/lib/dates";
import type { AppointmentStatus } from "@/types/domain";

interface ManagePageProps {
  params: Promise<{ slug: string; token: string }>;
}

export const metadata: Metadata = {
  title: "Gerenciar agendamento",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const statusLabels: Record<AppointmentStatus, string> = {
  pending: "Pendente",
  awaiting_approval: "Aguardando aprovação",
  confirmed: "Confirmado",
  checked_in: "Check-in realizado",
  in_service: "Em atendimento",
  completed: "Concluído",
  cancelled_by_customer: "Cancelado por você",
  cancelled_by_business: "Cancelado pelo estabelecimento",
  no_show: "Falta registrada",
};

export default async function ManageBookingPage({ params }: ManagePageProps) {
  const { slug, token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const booking = await getManagedBooking(token);
  if (!booking || booking.tenantSlug !== slug) notFound();

  return (
    <main className="min-h-dvh bg-[var(--background)] px-5 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <Link className="text-sm font-bold text-zinc-600 hover:text-zinc-950" href={`/${slug}`}>
          ← {booking.tenantName}
        </Link>
        <section className="surface mt-5 p-6 sm:p-9">
          <p className="text-sm font-semibold text-blue-700">{statusLabels[booking.status]}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Seu agendamento</h1>
          <p className="mt-3 text-zinc-600">Consulte os detalhes ou altere sua reserva com segurança.</p>

          <dl className="my-8 grid gap-5 border-y border-zinc-100 py-7 sm:grid-cols-2">
            <div className="flex gap-3">
              <CalendarDays className="mt-0.5 text-zinc-400" aria-hidden="true" size={19} />
              <div>
                <dt className="text-sm text-zinc-500">Data</dt>
                <dd className="mt-1 font-bold capitalize">
                  {formatDateInTimezone(booking.startsAt, booking.timezone)}
                </dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Clock3 className="mt-0.5 text-zinc-400" aria-hidden="true" size={19} />
              <div>
                <dt className="text-sm text-zinc-500">Horário</dt>
                <dd className="mt-1 font-bold">
                  {formatTimeInTimezone(booking.startsAt, booking.timezone)} – {formatTimeInTimezone(booking.endsAt, booking.timezone)}
                </dd>
              </div>
            </div>
            <div className="flex gap-3">
              <UserRound className="mt-0.5 text-zinc-400" aria-hidden="true" size={19} />
              <div>
                <dt className="text-sm text-zinc-500">Atendimento</dt>
                <dd className="mt-1 font-bold">{booking.serviceNames.join(" + ")}</dd>
                {booking.staffName ? <dd className="mt-1 text-sm text-zinc-500">com {booking.staffName}</dd> : null}
              </div>
            </div>
            <div className="flex gap-3">
              <MapPin className="mt-0.5 text-zinc-400" aria-hidden="true" size={19} />
              <div>
                <dt className="text-sm text-zinc-500">Local</dt>
                <dd className="mt-1 font-bold">{booking.locationName}</dd>
                <dd className="mt-1 text-sm leading-5 text-zinc-500">{booking.address}</dd>
              </div>
            </div>
          </dl>

          <ManageBookingActions
            canCancel={booking.canCancel}
            canReschedule={booking.canReschedule}
            initialDate={formatInTimeZone(new Date(), booking.timezone, "yyyy-MM-dd")}
            key={booking.status}
            tenantSlug={booking.tenantSlug}
            timezone={booking.timezone}
            token={token}
          />
        </section>
      </div>
    </main>
  );
}
