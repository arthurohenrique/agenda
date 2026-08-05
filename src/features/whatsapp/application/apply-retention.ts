import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const retentionResultSchema = z.object({
  status: z.enum(["applied", "legal_hold"]),
  policyVersion: z.string(),
  webhookPayloadsRedacted: z.number().int().nonnegative().optional(),
  outboxRowsDeleted: z.number().int().nonnegative().optional(),
  messageBodiesRedacted: z.number().int().nonnegative().optional(),
  conversationContextsRedacted: z.number().int().nonnegative().optional(),
  pendingStatusesDeleted: z.number().int().nonnegative().optional(),
  handoffsRedacted: z.number().int().nonnegative().optional(),
  flowContextsRedacted: z.number().int().nonnegative().optional(),
  optInEvidenceRedacted: z.number().int().nonnegative().optional(),
  rateLimitRowsDeleted: z.number().int().nonnegative().optional(),
  automatedSessionsExpired: z.number().int().nonnegative().optional(),
  staleHandoffsExpired: z.number().int().nonnegative().optional(),
  contactsAnonymized: z.number().int().nonnegative().optional(),
});

export async function applyWhatsAppRetention(limit: number) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_whatsapp_retention", {
    p_limit: limit,
  });
  if (error) throw new Error("whatsapp_retention_failed");
  return retentionResultSchema.parse(data);
}
