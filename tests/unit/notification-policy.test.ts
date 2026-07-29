import { describe, expect, it } from "vitest";
import {
  NotificationWorkerError,
  isRetryableNotificationError,
  notificationErrorContext,
  notificationErrorCode,
  notificationFailureLevel,
  resolveNotificationProviderConfig,
  shouldLogNotificationFailure,
} from "@/features/notifications/policy";

describe("notification policy", () => {
  it("defaults to dry-run outside production", () => {
    expect(resolveNotificationProviderConfig({}, "development")).toEqual({
      mode: "dry-run",
    });
  });

  it("forbids dry-run in production", () => {
    expect(() =>
      resolveNotificationProviderConfig({ mode: "dry-run" }, "production"),
    ).toThrow("notification_dry_run_forbidden");
  });

  it("requires a complete webhook configuration in production", () => {
    expect(() => resolveNotificationProviderConfig({}, "production")).toThrow(
      "notification_provider_not_configured",
    );
    expect(
      resolveNotificationProviderConfig(
        {
          mode: "webhook",
          webhookUrl: "https://notifications.example.com/events",
          webhookSecret: "secret",
        },
        "production",
      ),
    ).toEqual({
      mode: "webhook",
      webhookUrl: "https://notifications.example.com/events",
      webhookSecret: "secret",
    });
  });

  it("requires a safe webhook URL", () => {
    const base = { mode: "webhook" as const, webhookSecret: "secret" };
    expect(() =>
      resolveNotificationProviderConfig(
        { ...base, webhookUrl: "http://notifications.example.com/events" },
        "production",
      ),
    ).toThrow("notification_provider_not_configured");
    expect(() =>
      resolveNotificationProviderConfig(
        { ...base, webhookUrl: "https://user:password@notifications.example.com/events" },
        "production",
      ),
    ).toThrow("notification_provider_not_configured");
    expect(() =>
      resolveNotificationProviderConfig(
        { ...base, webhookUrl: "file:///tmp/notifications" },
        "development",
      ),
    ).toThrow("notification_provider_not_configured");
  });

  it("allows only known error codes into logs", () => {
    expect(notificationErrorCode(new Error("notification_provider_http_503"))).toBe(
      "notification_provider_http_503",
    );
    expect(notificationErrorCode(new Error("Bearer secret@example.com"))).toBe(
      "unknown_notification_error",
    );
  });

  it("preserves only safe correlation for contextual worker failures", () => {
    const error = new NotificationWorkerError(
      "outbox_defer_failed",
      "00000000-0000-4000-8000-000000000001",
      2,
    );
    expect(notificationErrorContext(error)).toEqual({
      errorCode: "outbox_defer_failed",
      eventId: "00000000-0000-4000-8000-000000000001",
      attempt: 2,
    });
  });

  it("logs retries as warnings and only the final attempt as an error", () => {
    expect(notificationFailureLevel(1)).toBe("warn");
    expect(notificationFailureLevel(7)).toBe("warn");
    expect(notificationFailureLevel(8)).toBe("error");
    expect(shouldLogNotificationFailure(1)).toBe(true);
    expect(shouldLogNotificationFailure(2)).toBe(false);
    expect(shouldLogNotificationFailure(3)).toBe(true);
    expect(shouldLogNotificationFailure(7)).toBe(false);
    expect(shouldLogNotificationFailure(8)).toBe(true);
  });

  it("distinguishes retryable provider failures from permanent rejections", () => {
    expect(isRetryableNotificationError("notification_provider_http_401")).toBe(false);
    expect(isRetryableNotificationError("notification_provider_http_429")).toBe(true);
    expect(isRetryableNotificationError("notification_provider_http_503")).toBe(true);
    expect(isRetryableNotificationError("notification_context_not_found")).toBe(false);
  });
});
