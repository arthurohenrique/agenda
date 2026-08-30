import "server-only";

import { normalizeText, stripDiacritics } from "@/lib/text/normalize";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { PersistedConversation } from "../domain/conversation";
import type { WhatsAppContact, WhatsAppPhoneNumber } from "../infrastructure/repositories/channel-repository";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

// O código do PostgREST é o único dado que identifica a causa de uma consulta
// recusada. Sem ele, uma falha de privilégio fica indistinguível de erro de schema.
function reportQueryFailure(operation: string, error: { code?: string } | null) {
  logger.warn("whatsapp_tenant_query_failed", {
    operation,
    errorCode: error?.code ?? "unknown",
    result: "rejected",
  });
}

export interface TenantCandidate {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  city: string | null;
  district: string | null;
}

export type TenantResolution =
  | { kind: "resolved"; tenant: TenantCandidate; source: "direct_number" | "routing_code" | "active_session" }
  | { kind: "confirm_history"; tenants: TenantCandidate[] }
  | { kind: "select_history"; tenants: TenantCandidate[] }
  | { kind: "search" };

export interface ResolveWhatsAppTenantInput {
  phoneNumber: WhatsAppPhoneNumber;
  contact: WhatsAppContact;
  conversation: PersistedConversation;
  messageText: string;
  provider: string;
  providerMessageId: string;
}

const tenantSchema = z.object({
  id: z.guid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  city_search: z.string().nullable(),
  district_search: z.string().nullable(),
});

const routingCodeResultSchema = z.object({
  tenant_id: z.guid(),
  routing_code_id: z.guid(),
  code_type: z.enum([
    "permanent_tenant_code",
    "temporary_context_token",
    "campaign_code",
    "appointment_context",
  ]),
});

function mapTenant(input: unknown): TenantCandidate {
  const tenant = tenantSchema.parse(input);
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    timezone: tenant.timezone,
    city: tenant.city_search,
    district: tenant.district_search,
  };
}

export function normalizeRoutingCode(value: string): string {
  return stripDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 32);
}

export function extractRoutingCode(message: string): string | null {
  const normalized = stripDiacritics(message).toUpperCase();
  const marked = /(?:CODIGO|COD|CODE)\s*[:#-]?\s*#?([A-Z0-9][A-Z0-9-]{4,31})(?=$|\s|[.,;!?])/.exec(
    normalized,
  );
  const hash = /(?:^|\s)#([A-Z0-9]{5,32})(?:\s|$|[.,;!?])/.exec(normalized);
  const standalone = /^\s*#?([A-Z0-9][A-Z0-9-]{4,31})[.!?]?\s*$/.exec(normalized);
  const standaloneCode = standalone?.[1] && /[0-9]/.test(standalone[1])
    ? standalone[1]
    : undefined;
  const candidate = marked?.[1] ?? hash?.[1] ?? standaloneCode;
  if (!candidate) return null;
  const code = normalizeRoutingCode(candidate);
  return code.length >= 5 ? code : null;
}

async function activeTenantIdsForPhone(phoneNumberId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_phone_number_tenants")
    .select("tenant_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("status", "active")
    .limit(1000);
  if (error) throw new Error("phone_tenant_query_failed");
  return z.array(z.object({ tenant_id: z.guid() })).parse(data ?? [])
    .map((row) => row.tenant_id);
}

async function loadTenant(
  tenantId: string,
  phoneNumberId: string,
): Promise<TenantCandidate | null> {
  const admin = createAdminClient();
  const { data: link, error: linkError } = await admin
    .from("whatsapp_phone_number_tenants")
    .select("tenant_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();
  if (linkError) throw new Error("phone_tenant_query_failed");
  if (!link) return null;
  const { data, error } = await admin
    .from("tenants")
    .select("id, slug, name, timezone, city_search, district_search, tenant_whatsapp_settings!inner(enabled, booking_enabled)")
    .eq("id", tenantId)
    .eq("state", "published")
    .eq("tenant_whatsapp_settings.enabled", true)
    .eq("tenant_whatsapp_settings.booking_enabled", true)
    .maybeSingle();
  if (error) {
    reportQueryFailure("load_tenant", error);
    throw new Error("tenant_query_failed");
  }
  if (!data) return null;
  return mapTenant(data);
}

export async function getWhatsAppTenantById(
  tenantId: string,
  phoneNumberId: string,
): Promise<TenantCandidate | null> {
  return loadTenant(tenantId, phoneNumberId);
}

async function resolveDirectNumber(phoneNumberId: string): Promise<TenantCandidate | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_phone_number_tenants")
    .select("tenant_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("routing_mode", "direct")
    .eq("status", "active")
    .limit(2);
  if (error) throw new Error("phone_tenant_query_failed");
  const rows = z.array(z.object({ tenant_id: z.guid() })).parse(data ?? []);
  if (rows.length !== 1 || !rows[0]) return null;
  return loadTenant(rows[0].tenant_id, phoneNumberId);
}

async function resolveCode(
  phoneNumberId: string,
  message: string,
  usageKey: string,
): Promise<{ tenant: TenantCandidate; code: string } | null> {
  const code = extractRoutingCode(message);
  if (!code) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_whatsapp_routing_code", {
    p_phone_number_id: phoneNumberId,
    p_code: code,
    p_usage_key: createHash("sha256").update(usageKey, "utf8").digest("hex"),
  });
  if (error?.code === "P0002") return null;
  if (error) throw new Error("routing_code_query_failed");
  if (!data) return null;
  const result = z.array(routingCodeResultSchema).min(1).parse(data)[0];
  if (!result) return null;
  const tenant = await loadTenant(result.tenant_id, phoneNumberId);
  return tenant ? { tenant, code } : null;
}

async function historyTenants(
  customerId: string | null,
  phoneNumberId: string,
): Promise<TenantCandidate[]> {
  if (!customerId) return [];
  const activeTenantIds = await activeTenantIdsForPhone(phoneNumberId);
  if (activeTenantIds.length === 0) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_tenants")
    .select(
      "last_interaction_at, last_visit_at, appointments_count, tenants!inner(id, slug, name, timezone, state, city_search, district_search, tenant_whatsapp_settings!inner(enabled, booking_enabled))",
    )
    .eq("customer_id", customerId)
    .in("tenant_id", activeTenantIds)
    .eq("tenants.state", "published")
    .eq("tenants.tenant_whatsapp_settings.enabled", true)
    .eq("tenants.tenant_whatsapp_settings.booking_enabled", true)
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .order("last_visit_at", { ascending: false, nullsFirst: false })
    .order("appointments_count", { ascending: false })
    .limit(20);
  if (error) {
    reportQueryFailure("tenant_history", error);
    throw new Error("tenant_history_query_failed");
  }
  const schema = z.array(z.object({ tenants: tenantSchema }));
  return schema.parse(data ?? []).map((row) => mapTenant(row.tenants));
}

export async function resolveWhatsAppTenant(
  input: ResolveWhatsAppTenantInput,
): Promise<TenantResolution> {
  if (input.phoneNumber.connectionMode !== "shared_platform") {
    const tenant = await resolveDirectNumber(input.phoneNumber.id);
    if (tenant) return { kind: "resolved", tenant, source: "direct_number" };
  }

  const code = await resolveCode(
    input.phoneNumber.id,
    input.messageText,
    `${input.provider}:${input.providerMessageId}`,
  );
  if (code) return { kind: "resolved", tenant: code.tenant, source: "routing_code" };

  if (input.conversation.tenantId) {
    const tenant = await loadTenant(input.conversation.tenantId, input.phoneNumber.id);
    if (tenant) return { kind: "resolved", tenant, source: "active_session" };
  }

  const tenants = await historyTenants(input.contact.customerId, input.phoneNumber.id);
  if (tenants.length === 1) return { kind: "confirm_history", tenants };
  if (tenants.length > 1) return { kind: "select_history", tenants };
  return { kind: "search" };
}

export async function searchWhatsAppTenants(input: {
  query: string;
  phoneNumberId: string;
}): Promise<TenantCandidate[]> {
  const needle = normalizeText(input.query).slice(0, 80);
  if (needle.length < 2) return [];
  const activeTenantIds = await activeTenantIdsForPhone(input.phoneNumberId);
  if (activeTenantIds.length === 0) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id, slug, name, timezone, city_search, district_search, tenant_whatsapp_settings!inner(enabled, booking_enabled)")
    .eq("state", "published")
    .in("id", activeTenantIds)
    .eq("tenant_whatsapp_settings.enabled", true)
    .eq("tenant_whatsapp_settings.booking_enabled", true)
    .order("name")
    .limit(100);
  if (error) {
    reportQueryFailure("tenant_search", error);
    throw new Error("tenant_search_failed");
  }
  return z
    .array(tenantSchema.passthrough())
    .parse(data ?? [])
    .map(mapTenant)
    .filter((tenant) =>
      normalizeText(
        [tenant.name, tenant.slug, tenant.city ?? "", tenant.district ?? ""].join(" "),
      ).includes(needle),
    );
}

export async function attachContactToTenant(input: {
  conversationId: string;
  contactId: string;
  tenantId: string;
  profileName: string | null;
}): Promise<{ customerId: string; customerTenantId: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resolve_whatsapp_customer_tenant", {
    p_conversation_id: input.conversationId,
    p_contact_id: input.contactId,
    p_tenant_id: input.tenantId,
    p_profile_name: input.profileName,
  });
  if (error) throw new Error("customer_tenant_resolution_failed");
  return z
    .array(z.object({ customer_id: z.guid(), customer_tenant_id: z.guid() }))
    .length(1)
    .transform((value) => ({
      customerId: value[0]?.customer_id,
      customerTenantId: value[0]?.customer_tenant_id,
    }))
    .pipe(z.object({ customerId: z.guid(), customerTenantId: z.guid() }))
    .parse(data);
}
