import { describe, expect, it } from "vitest";
import { isAllowedPublicSlug, normalizeSlug } from "@/lib/slugs";

describe("slugs públicos", () => {
  it("normaliza acentos, espaços e pontuação", () => {
    expect(normalizeSlug("  Salão da Ana!  ")).toBe("salao-da-ana");
  });

  it.each(["app", "api", "auth", "admin", "configuracoes", "definir-senha"])(
    "bloqueia rota reservada %s",
    (slug) => expect(isAllowedPublicSlug(slug)).toBe(false),
  );

  it("aceita slug normalizado de estabelecimento", () => {
    expect(isAllowedPublicSlug("barbearia-central")).toBe(true);
  });
});
