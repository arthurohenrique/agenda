import { describe, expect, it } from "vitest";
import { parseIntent, parseIntentKeyword } from "@/features/whatsapp/domain/intent";

// 2026-08-31 é uma segunda-feira.
const today = "2026-08-31";
const services = [
  { id: "s1", name: "Corte feminino" },
  { id: "s2", name: "Escova" },
  { id: "s3", name: "Coloração" },
  { id: "s4", name: "Corte com Maria" },
];
const staff = [
  { id: "p1", name: "Maria" },
  { id: "p2", name: "Joana" },
];

describe("parser de intenção", () => {
  it("extrai tudo da frase-alvo em uma passada", () => {
    const result = parseIntent("quero agendar corte feminino para sexta às 14h com a Maria", {
      today,
      services,
      staff,
    });
    expect(result).toMatchObject({
      intent: "book",
      service: { id: "s1" },
      staff: { id: "p1" },
      date: "2026-09-04",
      time: "14:00",
      period: null,
      staffAny: false,
      matched: true,
    });
  });

  it("casa o serviço antes da profissional e remove o trecho", () => {
    const result = parseIntent("corte com maria amanhã", { today, services, staff });
    expect(result.service?.id).toBe("s4");
    expect(result.staff).toBeNull();
    expect(result.date).toBe("2026-09-01");
  });

  it("não deixa o número da data virar hora nem parte de nome", () => {
    const result = parseIntent("escova dia 15 as 10", { today, services, staff });
    expect(result).toMatchObject({ service: { id: "s2" }, date: "2026-09-15", time: "10:00" });
  });

  it("devolve candidatas quando o nome é ambíguo", () => {
    const twoMarias = [...staff, { id: "p3", name: "Maria" }];
    const result = parseIntent("coloração com a maria", { today, services, staff: twoMarias });
    expect(result.service?.id).toBe("s3");
    expect(result.staff).toBeNull();
    expect(result.staffCandidates.map((person) => person.id)).toEqual(["p1", "p3"]);
    expect(result.matched).toBe(true);
  });

  it("reconhece período e ausência de preferência", () => {
    const result = parseIntent("amanhã de tarde, tanto faz o profissional", { today, services, staff });
    expect(result).toMatchObject({ date: "2026-09-01", period: "afternoon", staffAny: true, staff: null });
  });

  it("não extrai nada de uma frase sem sinal", () => {
    const result = parseIntent("bom dia, tudo bem?", { today, services, staff });
    expect(result.matched).toBe(false);
    expect(result).toMatchObject({ intent: null, service: null, staff: null, date: null, time: null, period: null });
  });

  it("classifica a intenção por prioridade", () => {
    expect(parseIntentKeyword("quero falar com atendente")).toBe("human");
    expect(parseIntentKeyword("preciso cancelar meu horário")).toBe("cancel");
    expect(parseIntentKeyword("dá pra remarcar?")).toBe("reschedule");
    expect(parseIntentKeyword("meus agendamentos")).toBe("upcoming");
    expect(parseIntentKeyword("quero marcar um horário")).toBe("book");
    expect(parseIntentKeyword("Ana Silva")).toBeNull();
  });
});
