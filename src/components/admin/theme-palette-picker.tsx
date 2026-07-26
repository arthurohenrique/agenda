import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { updateTenantPaletteAction } from "@/app/actions/settings";
import { tenantPalettes, type TenantPalette } from "@/lib/tenant-palettes";

interface ThemePalettePickerProps {
  slug: string;
  selectedPaletteId: TenantPalette["id"] | null;
}

export function ThemePalettePicker({ slug, selectedPaletteId }: ThemePalettePickerProps) {
  return (
    <section aria-labelledby="palette-heading" className="premium-card mt-6 p-7">
      <div className="max-w-2xl">
        <p className="page-eyebrow">Identidade visual</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight" id="palette-heading">Paleta 60 · 30 · 10</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">60% base, 30% cor principal e 10% destaque. A escolha atualiza painel e página de agendamento.</p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tenantPalettes.map((palette) => {
          const selected = palette.id === selectedPaletteId;
          const optionStyle = {
            backgroundColor: palette.surface,
            borderColor: selected ? palette.primary : "#DFE3DD",
            boxShadow: selected ? `0 0 0 3px ${palette.primary}2A` : undefined,
          } as CSSProperties;

          return (
            <form action={updateTenantPaletteAction} key={palette.id}>
              <input name="slug" type="hidden" value={slug} />
              <input name="paletteId" type="hidden" value={palette.id} />
              <button aria-pressed={selected} className="palette-option min-h-44 w-full rounded-2xl border p-4 text-left" style={optionStyle} type="submit">
                <span aria-hidden="true" className="mb-5 overflow-hidden rounded-lg border border-black/10" data-palette-preview={palette.id} style={{ backgroundColor: palette.surface, display: "flex", height: "2.25rem" }}>
                  <span data-palette-segment="base" style={{ backgroundColor: palette.background, flex: "0 0 60%" }} />
                  <span data-palette-segment="primary" style={{ backgroundColor: palette.primary, flex: "0 0 30%" }} />
                  <span data-palette-segment="accent" style={{ backgroundColor: palette.accent, flex: "0 0 10%" }} />
                </span>
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-bold" style={{ color: palette.text }}>{palette.name}</span>
                    <span className="mt-1 block text-xs leading-5 opacity-60" style={{ color: palette.text }}>{palette.description}</span>
                  </span>
                  {selected ? <span className="grid size-6 place-items-center rounded-full text-white" style={{ backgroundColor: palette.primary }}><Check aria-hidden="true" size={14} /></span> : null}
                </span>
              </button>
            </form>
          );
        })}
      </div>
      {selectedPaletteId === null ? <p className="mt-4 text-xs text-zinc-500">Paleta atual personalizada. Escolha uma opção para padronizar o 60 · 30 · 10.</p> : null}
    </section>
  );
}
