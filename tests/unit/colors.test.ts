import { describe, expect, it } from "vitest";
import { contrastRatio, hasAaContrast } from "@/lib/colors";

describe("contraste de tema", () => {
  it("aceita preto sobre branco em WCAG AA", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 3);
    expect(hasAaContrast("#000000", "#FFFFFF")).toBe(true);
  });

  it("rejeita cinza claro sobre branco", () => {
    expect(hasAaContrast("#DDDDDD", "#FFFFFF")).toBe(false);
  });

  it("rejeita formato inválido", () => {
    expect(contrastRatio("red", "#FFFFFF")).toBeNull();
  });
});
