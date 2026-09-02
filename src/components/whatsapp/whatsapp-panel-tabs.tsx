import Link from "next/link";

export type WhatsAppPanelTab = "painel" | "conversas";

const tabs = [
  { value: "painel", label: "Canal" },
  { value: "conversas", label: "Conversas" },
] as const;

export function WhatsAppPanelTabs({
  active,
  slug,
}: {
  active: WhatsAppPanelTab;
  slug: string;
}) {
  return (
    <nav aria-label="Seções do WhatsApp" className="flex gap-2 border-b border-zinc-200">
      {tabs.map((tab) => {
        const selected = tab.value === active;
        return (
          <Link
            aria-current={selected ? "page" : undefined}
            className={[
              "-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition",
              selected
                ? "border-[var(--primary)] text-[var(--foreground)]"
                : "border-transparent text-zinc-500 hover:text-zinc-800",
            ].join(" ")}
            href={`/app/${slug}/whatsapp?aba=${tab.value}`}
            key={tab.value}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
