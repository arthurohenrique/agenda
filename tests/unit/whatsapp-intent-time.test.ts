import { describe, expect, it } from "vitest";
import { parsePeriod, parseTime, periodHours } from "@/features/whatsapp/domain/intent/time";

describe("parser de hora pt-BR", () => {
  it("lê os formatos usuais", () => {
    expect(parseTime("às 14h")).toMatchObject({ time: "14:00", matched: "14h" });
    expect(parseTime("14:30")).toMatchObject({ time: "14:30" });
    expect(parseTime("14h30")).toMatchObject({ time: "14:30" });
    expect(parseTime("as 9 horas")).toMatchObject({ time: "09:00" });
    expect(parseTime("às 14")).toMatchObject({ time: "14:00" });
    expect(parseTime("meio-dia")).toMatchObject({ time: "12:00" });
    expect(parseTime("meia noite")).toMatchObject({ time: "00:00" });
  });

  it("soma 12 quando o período pede", () => {
    expect(parseTime("2 da tarde")?.time).toBe("14:00");
    expect(parseTime("às 2h30 da tarde")?.time).toBe("14:30");
    expect(parseTime("8 da noite")?.time).toBe("20:00");
    expect(parseTime("9 da manhã")?.time).toBe("09:00");
    expect(parseTime("14 da tarde")?.time).toBe("14:00");
  });

  it("não confunde data com hora nem aceita hora impossível", () => {
    expect(parseTime("às 15 de setembro")).toBeNull();
    expect(parseTime("as 15/09")).toBeNull();
    expect(parseTime("25h")).toBeNull();
    expect(parseTime("14:75")).toBeNull();
    expect(parseTime("sexta com a Maria")).toBeNull();
  });

  it("lê o período do dia", () => {
    expect(parsePeriod("amanhã de manhã")).toBe("morning");
    expect(parsePeriod("bem cedo")).toBe("morning");
    expect(parsePeriod("à tarde")).toBe("afternoon");
    expect(parsePeriod("de noite")).toBe("evening");
    expect(parsePeriod("sexta às 14h")).toBeNull();
    expect(periodHours("afternoon")).toEqual({ from: 12, to: 18 });
  });
});
