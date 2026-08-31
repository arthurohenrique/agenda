import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export function formatDateInTimezone(value: string | Date, timezone: string) {
  return formatInTimeZone(value, timezone, "EEEE, d 'de' MMMM", { locale: ptBR });
}

export function formatTimeInTimezone(value: string | Date, timezone: string) {
  return formatInTimeZone(value, timezone, "HH:mm", { locale: ptBR });
}

export function formatDateInput(value: Date) {
  return format(value, "yyyy-MM-dd");
}

// A data "de hoje" de um estabelecimento. Nunca use `format(new Date(), ...)`
// para isso: o servidor roda em UTC (Vercel), e das 21h às 23h59 em São Paulo o
// dia UTC já é o seguinte — a agenda abriria no dia errado. Invisível no dev
// local, cuja máquina está no fuso do tenant.
export function todayInTimezone(timezone: string) {
  return formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
}

export function parseDateInput(value: string) {
  return parseISO(`${value}T12:00:00`);
}

export function localDateBounds(value: string, timezone: string) {
  const start = parseISO(`${value}T00:00:00`);
  const end = addDays(start, 1);
  return {
    from: fromZonedTime(start, timezone).toISOString(),
    to: fromZonedTime(end, timezone).toISOString(),
  };
}
