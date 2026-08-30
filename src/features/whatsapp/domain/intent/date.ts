import { addDays, addMonths, addYears, format, getDay, isValid, parseISO, setDate } from "date-fns";
import { normalizeText } from "@/lib/text/normalize";

export interface ParsedDate {
  // yyyy-MM-dd no fuso do estabelecimento.
  date: string;
  // Trecho do texto normalizado que produziu a data, para ser descartado antes
  // dos próximos parsers.
  matched: string;
}

const weekdays: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

const months: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

// Meio-dia evita que a mudança de horário de verão mova a data.
function noon(date: string): Date {
  return parseISO(`${date}T12:00:00`);
}

function iso(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function buildDate(year: number, month: number, day: number): Date | null {
  const candidate = parseISO(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00`,
  );
  if (!isValid(candidate)) return null;
  // parseISO aceita 31/02 e rola para março; a data pedida não existe.
  if (candidate.getMonth() + 1 !== month || candidate.getDate() !== day) return null;
  return candidate;
}

// Datas em pt-BR relativas e absolutas. Só `dd/mm`: mês primeiro não é lido.
// Dia da semana já passado cai na semana seguinte; "dia N" já passado, no mês
// seguinte; `dd/mm` sem ano já passado, no ano seguinte.
export function parseDate(text: string, input: { today: string }): ParsedDate | null {
  const normalized = normalizeText(text);
  const today = noon(input.today);

  const relative = /\b(depois de amanha|amanha|hoje)\b/.exec(normalized);
  if (relative?.[1]) {
    const offset = relative[1] === "hoje" ? 0 : relative[1] === "amanha" ? 1 : 2;
    return { date: iso(addDays(today, offset)), matched: relative[1] };
  }

  const numeric = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?\b/.exec(normalized);
  if (numeric?.[1] && numeric[2]) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const yearText = numeric[3];
    const year = yearText === undefined
      ? today.getFullYear()
      : yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    let candidate = buildDate(year, month, day);
    if (!candidate) return null;
    if (yearText === undefined && candidate < today) candidate = addYears(candidate, 1);
    return { date: iso(candidate), matched: numeric[0] };
  }

  const named = /\b(\d{1,2})\s+(?:de\s+)?([a-z]{3,9})\b(?:\s+(?:de\s+)?(\d{4}))?/.exec(normalized);
  if (named?.[1] && named[2] && months[named[2]] !== undefined) {
    const day = Number(named[1]);
    const month = months[named[2]] ?? 0;
    const year = named[3] ? Number(named[3]) : today.getFullYear();
    let candidate = buildDate(year, month, day);
    if (!candidate) return null;
    if (!named[3] && candidate < today) candidate = addYears(candidate, 1);
    return { date: iso(candidate), matched: named[0] };
  }

  const dayOfMonth = /\bdia\s+(\d{1,2})\b/.exec(normalized);
  if (dayOfMonth?.[1]) {
    const day = Number(dayOfMonth[1]);
    if (day < 1 || day > 31) return null;
    let candidate = setDate(today, day);
    // setDate rola para o mês seguinte quando o dia não existe; nesse caso não
    // há data a oferecer neste mês, e o mês seguinte é tentado abaixo.
    if (candidate.getDate() !== day || candidate < today) {
      const nextMonth = addMonths(setDate(today, 1), 1);
      candidate = setDate(nextMonth, day);
      if (candidate.getDate() !== day) return null;
    }
    return { date: iso(candidate), matched: dayOfMonth[0] };
  }

  const weekday = /\b(?:(proxima|proximo|essa|esta|nesta|nessa)\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[- ]feira)?\b/
    .exec(normalized);
  if (weekday?.[2]) {
    const target = weekdays[weekday[2]] ?? 0;
    const current = getDay(today);
    let offset = (target - current + 7) % 7;
    const explicitNext = weekday[1] === "proxima" || weekday[1] === "proximo";
    if (offset === 0 && explicitNext) offset = 7;
    return { date: iso(addDays(today, offset)), matched: weekday[0] };
  }

  return null;
}
