import { describe, expect, it } from "vitest";
import { formatMoney, parseBrlToCents } from "@/lib/money";

describe("dinheiro", () => {
  it("converte entrada brasileira para centavos", () => {
    expect(parseBrlToCents("1.234,56")).toBe(123456);
    expect(parseBrlToCents("50")).toBe(5000);
  });

  it("rejeita valores inválidos", () => {
    expect(parseBrlToCents("-10,00")).toBeNull();
    expect(parseBrlToCents("dez")).toBeNull();
  });

  it("formata centavos em BRL", () => {
    expect(formatMoney(7500)).toContain("75,00");
  });
});
