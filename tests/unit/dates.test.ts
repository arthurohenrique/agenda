import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDateBounds, todayInTimezone } from "@/lib/dates";

describe("datas ancoradas no fuso do estabelecimento", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("depois das 21h em São Paulo o dia UTC já virou; o do tenant não", () => {
    // 2026-08-31 23:30 em São Paulo = 2026-09-01 02:30 UTC.
    vi.setSystemTime(new Date("2026-09-01T02:30:00.000Z"));
    expect(todayInTimezone("America/Sao_Paulo")).toBe("2026-08-31");
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("no início do dia local o dia UTC ainda é o mesmo", () => {
    // 2026-08-31 01:00 em São Paulo = 2026-08-31 04:00 UTC.
    vi.setSystemTime(new Date("2026-08-31T04:00:00.000Z"));
    expect(todayInTimezone("America/Sao_Paulo")).toBe("2026-08-31");
  });

  it("os limites do dia local viram instantes UTC corretos", () => {
    expect(localDateBounds("2026-08-31", "America/Sao_Paulo")).toEqual({
      from: "2026-08-31T03:00:00.000Z",
      to: "2026-09-01T03:00:00.000Z",
    });
  });
});
