import { describe, expect, it } from "vitest";
import { fromLlmExtraction, mergeParsed } from "@/features/whatsapp/domain/intent/llm-mapping";
import { parseIntent } from "@/features/whatsapp/domain/intent";

// 2026-08-31 é segunda-feira.
const today = "2026-08-31";
const services = [{ id: "s1", name: "Corte" }, { id: "s2", name: "Corte e barba" }];
const staff = [{ id: "p1", name: "Rafael" }, { id: "p2", name: "Diego" }];
const ctx = { today, services, staff };

describe("mapeamento da extração do LLM", () => {
  it("resolve nomes pelo catálogo e nunca confia em id", () => {
    const parsed = fromLlmExtraction({
      intent: "book",
      service_name: "corte e barba",
      staff_name: "Rafael",
      date: "2026-09-04",
      time: "14:00",
    }, ctx);
    expect(parsed).toMatchObject({
      intent: "book",
      service: { id: "s2" },
      staff: { id: "p1" },
      date: "2026-09-04",
      time: "14:00",
      matched: true,
    });
  });

  it("nome de profissional que não existe vira requestedStaffName", () => {
    const invented = fromLlmExtraction({ service_name: "Corte", staff_name: "Raul" }, ctx);
    expect(invented.staff).toBeNull();
    expect(invented.requestedStaffName).toBe("Raul");

    const explicit = fromLlmExtraction({ requested_staff_name: "joão" }, ctx);
    expect(explicit.requestedStaffName).toBe("João");
  });

  it("descarta data fora da janela e hora impossível", () => {
    expect(fromLlmExtraction({ date: "2026-08-01" }, ctx).date).toBeNull();
    expect(fromLlmExtraction({ date: "2027-05-01" }, ctx).date).toBeNull();
    expect(fromLlmExtraction({ date: "2026-09-04" }, ctx).date).toBe("2026-09-04");
    expect(fromLlmExtraction({ date: "amanha" }, ctx).date).toBe("2026-09-01");
    expect(fromLlmExtraction({ time: "25:00" }, ctx).time).toBeNull();
    expect(fromLlmExtraction({ time: "9:30" }, ctx).time).toBe("09:30");
  });

  it("serviço parecido com mais de um vira candidatas", () => {
    const twoCortes = [{ id: "a", name: "Corte feminino" }, { id: "b", name: "Corte masculino" }];
    const parsed = fromLlmExtraction({ service_name: "corte" }, { today, services: twoCortes, staff });
    expect(parsed.service).toBeNull();
    expect(parsed.serviceCandidates.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("na fusão o modelo manda e as regras preenchem lacunas", () => {
    const rules = parseIntent("sexta às 14h", ctx);
    const llm = fromLlmExtraction({ service_name: "Corte", staff_any: true }, ctx);
    const merged = mergeParsed(llm, rules);
    expect(merged).toMatchObject({
      service: { id: "s1" },
      staffAny: true,
      date: "2026-09-04",
      time: "14:00",
      matched: true,
    });
  });

  it("o handoff das regras nunca é rebaixado pelo modelo", () => {
    const rules = parseIntent("quero falar com atendente", ctx);
    const llm = fromLlmExtraction({ intent: "book" }, ctx);
    expect(mergeParsed(llm, rules).intent).toBe("human");
  });
});
