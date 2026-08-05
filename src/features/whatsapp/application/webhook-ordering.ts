import "server-only";

import { createHash } from "node:crypto";
import type {
  NormalizedWhatsAppEvent,
  WhatsAppProviderName,
} from "../domain/provider";

export const MAX_WHATSAPP_ORDERING_KEYS = 256;

export interface WhatsAppOrdering {
  keys: string[];
  globalFallback: boolean;
}

function digest(parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.join("\u0000"), "utf8")
    .digest("hex");
}

function globalOrderingKey(provider: WhatsAppProviderName): string {
  return digest(["whatsapp-order", "v1", provider, "global"]);
}

function eventOrderingKey(
  provider: WhatsAppProviderName,
  event: NormalizedWhatsAppEvent,
): string {
  const phone = event.externalPhoneNumberId ?? "unknown-phone";
  const party = event.kind === "message.text" ||
      event.kind === "message.button" ||
      event.kind === "message.list" ||
      event.kind === "message.unsupported"
    ? event.sender
    : event.kind === "status"
      ? event.recipient
      : `system:${event.externalWabaId ?? "unknown-waba"}`;
  return digest(["whatsapp-order", "v1", provider, phone, party]);
}

export function getWhatsAppOrdering(
  provider: WhatsAppProviderName,
  events: readonly NormalizedWhatsAppEvent[],
): WhatsAppOrdering {
  const keys = [...new Set(events.map((event) => eventOrderingKey(provider, event)))]
    .sort();
  if (keys.length === 0 || keys.length > MAX_WHATSAPP_ORDERING_KEYS) {
    return { keys: [globalOrderingKey(provider)], globalFallback: true };
  }
  return { keys, globalFallback: false };
}
