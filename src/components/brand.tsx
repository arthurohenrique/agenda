import { CalendarDays } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="inline-flex items-center gap-3" aria-label="Agenda">
      <span className="grid size-10 place-items-center rounded-xl bg-zinc-950 text-white">
        <CalendarDays aria-hidden="true" size={20} strokeWidth={2.2} />
      </span>
      {compact ? null : <span className="text-lg font-bold tracking-tight">Agenda</span>}
    </div>
  );
}
