import { describe, expect, it, vi } from "vitest";
import { resolveWhatsAppConfig } from "@/features/whatsapp/config";
import { MetaCloudWhatsAppProvider } from "@/features/whatsapp/infrastructure/providers/meta-cloud-provider";
import { MockWhatsAppProvider } from "@/features/whatsapp/infrastructure/providers/mock-provider";
import {
  resolveWhatsAppProvider,
  resolveWhatsAppSimulatorProvider,
} from "@/features/whatsapp/infrastructure/providers/resolver";

const completeMetaEnvironment = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "meta_cloud",
  WHATSAPP_GRAPH_API_VERSION: "v99.1",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token-value",
  WHATSAPP_APP_SECRET: "app-secret-value-long-enough",
  WHATSAPP_PLATFORM_ACCESS_TOKEN: "access-token-value-long-enough",
  WHATSAPP_DEFAULT_PHONE_NUMBER_ID: "phone-1",
  WHATSAPP_DEFAULT_WABA_ID: "waba-1",
  WHATSAPP_WORKER_SECRET: "w".repeat(32),
  TRUSTED_CLIENT_IP_HEADER: "x-real-ip",
  BOOKING_TOKEN_PEPPER: "p".repeat(32),
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(24),
  NOTIFICATION_WORKER_SECRET: "n".repeat(32),
  NOTIFICATION_MODE: "webhook",
  NOTIFICATION_WEBHOOK_URL: "https://notifications.example.com/events",
  NOTIFICATION_WEBHOOK_SECRET: "h".repeat(24),
};

describe("WhatsApp provider resolver", () => {
  it("does not resolve a provider while the channel is disabled", () => {
    const config = resolveWhatsAppConfig(
      { SUPABASE_SERVICE_ROLE_KEY: "s".repeat(24) },
      "development",
    );

    expect(() => resolveWhatsAppProvider({ config })).toThrow("whatsapp_channel_disabled");
    expect(resolveWhatsAppSimulatorProvider({ config })).toBeInstanceOf(MockWhatsAppProvider);
  });

  it("resolves mock only for a ready non-production channel", () => {
    const config = resolveWhatsAppConfig(
      {
        WHATSAPP_ENABLED: "true",
        WHATSAPP_PROVIDER: "mock",
        SUPABASE_SERVICE_ROLE_KEY: "s".repeat(24),
      },
      "test",
    );

    const adapter = resolveWhatsAppProvider({
      config,
      mock: { capabilities: { maxListRows: 5 } },
    });
    expect(adapter).toBeInstanceOf(MockWhatsAppProvider);
    expect(adapter.capabilities.maxListRows).toBe(5);
  });

  it("blocks incomplete Meta configuration before any network request", () => {
    const config = resolveWhatsAppConfig(
      { WHATSAPP_ENABLED: "true", WHATSAPP_PROVIDER: "meta_cloud" },
      "production",
    );
    const fetchMock = vi.fn<typeof fetch>();

    expect(() => resolveWhatsAppProvider({
      config,
      meta: { fetchImplementation: fetchMock },
    })).toThrow("whatsapp_provider_not_ready");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves Meta only with complete real readiness", () => {
    const config = resolveWhatsAppConfig(completeMetaEnvironment, "production");

    expect(resolveWhatsAppProvider({ config })).toBeInstanceOf(
      MetaCloudWhatsAppProvider,
    );
  });
});
