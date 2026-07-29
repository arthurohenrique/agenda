export const MAX_NOTIFICATION_ATTEMPTS = 8;

type NotificationMode = "dry-run" | "webhook";

interface NotificationProviderInput {
  mode?: NotificationMode | undefined;
  webhookUrl?: string | undefined;
  webhookSecret?: string | undefined;
}

export type NotificationProviderConfig =
  | { mode: "dry-run" }
  | { mode: "webhook"; webhookUrl: string; webhookSecret: string };

const knownErrorCodes = new Set([
  "appointment_not_found",
  "notification_context_not_found",
  "notification_dry_run_forbidden",
  "notification_provider_not_configured",
  "notification_provider_unavailable",
  "notification_recipient_not_found",
  "notification_worker_not_configured",
  "outbox_claim_failed",
  "outbox_complete_failed",
  "outbox_defer_failed",
  "outbox_payload_invalid",
]);

export class NotificationWorkerError extends Error {
  readonly attempt: number;
  readonly eventId: string;

  constructor(code: "outbox_defer_failed", eventId: string, attempt: number) {
    super(code);
    this.name = "NotificationWorkerError";
    this.attempt = attempt;
    this.eventId = eventId;
  }
}

export function resolveNotificationProviderConfig(
  input: NotificationProviderInput,
  nodeEnv: string | undefined,
): NotificationProviderConfig {
  const mode = input.mode ?? (nodeEnv === "production" ? undefined : "dry-run");

  if (mode === "dry-run") {
    if (nodeEnv === "production") throw new Error("notification_dry_run_forbidden");
    return { mode };
  }

  if (mode !== "webhook" || !input.webhookUrl || !input.webhookSecret) {
    throw new Error("notification_provider_not_configured");
  }

  let webhookUrl: URL;
  try {
    webhookUrl = new URL(input.webhookUrl);
  } catch {
    throw new Error("notification_provider_not_configured");
  }
  const allowedProtocol =
    webhookUrl.protocol === "https:" ||
    (nodeEnv !== "production" && webhookUrl.protocol === "http:");
  if (!allowedProtocol || webhookUrl.username || webhookUrl.password) {
    throw new Error("notification_provider_not_configured");
  }

  return {
    mode,
    webhookUrl: input.webhookUrl,
    webhookSecret: input.webhookSecret,
  };
}

export function notificationErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_notification_error";
  if (knownErrorCodes.has(error.message)) return error.message;
  if (/^notification_provider_http_[1-5][0-9]{2}$/.test(error.message)) {
    return error.message;
  }
  return "unknown_notification_error";
}

export function notificationErrorContext(error: unknown) {
  const errorCode = notificationErrorCode(error);
  if (error instanceof NotificationWorkerError) {
    return { errorCode, eventId: error.eventId, attempt: error.attempt };
  }
  return { errorCode };
}

export function notificationFailureLevel(attempt: number): "warn" | "error" {
  return attempt >= MAX_NOTIFICATION_ATTEMPTS ? "error" : "warn";
}

export function shouldLogNotificationFailure(attempt: number): boolean {
  return attempt === 1 || attempt === 3 || attempt >= MAX_NOTIFICATION_ATTEMPTS;
}

export function isRetryableNotificationError(errorCode: string): boolean {
  if (
    errorCode === "appointment_not_found" ||
    errorCode === "notification_context_not_found" ||
    errorCode === "notification_recipient_not_found"
  ) {
    return false;
  }

  const httpStatus = /^notification_provider_http_([1-5][0-9]{2})$/.exec(errorCode);
  if (!httpStatus) return true;
  const status = Number(httpStatus[1]);
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
