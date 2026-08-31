import { z } from "zod";
import type { WhatsAppProviderName } from "./domain/provider";

const emptyAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = (minimum: number, maximum = 4096) =>
  z.preprocess(emptyAsUndefined, z.string().min(minimum).max(maximum).optional());

const optionalBoolean = z.preprocess(
  emptyAsUndefined,
  z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
);

const environmentSchema = z.object({
  WHATSAPP_ENABLED: optionalBoolean,
  WHATSAPP_PROVIDER: z.preprocess(
    emptyAsUndefined,
    z.enum(["mock", "meta_cloud"]).optional(),
  ),
  WHATSAPP_GRAPH_API_VERSION: z.preprocess(
    emptyAsUndefined,
    z.string().regex(/^v[1-9][0-9]*[.][0-9]+$/).optional(),
  ),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalString(16, 512),
  WHATSAPP_APP_SECRET: optionalString(16, 512),
  WHATSAPP_PLATFORM_ACCESS_TOKEN: optionalString(20),
  WHATSAPP_DEFAULT_PHONE_NUMBER_ID: optionalString(1, 128),
  WHATSAPP_DEFAULT_WABA_ID: optionalString(1, 128),
  WHATSAPP_SIMULATOR_ENABLED: optionalBoolean,
  WHATSAPP_EMBEDDED_SIGNUP_ENABLED: optionalBoolean,
  WHATSAPP_WORKER_SECRET: optionalString(32, 512),
  WHATSAPP_LLM_PROVIDER: z.preprocess(
    emptyAsUndefined,
    z.enum(["none", "groq"]).optional(),
  ),
  WHATSAPP_LLM_API_KEY: optionalString(16, 512),
  WHATSAPP_LLM_MODEL: optionalString(1, 128),
  WHATSAPP_LLM_TIMEOUT_MS: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(500).max(15_000).optional(),
  ),
  TRUSTED_CLIENT_IP_HEADER: z.preprocess(
    emptyAsUndefined,
    z.enum(["x-real-ip", "x-vercel-forwarded-for", "cf-connecting-ip"]).optional(),
  ),
  BOOKING_TOKEN_PEPPER: optionalString(32, 512),
  SUPABASE_SERVICE_ROLE_KEY: optionalString(20),
  NOTIFICATION_WORKER_SECRET: optionalString(32, 512),
  NOTIFICATION_MODE: z.preprocess(
    emptyAsUndefined,
    z.enum(["dry-run", "webhook"]).optional(),
  ),
  NOTIFICATION_WEBHOOK_URL: z.preprocess(
    emptyAsUndefined,
    z.url().optional(),
  ),
  NOTIFICATION_WEBHOOK_SECRET: optionalString(20, 512),
});

export interface WhatsAppConfig {
  enabled: boolean;
  provider: WhatsAppProviderName;
  graphApiVersion: string | null;
  webhookVerifyToken: string | null;
  appSecret: string | null;
  platformAccessToken: string | null;
  defaultPhoneNumberId: string | null;
  defaultWabaId: string | null;
  simulatorEnabled: boolean;
  embeddedSignupEnabled: boolean;
  workerSecret: string | null;
  // Interpretação por LLM no modo texto. `none` = só regras (comportamento
  // original). A chave é exclusivamente de servidor.
  llm: {
    provider: "none" | "groq";
    apiKey: string | null;
    model: string;
    timeoutMs: number;
  };
  trustedClientIpHeader:
    | "x-real-ip"
    | "x-vercel-forwarded-for"
    | "cf-connecting-ip"
    | null;
  bookingTokenPepper: string | null;
  serviceRoleKey: string | null;
  notificationWorkerSecret: string | null;
  notificationMode: "dry-run" | "webhook" | null;
  notificationWebhookUrl: string | null;
  notificationWebhookSecret: string | null;
  nodeEnv: string;
}

export class WhatsAppConfigurationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super("whatsapp_configuration_invalid");
    this.name = "WhatsAppConfigurationError";
    this.fields = fields;
  }
}

function booleanValue(value: boolean | "true" | "false" | undefined, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function resolveWhatsAppConfig(
  environment: Record<string, unknown>,
  nodeEnv = process.env.NODE_ENV,
): WhatsAppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new WhatsAppConfigurationError(
      [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "unknown")))],
    );
  }

  const input = parsed.data;
  const runtime = nodeEnv ?? "development";
  return {
    enabled: booleanValue(input.WHATSAPP_ENABLED, false),
    provider: input.WHATSAPP_PROVIDER ?? "mock",
    graphApiVersion: input.WHATSAPP_GRAPH_API_VERSION ?? null,
    webhookVerifyToken: input.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? null,
    appSecret: input.WHATSAPP_APP_SECRET ?? null,
    platformAccessToken: input.WHATSAPP_PLATFORM_ACCESS_TOKEN ?? null,
    defaultPhoneNumberId: input.WHATSAPP_DEFAULT_PHONE_NUMBER_ID ?? null,
    defaultWabaId: input.WHATSAPP_DEFAULT_WABA_ID ?? null,
    simulatorEnabled: booleanValue(
      input.WHATSAPP_SIMULATOR_ENABLED,
      runtime !== "production",
    ),
    embeddedSignupEnabled: booleanValue(input.WHATSAPP_EMBEDDED_SIGNUP_ENABLED, false),
    workerSecret: input.WHATSAPP_WORKER_SECRET ?? null,
    llm: {
      provider: input.WHATSAPP_LLM_PROVIDER ?? "none",
      apiKey: input.WHATSAPP_LLM_API_KEY ?? null,
      model: input.WHATSAPP_LLM_MODEL ?? "llama-3.3-70b-versatile",
      timeoutMs: input.WHATSAPP_LLM_TIMEOUT_MS ?? 3_500,
    },
    trustedClientIpHeader: input.TRUSTED_CLIENT_IP_HEADER ?? null,
    bookingTokenPepper: input.BOOKING_TOKEN_PEPPER ?? null,
    serviceRoleKey: input.SUPABASE_SERVICE_ROLE_KEY ?? null,
    notificationWorkerSecret: input.NOTIFICATION_WORKER_SECRET ?? null,
    notificationMode: input.NOTIFICATION_MODE ?? null,
    notificationWebhookUrl: input.NOTIFICATION_WEBHOOK_URL ?? null,
    notificationWebhookSecret: input.NOTIFICATION_WEBHOOK_SECRET ?? null,
    nodeEnv: runtime,
  };
}

export function getWhatsAppConfig(
  environment: Record<string, unknown> = process.env,
  nodeEnv = process.env.NODE_ENV,
) {
  return resolveWhatsAppConfig(environment, nodeEnv);
}
