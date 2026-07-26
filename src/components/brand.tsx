import { CalendarDays } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="inline-flex items-center gap-3" aria-label="Agenda">
      <span className="relative grid size-10 place-items-center rounded-[14px] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm">
        <CalendarDays aria-hidden="true" size={19} strokeWidth={2} />
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--surface)] bg-emerald-400" />
      </span>
      {compact ? null : <span className="text-lg font-semibold tracking-[-0.035em]">Agenda</span>}
    </div>
  );
}
