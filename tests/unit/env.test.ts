import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRuntimeReady } from "@/lib/env";

const notificationKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NOTIFICATION_WORKER_SECRET",
  "NOTIFICATION_MODE",
  "NOTIFICATION_WEBHOOK_URL",
  "NOTIFICATION_WEBHOOK_SECRET",
] as const;
const originalNotificationEnv = Object.fromEntries(
  notificationKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof notificationKeys)[number], string | undefined>;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "p".repeat(24));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agenda.example.com");
  vi.stubEnv("BOOKING_TOKEN_PEPPER", "p".repeat(32));
  for (const key of notificationKeys) delete process.env[key];
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of notificationKeys) {
    const original = originalNotificationEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("production runtime readiness", () => {
  it("allows notifications to remain entirely disabled", () => {
    expect(isRuntimeReady()).toBe(true);
  });

  it("reports degraded when notification configuration is partial or dry-run", () => {
    process.env.NOTIFICATION_MODE = "dry-run";
    expect(isRuntimeReady()).toBe(false);

    process.env.NOTIFICATION_MODE = "webhook";
    process.env.NOTIFICATION_WEBHOOK_URL = "https://notifications.example.com/events";
    expect(isRuntimeReady()).toBe(false);
  });

  it("requires the complete production notification worker configuration", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "s".repeat(24);
    process.env.NOTIFICATION_WORKER_SECRET = "w".repeat(32);
    process.env.NOTIFICATION_MODE = "webhook";
    process.env.NOTIFICATION_WEBHOOK_URL = "https://notifications.example.com/events";
    process.env.NOTIFICATION_WEBHOOK_SECRET = "h".repeat(24);

    expect(isRuntimeReady()).toBe(true);
  });
});
