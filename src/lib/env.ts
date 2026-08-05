import { z } from "zod";
import { resolveWhatsAppConfig } from "@/features/whatsapp/config";
import { isWhatsAppRuntimeReady } from "@/features/whatsapp/readiness";

const emptyAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalWhatsAppString = (minimum: number, maximum = 4096) =>
  z.preprocess(emptyAsUndefined, z.string().min(minimum).max(maximum).optional());

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  BOOKING_TOKEN_PEPPER: z.string().min(32).optional(),
  TRUSTED_CLIENT_IP_HEADER: z
    .enum(["x-real-ip", "x-vercel-forwarded-for", "cf-connecting-ip"])
    .optional(),
  NOTIFICATION_WORKER_SECRET: z.string().min(32).optional(),
  NOTIFICATION_MODE: z.enum(["dry-run", "webhook"]).optional(),
  NOTIFICATION_WEBHOOK_URL: z.url().optional(),
  NOTIFICATION_WEBHOOK_SECRET: z.string().min(20).optional(),
  WHATSAPP_ENABLED: z.preprocess(
    emptyAsUndefined,
    z.enum(["true", "false"]).optional(),
  ),
  WHATSAPP_PROVIDER: z.preprocess(
    emptyAsUndefined,
    z.enum(["mock", "meta_cloud"]).optional(),
  ),
  WHATSAPP_GRAPH_API_VERSION: z.preprocess(
    emptyAsUndefined,
    z.string().regex(/^v[1-9][0-9]*[.][0-9]+$/).optional(),
  ),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalWhatsAppString(16, 512),
  WHATSAPP_APP_SECRET: optionalWhatsAppString(16, 512),
  WHATSAPP_PLATFORM_ACCESS_TOKEN: optionalWhatsAppString(20),
  WHATSAPP_DEFAULT_PHONE_NUMBER_ID: optionalWhatsAppString(1, 128),
  WHATSAPP_DEFAULT_WABA_ID: optionalWhatsAppString(1, 128),
  WHATSAPP_SIMULATOR_ENABLED: z.preprocess(
    emptyAsUndefined,
    z.enum(["true", "false"]).optional(),
  ),
  WHATSAPP_EMBEDDED_SIGNUP_ENABLED: z.preprocess(
    emptyAsUndefined,
    z.enum(["true", "false"]).optional(),
  ),
  WHATSAPP_WORKER_SECRET: optionalWhatsAppString(32, 512),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function serverEnvValues() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BOOKING_TOKEN_PEPPER: process.env.BOOKING_TOKEN_PEPPER,
    TRUSTED_CLIENT_IP_HEADER: process.env.TRUSTED_CLIENT_IP_HEADER,
    NOTIFICATION_WORKER_SECRET: process.env.NOTIFICATION_WORKER_SECRET,
    NOTIFICATION_MODE: process.env.NOTIFICATION_MODE,
    NOTIFICATION_WEBHOOK_URL: process.env.NOTIFICATION_WEBHOOK_URL,
    NOTIFICATION_WEBHOOK_SECRET: process.env.NOTIFICATION_WEBHOOK_SECRET,
    WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED,
    WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER,
    WHATSAPP_GRAPH_API_VERSION: process.env.WHATSAPP_GRAPH_API_VERSION,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
    WHATSAPP_PLATFORM_ACCESS_TOKEN: process.env.WHATSAPP_PLATFORM_ACCESS_TOKEN,
    WHATSAPP_DEFAULT_PHONE_NUMBER_ID: process.env.WHATSAPP_DEFAULT_PHONE_NUMBER_ID,
    WHATSAPP_DEFAULT_WABA_ID: process.env.WHATSAPP_DEFAULT_WABA_ID,
    WHATSAPP_SIMULATOR_ENABLED: process.env.WHATSAPP_SIMULATOR_ENABLED,
    WHATSAPP_EMBEDDED_SIGNUP_ENABLED: process.env.WHATSAPP_EMBEDDED_SIGNUP_ENABLED,
    WHATSAPP_WORKER_SECRET: process.env.WHATSAPP_WORKER_SECRET,
  };
}

export function isSupabaseConfigured(): boolean {
  return publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  }).success;
}

export function getPublicEnv(): PublicEnv {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
}

export function getServerEnv(): ServerEnv {
  return serverEnvSchema.parse(serverEnvValues());
}

export function getBookingTokenPepper(): string {
  const pepper = getServerEnv().BOOKING_TOKEN_PEPPER;
  if (pepper) return pepper;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BOOKING_TOKEN_PEPPER must be configured in production");
  }
  return "local-development-only-booking-pepper";
}

export function isRuntimeReady(): boolean {
  if (!isSupabaseConfigured()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  const parsed = serverEnvSchema.safeParse(serverEnvValues());
  if (!parsed.success || !parsed.data.BOOKING_TOKEN_PEPPER) return false;

  const env = parsed.data;
  const whatsappConfig = resolveWhatsAppConfig(env, "production");
  const whatsappRequiresNotifications =
    whatsappConfig.enabled && whatsappConfig.provider === "meta_cloud";
  const notificationConfigured = Boolean(
    env.NOTIFICATION_WORKER_SECRET ||
      env.NOTIFICATION_MODE ||
      env.NOTIFICATION_WEBHOOK_URL ||
      env.NOTIFICATION_WEBHOOK_SECRET,
  );
  if (
    (notificationConfigured || whatsappRequiresNotifications) &&
    !(
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.NOTIFICATION_WORKER_SECRET &&
      env.NOTIFICATION_MODE === "webhook" &&
      env.NOTIFICATION_WEBHOOK_URL &&
      env.NOTIFICATION_WEBHOOK_SECRET
    )
  ) {
    return false;
  }

  return isWhatsAppRuntimeReady(whatsappConfig);
}
