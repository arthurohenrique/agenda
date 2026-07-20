"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  MapPin,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { bookingCustomerSchema } from "@/features/booking/schemas";
import { formatDateInTimezone, formatTimeInTimezone, localDateBounds } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  AvailableSlot,
  PublicService,
  PublicStaff,
  PublicTenant,
} from "@/types/domain";

const detailsSchema = bookingCustomerSchema.extend({
  notes: z.string().trim().max(800, "Use no máximo 800 caracteres."),
  website: z.string().max(0),
});

type DetailsInput = z.infer<typeof detailsSchema>;

interface BookingResult {
  appointmentId: string;
  managementToken: string;
  status: string;
  startsAt: string;
  endsAt: string;
  staffName: string;
}

interface BookingFlowProps {
  tenant: PublicTenant;
  services: PublicService[];
  staff: PublicStaff[];
  initialDate: string;
}

function ServiceOption({
  active,
  currency,
  onSelect,
  service,
}: {
  active: boolean;
  currency: string;
  onSelect: () => void;
  service: PublicService;
}) {
  const price = service.promotionalPriceCents ?? service.priceCents;
  return (
    <button
      aria-pressed={active}
      className={cn(
        "group flex w-full items-start gap-4 rounded-2xl border bg-white p-4 text-left transition sm:p-5",
        active
          ? "border-[var(--booking-primary)] ring-2 ring-[var(--booking-primary)]/10"
          : "border-zinc-200 hover:border-zinc-300 hover:shadow-sm",
      )}
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border",
          active
            ? "border-[var(--booking-primary)] bg-[var(--booking-primary)] text-white"
            : "border-zinc-300 bg-white text-transparent",
        )}
      >
        <Check aria-hidden="true" size={14} strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">
        {service.categoryName ? (
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {service.categoryName}
          </span>
        ) : null}
        <span className="block font-bold text-zinc-950">{service.name}</span>
        {service.description ? (
          <span className="mt-1 block text-sm leading-6 text-zinc-500">{service.description}</span>
        ) : null}
        <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 aria-hidden="true" size={15} /> {service.durationMinutes} min
          </span>
          <span className="font-semibold text-zinc-950">{formatMoney(price, currency)}</span>
        </span>
      </span>
    </button>
  );
}

export function BookingFlow({ tenant, services, staff, initialDate }: BookingFlowProps) {
  const [serviceId, setServiceId] = useState<string | null>(services[0]?.id ?? null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(Boolean(services[0]));
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);

  const form = useForm<DetailsInput>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: "", phone: "", email: "", notes: "", website: "" },
    mode: "onBlur",
  });

  const selectedService = services.find((service) => service.id === serviceId) ?? null;
  const eligibleStaff = useMemo(
    () => staff.filter((person) => !serviceId || person.serviceIds.includes(serviceId)),
    [serviceId, staff],
  );

  useEffect(() => {
    if (!serviceId || !tenant.location) return;
    const controller = new AbortController();
    const bounds = localDateBounds(selectedDate, tenant.timezone);
    const params = new URLSearchParams({
      slug: tenant.slug,
      locationId: tenant.location.id,
      serviceId,
      dateFrom: bounds.from,
      dateTo: bounds.to,
      timezone: tenant.timezone,
    });
    if (staffId) params.set("staffId", staffId);

    fetch(`/api/public/availability?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Não foi possível consultar os horários.");
        const parsed = z
          .object({
            slots: z.array(
              z.object({
                startAt: z.string(),
                endAt: z.string(),
                staffId: z.guid(),
                staffName: z.string(),
              }),
            ),
          })
          .parse(payload);
        setSlots(parsed.slots);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSlots([]);
        setAvailabilityError("Horários indisponíveis agora. Tente novamente.");
      })
      .finally(() => setLoadingSlots(false));

    return () => controller.abort();
  }, [availabilityVersion, selectedDate, serviceId, staffId, tenant.location, tenant.slug, tenant.timezone]);

  function chooseService(id: string) {
    setServiceId(id);
    setStaffId(null);
    setSelectedSlot(null);
    setLoadingSlots(true);
    setAvailabilityError(null);
    setBookingError(null);
  }

  function chooseStaff(id: string | null) {
    setStaffId(id);
    setSelectedSlot(null);
    setLoadingSlots(true);
    setAvailabilityError(null);
  }

  function chooseDate(value: string) {
    setSelectedDate(value);
    setSelectedSlot(null);
    setLoadingSlots(true);
    setAvailabilityError(null);
  }

  async function submitBooking(details: DetailsInput) {
    if (!selectedService || !selectedSlot || !tenant.location) {
      setBookingError("Escolha serviço e horário antes de confirmar.");
      return;
    }

    setSubmitting(true);
    setBookingError(null);
    const response = await fetch("/api/public/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: tenant.slug,
        locationId: tenant.location.id,
        serviceIds: [selectedService.id],
        staffId,
        startsAt: selectedSlot.startAt,
        timezone: tenant.timezone,
        customer: { name: details.name, phone: details.phone, email: details.email },
        notes: details.notes,
        website: details.website,
        idempotencyKey: crypto.randomUUID(),
      }),
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsedError = z.object({ error: z.string() }).safeParse(payload);
      setBookingError(parsedError.success ? parsedError.data.error : "Não foi possível confirmar.");
      setSubmitting(false);
      if (response.status === 409) {
        setSelectedSlot(null);
        setLoadingSlots(true);
        setAvailabilityVersion((value) => value + 1);
      }
      return;
    }

    const parsedResult = z
      .object({
        appointmentId: z.guid(),
        managementToken: z.string().min(32),
        status: z.string(),
        startsAt: z.string(),
        endsAt: z.string(),
        staffName: z.string(),
      })
      .parse(payload);
    setBooking(parsedResult);
    setSubmitting(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (booking && selectedService && tenant.location) {
    const pending = booking.status === "awaiting_approval";
    return (
      <section className="mx-auto max-w-2xl px-5 py-12 sm:py-20" aria-labelledby="booking-success-title">
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-10">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-green-50 text-green-700">
            <CheckCircle2 aria-hidden="true" size={32} />
          </span>
          <p className="mt-6 text-sm font-semibold text-green-700">
            {pending ? "Solicitação recebida" : "Agendamento confirmado"}
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight" id="booking-success-title">
            {pending ? "Aguarde a confirmação" : "Tudo certo por aqui"}
          </h2>
          <p className="mx-auto mt-4 max-w-lg leading-7 text-zinc-600">
            {pending
              ? `${tenant.name} analisará seu pedido. Você receberá a atualização pelos contatos informados.`
              : `Seu horário em ${tenant.name} está reservado.`}
          </p>

          <dl className="mt-8 grid gap-4 rounded-2xl bg-zinc-50 p-5 text-left sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Serviço</dt>
              <dd className="mt-1 font-bold">{selectedService.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Profissional</dt>
              <dd className="mt-1 font-bold">{booking.staffName}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Data</dt>
              <dd className="mt-1 font-bold capitalize">
                {formatDateInTimezone(booking.startsAt, tenant.timezone)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Horário</dt>
              <dd className="mt-1 font-bold">
                {formatTimeInTimezone(booking.startsAt, tenant.timezone)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Local</dt>
              <dd className="mt-1 font-bold">
                {tenant.location.addressLine1}, {tenant.location.city}
              </dd>
            </div>
          </dl>

          <a
            className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--booking-primary)] px-5 font-semibold text-white sm:w-auto"
            href={`/${tenant.slug}/reserva/${booking.managementToken}`}
          >
            Gerenciar agendamento
          </a>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 pb-32 pt-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8 lg:pb-20 lg:pt-12">
      <div className="grid min-w-0 gap-10">
        <section aria-labelledby="services-title">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[var(--booking-accent)]">1 · Serviço</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight" id="services-title">
                O que você deseja fazer?
              </h2>
            </div>
          </div>
          <div className={cn("grid gap-3", tenant.theme.serviceView === "cards" && "sm:grid-cols-2")}>
            {services.map((service) => (
              <ServiceOption
                active={service.id === serviceId}
                currency={tenant.currency}
                key={service.id}
                onSelect={() => chooseService(service.id)}
                service={service}
              />
            ))}
          </div>
        </section>

        {selectedService?.allowStaffSelection ? (
          <section aria-labelledby="staff-title">
            <p className="text-sm font-semibold text-[var(--booking-accent)]">2 · Profissional</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight" id="staff-title">
              Com quem você prefere?
            </h2>
            <div className="mt-5 flex gap-3 overflow-x-auto pb-2">
              <button
                aria-pressed={!staffId}
                className={cn(
                  "flex min-w-36 items-center gap-3 rounded-2xl border bg-white p-3 text-left transition",
                  !staffId
                    ? "border-[var(--booking-primary)] ring-2 ring-[var(--booking-primary)]/10"
                    : "border-zinc-200 hover:border-zinc-300",
                )}
                onClick={() => chooseStaff(null)}
                type="button"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                  <Sparkles aria-hidden="true" size={18} />
                </span>
                <span className="text-sm font-bold">Qualquer profissional</span>
              </button>
              {eligibleStaff.map((person) => (
                <button
                  aria-pressed={staffId === person.id}
                  className={cn(
                    "flex min-w-44 items-center gap-3 rounded-2xl border bg-white p-3 text-left transition",
                    staffId === person.id
                      ? "border-[var(--booking-primary)] ring-2 ring-[var(--booking-primary)]/10"
                      : "border-zinc-200 hover:border-zinc-300",
                  )}
                  key={person.id}
                  onClick={() => chooseStaff(person.id)}
                  type="button"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                    <UserRound aria-hidden="true" size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{person.name}</span>
                    {person.title ? (
                      <span className="mt-0.5 block truncate text-xs text-zinc-500">{person.title}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="datetime-title">
          <p className="text-sm font-semibold text-[var(--booking-accent)]">
            {selectedService?.allowStaffSelection ? "3" : "2"} · Data e horário
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight" id="datetime-title">
            Quando fica melhor?
          </h2>
          <label className="mt-5 grid max-w-xs gap-2 text-sm font-semibold" htmlFor="booking-date">
            Data
            <input
              className="min-h-12 rounded-xl border border-zinc-200 bg-white px-4 text-base focus:border-[var(--booking-accent)] focus:outline-none focus:ring-4 focus:ring-blue-600/10"
              id="booking-date"
              min={initialDate}
              onChange={(event) => chooseDate(event.target.value)}
              type="date"
              value={selectedDate}
            />
          </label>

          <div className="mt-5" aria-live="polite">
            {loadingSlots ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Carregando horários">
                {Array.from({ length: 10 }, (_, index) => (
                  <span className="h-12 animate-pulse rounded-xl bg-zinc-200" key={index} />
                ))}
              </div>
            ) : availabilityError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {availabilityError}
              </div>
            ) : slots.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {slots.map((slot) => (
                  <button
                    aria-label={`${formatTimeInTimezone(slot.startAt, tenant.timezone)} com ${slot.staffName}`}
                    aria-pressed={selectedSlot?.startAt === slot.startAt && selectedSlot.staffId === slot.staffId}
                    className={cn(
                      "min-h-12 rounded-xl border px-2 text-sm font-bold transition",
                      selectedSlot?.startAt === slot.startAt && selectedSlot.staffId === slot.staffId
                        ? "border-[var(--booking-primary)] bg-[var(--booking-primary)] text-white"
                        : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-400",
                    )}
                    key={`${slot.startAt}-${slot.staffId}`}
                    onClick={() => setSelectedSlot(slot)}
                    type="button"
                  >
                    {formatTimeInTimezone(slot.startAt, tenant.timezone)}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center">
                <CalendarDays className="mx-auto text-zinc-400" aria-hidden="true" size={25} />
                <p className="mt-3 font-bold">Sem horários neste dia</p>
                <p className="mt-1 text-sm text-zinc-500">Escolha outra data para ver novas opções.</p>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="details-title">
          <p className="text-sm font-semibold text-[var(--booking-accent)]">
            {selectedService?.allowStaffSelection ? "4" : "3"} · Seus dados
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight" id="details-title">
            Como podemos identificar você?
          </h2>
          <form className="mt-5 grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 sm:grid-cols-2 sm:p-6" onSubmit={form.handleSubmit(submitBooking)}>
            <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
              Nome completo
              <input
                autoComplete="name"
                className="min-h-12 rounded-xl border border-zinc-200 px-4 text-base focus:border-[var(--booking-accent)] focus:outline-none focus:ring-4 focus:ring-blue-600/10"
                {...form.register("name")}
              />
              {form.formState.errors.name ? (
                <span className="text-sm text-red-700" role="alert">{form.formState.errors.name.message}</span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Telefone com DDD
              <input
                autoComplete="tel"
                className="min-h-12 rounded-xl border border-zinc-200 px-4 text-base focus:border-[var(--booking-accent)] focus:outline-none focus:ring-4 focus:ring-blue-600/10"
                inputMode="tel"
                placeholder="(11) 99999-9999"
                {...form.register("phone")}
              />
              {form.formState.errors.phone ? (
                <span className="text-sm text-red-700" role="alert">{form.formState.errors.phone.message}</span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              E-mail <span className="font-normal text-zinc-500">(opcional)</span>
              <input
                autoComplete="email"
                className="min-h-12 rounded-xl border border-zinc-200 px-4 text-base focus:border-[var(--booking-accent)] focus:outline-none focus:ring-4 focus:ring-blue-600/10"
                type="email"
                {...form.register("email")}
              />
              {form.formState.errors.email ? (
                <span className="text-sm text-red-700" role="alert">{form.formState.errors.email.message}</span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm font-semibold sm:col-span-2">
              Observação <span className="font-normal text-zinc-500">(opcional)</span>
              <textarea
                className="min-h-24 resize-y rounded-xl border border-zinc-200 p-4 text-base focus:border-[var(--booking-accent)] focus:outline-none focus:ring-4 focus:ring-blue-600/10"
                maxLength={800}
                {...form.register("notes")}
              />
            </label>
            <label className="sr-only" aria-hidden="true">
              Website
              <input autoComplete="off" tabIndex={-1} {...form.register("website")} />
            </label>
            {bookingError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800 sm:col-span-2" role="alert">
                {bookingError}
              </p>
            ) : null}
            <button
              className="min-h-12 rounded-xl bg-[var(--booking-primary)] px-5 font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
              disabled={!selectedSlot || submitting}
              type="submit"
            >
              {submitting ? "Confirmando…" : selectedSlot ? "Revisar e confirmar" : "Escolha um horário"}
            </button>
            <p className="text-xs leading-5 text-zinc-500 sm:col-span-2">
              Ao confirmar, seus dados serão usados por {tenant.name} para administrar este atendimento.
            </p>
          </form>
        </section>
      </div>

      <aside className="hidden lg:block" aria-label="Resumo do agendamento">
        <div className="sticky top-8 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Seu agendamento</p>
          <h2 className="mt-2 text-xl font-bold tracking-tight">Resumo</h2>
          <dl className="mt-6 grid gap-5 text-sm">
            <div className="flex gap-3">
              <Sparkles className="mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" size={18} />
              <div>
                <dt className="text-zinc-500">Serviço</dt>
                <dd className="mt-1 font-bold text-zinc-950">{selectedService?.name ?? "Escolha um serviço"}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <UserRound className="mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" size={18} />
              <div>
                <dt className="text-zinc-500">Profissional</dt>
                <dd className="mt-1 font-bold text-zinc-950">
                  {staffId ? eligibleStaff.find((person) => person.id === staffId)?.name : "Qualquer disponível"}
                </dd>
              </div>
            </div>
            <div className="flex gap-3">
              <CalendarDays className="mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" size={18} />
              <div>
                <dt className="text-zinc-500">Data e horário</dt>
                <dd className="mt-1 font-bold capitalize text-zinc-950">
                  {selectedSlot
                    ? `${formatDateInTimezone(selectedSlot.startAt, tenant.timezone)}, ${formatTimeInTimezone(selectedSlot.startAt, tenant.timezone)}`
                    : format(parseISO(`${selectedDate}T12:00:00`), "d 'de' MMMM", { locale: ptBR })}
                </dd>
              </div>
            </div>
            <div className="flex gap-3">
              <MapPin className="mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" size={18} />
              <div>
                <dt className="text-zinc-500">Local</dt>
                <dd className="mt-1 font-bold text-zinc-950">{tenant.location?.name ?? "A definir"}</dd>
                {tenant.location ? (
                  <dd className="mt-1 leading-5 text-zinc-500">
                    {tenant.location.addressLine1}, {tenant.location.city}
                  </dd>
                ) : null}
              </div>
            </div>
          </dl>
          {selectedService ? (
            <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-5">
              <span className="text-sm text-zinc-500">Total</span>
              <span className="text-lg font-bold">
                {formatMoney(
                  selectedService.promotionalPriceCents ?? selectedService.priceCents,
                  tenant.currency,
                )}
              </span>
            </div>
          ) : null}
        </div>
      </aside>

      {selectedService ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 p-3 shadow-[0_-10px_30px_rgb(0_0_0/0.08)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{selectedService.name}</p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {selectedSlot
                  ? `${formatTimeInTimezone(selectedSlot.startAt, tenant.timezone)} · ${selectedSlot.staffName}`
                  : "Escolha data e horário"}
              </p>
            </div>
            <span className="shrink-0 font-bold">
              {formatMoney(selectedService.promotionalPriceCents ?? selectedService.priceCents, tenant.currency)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
