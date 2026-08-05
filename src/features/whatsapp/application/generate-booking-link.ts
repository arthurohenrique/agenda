import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export interface GenerateWhatsAppBookingLinkInput {
  tenantId: string;
  phoneNumberId?: string;
  source?: string;
  campaign?: string;
  expiresAt?: string;
}

export interface WhatsAppBookingLink {
  url: string;
  message: string;
  code: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  expiresAt: string | null;
}

const relationSchema = z.object({
  phone_number_id: z.guid(),
  is_primary: z.boolean(),
  whatsapp_phone_numbers: z.object({
    display_phone_number: z.string(),
    normalized_phone_number: z.string(),
    status: z.string(),
  }),
  tenants: z.object({ id: z.guid(), name: z.string(), state: z.string() }),
});

const codeSchema = z.object({ id: z.guid(), code: z.string(), expires_at: z.string().nullable() });

function createPublicCode(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function safeLabel(value: string | undefined, maxLength: number): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, maxLength);
  return normalized || null;
}

export async function generateWhatsAppBookingLink(
  input: GenerateWhatsAppBookingLinkInput,
): Promise<WhatsAppBookingLink> {
  const admin = createAdminClient();
  let query = admin
    .from("whatsapp_phone_number_tenants")
    .select(
      "phone_number_id, is_primary, whatsapp_phone_numbers!inner(display_phone_number, normalized_phone_number, status), tenants!inner(id, name, state)",
    )
    .eq("tenant_id", input.tenantId)
    .eq("status", "active")
    .eq("whatsapp_phone_numbers.status", "connected")
    .eq("tenants.state", "published")
    .order("is_primary", { ascending: false })
    .limit(1);
  if (input.phoneNumberId) query = query.eq("phone_number_id", input.phoneNumberId);
  const { data: relationData, error: relationError } = await query.maybeSingle();
  if (relationError || !relationData) throw new Error("whatsapp_phone_relation_not_found");
  const relation = relationSchema.parse(relationData);

  const source = safeLabel(input.source, 80);
  const campaign = safeLabel(input.campaign, 80);
  const permanent = !input.expiresAt && !campaign;
  let code: z.infer<typeof codeSchema> | null = null;
  if (permanent) {
    const { data, error } = await admin
      .from("whatsapp_routing_codes")
      .select("id, code, expires_at")
      .eq("tenant_id", input.tenantId)
      .eq("phone_number_id", relation.phone_number_id)
      .eq("type", "permanent_tenant_code")
      .eq("status", "active")
      .is("expires_at", null)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("routing_code_query_failed");
    code = data ? codeSchema.parse(data) : null;
  }
  if (!code) {
    for (let attempt = 0; attempt < 4 && !code; attempt += 1) {
      const candidate = createPublicCode(permanent ? 8 : 20);
      const { data, error } = await admin
        .from("whatsapp_routing_codes")
        .insert({
          tenant_id: input.tenantId,
          phone_number_id: relation.phone_number_id,
          code: candidate,
          type: permanent ? "permanent_tenant_code" : "campaign_code",
          campaign,
          source,
          expires_at: input.expiresAt ?? null,
          status: "active",
        })
        .select("id, code, expires_at")
        .maybeSingle();
      if (!error && data) code = codeSchema.parse(data);
      else if (error?.code !== "23505") throw new Error("routing_code_create_failed");
    }
  }
  if (!code) throw new Error("routing_code_generation_failed");

  const message = `Olá! Quero agendar em ${relation.tenants.name}. Código: ${code.code}`;
  const phone = relation.whatsapp_phone_numbers.normalized_phone_number.replace(/\D/g, "");
  return {
    url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    message,
    code: code.code,
    phoneNumberId: relation.phone_number_id,
    displayPhoneNumber: relation.whatsapp_phone_numbers.display_phone_number,
    expiresAt: code.expires_at,
  };
}
