import { describe, expect, it } from "vitest";
import { parseDate } from "@/features/whatsapp/domain/intent/date";

// 2026-08-31 é uma segunda-feira.
const today = "2026-08-31";

describe("parser de data pt-BR", () => {
  it("lê hoje, amanhã e depois de amanhã", () => {
    expect(parseDate("quero hoje", { today })).toMatchObject({ date: "2026-08-31", matched: "hoje" });
    expect(parseDate("Amanhã de tarde", { today })).toMatchObject({ date: "2026-09-01" });
    expect(parseDate("depois de amanhã", { today })).toMatchObject({ date: "2026-09-02", matched: "depois de amanha" });
  });

  it("lê dd/mm, nunca mm/dd, e joga data passada para o ano seguinte", () => {
    expect(parseDate("dia 15/09 as 14h", { today })?.date).toBe("2026-09-15");
    expect(parseDate("15.09.2026", { today })?.date).toBe("2026-09-15");
    expect(parseDate("15/09/27", { today })?.date).toBe("2027-09-15");
    expect(parseDate("10/08", { today })?.date).toBe("2027-08-10");
    expect(parseDate("31/02", { today })).toBeNull();
  });

  it("lê dia com nome do mês", () => {
    expect(parseDate("15 de setembro", { today })?.date).toBe("2026-09-15");
    expect(parseDate("3 set", { today })?.date).toBe("2026-09-03");
    expect(parseDate("10 de agosto", { today })?.date).toBe("2027-08-10");
    expect(parseDate("1 de janeiro de 2027", { today })?.date).toBe("2027-01-01");
  });

  it("lê dia do mês corrente ou seguinte", () => {
    expect(parseDate("no dia 31", { today })?.date).toBe("2026-08-31");
    expect(parseDate("dia 15", { today })?.date).toBe("2026-09-15");
    expect(parseDate("dia 5", { today })?.date).toBe("2026-09-05");
    // Setembro não tem 31: o próximo dia 31 é o de outubro.
    expect(parseDate("dia 31", { today: "2026-09-01" })?.date).toBe("2026-10-31");
    expect(parseDate("dia 0", { today })).toBeNull();
  });

  it("lê dia da semana como a próxima ocorrência", () => {
    expect(parseDate("sexta às 14h", { today })).toMatchObject({ date: "2026-09-04", matched: "sexta" });
    expect(parseDate("sexta-feira", { today })?.date).toBe("2026-09-04");
    expect(parseDate("na segunda", { today })?.date).toBe("2026-08-31");
    expect(parseDate("próxima segunda", { today })?.date).toBe("2026-09-07");
    expect(parseDate("próxima sexta", { today })?.date).toBe("2026-09-04");
    expect(parseDate("sábado", { today })?.date).toBe("2026-09-05");
    expect(parseDate("domingo", { today })?.date).toBe("2026-09-06");
  });

  it("não inventa data quando a frase não tem nenhuma", () => {
    expect(parseDate("quero cortar o cabelo com a Maria", { today })).toBeNull();
    expect(parseDate("às 14h", { today })).toBeNull();
  });
});
