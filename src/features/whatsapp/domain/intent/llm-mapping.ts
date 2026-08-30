import { addDays, format, parseISO } from "date-fns";
import { matchCatalog, type CatalogItem } from "./catalog";
import { parseDate } from "./date";
import type { LlmExtraction } from "../../infrastructure/llm/intent-llm";
import type { ParsedIntent, ParseIntentInput } from "./index";

// Janela máxima de agendamento aceita de uma data vinda do modelo. Fora dela é
// alucinação ou engano — vale mais perguntar do que confiar.
const MAX_DAYS_AHEAD = 60;

function validDate(value: string | null | undefined, today: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ceiling = format(addDays(parseISO(`${today}T12:00:00`), MAX_DAYS_AHEAD), "yyyy-MM-dd");
    // Datas ISO comparam lexicograficamente.
    return value >= today && value <= ceiling ? value : null;
  }
  // "hoje", "amanha", "sexta": reaproveita o parser de regras.
  return parseDate(value, { today })?.date ?? null;
}

function validTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function requestedName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 3 || trimmed.length > 80) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// Extração do modelo → `ParsedIntent` validado. Nomes voltam pelo nosso
// catálogo (id nunca vem do modelo); nome que não casa vira
// `requestedStaffName`, a mesma semântica do parser de regras.
export function fromLlmExtraction<Service extends CatalogItem, Staff extends CatalogItem>(
  extraction: LlmExtraction,
  input: ParseIntentInput<Service, Staff>,
): ParsedIntent<Service, Staff> {
  const serviceMatch = extraction.service_name
    ? matchCatalog(extraction.service_name, input.services)
    : { kind: "none" as const };
  const staffAny = extraction.staff_any === true;
  const staffMatch = !staffAny && extraction.staff_name
    ? matchCatalog(extraction.staff_name, input.staff)
    : { kind: "none" as const };
  const staff = staffMatch.kind === "match" ? staffMatch.item : null;
  const requestedStaffName = staffAny || staff || staffMatch.kind === "ambiguous"
    ? null
    : requestedName(extraction.requested_staff_name)
      ?? (extraction.staff_name ? requestedName(extraction.staff_name) : null);

  const service = serviceMatch.kind === "match" ? serviceMatch.item : null;
  const serviceCandidates = serviceMatch.kind === "ambiguous" ? serviceMatch.items : [];
  const staffCandidates = staffMatch.kind === "ambiguous" ? staffMatch.items : [];
  const date = validDate(extraction.date, input.today);
  const time = validTime(extraction.time);
  const period = extraction.period ?? null;
  const intent = extraction.intent ?? null;

  return {
    intent,
    service,
    serviceCandidates,
    staff,
    staffCandidates,
    staffAny,
    requestedStaffName,
    date,
    time,
    period,
    matched: Boolean(
      intent || service || staff || staffAny || requestedStaffName || date || time || period
        || serviceCandidates.length || staffCandidates.length,
    ),
  };
}

// Fusão: o modelo manda; as regras preenchem o que ele não trouxe. Duas
// exceções de segurança: o handoff das regras (lista revisada de expressões)
// nunca é rebaixado, e candidatas diretas anulam ambiguidade.
export function mergeParsed<Service extends CatalogItem, Staff extends CatalogItem>(
  llm: ParsedIntent<Service, Staff>,
  rules: ParsedIntent<Service, Staff>,
): ParsedIntent<Service, Staff> {
  const service = llm.service ?? rules.service;
  const staffAny = llm.staffAny || rules.staffAny;
  const staff = staffAny ? null : llm.staff ?? rules.staff;
  const merged: ParsedIntent<Service, Staff> = {
    intent: rules.intent === "human" ? "human" : llm.intent ?? rules.intent,
    service,
    serviceCandidates: service
      ? []
      : llm.serviceCandidates.length ? llm.serviceCandidates : rules.serviceCandidates,
    staff,
    staffCandidates: staff || staffAny
      ? []
      : llm.staffCandidates.length ? llm.staffCandidates : rules.staffCandidates,
    staffAny,
    requestedStaffName: staff || staffAny
      ? null
      : llm.requestedStaffName ?? rules.requestedStaffName,
    date: llm.date ?? rules.date,
    time: llm.time ?? rules.time,
    period: llm.time ?? rules.time ? null : llm.period ?? rules.period,
    matched: false,
  };
  merged.matched = Boolean(
    merged.intent || merged.service || merged.staff || merged.staffAny
      || merged.requestedStaffName || merged.date || merged.time || merged.period
      || merged.serviceCandidates.length || merged.staffCandidates.length,
  );
  return merged;
}
