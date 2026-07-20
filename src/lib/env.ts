import { z } from "zod";

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
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

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
  return serverEnvSchema.parse({
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
  });
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
  return Boolean(serverEnvSchema.safeParse({
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
  }).data?.BOOKING_TOKEN_PEPPER);
}
