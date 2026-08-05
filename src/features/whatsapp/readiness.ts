import type { WhatsAppConfig } from "./config";
import type { WhatsAppProviderName } from "./domain/provider";

export const whatsappRealRequiredFields = [
  "WHATSAPP_GRAPH_API_VERSION",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_PLATFORM_ACCESS_TOKEN",
  "WHATSAPP_DEFAULT_PHONE_NUMBER_ID",
  "WHATSAPP_DEFAULT_WABA_ID",
  "WHATSAPP_WORKER_SECRET",
  "TRUSTED_CLIENT_IP_HEADER",
  "BOOKING_TOKEN_PEPPER",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NOTIFICATION_WORKER_SECRET",
  "NOTIFICATION_MODE",
  "NOTIFICATION_WEBHOOK_URL",
  "NOTIFICATION_WEBHOOK_SECRET",
] as const;

export type WhatsAppRequiredField = (typeof whatsappRealRequiredFields)[number];
export type WhatsAppReadinessStatus = "disabled" | "ready" | "misconfigured";

export interface WhatsAppComponentReadiness {
  status: WhatsAppReadinessStatus;
  provider: WhatsAppProviderName;
  missing: WhatsAppRequiredField[];
  reason: "disabled" | "ready" | "missing_configuration" | "mock_forbidden_in_production";
}

export interface WhatsAppReadiness {
  runtimeReady: boolean;
  blockingIssues: string[];
  warnings: Array<"embedded_signup_disabled" | "embedded_signup_not_implemented">;
  channel: WhatsAppComponentReadiness;
  simulator: WhatsAppComponentReadiness;
  real: WhatsAppComponentReadiness;
}

function missingRealFields(config: WhatsAppConfig): WhatsAppRequiredField[] {
  const values: Record<WhatsAppRequiredField, string | null> = {
    WHATSAPP_GRAPH_API_VERSION: config.graphApiVersion,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: config.webhookVerifyToken,
    WHATSAPP_APP_SECRET: config.appSecret,
    WHATSAPP_PLATFORM_ACCESS_TOKEN: config.platformAccessToken,
    WHATSAPP_DEFAULT_PHONE_NUMBER_ID: config.defaultPhoneNumberId,
    WHATSAPP_DEFAULT_WABA_ID: config.defaultWabaId,
    WHATSAPP_WORKER_SECRET: config.workerSecret,
    TRUSTED_CLIENT_IP_HEADER: config.trustedClientIpHeader,
    BOOKING_TOKEN_PEPPER: config.bookingTokenPepper,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    NOTIFICATION_WORKER_SECRET:
      config.nodeEnv !== "production" || config.notificationWorkerSecret
        ? "configured"
        : null,
    NOTIFICATION_MODE:
      config.nodeEnv !== "production" || config.notificationMode === "webhook"
        ? "configured"
        : null,
    NOTIFICATION_WEBHOOK_URL:
      config.nodeEnv !== "production" || config.notificationWebhookUrl
        ? "configured"
        : null,
    NOTIFICATION_WEBHOOK_SECRET:
      config.nodeEnv !== "production" || config.notificationWebhookSecret
        ? "configured"
        : null,
  };
  return whatsappRealRequiredFields.filter((field) => !values[field]);
}

const disabledMock: WhatsAppComponentReadiness = {
  status: "disabled",
  provider: "mock",
  missing: [],
  reason: "disabled",
};

export function getWhatsAppReadiness(config: WhatsAppConfig): WhatsAppReadiness {
  const missing = missingRealFields(config);
  const mockMissing: WhatsAppRequiredField[] = config.serviceRoleKey
    ? []
    : ["SUPABASE_SERVICE_ROLE_KEY"];
  const real: WhatsAppComponentReadiness =
    config.enabled && config.provider === "meta_cloud"
      ? missing.length
        ? {
            status: "misconfigured",
            provider: "meta_cloud",
            missing,
            reason: "missing_configuration",
          }
        : {
            status: "ready",
            provider: "meta_cloud",
            missing: [],
            reason: "ready",
          }
      : {
          status: "disabled",
          provider: "meta_cloud",
          missing,
          reason: "disabled",
        };

  let channel: WhatsAppComponentReadiness;
  if (!config.enabled) {
    channel = {
      status: "disabled",
      provider: config.provider,
      missing: [],
      reason: "disabled",
    };
  } else if (config.provider === "mock") {
    channel = config.nodeEnv === "production"
      ? {
          status: "misconfigured",
          provider: "mock",
          missing: [],
          reason: "mock_forbidden_in_production",
        }
      : mockMissing.length
        ? {
            status: "misconfigured",
            provider: "mock",
            missing: mockMissing,
            reason: "missing_configuration",
          }
        : {
          status: "ready",
          provider: "mock",
          missing: [],
          reason: "ready",
        };
  } else {
    channel = real;
  }

  const simulator: WhatsAppComponentReadiness = config.simulatorEnabled
    ? mockMissing.length
      ? {
          status: "misconfigured",
          provider: "mock",
          missing: mockMissing,
          reason: "missing_configuration",
        }
      : {
        status: "ready",
        provider: "mock",
        missing: [],
        reason: "ready",
      }
    : disabledMock;

  const runtimeReady = channel.status !== "misconfigured" && !config.embeddedSignupEnabled;
  const blockingIssues = [
    ...(channel.status === "misconfigured"
      ? channel.missing.map((field) => `missing:${field}`)
      : []),
    ...(channel.reason === "mock_forbidden_in_production"
      ? ["mock_forbidden_in_production"]
      : []),
    ...(config.embeddedSignupEnabled
      ? ["embedded_signup_not_implemented"]
      : []),
  ];
  return {
    runtimeReady,
    blockingIssues,
    warnings: config.embeddedSignupEnabled
      ? ["embedded_signup_not_implemented"]
      : ["embedded_signup_disabled"],
    channel,
    simulator,
    real,
  };
}

export function isWhatsAppRuntimeReady(config: WhatsAppConfig): boolean {
  return getWhatsAppReadiness(config).runtimeReady;
}
