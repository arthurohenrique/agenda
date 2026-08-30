import { describe, expect, it } from "vitest";
import {
  normalizeCommand,
  normalizeText,
  normalizeWords,
  stripDiacritics,
} from "@/lib/text/normalize";

describe("normalização de texto pt-BR", () => {
  it("remove acentos sem alterar o restante", () => {
    expect(stripDiacritics("Coloração São João")).toBe("Coloracao Sao Joao");
  });

  it("baixa caixa, apara e colapsa espaços", () => {
    expect(normalizeText("  Quero   Agendar  ÀS 14h ")).toBe("quero agendar as 14h");
  });

  it("descarta só a pontuação final em comandos", () => {
    expect(normalizeCommand("Menu!")).toBe("menu");
    expect(normalizeCommand("falar com alguém?!")).toBe("falar com alguem");
    expect(normalizeCommand("R. Silva")).toBe("r. silva");
  });

  it("reduz rótulos a palavras para comparação", () => {
    expect(normalizeWords("Sim, cancelar")).toBe("sim cancelar");
    expect(normalizeWords("Corte & barba — 14h")).toBe("corte barba 14h");
    expect(normalizeWords("   ")).toBe("");
  });
});
