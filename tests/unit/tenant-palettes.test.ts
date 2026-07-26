import { describe, expect, it } from "vitest";
import {
  getTenantPalette,
  getTenantPaletteId,
  paletteHasAaContrast,
  tenantPalettes,
} from "@/lib/tenant-palettes";

describe("paletas de tenant", () => {
  it("mantém todas as paletas em contraste WCAG AA", () => {
    expect(tenantPalettes.every(paletteHasAaContrast)).toBe(true);
  });

  it("encontra a paleta pelas cores persistidas", () => {
    const palette = getTenantPalette("ocean");
    expect(palette).not.toBeNull();
    expect(getTenantPaletteId({
      primary: palette!.primary.toLowerCase(),
      accent: palette!.accent.toLowerCase(),
      background: palette!.background.toLowerCase(),
      surface: palette!.surface.toLowerCase(),
      text: palette!.text.toLowerCase(),
    })).toBe("ocean");
  });
});
