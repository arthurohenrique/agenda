import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";

describe("normalização de telefone", () => {
  it("converte telefone brasileiro para E.164", () => {
    expect(normalizePhone("(11) 99999-0001")).toBe("+5511999990001");
  });

  it("rejeita número incompleto", () => {
    expect(normalizePhone("1234")).toBeNull();
  });
});
