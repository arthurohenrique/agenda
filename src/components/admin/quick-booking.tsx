"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckCircle2, Clock3, X } from "lucide-react";
import { z } from "zod";
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
}

export function QuickBooking({ slug, timezone, locationId, initialDate, services, staff }: QuickBookingProps) {
  const router = useRouter();
  const activeServices = services.filter((service) => service.is_active);
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState(activeServices[0]?.id ?? "");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [date, setDate] = useState(initialDate);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slot, setSlot] = useState<AvailableSlot | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const eligibleStaff = useMemo(
    () => staff.filter((person) => person.is_active && person.staff_services.some((relation) => relation.services.id === serviceId)),
    [serviceId, staff],
  );

  useEffect(() => {
    if (!open || !locationId || !serviceId) return;
    const controller = new AbortController();
    const bounds = localDateBounds(date, timezone);
    const params = new URLSearchParams({
      slug,
      locationId,
      serviceId,
      dateFrom: bounds.from,
      dateTo: bounds.to,
      timezone,
    });
    if (staffId) params.set("staffId", staffId);

    fetch(`/api/public/availability?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("availability_failed");
        const parsed = z.object({ slots: z.array(z.object({ startAt: z.string(), endAt: z.string(), staffId: z.guid(), staffName: z.string() })) }).parse(payload);
        setSlots(parsed.slots);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Não foi possível consultar horários.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [date, locationId, open, serviceId, slug, staffId, timezone]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  function refreshAvailability(next: { serviceId?: string; staffId?: string | null; date?: string }) {
    if (next.serviceId !== undefined) setServiceId(next.serviceId);
    if (next.staffId !== undefined) setStaffId(next.staffId);
    if (next.date !== undefined) setDate(next.date);
    setSlot(null);
    setSlots([]);
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
    setStatusMessage("Agendamento criado e agenda atualizada.");
    router.refresh();
  }

  return (
    <>
      <button
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-bold text-white disabled:bg-zinc-400"
        disabled={!locationId || !activeServices.length}
        onClick={() => {
          setOpen(true);
          setLoading(true);
          setError(null);
        }}
        type="button"
      >
        <CalendarPlus aria-hidden="true" size={18} /> Novo agendamento
      </button>
      {statusMessage ? <span className="sr-only" role="status">{statusMessage}</span> : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} role="presentation">
          <section aria-labelledby="quick-booking-title" aria-modal="true" className="h-dvh w-full max-w-lg overflow-y-auto bg-[var(--background)] p-5 shadow-2xl sm:p-7" role="dialog">
            <header className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-zinc-500">Cadastro rápido</p><h2 className="mt-1 text-2xl font-bold tracking-tight" id="quick-booking-title">Novo agendamento</h2></div><button aria-label="Fechar" className="grid size-11 place-items-center rounded-xl hover:bg-white" onClick={() => setOpen(false)} type="button"><X aria-hidden="true" size={21} /></button></header>
            <form className="mt-7 grid gap-5" onSubmit={submit}>
              <label className="grid gap-2 text-sm font-semibold">Serviço<select className="min-h-12 rounded-xl border border-zinc-200 bg-white px-3" onChange={(event) => refreshAvailability({ serviceId: event.target.value, staffId: null })} value={serviceId}>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
              <label className="grid gap-2 text-sm font-semibold">Profissional<select className="min-h-12 rounded-xl border border-zinc-200 bg-white px-3" onChange={(event) => refreshAvailability({ staffId: event.target.value || null })} value={staffId ?? ""}><option value="">Qualquer disponível</option>{eligibleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
              <label className="grid gap-2 text-sm font-semibold">Data<input className="min-h-12 rounded-xl border border-zinc-200 bg-white px-3" min={initialDate} onChange={(event) => refreshAvailability({ date: event.target.value })} type="date" value={date} /></label>
              <fieldset><legend className="text-sm font-semibold">Horário</legend><div className="mt-2 grid grid-cols-4 gap-2" aria-live="polite">{loading ? Array.from({ length: 8 }, (_, index) => <span className="h-11 animate-pulse rounded-xl bg-zinc-200" key={index} />) : slots.length ? slots.slice(0, 16).map((item) => <button aria-pressed={slot?.startAt === item.startAt && slot.staffId === item.staffId} className={cn("min-h-11 rounded-xl border text-sm font-bold", slot?.startAt === item.startAt && slot.staffId === item.staffId ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white hover:border-zinc-400")} key={`${item.startAt}-${item.staffId}`} onClick={() => setSlot(item)} type="button">{formatTimeInTimezone(item.startAt, timezone)}</button>) : <p className="col-span-4 rounded-xl bg-white p-4 text-sm text-zinc-500">Sem horários nesta data.</p>}</div></fieldset>
              {slot ? <p className="flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-800"><Clock3 aria-hidden="true" size={17} />{formatTimeInTimezone(slot.startAt, timezone)} com {slot.staffName}</p> : null}
              <div className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5"><label className="grid gap-2 text-sm font-semibold">Cliente<input className="min-h-11 rounded-xl border border-zinc-200 px-3" autoComplete="name" name="customerName" required /></label><label className="grid gap-2 text-sm font-semibold">Telefone<input className="min-h-11 rounded-xl border border-zinc-200 px-3" autoComplete="tel" inputMode="tel" name="customerPhone" placeholder="(11) 99999-9999" required /></label><label className="grid gap-2 text-sm font-semibold">E-mail <span className="font-normal text-zinc-500">(opcional)</span><input className="min-h-11 rounded-xl border border-zinc-200 px-3" autoComplete="email" name="customerEmail" type="email" /></label><label className="grid gap-2 text-sm font-semibold">Observação interna <span className="font-normal text-zinc-500">(opcional)</span><textarea className="min-h-20 rounded-xl border border-zinc-200 p-3" maxLength={2000} name="internalNotes" /></label></div>
              {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800" role="alert">{error}</p> : null}
              <button className="min-h-12 rounded-xl bg-zinc-950 px-5 font-bold text-white disabled:bg-zinc-300" disabled={!slot || submitting}>{submitting ? "Criando…" : "Confirmar agendamento"}</button>
              <p className="flex items-center gap-2 text-xs text-zinc-500"><CheckCircle2 aria-hidden="true" size={15} />Disponibilidade será validada novamente ao confirmar.</p>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
