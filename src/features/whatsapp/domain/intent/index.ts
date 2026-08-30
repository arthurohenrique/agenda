import { normalizeText } from "@/lib/text/normalize";
import { matchCatalog, type CatalogItem } from "./catalog";
import { parseDate } from "./date";
import { mentionsAnyStaff, parseIntentKeyword, type BookingIntent } from "./intent";
import { expandSlang } from "./slang";
import { extractRequestedStaffName } from "./staff-name";
import { parsePeriod, parseTime, type DayPeriod } from "./time";
import { withoutMatch, withoutWords } from "./tokens";

export type { BookingIntent } from "./intent";
export type { CatalogItem, CatalogMatch } from "./catalog";
export type { DayPeriod } from "./time";
export { matchCatalog } from "./catalog";
export { parseDate } from "./date";
export { mentionsAnyStaff, parseIntentKeyword } from "./intent";
export { parsePeriod, parseTime, periodHours } from "./time";
export { expandSlang } from "./slang";
export { extractRequestedStaffName } from "./staff-name";
export {
  mentionsOtherDate,
  parseAffirmation,
  parseSlotShortcut,
  type Affirmation,
  type SlotShortcut,
} from "./affirmation";

export interface ParseIntentInput<Service extends CatalogItem, Staff extends CatalogItem> {
  // yyyy-MM-dd no fuso do estabelecimento.
  today: string;
  services: readonly Service[];
  staff: readonly Staff[];
}

export interface ParsedIntent<Service extends CatalogItem, Staff extends CatalogItem> {
  intent: BookingIntent | null;
  service: Service | null;
  // Mais de um serviço com a mesma força: a escolha volta para o cliente.
  serviceCandidates: Service[];
  staff: Staff | null;
  staffCandidates: Staff[];
  // "Sem preferência", "qualquer um".
  staffAny: boolean;
  // Nome pedido que não casou com ninguém do cadastro ("com Raul"). Só quando
  // não houve match nem ambiguidade — a conversa avisa e oferece quem atende.
  requestedStaffName: string | null;
  date: string | null;
  time: string | null;
  period: DayPeriod | null;
  // Algum campo foi extraído. Sem nada, o estado atual trata a mensagem como
  // entrada inválida e reapresenta as opções.
  matched: boolean;
}

// Interpretação determinística de uma frase de agendamento. Cada parser lê o
// texto e devolve o trecho consumido; o trecho sai antes do próximo parser
// para que "15" de "dia 15" não vire parte de um nome e "Corte com Maria"
// (serviço) não entregue a profissional Maria por engano — o serviço é casado
// antes e removido da frase.
export function parseIntent<Service extends CatalogItem, Staff extends CatalogItem>(
  text: string,
  input: ParseIntentInput<Service, Staff>,
): ParsedIntent<Service, Staff> {
  let remainder = expandSlang(normalizeText(text));

  const time = parseTime(remainder);
  remainder = withoutMatch(remainder, time?.matched);
  const date = parseDate(remainder, { today: input.today });
  remainder = withoutMatch(remainder, date?.matched);
  const period = parsePeriod(remainder);

  const serviceMatch = matchCatalog(remainder, input.services);
  if (serviceMatch.kind === "match") remainder = withoutWords(remainder, serviceMatch.matched);
  const staffAny = mentionsAnyStaff(remainder);
  const staffMatch = staffAny ? { kind: "none" as const } : matchCatalog(remainder, input.staff);
  const requestedStaffName = !staffAny && staffMatch.kind === "none"
    ? extractRequestedStaffName(remainder)
    : null;

  const service = serviceMatch.kind === "match" ? serviceMatch.item : null;
  const staff = staffMatch.kind === "match" ? staffMatch.item : null;
  const serviceCandidates = serviceMatch.kind === "ambiguous" ? serviceMatch.items : [];
  const staffCandidates = staffMatch.kind === "ambiguous" ? staffMatch.items : [];
  const intent = parseIntentKeyword(expandSlang(normalizeText(text)));

  return {
    intent,
    service,
    serviceCandidates,
    staff,
    staffCandidates,
    staffAny,
    requestedStaffName,
    date: date?.date ?? null,
    time: time?.time ?? null,
    period,
    matched: Boolean(
      intent || service || staff || staffAny || requestedStaffName || date || time || period
        || serviceCandidates.length || staffCandidates.length,
    ),
  };
}
