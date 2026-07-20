import { Ban } from "lucide-react";
import { createCalendarBlockAction } from "@/app/actions/blocks";
import type { AdminStaff } from "@/features/catalog/admin-queries";

export function QuickBlock({
  date,
  locationId,
  slug,
  staff,
}: {
  date: string;
  locationId: string | null;
  slug: string;
  staff: AdminStaff[];
}) {
  if (!locationId || !staff.length) return null;
  return (
    <details className="relative">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-700 hover:bg-zinc-50">
        <Ban aria-hidden="true" size={17} /> Bloquear
      </summary>
      <div className="absolute right-0 top-13 z-30 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl">
        <h2 className="font-bold">Bloquear horário</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">Conflitos com atendimentos são impedidos no banco.</p>
        <form action={createCalendarBlockAction} className="mt-4 grid gap-3">
          <input name="slug" type="hidden" value={slug} />
          <input name="locationId" type="hidden" value={locationId} />
          <label className="grid gap-1.5 text-xs font-semibold">Profissional<select className="min-h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm" name="staffId" required>{staff.filter((person) => person.is_active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label className="grid gap-1.5 text-xs font-semibold">Data<input className="min-h-10 rounded-xl border border-zinc-200 px-3 text-sm" defaultValue={date} name="date" required type="date" /></label>
          <div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-xs font-semibold">Início<input className="min-h-10 rounded-xl border border-zinc-200 px-3 text-sm" defaultValue="12:00" name="startsAt" required type="time" /></label><label className="grid gap-1.5 text-xs font-semibold">Fim<input className="min-h-10 rounded-xl border border-zinc-200 px-3 text-sm" defaultValue="13:00" name="endsAt" required type="time" /></label></div>
          <label className="grid gap-1.5 text-xs font-semibold">Motivo<input className="min-h-10 rounded-xl border border-zinc-200 px-3 text-sm" defaultValue="Indisponível" maxLength={120} name="title" required /></label>
          <button className="min-h-10 rounded-xl bg-zinc-950 px-4 text-sm font-bold text-white">Criar bloqueio</button>
        </form>
      </div>
    </details>
  );
}
