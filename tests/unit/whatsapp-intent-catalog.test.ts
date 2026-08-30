import { describe, expect, it } from "vitest";
import { matchCatalog } from "@/features/whatsapp/domain/intent/catalog";

const services = [
  { id: "s1", name: "Corte" },
  { id: "s2", name: "Barba" },
  { id: "s3", name: "Corte e barba" },
  { id: "s4", name: "Coloração" },
  { id: "s5", name: "Tratamento de queda" },
];

describe("casamento de nomes do catálogo", () => {
  it("prefere o nome inteiro à sobreposição parcial", () => {
    expect(matchCatalog("quero um corte", services)).toMatchObject({ kind: "match", item: { id: "s1" } });
    expect(matchCatalog("corte e barba sexta", services)).toMatchObject({ kind: "match", item: { id: "s3" } });
    expect(matchCatalog("fazer a barba", services)).toMatchObject({ kind: "match", item: { id: "s2" } });
  });

  it("ignora acentos e aceita plural por prefixo", () => {
    expect(matchCatalog("coloracao amanha", services)).toMatchObject({ kind: "match", item: { id: "s4" } });
    expect(matchCatalog("quero fazer colorações", services)).toMatchObject({ kind: "match", item: { id: "s4" } });
  });

  it("exige metade do nome e não casa por conectivo", () => {
    expect(matchCatalog("tratamento", services)).toMatchObject({ kind: "match", item: { id: "s5" } });
    expect(matchCatalog("de", services)).toEqual({ kind: "none" });
    expect(matchCatalog("quero agendar amanhã", services)).toEqual({ kind: "none" });
  });

  it("devolve ambiguidade em empate", () => {
    const staff = [
      { id: "p1", name: "Maria" },
      { id: "p2", name: "Maria" },
      { id: "p3", name: "Maria Clara" },
    ];
    expect(matchCatalog("com a maria", staff)).toMatchObject({
      kind: "ambiguous",
      items: [{ id: "p1" }, { id: "p2" }],
    });
    expect(matchCatalog("com a maria clara", staff)).toMatchObject({ kind: "match", item: { id: "p3" } });

    const twoCortes = [
      { id: "a", name: "Corte feminino" },
      { id: "b", name: "Corte masculino" },
    ];
    expect(matchCatalog("corte", twoCortes)).toMatchObject({ kind: "ambiguous" });
    expect(matchCatalog("corte feminino", twoCortes)).toMatchObject({ kind: "match", item: { id: "a" } });
  });
});
