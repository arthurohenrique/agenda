import "server-only";

import { getServerEnv } from "@/lib/env";
import type { NotificationDelivery, NotificationMessage } from "./types";

export async function deliverNotification(
  message: NotificationMessage,
): Promise<NotificationDelivery> {
  const env = getServerEnv();
  const mode = env.NOTIFICATION_MODE ?? (process.env.NODE_ENV === "production" ? undefined : "dry-run");

  if (mode === "dry-run") {
    return { provider: "dry-run", providerMessageId: `dry-run:${message.eventId}` };
  }

  if (
    mode !== "webhook" ||
    !env.NOTIFICATION_WEBHOOK_URL ||
    !env.NOTIFICATION_WEBHOOK_SECRET
  ) {
    throw new Error("notification_provider_not_configured");
  }

  const response = await fetch(env.NOTIFICATION_WEBHOOK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NOTIFICATION_WEBHOOK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`notification_provider_http_${response.status}`);
  const body: unknown = await response.json().catch(() => ({}));
  const providerMessageId =
    typeof body === "object" && body && "id" in body && typeof body.id === "string"
      ? body.id
      : message.eventId;

  return { provider: "webhook", providerMessageId };
}
