import type { ConversationOption } from "../domain/conversation";
import type { WhatsAppInteractionMode } from "../domain/interaction-mode";
import type { ConversationResponse } from "../domain/provider";

export const WHATSAPP_TEXT_BODY_MAX_LENGTH = 4096;
export const WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH = 1024;
// Limites do WhatsApp para rótulos interativos. Rótulo estático deve caber sem
// truncagem; o corte existe para conteúdo dinâmico, como nome de serviço.
export const WHATSAPP_BUTTON_TITLE_MAX_LENGTH = 20;
export const WHATSAPP_LIST_ROW_TITLE_MAX_LENGTH = 24;

type TextResponse = Extract<ConversationResponse, { kind: "text" }>;
type ReplyButtonsResponse = Extract<ConversationResponse, { kind: "reply_buttons" }>;
type ListResponse = Extract<ConversationResponse, { kind: "list" }>;

function truncateBody(body: string, maximum: number): string {
  if (body.length <= maximum) return body;
  if (maximum < 2) return "…".slice(0, maximum);

  let end = maximum - 1;
  const finalCodeUnit = body.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;

  return `${body.slice(0, end).trimEnd()}…`;
}

export function textResponse(body: string): TextResponse {
  return {
    kind: "text",
    body: truncateBody(body, WHATSAPP_TEXT_BODY_MAX_LENGTH),
  };
}

function weightedNoticeBodies(
  notices: readonly { body: string; weight: number }[],
  budget: number,
): string[] {
  const allocations = Array.from({ length: notices.length }, () => 0);
  let available = budget;
  let pending = notices.map((_, index) => index);

  while (pending.length > 0) {
    const totalWeight = pending.reduce(
      (sum, index) => sum + (notices[index]?.weight ?? 0),
      0,
    );
    const shares = pending.map((index) => ({
      index,
      maximum: Math.floor(
        available * (notices[index]?.weight ?? 0) / totalWeight,
      ),
    }));
    const complete = shares.filter(({ index, maximum }) =>
      (notices[index]?.body.length ?? 0) <= maximum
    );

    if (complete.length === 0) {
      for (const { index, maximum } of shares) allocations[index] = maximum;
      let remainder = available - shares.reduce((sum, item) => sum + item.maximum, 0);
      for (const { index } of shares) {
        if (remainder === 0) break;
        allocations[index] = (allocations[index] ?? 0) + 1;
        remainder -= 1;
      }
      break;
    }

    const completedIndexes = new Set(complete.map(({ index }) => index));
    for (const { index } of complete) {
      const length = notices[index]?.body.length ?? 0;
      allocations[index] = length;
      available -= length;
    }
    pending = pending.filter((index) => !completedIndexes.has(index));
  }

  return notices.map((notice, index) =>
    truncateBody(notice.body, allocations[index] ?? 0)
  );
}

export function replyButtonsResponse(
  body: string,
  options: readonly ConversationOption[],
  maxReplyButtons: number,
): ConversationResponse {
  if (options.length <= maxReplyButtons) {
    return {
      kind: "reply_buttons",
      body: truncateBody(body, WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH),
      buttons: options.map((option) => ({
        id: option.key,
        // `slice` cru cortava no meio da palavra sem sinalizar: "Qualquer
        // profissional" chegava como "Qualquer profissiona". A reticência
        // deixa o corte explícito para o cliente.
        title: truncateBody(option.label, WHATSAPP_BUTTON_TITLE_MAX_LENGTH),
      })),
    } satisfies ReplyButtonsResponse;
  }

  return textResponse(
    [body, "", ...options.map((option) => `${option.key} — ${option.label}`)].join("\n"),
  );
}

export const TEXT_MODE_DEFAULT_HINT = "Responda com o número da opção.";

function optionLine(option: ConversationOption): string {
  // A chave da paginação é "more", mas o cliente escreve "mais".
  return option.kind === "page" ? `mais — ${option.label}` : `${option.key} — ${option.label}`;
}

function numberedBody(
  body: string,
  options: readonly ConversationOption[],
  hint: string | null,
): string {
  return [
    body,
    ...(options.length ? ["", ...options.map(optionLine)] : []),
    ...(hint ? ["", hint] : []),
  ].join("\n");
}

// Pergunta com opções em texto puro: o único formato do modo `text`. A mesma
// lista que viraria botões vira linhas numeradas, e a dica final diz como
// responder — no modo texto não há nada para tocar.
export function numberedOptionsResponse(
  body: string,
  options: readonly ConversationOption[],
  hint: string | null = TEXT_MODE_DEFAULT_HINT,
): TextResponse {
  return textResponse(numberedBody(body, options, options.length ? hint : null));
}

// Ponto único de escolha entre interativo e texto. Quem chama descreve a
// pergunta e o modo; o formato sai daqui. `listButtonText` reproduz a escolha
// original de cada passo no modo `buttons`: com ele, lista; sem ele, botões.
export function presentOptions(input: {
  mode: WhatsAppInteractionMode;
  body: string;
  options: readonly ConversationOption[];
  maxReplyButtons: number;
  listButtonText?: string;
  hint?: string | null;
  // O corpo já traz as alternativas em prosa (copy do modo texto): nada de
  // lista numerada nem dica.
  prose?: boolean;
}): ConversationResponse {
  if (input.mode === "text") {
    return input.prose
      ? textResponse(input.body)
      : numberedOptionsResponse(input.body, input.options, input.hint);
  }
  if (input.listButtonText) {
    return listResponse(input.body, input.listButtonText, input.options);
  }
  return replyButtonsResponse(input.body, input.options, input.maxReplyButtons);
}

export function listResponse(
  body: string,
  buttonText: string,
  options: readonly ConversationOption[],
): ListResponse {
  return {
    kind: "list",
    body: truncateBody(body, WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH),
    buttonText,
    sections: [
      {
        title: "Opções",
        rows: options.map((option) => ({
          id: option.key,
          title: truncateBody(option.label, WHATSAPP_LIST_ROW_TITLE_MAX_LENGTH),
        })),
      },
    ],
  };
}

// Resposta a entrada inválida. O fluxo é por toque: mandar só texto deixa o
// cliente sem nada para tocar, obrigando a rolar a conversa até os botões
// anteriores. Reapresentar as opções junto da mensagem mantém a saída à mão.
export function repromptResponse(
  message: string,
  options: readonly ConversationOption[],
  maxReplyButtons: number,
  mode: WhatsAppInteractionMode = "buttons",
): ConversationResponse {
  if (options.length === 0) return textResponse(message);
  if (mode === "text") return numberedOptionsResponse(message, options);
  if (options.length <= maxReplyButtons) {
    return replyButtonsResponse(message, options, maxReplyButtons);
  }
  return listResponse(message, "Ver opções", options);
}

export function bookingStartResponses(input: {
  emergencyNotice: string | null;
  administrativeNotice: string | null;
  welcomeMessage: string;
  prompt: string;
  buttonText: string;
  options: readonly ConversationOption[];
  mode?: WhatsAppInteractionMode;
  hint?: string | null;
  prose?: boolean;
}): ConversationResponse[] {
  const mode = input.mode ?? "buttons";
  // No modo texto as opções fazem parte do corpo, e o limite é o de texto puro.
  const limit = mode === "text"
    ? WHATSAPP_TEXT_BODY_MAX_LENGTH
    : WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH;
  const prompt = mode === "text" && !input.prose
    ? numberedBody(input.prompt, input.options, input.hint ?? TEXT_MODE_DEFAULT_HINT)
    : input.prompt;
  if (prompt.length > limit) {
    throw new Error("whatsapp_interactive_prompt_too_long");
  }
  const render = (body: string): ConversationResponse => mode === "text"
    ? textResponse(body)
    : listResponse(body, input.buttonText, input.options);

  const notices = [
    { body: input.emergencyNotice, weight: 3 },
    { body: input.administrativeNotice, weight: 2 },
    { body: input.welcomeMessage, weight: 1 },
  ].filter((notice): notice is { body: string; weight: number } => Boolean(notice.body));
  const combinedBody = [...notices.map((notice) => notice.body), prompt].join("\n\n");

  if (combinedBody.length <= limit) {
    return [render(combinedBody)];
  }

  const separatorLength = notices.length * 2;
  const noticeBudget = limit - prompt.length - separatorLength;
  if (noticeBudget <= 0) {
    return [render(prompt)];
  }
  const compactNotices = weightedNoticeBodies(notices, noticeBudget);

  return [render([...compactNotices.filter(Boolean), prompt].join("\n\n"))];
}
