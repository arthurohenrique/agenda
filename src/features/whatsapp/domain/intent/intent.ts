import { normalizeWords } from "@/lib/text/normalize";
import { tokenize } from "./tokens";

export type BookingIntent = "book" | "reschedule" | "cancel" | "upcoming" | "human";

const phrases: Array<{ intent: BookingIntent; phrases: readonly string[] }> = [
  { intent: "human", phrases: ["atendente", "humano", "atendimento humano", "falar com alguem", "falar com uma pessoa"] },
  { intent: "cancel", phrases: ["cancelar", "cancela", "desmarcar", "desmarca"] },
  { intent: "reschedule", phrases: ["reagendar", "reagenda", "remarcar", "remarca", "adiar", "mudar horario", "trocar horario", "mudar o horario", "trocar o horario"] },
  { intent: "upcoming", phrases: ["meus agendamentos", "meu agendamento", "meus horarios", "meu horario", "minha reserva", "minhas reservas", "proximo agendamento"] },
  { intent: "book", phrases: ["agendar", "agenda", "agendamento", "marcar", "marca", "reservar", "reserva", "horario", "vaga", "encaixe"] },
];

// Intenção pela presença de palavra ou expressão na frase — aqui a comparação é
// por palavra inteira, não pela mensagem inteira, porque a frase carrega mais
// coisas ("quero agendar corte sexta"). Por isso este parser só roda nos estados
// em que a frase é uma instrução, nunca onde o texto é nome ou observação.
export function parseIntentKeyword(text: string): BookingIntent | null {
  const words = normalizeWords(text);
  const padded = ` ${words} `;
  const tokens = new Set(tokenize(text));
  for (const group of phrases) {
    const hit = group.phrases.some((phrase) =>
      phrase.includes(" ") ? padded.includes(` ${phrase} `) : tokens.has(phrase),
    );
    if (hit) return group.intent;
  }
  return null;
}

// "Sem preferência", "qualquer um", "tanto faz": o cliente abriu mão de
// escolher profissional.
export function mentionsAnyStaff(text: string): boolean {
  const padded = ` ${normalizeWords(text)} `;
  return [
    " sem preferencia ",
    " qualquer profissional ",
    " qualquer um ",
    " qualquer uma ",
    " tanto faz ",
    " nao tenho preferencia ",
  ].some((phrase) => padded.includes(phrase));
}
