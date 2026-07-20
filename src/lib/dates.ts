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
