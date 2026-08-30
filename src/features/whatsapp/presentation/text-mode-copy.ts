import { parseISO } from "date-fns";
import { formatDateInTimezone } from "@/lib/dates";

// Frases do modo texto. Só aqui: quem monta o fluxo passa dados, quem escreve
// a conversa mexe neste arquivo. Regras de redação: reação curta quando algo
// foi entendido, repetir o entendido em linguagem natural, terminar com uma
// pergunta só. Tom informal, "você", sem emoji. Números ficam ocultos até a
// lista passar de INLINE_LIMIT (linhas) e de NUMBERED_LIMIT (numerada) —
// as chaves das opções continuam aceitas em silêncio.

export const INLINE_LIMIT = 6;
export const NUMBERED_LIMIT = 12;

export interface CopyItem {
  key: string;
  label: string;
}

export function joinNatural(items: readonly string[], conjunction = "e"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

export function decapitalize(value: string): string {
  return value.charAt(0).toLocaleLowerCase("pt-BR") + value.slice(1);
}

export function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

const weekdayLabels = ["no domingo", "na segunda", "na terça", "na quarta", "na quinta", "na sexta", "no sábado"];

// "hoje", "amanhã", "na sexta (4/9)", "no dia 15/9". `date` e `today` em
// yyyy-MM-dd no fuso do estabelecimento; a diferença é em dias de calendário.
export function relativeDay(date: string, today: string): string {
  const target = parseISO(`${date}T12:00:00`);
  const base = parseISO(`${today}T12:00:00`);
  const days = Math.round((target.getTime() - base.getTime()) / 86_400_000);
  const short = `${target.getDate()}/${target.getMonth() + 1}`;
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days > 1 && days < 7) return `${weekdayLabels[target.getDay()]} (${short})`;
  return `no dia ${short}`;
}

export function longDay(isoDateTime: string, timezone: string): string {
  return formatDateInTimezone(isoDateTime, timezone);
}

// Alternativas: inline até INLINE_LIMIT, linhas até NUMBERED_LIMIT, numeradas
// acima disso. `lead` é a frase antes da lista; `question`, a pergunta final.
export function listing(input: {
  items: readonly CopyItem[];
  lead: string;
  question: string;
  conjunction?: string;
  lowercase?: boolean;
}): string {
  const labels = input.items.map((item) => input.lowercase ? decapitalize(item.label) : item.label);
  if (input.items.length <= INLINE_LIMIT) {
    return `${input.lead} ${joinNatural(labels, input.conjunction ?? "e")}. ${input.question}`;
  }
  const lines = input.items.length <= NUMBERED_LIMIT
    ? input.items.map((item) => `• ${item.label}`)
    : input.items.map((item) => `${item.key} — ${item.label}`);
  return [`${input.lead}:`, ...lines, "", input.question].join("\n");
}

function opener(understood: string | null | undefined, note: string | null | undefined): string {
  const parts = [
    understood ? `Beleza, ${understood}.` : null,
    note ?? null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? `${parts.join(" ")} ` : "";
}

export function askService(input: {
  services: readonly CopyItem[];
  understood?: string | null;
  note?: string | null;
}): string {
  return opener(input.understood, input.note) + listing({
    items: input.services,
    lead: "A gente faz",
    question: "Qual você quer?",
    lowercase: true,
  });
}

export function serviceAmbiguous(input: { services: readonly CopyItem[]; understood?: string | null }): string {
  return opener(input.understood, null) + listing({
    items: input.services,
    lead: "Tenho mais de um serviço parecido:",
    question: "Qual deles?",
    conjunction: "ou",
    lowercase: true,
  });
}

export function askStaff(input: {
  service: string;
  staff: readonly CopyItem[];
  understood?: string | null;
  note?: string | null;
}): string {
  return opener(input.understood, input.note) + listing({
    items: input.staff,
    lead: `Prefere algum profissional pra ${decapitalize(input.service)}? Tem`,
    question: "Ou tanto faz?",
  });
}

export function staffNotFoundNote(name: string): string {
  return `Só não achei ninguém chamado ${name} por aqui.`;
}

export function staffNotFound(input: {
  name: string;
  service: string;
  staff: readonly CopyItem[];
  understood?: string | null;
}): string {
  return opener(input.understood, staffNotFoundNote(input.name)) + listing({
    items: input.staff,
    lead: `${capitalize(input.service)} quem faz é`,
    question: "Prefere algum deles ou tanto faz?",
  });
}

export function staffNotEligible(input: {
  name: string;
  service: string;
  staff: readonly CopyItem[];
  understood?: string | null;
}): string {
  return opener(input.understood, `${input.name} não atende ${decapitalize(input.service)}.`) + listing({
    items: input.staff,
    lead: "Quem faz é",
    question: "Prefere algum deles ou tanto faz?",
  });
}

export function staffAmbiguous(input: { name: string; staff: readonly CopyItem[]; understood?: string | null }): string {
  return opener(input.understood, `Tem mais de um ${input.name} por aqui.`) + listing({
    items: input.staff,
    lead: "Pode ser",
    question: "Qual deles?",
    conjunction: "ou",
  });
}

export function askDate(input: { understood?: string | null; note?: string | null } = {}): string {
  return `${opener(input.understood, input.note)}Que dia fica bom pra você? Pode ser hoje, amanhã, ou me diz o dia — tipo "sexta" ou "dia 15".`;
}

export function noSlotsOnDate(dayLabel: string): string {
  return `${capitalize(dayLabel)} não tem mais horário.`;
}

export interface SlotCopyItem extends CopyItem {
  time: string;
  staffName: string;
}

function slotListing(slots: readonly SlotCopyItem[], conjunction = "e"): string {
  const staffNames = new Set(slots.map((slot) => slot.staffName));
  if (staffNames.size <= 1 || slots.length > INLINE_LIMIT * 2) {
    return slots.length <= NUMBERED_LIMIT
      ? joinNatural(slots.map((slot) => slot.time), conjunction)
      : `\n${slots.map((slot) => `${slot.key} — ${slot.label}`).join("\n")}`;
  }
  const byStaff = new Map<string, string[]>();
  for (const slot of slots) byStaff.set(slot.staffName, [...(byStaff.get(slot.staffName) ?? []), slot.time]);
  return `\n${[...byStaff.entries()].map(([name, times]) => `${name}: ${joinNatural(times)}`).join("\n")}`;
}

export function offerSlots(input: {
  understood?: string | null;
  note?: string | null;
  dayLabel: string;
  slots: readonly SlotCopyItem[];
}): string {
  const lead = input.understood
    ? `Beleza! Você quer ${input.understood}, certo? `
    : "";
  const note = input.note ? `${input.note} ` : "";
  const times = slotListing(input.slots);
  const separator = times.startsWith("\n") ? "" : " ";
  return `${lead}${note}Olha, ${input.dayLabel} a gente ainda tem${separator}${times}${times.startsWith("\n") ? "\n" : ". "}Qual prefere?`;
}

export function slotUnavailable(input: {
  time: string;
  dayLabel: string;
  slots: readonly SlotCopyItem[];
  understood?: string | null;
}): string {
  const lead = input.understood ? `Beleza, ${input.understood}. ` : "";
  return `${lead}Às ${input.time} ${input.dayLabel} já foi. O mais perto que tenho é ${slotListing(input.slots, "ou")} — serve algum?`;
}

export function noSlotsInPeriod(input: {
  periodLabel: string;
  dayLabel: string;
  slots: readonly SlotCopyItem[];
  understood?: string | null;
}): string {
  const lead = input.understood ? `Beleza, ${input.understood}. ` : "";
  return `${lead}${capitalize(input.dayLabel)} ${input.periodLabel} não tem mais horário. Sobrou ${slotListing(input.slots, "ou")} — serve algum?`;
}

export function askName(input: { understood?: string | null } = {}): string {
  const lead = input.understood ? `Fechado, ${input.understood}. ` : "";
  return `${lead}Só me diz seu nome completo pra eu deixar reservado.`;
}

export function review(input: {
  service: string;
  longDay: string;
  time: string;
  staffName: string | null;
  customerName: string;
}): string {
  const staff = input.staffName ? ` com ${input.staffName}` : "";
  return `Então fica assim: ${decapitalize(input.service)}, ${input.longDay} às ${input.time}${staff}, no nome de ${input.customerName}. Posso confirmar?`;
}

export function confirmed(input: {
  service: string;
  longDay: string;
  time: string;
  staffName: string;
  tenantName: string;
}): string {
  return `Fechado! ${capitalize(input.service)} confirmado pra ${input.longDay} às ${input.time} com ${input.staffName}. Te esperamos na ${input.tenantName}. Até lá!`;
}

export function rescheduleReview(input: { longDay: string; time: string; staffName: string }): string {
  return `Posso remarcar pra ${input.longDay} às ${input.time} com ${input.staffName}? Me confirma que eu troco.`;
}

export function rescheduled(input: { longDay: string; time: string }): string {
  return `Pronto, remarcado pra ${input.longDay} às ${input.time}. Até lá!`;
}

export function askRescheduleDate(): string {
  return "Pra que dia você quer remarcar? Pode ser hoje, amanhã, ou me diz o dia.";
}

export function cancelledFlow(): string {
  return "Tudo bem, deixei de lado. Quando quiser marcar, é só me mandar mensagem.";
}

export function clarifyConfirmation(): string {
  return "Entendi que não. Quer trocar o horário ou cancelar de vez?";
}

export function slotTaken(): string {
  return "Esse horário acabou de ser pego por outra pessoa.";
}

export function mainMenu(input: { humanHandoff: boolean }): string {
  const actions = ["marcar um horário novo", "mostrar seus agendamentos", ...(input.humanHandoff ? ["chamar alguém da equipe"] : [])];
  return `O que você precisa? Posso ${joinNatural(actions, "ou")}. Se for outro estabelecimento, é só dizer "trocar estabelecimento".`;
}

export function didNotUnderstand(input: { configured?: string | null; hint: string }): string {
  return `${input.configured ?? "Não entendi."} ${input.hint}`.trim();
}

// Dica de repetição por passo, montada a partir das alternativas de pé.
export function hintFor(state: string, options: readonly CopyItem[]): string {
  const labels = options.filter((option) => /^\d+$/.test(option.key)).map((option) => option.label);
  switch (state) {
    case "SERVICE_SELECTION":
      return labels.length ? `Me diz qual serviço: ${joinNatural(labels.map(decapitalize), "ou")}?` : "Me diz qual serviço você quer.";
    case "STAFF_SELECTION":
      return labels.length ? `Prefere ${joinNatural(labels, "ou")} — ou tanto faz?` : "Prefere algum profissional ou tanto faz?";
    case "STAFF_PREFERENCE":
      return "Prefere escolher o profissional ou tanto faz?";
    case "DATE_SELECTION":
    case "BOOKING_CONFLICT":
    case "RESCHEDULE_SELECTION":
      return 'Me diz o dia — hoje, amanhã, "sexta" ou "dia 15".';
    case "SLOT_SELECTION": {
      // Horário tem "hh:mm · profissional"; "Escolher outra data" não entra.
      const times = labels.filter((label) => label.includes(" · ")).map((label) => label.split(" · ")[0] ?? label);
      return times.length
        ? `Os horários são ${joinNatural(times, "ou")} — qual serve? Se preferir outro dia, é só dizer.`
        : "Me diz o horário que serve, ou se prefere outro dia.";
    }
    case "BOOKING_CONFIRMATION":
      return 'Posso confirmar? Responde "sim", ou me diz se quer outro horário ou cancelar.';
    case "CANCELLATION_CONFIRMATION":
      return 'Quer mesmo cancelar? Responde "sim" ou "não".';
    case "CUSTOMER_IDENTIFICATION":
      return "Me diz seu nome completo, por favor.";
    case "MAIN_MENU":
      return "Posso marcar um horário novo, mostrar seus agendamentos ou chamar alguém da equipe. O que prefere?";
    default:
      return labels.length ? `Pode ser ${joinNatural(labels, "ou")}.` : "";
  }
}
