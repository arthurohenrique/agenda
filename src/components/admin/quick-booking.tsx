"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckCircle2, Clock3, UserRoundCheck, X } from "lucide-react";
import { z } from "zod";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { formatTimeInTimezone, localDateBounds } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AdminService, AdminStaff } from "@/features/catalog/admin-queries";
import type { AvailableSlot } from "@/types/domain";

interface QuickBookingProps {
  slug: string;
  timezone: string;
  locationId: string | null;
  initialDate: string;
  services: AdminService[];
  staff: AdminStaff[];
  mode?: "booking" | "walk_in";
}

export function QuickBooking({ slug, timezone, locationId, initialDate, services, staff, mode = "booking" }: QuickBookingProps) {
  const isWalkIn = mode === "walk_in";
  const dialogId = isWalkIn ? "quick-walk-in-dialog" : "quick-booking-dialog";
  const dialogTitleId = isWalkIn ? "quick-walk-in-title" : "quick-booking-title";
  const router = useRouter();
  const activeServices = services.filter((service) => service.is_active);
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState(activeServices[0]?.id ?? "");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [date, setDate] = useState(initialDate);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slot, setSlot] = useState<AvailableSlot | null>(null);
  const [loading, setLoading] = useState(false);
  const [availabilityFailed, setAvailabilityFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const { dialogRef, triggerRef } = useModalFocus<HTMLButtonElement, HTMLElement>({
    onClose: () => setOpen(false),
    open,
  });

  const eligibleStaff = useMemo(
    () => staff.filter((person) => person.is_active && person.staff_services.some((relation) => relation.services.id === serviceId)),
    [serviceId, staff],
  );

  useEffect(() => {
    if (!open || !locationId || !serviceId) return;
    const controller = new AbortController();
    let active = true;
    const bounds = localDateBounds(date, timezone);
    const params = new URLSearchParams({
      locationId,
      serviceId,
      dateFrom: bounds.from,
      dateTo: bounds.to,
      timezone,
    });
    if (staffId) params.set("staffId", staffId);
    fetch(`/api/app/${slug}/availability?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("availability_failed");
        const parsed = z.object({ slots: z.array(z.object({ startAt: z.string(), endAt: z.string(), staffId: z.guid(), staffName: z.string() })) }).parse(payload);
        if (!active) return;
        setSlots(parsed.slots);
      })
      .catch((reason: unknown) => {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setAvailabilityFailed(true);
        setSlot(null);
        setSlots([]);
        setError("Não foi possível consultar horários.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [date, locationId, open, serviceId, slug, staffId, timezone]);

  function refreshAvailability(next: { serviceId?: string; staffId?: string | null; date?: string }) {
    if (next.serviceId !== undefined) setServiceId(next.serviceId);
    if (next.staffId !== undefined) setStaffId(next.staffId);
    if (next.date !== undefined) setDate(next.date);
    setSlot(null);
    setSlots([]);
    setAvailabilityFailed(false);
    setError(null);
    setLoading(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slot || !locationId) return;
    setSubmitting(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    const response = await fetch(`/api/app/${slug}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        serviceId,
        staffId,
        startsAt: slot.startAt,
        customerName: formData.get("customerName"),
        customerPhone: formData.get("customerPhone"),
        customerEmail: formData.get("customerEmail"),
        customerNotes: "",
        internalNotes: formData.get("internalNotes"),
        walkIn: isWalkIn,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(payload?.error ?? "Não foi possível criar o agendamento.");
      setSubmitting(false);
      if (response.status === 409) refreshAvailability({});
      return;
    }
    setOpen(false);
    setSubmitting(false);
    setStatusMessage(isWalkIn ? "Chegada registrada e agenda atualizada." : "Agendamento criado e agenda atualizada.");
    router.refresh();
  }

  return (
    <>
      <button
        aria-controls={open ? dialogId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold disabled:bg-zinc-400",
          isWalkIn ? "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50" : "bg-zinc-950 text-white",
        )}
        disabled={!locationId || !activeServices.length}
        onClick={() => {
          setOpen(true);
          setLoading(true);
          setAvailabilityFailed(false);
          setError(null);
          setSlot(null);
          setSlots([]);
          setStatusMessage(null);
        }}
        ref={triggerRef}
        type="button"
      >
        {isWalkIn ? <UserRoundCheck aria-hidden="true" size={18} /> : <CalendarPlus aria-hidden="true" size={18} />}
        {isWalkIn ? "Cliente presente" : "Novo agendamento"}
      </button>
      {statusMessage ? <span className="sr-only" role="status">{statusMessage}</span> : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} role="presentation">
          <section
            aria-labelledby={dialogTitleId}
            aria-modal="true"
            className="h-dvh w-full max-w-lg overflow-y-auto overscroll-contain bg-[var(--background)] p-5 shadow-2xl sm:p-7"
            id={dialogId}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-zinc-500">{isWalkIn ? "Atendimento sem reserva" : "Cadastro rápido"}</p><h2 className="mt-1 text-2xl font-bold tracking-tight" id={dialogTitleId}>{isWalkIn ? "Registrar cliente presente" : "Novo agendamento"}</h2>{isWalkIn ? <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">Reserve primeiro horário livre e registre chegada agora. Nada é alterado sem validar disponibilidade.</p> : null}</div><button aria-label="Fechar" className="grid size-11 place-items-center rounded-xl hover:bg-white" data-modal-initial-focus onClick={() => setOpen(false)} type="button"><X aria-hidden="true" size={21} /></button></header>
            <form className="mt-7 grid gap-5" onSubmit={submit}>
              <label className="grid gap-2 text-sm font-semibold">Serviço<select className="min-h-12 rounded-xl border border-zinc-200 bg-white px-3" onChange={(event) => refreshAvailability({ serviceId: event.target.value, staffId: null })} value={serviceId}>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
              <label className="grid gap-2 text-sm font-semibold">Profissional<select className="min-h-12 rounded-xl border border-zinc-200 bg-white px-3" onChange={(event) => refreshAvailability({ staffId: event.target.value || null })} value={staffId ?? ""}><option value="">Qualquer disponível</option>{eligibleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
              <label className="grid gap-2 text-sm font-semibold">Data<input className="min-h-12 rounded-xl border border-zinc-200 bg-white px-3" min={initialDate} onChange={(event) => refreshAvailability({ date: event.target.value })} type="date" value={date} /></label>
              <fieldset aria-busy={loading}>
                <legend className="text-sm font-semibold">Horário</legend>
                <p className="sr-only" role="status">
                  {loading
                    ? "Carregando horários."
                    : availabilityFailed
                      ? ""
                    : slots.length
                      ? `${Math.min(slots.length, 16)} horários disponíveis.`
                      : "Nenhum horário disponível nesta data."}
                </p>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {loading ? Array.from({ length: 8 }, (_, index) => (
                    <span aria-hidden="true" className="h-11 animate-pulse rounded-xl bg-zinc-200" key={index} />
                  )) : availabilityFailed ? null : slots.length ? slots.slice(0, 16).map((item) => (
                    <button
                      aria-label={`${formatTimeInTimezone(item.startAt, timezone)} com ${item.staffName}`}
                      aria-pressed={slot?.startAt === item.startAt && slot.staffId === item.staffId}
                      className={cn(
                        "min-h-11 rounded-xl border text-sm font-bold",
                        slot?.startAt === item.startAt && slot.staffId === item.staffId
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-zinc-200 bg-white hover:border-[var(--accent)]",
                      )}
                      key={`${item.startAt}-${item.staffId}`}
                      onClick={() => setSlot(item)}
                      type="button"
                    >
                      {formatTimeInTimezone(item.startAt, timezone)}
                    </button>
                  )) : <p className="col-span-4 rounded-xl bg-white p-4 text-sm text-zinc-500">Sem horários nesta data.</p>}
                </div>
              </fieldset>
              {slot ? <p className="flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-800"><Clock3 aria-hidden="true" size={17} />{formatTimeInTimezone(slot.startAt, timezone)} com {slot.staffName}</p> : null}
              <div className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5"><label className="grid gap-2 text-sm font-semibold">Cliente<input className="min-h-11 rounded-xl border border-zinc-200 px-3" autoComplete="name" name="customerName" required /></label><label className="grid gap-2 text-sm font-semibold">Telefone<input className="min-h-11 rounded-xl border border-zinc-200 px-3" autoComplete="tel" inputMode="tel" name="customerPhone" placeholder="(11) 99999-9999" required /></label><label className="grid gap-2 text-sm font-semibold">E-mail <span className="font-normal text-zinc-500">(opcional)</span><input className="min-h-11 rounded-xl border border-zinc-200 px-3" autoComplete="email" name="customerEmail" type="email" /></label><label className="grid gap-2 text-sm font-semibold">Observação interna <span className="font-normal text-zinc-500">(opcional)</span><textarea className="min-h-20 rounded-xl border border-zinc-200 p-3" maxLength={2000} name="internalNotes" /></label></div>
              {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800" role="alert">{error}</p> : null}
              <button className="min-h-12 rounded-xl bg-zinc-950 px-5 font-bold text-white disabled:bg-zinc-300" disabled={!slot || submitting}>{submitting ? "Registrando…" : isWalkIn ? "Registrar chegada" : "Confirmar agendamento"}</button>
              <p className="flex items-center gap-2 text-sm text-zinc-500"><CheckCircle2 aria-hidden="true" size={15} />{isWalkIn ? "O atendimento entrará como check-in na agenda." : "Disponibilidade será validada novamente ao confirmar."}</p>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
