"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  UserRound,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { bookingCustomerSchema } from "@/features/booking/schemas";
import { formatDateInTimezone, formatTimeInTimezone, localDateBounds } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AvailableSlot, PublicService, PublicStaff, PublicTenant } from "@/types/domain";

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
  currency,
  onSelect,
  service,
}: {
  currency: string;
  onSelect: () => void;
  service: PublicService;
}) {
  const price = service.promotionalPriceCents ?? service.priceCents;

  return (
    <button
      className="group flex w-full items-center justify-between gap-5 border-b border-[var(--booking-border)] px-5 py-5 text-left transition last:border-b-0 hover:bg-[var(--booking-hover)] focus-visible:outline-[var(--booking-accent)] sm:px-7"
      onClick={onSelect}
      type="button"
    >
      <span className="min-w-0">
        {service.categoryName ? <span className="block text-xs font-semibold opacity-50">{service.categoryName}</span> : null}
        <span className="mt-1 block text-lg font-semibold tracking-[-0.02em]">{service.name}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm opacity-55">
          <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden="true" size={15} /> {service.durationMinutes} min</span>
        </span>
      </span>
      <span className="shrink-0 text-right text-base font-semibold tracking-[-0.02em]">{formatMoney(price, currency)}</span>
    </button>
  );
}

export function BookingFlow({ tenant, services, staff, initialDate }: BookingFlowProps) {
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [showStaffChoices, setShowStaffChoices] = useState(false);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
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
  const quickDates = useMemo(
    () => Array.from({ length: 5 }, (_, offset) => {
      const date = addDays(parseISO(`${initialDate}T12:00:00`), offset);
      return {
        value: format(date, "yyyy-MM-dd"),
        label: offset === 0 ? "Hoje" : offset === 1 ? "Amanhã" : format(date, "EEE", { locale: ptBR }),
        day: format(date, "d"),
      };
    }),
    [initialDate],
  );
  const visibleSlots = slots.slice(0, 12);
  const moreSlots = slots.slice(12);

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

    fetch(`/api/public/availability?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("availability_failed");
        const parsed = z.object({
          slots: z.array(z.object({ startAt: z.string(), endAt: z.string(), staffId: z.guid(), staffName: z.string() })),
        }).parse(payload);
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

  function reveal(id: string) {
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function chooseService(id: string) {
    setServiceId(id);
    setStaffId(null);
    setShowStaffChoices(false);
    setSelectedSlot(null);
    setSlots([]);
    setLoadingSlots(true);
    setAvailabilityError(null);
    setBookingError(null);
    reveal("booking-schedule");
  }

  function clearService() {
    setServiceId(null);
    setStaffId(null);
    setShowStaffChoices(false);
    setSelectedSlot(null);
    setSlots([]);
    setAvailabilityError(null);
    reveal("booking-service");
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

  function chooseSlot(slot: AvailableSlot) {
    setSelectedSlot(slot);
    setBookingError(null);
    reveal("booking-details");
  }

  async function submitBooking(details: DetailsInput) {
    if (!selectedService || !selectedSlot || !tenant.location) {
      setBookingError("Escolha um horário antes de confirmar.");
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

    const parsedResult = z.object({
      appointmentId: z.guid(),
      managementToken: z.string().min(32),
      status: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      staffName: z.string(),
    }).parse(payload);
    setBooking(parsedResult);
    setSubmitting(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (booking && selectedService && tenant.location) {
    const pending = booking.status === "awaiting_approval";
    return (
      <section className="mx-auto max-w-2xl px-5 py-16 sm:py-24" aria-labelledby="booking-success-title">
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-green-50 text-green-700"><CheckCircle2 aria-hidden="true" size={28} /></span>
          <p className="mt-6 text-sm font-semibold text-green-700">{pending ? "Pedido recebido" : "Agendamento confirmado"}</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em]" id="booking-success-title">{pending ? "Já estamos cuidando disso." : "Seu horário está reservado."}</h2>
          <p className="mx-auto mt-4 max-w-lg leading-7 opacity-65">
            {pending ? `${tenant.name} confirmará o pedido pelos contatos informados.` : `Nos vemos em ${tenant.name}.`}
          </p>
          <dl className="mt-10 grid gap-4 border-y border-[var(--booking-border)] py-6 text-left sm:grid-cols-2">
            <div><dt className="text-xs font-bold uppercase tracking-wide opacity-50">Serviço</dt><dd className="mt-1 font-bold">{selectedService.name}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wide opacity-50">Profissional</dt><dd className="mt-1 font-bold">{booking.staffName}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wide opacity-50">Data</dt><dd className="mt-1 font-bold capitalize">{formatDateInTimezone(booking.startsAt, tenant.timezone)}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-wide opacity-50">Horário</dt><dd className="mt-1 font-bold">{formatTimeInTimezone(booking.startsAt, tenant.timezone)}</dd></div>
          </dl>
          <a className="mt-8 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--booking-primary)] px-5 font-semibold text-white" href={`/${tenant.slug}/reserva/${booking.managementToken}`}>Gerenciar agendamento</a>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-16 sm:px-8 sm:pt-24">
      {!selectedService ? (
        <section className="mx-auto max-w-2xl text-center" id="booking-service" aria-labelledby="services-title">
          <p className="text-sm font-semibold text-[var(--booking-accent)]">Agendamento</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl" id="services-title">Como podemos ajudar?</h2>
          <p className="mt-4 text-base leading-7 opacity-60">Escolha um serviço. Os horários aparecem em seguida.</p>
          <div className="mt-10 overflow-hidden rounded-3xl border border-[var(--booking-border)] bg-[var(--booking-surface)] text-left">
            {services.map((service) => <ServiceOption currency={tenant.currency} key={service.id} onSelect={() => chooseService(service.id)} service={service} />)}
          </div>
        </section>
      ) : (
        <div className="mx-auto max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--booking-border)] pb-5">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.14em] opacity-50">Seu serviço</p>
              <p className="mt-1 truncate text-lg font-semibold tracking-[-0.025em]">{selectedService.name}</p>
            </div>
            <button className="min-h-10 rounded-full border border-[var(--booking-border)] bg-[var(--booking-surface)] px-4 text-sm font-medium hover:bg-[var(--booking-hover)]" onClick={clearService} type="button">Trocar</button>
          </div>

          <section className="scroll-mt-6 pt-10" id="booking-schedule" aria-labelledby="schedule-title">
            <p className="text-sm font-semibold text-[var(--booking-accent)]">Próximo passo</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl" id="schedule-title">Escolha um horário.</h2>
            <p className="mt-4 max-w-xl leading-7 opacity-65">Comece por um dos próximos dias. Você pode trocar a data quando quiser.</p>

            <div className="mt-8 flex gap-2 overflow-x-auto pb-2" aria-label="Datas sugeridas">
              {quickDates.map((date) => (
                <button
                  aria-pressed={selectedDate === date.value}
                  className={cn(
                    "grid min-w-16 gap-0.5 rounded-2xl border px-3 py-3 text-center transition",
                    selectedDate === date.value ? "border-[var(--booking-primary)] bg-[var(--booking-primary)] text-white" : "border-[var(--booking-border)] bg-[var(--booking-surface)] hover:border-[var(--booking-border-strong)]",
                  )}
                  key={date.value}
                  onClick={() => chooseDate(date.value)}
                  type="button"
                >
                  <span className="text-xs font-bold capitalize">{date.label}</span>
                  <span className="text-xl font-black tabular-nums">{date.day}</span>
                </button>
              ))}
              <label className="grid min-w-24 cursor-pointer place-items-center rounded-2xl border border-dashed border-[var(--booking-border)] bg-[var(--booking-surface)] px-3 text-center text-xs font-medium hover:border-[var(--booking-border-strong)]">
                Outra data
                <input aria-label="Escolher outra data" className="mt-1 max-w-20 bg-transparent text-center text-sm outline-none" min={initialDate} onChange={(event) => chooseDate(event.target.value)} type="date" value={selectedDate} />
              </label>
            </div>

            {selectedService.allowStaffSelection ? (
              <div className="mt-7">
                <button className="inline-flex min-h-10 items-center gap-2 text-sm font-medium opacity-65 hover:opacity-100" onClick={() => setShowStaffChoices((visible) => !visible)} type="button">
                  <UserRound aria-hidden="true" size={17} />
                  {staffId ? `Profissional: ${eligibleStaff.find((person) => person.id === staffId)?.name ?? "selecionado"}` : "Prefere escolher profissional?"}
                  <ChevronDown aria-hidden="true" className={cn("transition", showStaffChoices && "rotate-180")} size={16} />
                </button>
                {showStaffChoices ? (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                    <button aria-pressed={!staffId} className={cn("min-h-11 shrink-0 rounded-xl border px-4 text-sm font-medium", !staffId ? "border-[var(--booking-primary)] bg-[var(--booking-primary)] text-white" : "border-[var(--booking-border)] bg-[var(--booking-surface)]")} onClick={() => chooseStaff(null)} type="button">Qualquer pessoa</button>
                    {eligibleStaff.map((person) => <button aria-pressed={staffId === person.id} className={cn("min-h-11 shrink-0 rounded-xl border px-4 text-sm font-medium", staffId === person.id ? "border-[var(--booking-primary)] bg-[var(--booking-primary)] text-white" : "border-[var(--booking-border)] bg-[var(--booking-surface)]")} key={person.id} onClick={() => chooseStaff(person.id)} type="button">{person.name}</button>)}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-8" aria-live="polite">
              {loadingSlots ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Carregando horários">{Array.from({ length: 8 }, (_, index) => <span className="h-14 animate-pulse rounded-2xl bg-[var(--booking-skeleton)]" key={index} />)}</div>
              ) : availabilityError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{availabilityError}</div>
              ) : slots.length ? (
                <div className="grid gap-2 sm:grid-cols-4">
                  {visibleSlots.map((slot) => <SlotButton active={selectedSlot?.startAt === slot.startAt && selectedSlot.staffId === slot.staffId} key={`${slot.startAt}-${slot.staffId}`} onClick={() => chooseSlot(slot)} slot={slot} tenant={tenant} />)}
                  {moreSlots.length ? <details className="sm:col-span-4"><summary className="mt-2 cursor-pointer text-sm font-medium opacity-65 hover:opacity-100">Ver mais {moreSlots.length} horários</summary><div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">{moreSlots.map((slot) => <SlotButton active={selectedSlot?.startAt === slot.startAt && selectedSlot.staffId === slot.staffId} key={`${slot.startAt}-${slot.staffId}`} onClick={() => chooseSlot(slot)} slot={slot} tenant={tenant} />)}</div></details> : null}
                </div>
              ) : (
                <div className="rounded-3xl border border-[var(--booking-border)] bg-[var(--booking-surface)] p-7 text-center"><CalendarDays className="mx-auto opacity-40" aria-hidden="true" size={26} /><p className="mt-3 font-semibold">Nenhum horário neste dia</p><p className="mt-1 text-sm opacity-60">Tente uma das próximas datas.</p></div>
              )}
            </div>
          </section>

          {selectedSlot ? (
            <section className="scroll-mt-6 pt-14" id="booking-details" aria-labelledby="details-title">
              <div className="border-y border-[var(--booking-border)] py-10 sm:py-12">
                <p className="text-sm font-semibold text-[var(--booking-accent)]">Quase lá</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em]" id="details-title">Para quem é esse horário?</h2>
                <p className="mt-3 text-sm leading-6 opacity-65">{formatDateInTimezone(selectedSlot.startAt, tenant.timezone)} às {formatTimeInTimezone(selectedSlot.startAt, tenant.timezone)} · {selectedSlot.staffName}</p>
                <form className="mt-7 grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(submitBooking)}>
                  <label className="grid gap-2 text-sm font-medium sm:col-span-2">Nome completo<input autoComplete="name" className="min-h-13 rounded-xl border border-[var(--booking-border)] bg-[var(--booking-background)] px-4 text-base font-normal focus:border-[var(--booking-accent)] focus:outline-none focus:ring-4 focus:ring-blue-600/10" {...form.register("name")} />{form.formState.errors.name ? <span className="text-sm text-red-700" role="alert">{form.formState.errors.name.message}</span> : null}</label>
                  <label className="grid gap-2 text-sm font-medium sm:col-span-2">Telefone com DDD<input autoComplete="tel" className="min-h-13 rounded-xl border border-[var(--booking-border)] bg-[var(--booking-background)] px-4 text-base font-normal focus:border-[var(--booking-accent)] focus:outline-none focus:ring-4 focus:ring-blue-600/10" inputMode="tel" placeholder="(11) 99999-9999" {...form.register("phone")} />{form.formState.errors.phone ? <span className="text-sm text-red-700" role="alert">{form.formState.errors.phone.message}</span> : null}</label>
                  <details className="sm:col-span-2"><summary className="cursor-pointer text-sm font-medium opacity-65 hover:opacity-100">Adicionar e-mail ou observação (opcional)</summary><div className="mt-4 grid gap-4"><label className="grid gap-2 text-sm font-medium">E-mail<input autoComplete="email" className="min-h-12 rounded-xl border border-[var(--booking-border)] bg-[var(--booking-background)] px-4 text-base font-normal" type="email" {...form.register("email")} />{form.formState.errors.email ? <span className="text-sm text-red-700" role="alert">{form.formState.errors.email.message}</span> : null}</label><label className="grid gap-2 text-sm font-medium">Observação<textarea className="min-h-24 resize-y rounded-xl border border-[var(--booking-border)] bg-[var(--booking-background)] p-4 text-base font-normal" maxLength={800} {...form.register("notes")} /></label></div></details>
                  <label className="sr-only" aria-hidden="true">Website<input autoComplete="off" tabIndex={-1} {...form.register("website")} /></label>
                  {bookingError ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800 sm:col-span-2" role="alert">{bookingError}</p> : null}
                  <button className="min-h-13 rounded-full bg-[var(--booking-primary)] px-5 text-base font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2" disabled={submitting} type="submit">{submitting ? "Confirmando…" : "Confirmar agendamento"}</button>
                  <p className="text-xs leading-5 opacity-55 sm:col-span-2">Seus dados serão usados somente por {tenant.name} para administrar este atendimento.</p>
                </form>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SlotButton({ active, onClick, slot, tenant }: { active: boolean; onClick: () => void; slot: AvailableSlot; tenant: PublicTenant }) {
  return (
    <button
      aria-label={`${formatTimeInTimezone(slot.startAt, tenant.timezone)} com ${slot.staffName}`}
      aria-pressed={active}
      className={cn("min-h-14 rounded-2xl border px-3 text-sm font-semibold transition", active ? "border-[var(--booking-primary)] bg-[var(--booking-primary)] text-white" : "border-[var(--booking-border)] bg-[var(--booking-surface)] hover:border-[var(--booking-border-strong)]")}
      onClick={onClick}
      type="button"
    >
      {formatTimeInTimezone(slot.startAt, tenant.timezone)}
    </button>
  );
}
