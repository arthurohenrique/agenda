import "server-only";

import { getServerEnv } from "@/lib/env";
import {
  resolveNotificationProviderConfig,
  type NotificationProviderConfig,
} from "./policy";
import type { NotificationDelivery, NotificationMessage } from "./types";

function getNotificationProviderConfig(): NotificationProviderConfig {
  const env = getServerEnv();
  return resolveNotificationProviderConfig(
    {
      mode: env.NOTIFICATION_MODE,
      webhookUrl: env.NOTIFICATION_WEBHOOK_URL,
      webhookSecret: env.NOTIFICATION_WEBHOOK_SECRET,
    },
    process.env.NODE_ENV,
  );
}

export function assertNotificationProviderConfigured(): void {
  getNotificationProviderConfig();
}

export async function deliverNotification(
  message: NotificationMessage,
): Promise<NotificationDelivery> {
  const config = getNotificationProviderConfig();

  if (config.mode === "dry-run") {
    return { provider: "dry-run", providerMessageId: `dry-run:${message.eventId}` };
  }

  let response: Response;
  try {
    response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.webhookSecret}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.eventId,
      },
      body: JSON.stringify(message),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("notification_provider_unavailable");
  }

  if (!response.ok) throw new Error(`notification_provider_http_${response.status}`);
  const body: unknown = await response.json().catch(() => ({}));
  const providerMessageId =
    typeof body === "object" && body && "id" in body && typeof body.id === "string"
      ? body.id
      : message.eventId;

  return { provider: "webhook", providerMessageId };
}
