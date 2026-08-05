import type { ConversationOption } from "../domain/conversation";
import type { ConversationResponse } from "../domain/provider";

export const WHATSAPP_TEXT_BODY_MAX_LENGTH = 4096;
export const WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH = 1024;

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
        title: option.label.slice(0, 20),
      })),
    } satisfies ReplyButtonsResponse;
  }

  return textResponse(
    [body, "", ...options.map((option) => `${option.key} — ${option.label}`)].join("\n"),
  );
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
          title: option.label.slice(0, 24),
        })),
      },
    ],
  };
}

export function bookingStartResponses(input: {
  emergencyNotice: string | null;
  administrativeNotice: string | null;
  welcomeMessage: string;
  prompt: string;
  buttonText: string;
  options: readonly ConversationOption[];
}): ConversationResponse[] {
  if (input.prompt.length > WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH) {
    throw new Error("whatsapp_interactive_prompt_too_long");
  }

  const notices = [
    { body: input.emergencyNotice, weight: 3 },
    { body: input.administrativeNotice, weight: 2 },
    { body: input.welcomeMessage, weight: 1 },
  ].filter((notice): notice is { body: string; weight: number } => Boolean(notice.body));
  const combinedBody = [...notices.map((notice) => notice.body), input.prompt].join("\n\n");

  if (combinedBody.length <= WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH) {
    return [listResponse(combinedBody, input.buttonText, input.options)];
  }

  const separatorLength = notices.length * 2;
  const noticeBudget = WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH
    - input.prompt.length
    - separatorLength;
  if (noticeBudget <= 0) {
    return [listResponse(input.prompt, input.buttonText, input.options)];
  }
  const compactNotices = weightedNoticeBodies(notices, noticeBudget);

  return [listResponse(
    [...compactNotices.filter(Boolean), input.prompt].join("\n\n"),
    input.buttonText,
    input.options,
  )];
}
