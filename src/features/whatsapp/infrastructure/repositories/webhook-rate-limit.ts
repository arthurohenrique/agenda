import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const rateLimitResultSchema = z.object({
  allowed: z.boolean(),
  retry_after_seconds: z.number().int().min(0).max(600),
});

export type WhatsAppWebhookRateLimitAction = "receive" | "verify";

export async function consumeWhatsAppWebhookRateLimit(input: {
  action: WhatsAppWebhookRateLimitAction;
  rateKey: string;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_whatsapp_webhook_rate_limit", {
    p_action: input.action,
    p_rate_key: input.rateKey,
  });
  if (error) throw new Error("whatsapp_webhook_rate_limit_failed");

  const parsed = rateLimitResultSchema.parse(data);
  return {
    allowed: parsed.allowed,
    retryAfterSeconds: parsed.retry_after_seconds,
  };
}
