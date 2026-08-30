import { describe, expect, it } from "vitest";
import {
  WhatsAppConfigurationError,
  resolveWhatsAppConfig,
} from "@/features/whatsapp/config";
import { getWhatsAppReadiness } from "@/features/whatsapp/readiness";

const completeMetaEnvironment = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "meta_cloud",
  WHATSAPP_GRAPH_API_VERSION: "v99.1",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token-value",
  WHATSAPP_APP_SECRET: "app-secret-value-long-enough",
  WHATSAPP_PLATFORM_ACCESS_TOKEN: "access-token-value-long-enough",
  WHATSAPP_DEFAULT_PHONE_NUMBER_ID: "phone-1",
  WHATSAPP_DEFAULT_WABA_ID: "waba-1",
  WHATSAPP_SIMULATOR_ENABLED: "true",
  WHATSAPP_WORKER_SECRET: "w".repeat(32),
  TRUSTED_CLIENT_IP_HEADER: "x-real-ip",
  BOOKING_TOKEN_PEPPER: "p".repeat(32),
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(24),
  NOTIFICATION_WORKER_SECRET: "n".repeat(32),
  NOTIFICATION_MODE: "webhook",
  NOTIFICATION_WEBHOOK_URL: "https://notifications.example.com/events",
  NOTIFICATION_WEBHOOK_SECRET: "h".repeat(24),
};

describe("WhatsApp configuration", () => {
  it("desliga o LLM por padrão e o liga só com provedor e chave", () => {
    expect(resolveWhatsAppConfig({}, "development").llm).toEqual({
      provider: "none",
      apiKey: null,
      model: "llama-3.3-70b-versatile",
      timeoutMs: 3_500,
    });
    expect(resolveWhatsAppConfig({
      WHATSAPP_LLM_PROVIDER: "groq",
      WHATSAPP_LLM_API_KEY: "k".repeat(20),
      WHATSAPP_LLM_MODEL: "llama-3.1-8b-instant",
      WHATSAPP_LLM_TIMEOUT_MS: "2000",
    }, "development").llm).toEqual({
      provider: "groq",
      apiKey: "k".repeat(20),
      model: "llama-3.1-8b-instant",
      timeoutMs: 2_000,
    });
    expect(() => resolveWhatsAppConfig({ WHATSAPP_LLM_PROVIDER: "gemini" }, "development"))
      .toThrow(WhatsAppConfigurationError);
  });

  it("keeps the channel disabled and reports the simulator dependency", () => {
    const config = resolveWhatsAppConfig({}, "development");

    expect(config).toMatchObject({
      enabled: false,
      provider: "mock",
      simulatorEnabled: true,
      graphApiVersion: null,
    });
    expect(getWhatsAppReadiness(config)).toMatchObject({
      runtimeReady: true,
      warnings: ["embedded_signup_disabled"],
      channel: { status: "disabled" },
      simulator: {
        status: "misconfigured",
        provider: "mock",
        missing: ["SUPABASE_SERVICE_ROLE_KEY"],
      },
      real: { status: "disabled" },
    });
  });

  it("reports every missing Meta field without returning secret values", () => {
    const readiness = getWhatsAppReadiness(
      resolveWhatsAppConfig(
        { WHATSAPP_ENABLED: "true", WHATSAPP_PROVIDER: "meta_cloud" },
        "production",
      ),
    );

    expect(readiness.runtimeReady).toBe(false);
    expect(readiness.channel.status).toBe("misconfigured");
    expect(readiness.channel.missing).toEqual(
      expect.arrayContaining([
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_PLATFORM_ACCESS_TOKEN",
        "WHATSAPP_WORKER_SECRET",
        "TRUSTED_CLIENT_IP_HEADER",
        "BOOKING_TOKEN_PEPPER",
        "SUPABASE_SERVICE_ROLE_KEY",
        "NOTIFICATION_WORKER_SECRET",
        "NOTIFICATION_MODE",
        "NOTIFICATION_WEBHOOK_URL",
        "NOTIFICATION_WEBHOOK_SECRET",
      ]),
    );
    expect(readiness.blockingIssues).toContain("missing:NOTIFICATION_WORKER_SECRET");
    expect(JSON.stringify(readiness)).not.toContain("access-token");
  });

  it("marks a complete Meta channel and simulator as ready", () => {
    const readiness = getWhatsAppReadiness(
      resolveWhatsAppConfig(completeMetaEnvironment, "production"),
    );

    expect(readiness.runtimeReady).toBe(true);
    expect(readiness.channel).toMatchObject({
      status: "ready",
      provider: "meta_cloud",
      missing: [],
    });
    expect(readiness.real.status).toBe("ready");
    expect(readiness.simulator.status).toBe("ready");
  });

  it("keeps the runtime blocked while Embedded Signup is not implemented", () => {
    const config = resolveWhatsAppConfig({
      WHATSAPP_EMBEDDED_SIGNUP_ENABLED: "true",
    });

    expect(config.embeddedSignupEnabled).toBe(true);
    expect(getWhatsAppReadiness(config)).toMatchObject({
      runtimeReady: false,
      warnings: ["embedded_signup_not_implemented"],
    });
  });

  it("allows mock for development but rejects it as an active production channel", () => {
    const input = {
      WHATSAPP_ENABLED: "true",
      WHATSAPP_PROVIDER: "mock",
      SUPABASE_SERVICE_ROLE_KEY: "s".repeat(24),
    };

    expect(getWhatsAppReadiness(resolveWhatsAppConfig(input, "test")).channel.status)
      .toBe("ready");
    expect(getWhatsAppReadiness(resolveWhatsAppConfig(input, "production")).channel)
      .toMatchObject({
        status: "misconfigured",
        reason: "mock_forbidden_in_production",
      });
  });

  it("treats empty placeholders as absent and rejects malformed values", () => {
    expect(resolveWhatsAppConfig({ WHATSAPP_GRAPH_API_VERSION: "" })).toMatchObject({
      graphApiVersion: null,
    });

    expect(() =>
      resolveWhatsAppConfig({ WHATSAPP_GRAPH_API_VERSION: "latest" }),
    ).toThrow(WhatsAppConfigurationError);
    expect(() => resolveWhatsAppConfig({ WHATSAPP_ENABLED: "yes" })).toThrow(
      "whatsapp_configuration_invalid",
    );
  });
});
