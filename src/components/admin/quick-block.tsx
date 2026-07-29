"use client";

import { useState } from "react";
import { Ban, CalendarOff, Clock3, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { createCalendarBlockAction, removeCalendarBlockAction } from "@/app/actions/blocks";
import type { AgendaCalendarBlock } from "@/features/appointments/queries";
import type { AdminStaff } from "@/features/catalog/admin-queries";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { formatTimeInTimezone } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Interval = { startsAt: string; endsAt: string };

const initialIntervals: Interval[] = [{ startsAt: "12:00", endsAt: "13:00" }];

function blockPeriodLabel(block: AgendaCalendarBlock, timezone: string) {
  const startsAt = formatTimeInTimezone(block.startsAt, timezone);
  const endsAt = formatTimeInTimezone(block.endsAt, timezone);
  return startsAt === "00:00" && endsAt === "00:00"
    ? "Dia inteiro"
    : `${startsAt}–${endsAt}`;
}

export function QuickBlock({
  blocks,
  date,
  locationId,
  slug,
  staff,
  timezone,
}: {
  blocks: AgendaCalendarBlock[];
  date: string;
  locationId: string | null;
  slug: string;
  staff: AdminStaff[];
  timezone: string;
}) {
  const activeStaff = staff.filter((person) => person.is_active);
  const [scope, setScope] = useState<"all" | "staff">("all");
  const [allDay, setAllDay] = useState(true);
  const [intervals, setIntervals] = useState<Interval[]>(initialIntervals);
  const [open, setOpen] = useState(false);
  const available = Boolean(locationId && activeStaff.length);
  const { dialogRef, triggerRef } = useModalFocus<HTMLButtonElement, HTMLElement>({
    onClose: () => setOpen(false),
    open: open && available,
  });

  if (!available || !locationId) return null;

  function updateInterval(index: number, field: keyof Interval, value: string) {
    setIntervals((current) => current.map((interval, position) => (
      position === index ? { ...interval, [field]: value } : interval
    )));
  }

  return (
    <div className="relative w-full sm:w-auto">
      <button
        aria-controls="quick-block-dialog"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-700 hover:bg-zinc-50 sm:w-auto"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        <CalendarOff aria-hidden="true" size={17} /> Disponibilidade
      </button>
      <div
        aria-hidden={!open}
        className={cn("fixed inset-0 z-50 flex items-end justify-end bg-black/30 p-4 sm:p-6", !open && "hidden")}
        onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}
        role="presentation"
      >
          <section
            aria-labelledby="quick-block-title"
            aria-modal="true"
            className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl sm:max-h-[calc(100dvh-3rem)] sm:max-w-[420px]"
            id="quick-block-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-white pb-2">
          <h2 className="font-bold" id="quick-block-title">Folga e fechamento</h2>
          <button
            aria-label="Fechar disponibilidade"
            className="grid size-11 shrink-0 place-items-center rounded-xl text-zinc-600 hover:bg-zinc-100"
            data-modal-initial-focus
            onClick={() => setOpen(false)}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        </div>
        <p className="mt-1 text-sm leading-6 text-zinc-500">Feche dia inteiro, alguns horários ou toda agenda. Atendimentos já confirmados não são cancelados.</p>

        <form action={createCalendarBlockAction} className="mt-4 grid gap-4">
          <input name="slug" type="hidden" value={slug} />
          <input name="locationId" type="hidden" value={locationId} />
          <input name="allDay" type="hidden" value={String(allDay)} />
          <input name="intervals" type="hidden" value={JSON.stringify(intervals)} />

          <label className="grid gap-1.5 text-sm font-semibold">
            Fechar para
            <select className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-sm" name="scope" onChange={(event) => setScope(event.target.value as "all" | "staff")} value={scope}>
              <option value="all">Agenda inteira · todos profissionais</option>
              <option value="staff">Folga individual</option>
            </select>
          </label>

          {scope === "staff" ? (
            <label className="grid gap-1.5 text-sm font-semibold">
              Profissional
              <select className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-sm" name="staffId" required>
                {activeStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
          ) : null}

          <label className="grid gap-1.5 text-sm font-semibold">Data<input className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 px-3 text-sm" defaultValue={date} name="date" required type="date" /></label>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">Período</legend>
            <div className="grid grid-cols-2 gap-2">
              <button aria-pressed={allDay} className={cn("min-h-11 rounded-xl border px-3 text-sm font-bold", allDay ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 text-zinc-600")} onClick={() => setAllDay(true)} type="button">Dia inteiro</button>
              <button aria-pressed={!allDay} className={cn("min-h-11 rounded-xl border px-3 text-sm font-bold", !allDay ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 text-zinc-600")} onClick={() => setAllDay(false)} type="button">Alguns horários</button>
            </div>
            {!allDay ? (
              <div className="grid gap-2 rounded-xl bg-zinc-50 p-3">
                {intervals.map((interval, index) => (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" key={index}>
                    <label className="grid min-w-0 gap-1 text-sm font-semibold text-zinc-600">Início<input className="min-h-11 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 text-sm" onChange={(event) => updateInterval(index, "startsAt", event.target.value)} type="time" value={interval.startsAt} /></label>
                    <label className="grid min-w-0 gap-1 text-sm font-semibold text-zinc-600">Fim<input className="min-h-11 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 text-sm" onChange={(event) => updateInterval(index, "endsAt", event.target.value)} type="time" value={interval.endsAt} /></label>
                    <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 sm:size-11 sm:p-0" disabled={intervals.length === 1} onClick={() => setIntervals((current) => current.filter((_, position) => position !== index))} type="button"><Trash2 aria-hidden="true" size={15} /><span className="sm:sr-only">Remover horário</span></button>
                  </div>
                ))}
                <button className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700 hover:bg-zinc-100" disabled={intervals.length >= 12} onClick={() => setIntervals((current) => [...current, { startsAt: "14:00", endsAt: "15:00" }])} type="button"><Plus aria-hidden="true" size={14} /> Adicionar horário</button>
              </div>
            ) : null}
          </fieldset>

          <label className="grid gap-1.5 text-sm font-semibold">Motivo <span className="font-normal text-zinc-500">(opcional)</span><input className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 px-3 text-sm" maxLength={120} name="reason" placeholder={scope === "all" ? "Ex.: Feriado" : "Ex.: Consulta"} /></label>
          <button className="min-h-11 rounded-xl bg-zinc-950 px-4 text-sm font-bold text-white">{scope === "all" ? "Fechar agenda" : allDay ? "Registrar folga" : "Bloquear horários"}</button>
        </form>

        <section className="mt-5 border-t border-zinc-100 pt-4" aria-labelledby="active-blocks-title">
          <div className="flex items-center gap-2"><Ban aria-hidden="true" className="text-zinc-500" size={15} /><h3 className="text-sm font-bold" id="active-blocks-title">Fechamentos neste período</h3></div>
          {blocks.length ? <ul className="mt-3 grid gap-2">{blocks.map((block) => (
            <li className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 p-3" key={block.id}>
              <div className="min-w-0"><p className="truncate text-sm font-bold text-zinc-800">{block.title}{block.staffName ? ` · ${block.staffName}` : ""}</p><p className="mt-0.5 flex items-center gap-1 text-sm text-zinc-500"><Clock3 aria-hidden="true" size={12} />{blockPeriodLabel(block, timezone)}</p></div>
              <form action={removeCalendarBlockAction}><input name="slug" type="hidden" value={slug} /><input name="blockId" type="hidden" value={block.id} /><button className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-bold text-zinc-700 hover:bg-white" title="Reabrir este período"><RotateCcw aria-hidden="true" size={14} /> Reabrir</button></form>
            </li>
          ))}</ul> : <p className="mt-2 text-sm text-zinc-500">Nenhum fechamento neste dia.</p>}
        </section>
          </section>
      </div>
    </div>
  );
}
