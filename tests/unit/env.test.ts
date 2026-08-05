import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRuntimeReady } from "@/lib/env";

const runtimeKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NOTIFICATION_WORKER_SECRET",
  "NOTIFICATION_MODE",
  "NOTIFICATION_WEBHOOK_URL",
  "NOTIFICATION_WEBHOOK_SECRET",
  "WHATSAPP_ENABLED",
  "WHATSAPP_PROVIDER",
  "WHATSAPP_GRAPH_API_VERSION",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_PLATFORM_ACCESS_TOKEN",
  "WHATSAPP_DEFAULT_PHONE_NUMBER_ID",
  "WHATSAPP_DEFAULT_WABA_ID",
  "WHATSAPP_SIMULATOR_ENABLED",
  "WHATSAPP_EMBEDDED_SIGNUP_ENABLED",
  "WHATSAPP_WORKER_SECRET",
  "TRUSTED_CLIENT_IP_HEADER",
] as const;
const originalRuntimeEnv = Object.fromEntries(
  runtimeKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof runtimeKeys)[number], string | undefined>;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "p".repeat(24));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agenda.example.com");
  vi.stubEnv("BOOKING_TOKEN_PEPPER", "p".repeat(32));
  for (const key of runtimeKeys) delete process.env[key];
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of runtimeKeys) {
    const original = originalRuntimeEnv[key];
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

  it("allows WhatsApp to remain disabled despite empty Meta placeholders", () => {
    process.env.WHATSAPP_ENABLED = "false";
    process.env.WHATSAPP_PROVIDER = "meta_cloud";
    process.env.WHATSAPP_GRAPH_API_VERSION = "";
    process.env.WHATSAPP_APP_SECRET = "";

    expect(isRuntimeReady()).toBe(true);
  });

  it("reports degraded when an active Meta channel is incomplete", () => {
    process.env.WHATSAPP_ENABLED = "true";
    process.env.WHATSAPP_PROVIDER = "meta_cloud";

    expect(isRuntimeReady()).toBe(false);
  });

  it("requires notifications before accepting a complete active Meta channel", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "s".repeat(24);
    process.env.WHATSAPP_ENABLED = "true";
    process.env.WHATSAPP_PROVIDER = "meta_cloud";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v99.1";
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-token-value";
    process.env.WHATSAPP_APP_SECRET = "app-secret-value-long-enough";
    process.env.WHATSAPP_PLATFORM_ACCESS_TOKEN = "access-token-value-long-enough";
    process.env.WHATSAPP_DEFAULT_PHONE_NUMBER_ID = "phone-1";
    process.env.WHATSAPP_DEFAULT_WABA_ID = "waba-1";
    process.env.WHATSAPP_WORKER_SECRET = "w".repeat(32);
    process.env.TRUSTED_CLIENT_IP_HEADER = "x-real-ip";

    expect(isRuntimeReady()).toBe(false);

    process.env.NOTIFICATION_WORKER_SECRET = "n".repeat(32);
    process.env.NOTIFICATION_MODE = "webhook";
    process.env.NOTIFICATION_WEBHOOK_URL = "https://notifications.example.com/events";
    process.env.NOTIFICATION_WEBHOOK_SECRET = "h".repeat(24);

    expect(isRuntimeReady()).toBe(true);
  });
});
