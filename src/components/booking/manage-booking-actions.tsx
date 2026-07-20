"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarSync, Clock3, XCircle } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { formatTimeInTimezone, localDateBounds } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AvailableSlot } from "@/types/domain";

export function ManageBookingActions({
  canCancel,
  canReschedule,
  initialDate,
  tenantSlug,
  timezone,
  token,
}: {
  canCancel: boolean;
  canReschedule: boolean;
  initialDate: string;
  tenantSlug: string;
  timezone: string;
  token: string;
}) {
  const router = useRouter();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);

  useEffect(() => {
    if (!rescheduling) return;
    const controller = new AbortController();
    const bounds = localDateBounds(date, timezone);
    const params = new URLSearchParams({ dateFrom: bounds.from, dateTo: bounds.to });
    fetch(`/api/bookings/${token}/availability?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("availability_failed");
        const parsed = z.object({
          slots: z.array(z.object({
            startAt: z.string(),
            endAt: z.string(),
            staffId: z.guid(),
            staffName: z.string(),
          })),
        }).parse(payload);
        setSlots(parsed.slots);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Não foi possível consultar novos horários.");
      })
      .finally(() => setLoadingSlots(false));
    return () => controller.abort();
  }, [availabilityVersion, date, rescheduling, timezone, token]);

  async function cancelBooking() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/bookings/${token}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(payload?.error ?? "Não foi possível cancelar.");
      setPending(false);
      return;
    }
    router.refresh();
  }

  async function rescheduleBooking() {
    if (!selectedSlot) return;
    setPending(true);
    setError(null);
    const response = await fetch(`/api/bookings/${token}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startsAt: selectedSlot.startAt,
        staffId: selectedSlot.staffId,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = z.object({ error: z.string() }).safeParse(payload);
      setError(parsed.success ? parsed.data.error : "Não foi possível reagendar.");
      setPending(false);
      if (response.status === 409) {
        setSelectedSlot(null);
        setSlots([]);
        setLoadingSlots(true);
        setAvailabilityVersion((value) => value + 1);
      }
      return;
    }
    const parsed = z.object({ managementToken: z.string().length(64) }).parse(payload);
    router.replace(`/${tenantSlug}/reserva/${parsed.managementToken}`);
    router.refresh();
  }

  if (rescheduling) {
    return (
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5" id="reagendar">
        <h2 className="font-bold text-blue-950">Escolha novo horário</h2>
        <p className="mt-2 text-sm leading-6 text-blue-900/75">
          Horário atual será liberado somente depois da nova reserva ser confirmada.
        </p>
        <label className="mt-4 grid max-w-xs gap-2 text-sm font-semibold text-blue-950">
          Data
          <input
            className="min-h-11 rounded-xl border border-blue-200 bg-white px-3 text-base text-zinc-950"
            min={initialDate}
            onChange={(event) => {
              setDate(event.target.value);
              setSelectedSlot(null);
              setSlots([]);
              setLoadingSlots(true);
              setError(null);
            }}
            type="date"
            value={date}
          />
        </label>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-live="polite">
          {loadingSlots ? Array.from({ length: 5 }, (_, index) => (
            <span className="h-11 animate-pulse rounded-xl bg-blue-100" key={index} />
          )) : slots.length ? slots.map((slot) => (
            <button
              aria-label={`${formatTimeInTimezone(slot.startAt, timezone)} com ${slot.staffName}`}
              aria-pressed={selectedSlot?.startAt === slot.startAt && selectedSlot.staffId === slot.staffId}
              className={cn(
                "min-h-11 rounded-xl border text-sm font-bold",
                selectedSlot?.startAt === slot.startAt && selectedSlot.staffId === slot.staffId
                  ? "border-blue-900 bg-blue-900 text-white"
                  : "border-blue-200 bg-white text-blue-950 hover:border-blue-500",
              )}
              key={`${slot.startAt}-${slot.staffId}`}
              onClick={() => setSelectedSlot(slot)}
              type="button"
            >
              {formatTimeInTimezone(slot.startAt, timezone)}
            </button>
          )) : <p className="col-span-full rounded-xl bg-white p-4 text-sm text-blue-900/70">Sem horários nesta data.</p>}
        </div>
        {selectedSlot ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-950">
            <Clock3 aria-hidden="true" size={16} /> {selectedSlot.staffName}
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm font-semibold text-red-800" role="alert">{error}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button disabled={!selectedSlot || pending} onClick={rescheduleBooking}>
            {pending ? "Reagendando…" : "Confirmar novo horário"}
          </Button>
          <Button disabled={pending} onClick={() => setRescheduling(false)} variant="secondary">
            Voltar
          </Button>
        </div>
      </div>
    );
  }

  if (confirmingCancel) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <h2 className="font-bold text-red-950">Cancelar este agendamento?</h2>
        <p className="mt-2 text-sm leading-6 text-red-900/75">
          O horário será liberado. Esta ação fica registrada no histórico.
        </p>
        <label className="mt-4 grid gap-2 text-sm font-semibold text-red-950">
          Motivo <span className="font-normal opacity-70">(opcional)</span>
          <textarea
            className="min-h-24 rounded-xl border border-red-200 bg-white p-3 text-base text-zinc-950"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </label>
        {error ? <p className="mt-3 text-sm font-semibold text-red-800" role="alert">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={pending} onClick={cancelBooking} variant="danger">
            {pending ? "Cancelando…" : "Confirmar cancelamento"}
          </Button>
          <Button disabled={pending} onClick={() => setConfirmingCancel(false)} variant="secondary">
            Manter horário
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {canReschedule ? (
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 font-semibold text-zinc-950 hover:bg-zinc-50"
          onClick={() => {
            setRescheduling(true);
            setLoadingSlots(true);
            setError(null);
          }}
          type="button"
        >
          <CalendarSync aria-hidden="true" size={18} /> Reagendar
        </button>
      ) : null}
      {canCancel ? (
        <Button onClick={() => setConfirmingCancel(true)} variant="danger">
          <XCircle aria-hidden="true" size={18} /> Cancelar
        </Button>
      ) : null}
      {!canCancel && !canReschedule ? (
        <p className="text-sm leading-6 text-zinc-500 sm:col-span-2">
          Ações online indisponíveis para este atendimento. Fale com o estabelecimento se precisar de ajuda.
        </p>
      ) : null}
    </div>
  );
}
