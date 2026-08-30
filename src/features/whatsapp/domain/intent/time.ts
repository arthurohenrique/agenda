import { normalizeText } from "@/lib/text/normalize";
import { tokenize } from "./tokens";

export interface ParsedTime {
  // HH:mm no fuso do estabelecimento.
  time: string;
  matched: string;
}

export type DayPeriod = "morning" | "afternoon" | "evening";

function clock(hour: number, minute: number): string | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// Horas em pt-BR: "14h", "14:30", "14h30", "14 horas", "às 14", "2 da tarde",
// "meio-dia". Hora com período soma 12 quando faz sentido ("2 da tarde" é
// 14:00; "14 da tarde" segue 14:00).
export function parseTime(text: string): ParsedTime | null {
  const normalized = normalizeText(text);

  const named = /\b(meio[- ]dia|meia[- ]noite)\b/.exec(normalized);
  if (named?.[1]) {
    return { time: named[1].startsWith("meio") ? "12:00" : "00:00", matched: named[1] };
  }

  const withPeriod = /\b(\d{1,2})(?:[:h](\d{2}))?\s*(?:h|hs|hrs|horas?)?\s+(?:da|de|pela)\s+(manha|tarde|noite)\b/
    .exec(normalized);
  if (withPeriod?.[1] && withPeriod[3]) {
    let hour = Number(withPeriod[1]);
    const minute = Number(withPeriod[2] ?? "0");
    if (withPeriod[3] !== "manha" && hour < 12) hour += 12;
    const time = clock(hour, minute);
    return time ? { time, matched: withPeriod[0] } : null;
  }

  const explicit = /\b(\d{1,2})(?:[:h](\d{2})|\s*(?:h|hs|hrs|horas?))\b/.exec(normalized);
  if (explicit?.[1]) {
    const time = clock(Number(explicit[1]), Number(explicit[2] ?? "0"));
    return time ? { time, matched: explicit[0] } : null;
  }

  // "às 14" sem sufixo. Não confundir com "às 15 de setembro" nem "às 15/09".
  const bare = /\b(?:as|a)\s+(\d{1,2})\b(?!\s*(?:de\s+[a-z]|[/.-]\d))/.exec(normalized);
  if (bare?.[1]) {
    const time = clock(Number(bare[1]), 0);
    return time ? { time, matched: bare[0] } : null;
  }

  return null;
}

export function parsePeriod(text: string): DayPeriod | null {
  const tokens = new Set(tokenize(text));
  if (tokens.has("manha") || tokens.has("cedo")) return "morning";
  if (tokens.has("tarde")) return "afternoon";
  if (tokens.has("noite")) return "evening";
  return null;
}

// Faixa local de cada período, em hora inteira [from, to).
export function periodHours(period: DayPeriod): { from: number; to: number } {
  if (period === "morning") return { from: 0, to: 12 };
  if (period === "afternoon") return { from: 12, to: 18 };
  return { from: 18, to: 24 };
}
