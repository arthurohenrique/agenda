import "server-only";

import { z } from "zod";
import { getWhatsAppConfig } from "@/features/whatsapp/config";
import {
  parseTenantWhatsAppMetadata,
  type WhatsAppInteractionMode,
} from "@/features/whatsapp/presentation/settings-contract";
import { getWhatsAppReadiness } from "@/features/whatsapp/readiness";
import { getPublicEnv, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const businessAccountSchema = z.object({
  id: z.guid(),
  provider: z.string(),
  external_waba_id: z.string().nullable(),
  display_name: z.string().nullable(),
  status: z.string(),
});

const phoneNumberSchema = z.object({
  id: z.guid(),
  provider: z.enum(["mock", "meta_cloud"]),
  external_phone_number_id: z.string(),
  display_phone_number: z.string().nullable(),
  normalized_phone_number: z.string().nullable(),
  connection_mode: z.enum(["shared_platform", "exclusive_platform", "tenant_owned"]),
  status: z.string(),
  quality_status: z.string().nullable(),
});

const tenantSettingsSchema = z.object({
  enabled: z.boolean(),
  booking_enabled: z.boolean(),
  reminders_enabled: z.boolean(),
  cancellations_enabled: z.boolean(),
  rescheduling_enabled: z.boolean(),
  human_handoff_enabled: z.boolean(),
  human_handoff_phone: z.string().nullable(),
  human_handoff_email: z.string().nullable(),
  welcome_message: z.string().nullable(),
  unknown_message_response: z.string().nullable(),
  metadata: z.unknown(),
});

const catalogOptionSchema = z.object({
  id: z.guid(),
  name: z.string(),
});

const handoffSchema = z.object({
  id: z.guid(),
  conversation_id: z.guid(),
  requested_by: z.enum(["customer", "automation", "user"]),
  reason: z.string().nullable(),
  status: z.enum(["requested", "accepted"]),
  requested_at: z.string(),
});

const conversationContactSchema = z.object({
  id: z.guid(),
  contact_id: z.guid(),
});

const contactSchema = z.object({
  id: z.guid(),
  normalized_phone: z.string(),
  profile_name: z.string().nullable(),
});

const phoneTenantSchema = z.object({
  phone_number_id: z.guid(),
  routing_mode: z.enum(["shared", "direct"]),
  is_primary: z.boolean(),
  status: z.string(),
});

const routingCodeSchema = z.object({
  code: z.string(),
  type: z.string(),
  uses_count: z.number().int().nonnegative(),
  status: z.string(),
  expires_at: z.string().nullable(),
});

const routingCodeHistorySchema = routingCodeSchema.extend({
  phone_number_id: z.guid(),
  campaign: z.string().nullable(),
  source: z.string().nullable(),
  created_at: z.string(),
});

const phoneTenantLinkSchema = z.object({
  phone_number_id: z.guid(),
  tenant_id: z.guid(),
});

const tenantIdentitySchema = z.object({
  id: z.guid(),
  name: z.string(),
  slug: z.string(),
});

const timestampSchema = z.object({
  received_at: z.string(),
});

const templateSyncSchema = z.object({
  last_synced_at: z.string(),
});

export interface PlatformBusinessAccountView {
  id: string;
  provider: string;
  externalWabaId: string | null;
  displayName: string | null;
  status: string;
}

export interface PlatformPhoneNumberView {
  id: string;
  provider: "mock" | "meta_cloud";
  externalPhoneNumberId: string;
  displayPhoneNumber: string | null;
  normalizedPhoneNumber: string | null;
  connectionMode: "shared_platform" | "exclusive_platform" | "tenant_owned";
  status: string;
  qualityStatus: string | null;
  associatedTenants?: Array<{ id: string; name: string; slug: string }>;
}

export interface WhatsAppHandoffView {
  id: string;
  conversationReference: string;
  contactLabel: string;
  requestedBy: "customer" | "automation" | "user";
  reason: string | null;
  status: "requested" | "accepted";
  requestedAt: string;
}

export interface PlatformWhatsAppOverview {
  readiness: {
    provider: "mock" | "meta_cloud";
    channelStatus: "disabled" | "ready" | "misconfigured";
    simulatorStatus: "disabled" | "ready" | "misconfigured";
    realStatus: "disabled" | "ready" | "misconfigured";
    missingConfiguration: string[];
  };
  businessAccounts: PlatformBusinessAccountView[];
  phoneNumbers: PlatformPhoneNumberView[];
  counts: {
    inboxPending: number | null;
    outboxPending: number | null;
    deadLetter: number | null;
    failedMessages: number | null;
    outboundMessages: number | null;
  };
  diagnostics: {
    webhookUrl: string | null;
    lastWebhookAt: string | null;
    failureRate: number | null;
    templatesTotal: number | null;
    templatesApproved: number | null;
    templatesLastSyncedAt: string | null;
  };
  handoffs: WhatsAppHandoffView[];
  warnings: string[];
}

function publicWebhookUrl(): string | null {
  try {
    return new URL(
      "/api/integrations/whatsapp/webhook",
      getPublicEnv().NEXT_PUBLIC_APP_URL,
    ).toString();
  } catch {
    return null;
  }
}

function publicReadiness(): PlatformWhatsAppOverview["readiness"] {
  try {
    const readiness = getWhatsAppReadiness(getWhatsAppConfig());
    return {
      provider: readiness.channel.provider,
      channelStatus: readiness.channel.status,
      simulatorStatus: readiness.simulator.status,
      realStatus: readiness.real.status,
      missingConfiguration: readiness.real.missing,
    };
  } catch {
    return {
      provider: "mock",
      channelStatus: "misconfigured",
      simulatorStatus: "disabled",
      realStatus: "misconfigured",
      missingConfiguration: [],
    };
  }
}

export interface TenantWhatsAppPresentation {
  settings: {
    enabled: boolean;
    bookingEnabled: boolean;
    remindersEnabled: boolean;
    cancellationsEnabled: boolean;
    reschedulingEnabled: boolean;
    humanHandoffEnabled: boolean;
    humanHandoffPhone: string | null;
    humanHandoffEmail: string | null;
    welcomeMessage: string | null;
    unknownMessageResponse: string | null;
    reminder24Hours: boolean;
    reminder2Hours: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    administrativeNotice: string | null;
    emergencyNotice: string | null;
    interactionMode: WhatsAppInteractionMode;
  };
  availableServices: Array<{ id: string; name: string }>;
  availableLocations: Array<{ id: string; name: string }>;
  selectedServiceIds: string[];
  selectedLocationIds: string[];
  handoffs: WhatsAppHandoffView[];
  phoneNumber: PlatformPhoneNumberView | null;
  routingMode: "shared" | "direct" | null;
  routingCode: {
    code: string;
    usesCount: number;
    expiresAt: string | null;
  } | null;
  bookingLink: string | null;
  bookingMessage: string | null;
  recentRoutingLinks: Array<{
    code: string;
    type: string;
    campaign: string | null;
    source: string | null;
    usesCount: number;
    status: string;
    expiresAt: string | null;
    createdAt: string;
    url: string;
    message: string;
  }>;
  counts: {
    conversations: number | null;
    failedMessages: number | null;
  };
  warnings: string[];
}

export function maskWhatsAppConversation(value: string): string {
  return value.length > 8 ? `…${value.slice(-8)}` : `…${value}`;
}

export function maskWhatsAppContact(input: {
  profileName: string | null;
  normalizedPhone: string | null;
}): string {
  const name = input.profileName?.trim();
  const maskedName = name ? `${Array.from(name)[0] ?? ""}••` : null;
  const digits = input.normalizedPhone?.replace(/\D/g, "") ?? "";
  const maskedPhone = digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
  return [maskedName, maskedPhone].filter(Boolean).join(" · ") || "Contato oculto";
}

export function buildWhatsAppBookingLink(input: {
  normalizedPhoneNumber: string | null;
  displayPhoneNumber: string | null;
  tenantName: string;
  routingCode: string | null;
}): { link: string; message: string } | null {
  const digits = (input.normalizedPhoneNumber ?? input.displayPhoneNumber ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15 || !input.routingCode) return null;
  const message = `Olá! Quero agendar na ${input.tenantName}. Código: ${input.routingCode}`;
  return {
    link: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
    message,
  };
}

function rowsFrom<T>(schema: z.ZodType<T>, value: unknown): T[] {
  const parsed = z.array(schema).safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

async function loadWhatsAppHandoffs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string | null,
): Promise<{ handoffs: WhatsAppHandoffView[]; error: boolean }> {
  const handoffsQuery = supabase
    .from("whatsapp_handoffs")
    .select("id, conversation_id, requested_by, reason, status, requested_at")
    .in("status", ["requested", "accepted"])
    .order("requested_at", { ascending: true })
    .limit(25);
  const handoffsResult = tenantId === null
    ? await handoffsQuery.is("tenant_id", null)
    : await handoffsQuery.eq("tenant_id", tenantId);
  const handoffRows = rowsFrom(handoffSchema, handoffsResult.data);
  let hasError = Boolean(handoffsResult.error);
  const conversationIds = handoffRows.map(({ conversation_id }) => conversation_id);
  let conversationContacts: Array<z.infer<typeof conversationContactSchema>> = [];
  let contacts: Array<z.infer<typeof contactSchema>> = [];

  if (conversationIds.length) {
    const conversationsQuery = supabase
      .from("whatsapp_conversations")
      .select("id, contact_id")
      .in("id", conversationIds);
    const conversationResult = tenantId === null
      ? await conversationsQuery.is("tenant_id", null)
      : await conversationsQuery.eq("tenant_id", tenantId);
    conversationContacts = rowsFrom(conversationContactSchema, conversationResult.data);
    hasError ||= Boolean(conversationResult.error);

    const contactIds = [...new Set(conversationContacts.map(({ contact_id }) => contact_id))];
    if (contactIds.length) {
      const contactsResult = await supabase
        .from("whatsapp_contacts")
        .select("id, normalized_phone, profile_name")
        .in("id", contactIds);
      contacts = rowsFrom(contactSchema, contactsResult.data);
      hasError ||= Boolean(contactsResult.error);
    }
  }

  const conversationsById = new Map(conversationContacts.map((row) => [row.id, row]));
  const contactsById = new Map(contacts.map((row) => [row.id, row]));
  return {
    handoffs: handoffRows.map((handoff) => {
      const conversation = conversationsById.get(handoff.conversation_id);
      const contact = conversation ? contactsById.get(conversation.contact_id) : null;
      return {
        id: handoff.id,
        conversationReference: maskWhatsAppConversation(handoff.conversation_id),
        contactLabel: maskWhatsAppContact({
          profileName: contact?.profile_name ?? null,
          normalizedPhone: contact?.normalized_phone ?? null,
        }),
        requestedBy: handoff.requested_by,
        reason: handoff.reason,
        status: handoff.status,
        requestedAt: handoff.requested_at,
      };
    }),
    error: hasError,
  };
}

function countFrom(result: { count: number | null; error: unknown }): number | null {
  return result.error ? null : (result.count ?? 0);
}

function unavailableOverview(message: string): PlatformWhatsAppOverview {
  return {
    readiness: publicReadiness(),
    businessAccounts: [],
    phoneNumbers: [],
    counts: {
      inboxPending: null,
      outboxPending: null,
      deadLetter: null,
      failedMessages: null,
      outboundMessages: null,
    },
    diagnostics: {
      webhookUrl: publicWebhookUrl(),
      lastWebhookAt: null,
      failureRate: null,
      templatesTotal: null,
      templatesApproved: null,
      templatesLastSyncedAt: null,
    },
    handoffs: [],
    warnings: [message],
  };
}

export async function getPlatformWhatsAppOverview(): Promise<PlatformWhatsAppOverview> {
  if (!isSupabaseConfigured()) {
    return unavailableOverview("Conecte o Supabase local para consultar inbox, outbox e números simulados.");
  }

  const supabase = await createClient();
  const [
    accounts,
    phones,
    phoneLinks,
    inbox,
    outbox,
    deadLetter,
    failedMessages,
    outboundMessages,
    lastWebhook,
    templatesTotal,
    templatesApproved,
    templatesLastSynced,
    platformHandoffs,
  ] = await Promise.all([
    supabase
      .from("whatsapp_business_accounts")
      .select("id, provider, external_waba_id, display_name, status")
      .order("created_at", { ascending: true }),
    supabase
      .from("whatsapp_phone_numbers")
      .select("id, provider, external_phone_number_id, display_phone_number, normalized_phone_number, connection_mode, status, quality_status")
      .order("created_at", { ascending: true }),
    supabase
      .from("whatsapp_phone_number_tenants")
      .select("phone_number_id, tenant_id")
      .eq("status", "active"),
    supabase
      .from("whatsapp_webhook_events")
      .select("id", { count: "exact", head: true })
      .in("processing_status", ["received", "queued", "processing"]),
    supabase
      .from("whatsapp_outbox")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "processing", "retry"]),
    supabase
      .from("whatsapp_webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("processing_status", "dead_letter"),
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound")
      .eq("status", "failed"),
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound"),
    supabase
      .from("whatsapp_webhook_events")
      .select("received_at")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("whatsapp_template_definitions")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("whatsapp_template_definitions")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved"),
    supabase
      .from("whatsapp_template_definitions")
      .select("last_synced_at")
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadWhatsAppHandoffs(supabase, null),
  ]);

  const linkRows = rowsFrom(phoneTenantLinkSchema, phoneLinks.data);
  const tenantIds = [...new Set(linkRows.map(({ tenant_id }) => tenant_id))];
  const tenantsResult = tenantIds.length
    ? await supabase.from("tenants").select("id, name, slug").in("id", tenantIds)
    : { data: [], error: null };
  const tenantsById = new Map(
    rowsFrom(tenantIdentitySchema, tenantsResult.data).map((tenant) => [tenant.id, tenant]),
  );

  const warnings = new Set<string>();
  if (accounts.error || phones.error || phoneLinks.error || tenantsResult.error) {
    warnings.add("Cadastros WhatsApp ainda não estão disponíveis neste banco.");
  }
  if (
    inbox.error || outbox.error || deadLetter.error || failedMessages.error
    || outboundMessages.error || lastWebhook.error || templatesTotal.error
    || templatesApproved.error || templatesLastSynced.error
  ) {
    warnings.add("Métricas operacionais ainda não estão disponíveis.");
  }
  if (platformHandoffs.error) {
    warnings.add("A fila de atendimento da plataforma não pôde ser carregada por completo.");
  }
  const parsedLastWebhook = timestampSchema.safeParse(lastWebhook.data);
  const parsedTemplateSync = templateSyncSchema.safeParse(templatesLastSynced.data);
  const failedCount = countFrom(failedMessages);
  const outboundCount = countFrom(outboundMessages);
  const failureRate = failedCount !== null && outboundCount !== null
    ? outboundCount === 0 ? 0 : failedCount / outboundCount
    : null;

  return {
    readiness: publicReadiness(),
    businessAccounts: rowsFrom(businessAccountSchema, accounts.data).map((account) => ({
      id: account.id,
      provider: account.provider,
      externalWabaId: account.external_waba_id,
      displayName: account.display_name,
      status: account.status,
    })),
    phoneNumbers: rowsFrom(phoneNumberSchema, phones.data).map((phone) => {
      const associatedTenants = linkRows
        .filter((link) => link.phone_number_id === phone.id)
        .map((link) => tenantsById.get(link.tenant_id))
        .filter((tenant): tenant is z.infer<typeof tenantIdentitySchema> => Boolean(tenant));
      return {
        id: phone.id,
        provider: phone.provider,
        externalPhoneNumberId: phone.external_phone_number_id,
        displayPhoneNumber: phone.display_phone_number,
        normalizedPhoneNumber: phone.normalized_phone_number,
        connectionMode: phone.connection_mode,
        status: phone.status,
        qualityStatus: phone.quality_status,
        associatedTenants,
      };
    }),
    counts: {
      inboxPending: countFrom(inbox),
      outboxPending: countFrom(outbox),
      deadLetter: countFrom(deadLetter),
      failedMessages: countFrom(failedMessages),
      outboundMessages: countFrom(outboundMessages),
    },
    diagnostics: {
      webhookUrl: publicWebhookUrl(),
      lastWebhookAt: parsedLastWebhook.success
        ? parsedLastWebhook.data.received_at
        : null,
      failureRate,
      templatesTotal: countFrom(templatesTotal),
      templatesApproved: countFrom(templatesApproved),
      templatesLastSyncedAt: parsedTemplateSync.success
        ? parsedTemplateSync.data.last_synced_at
        : null,
    },
    handoffs: platformHandoffs.handoffs,
    warnings: [...warnings],
  };
}

function emptyTenantPresentation(message: string): TenantWhatsAppPresentation {
  return {
    settings: {
      enabled: false,
      bookingEnabled: false,
      remindersEnabled: false,
      cancellationsEnabled: false,
      reschedulingEnabled: false,
      humanHandoffEnabled: false,
      humanHandoffPhone: null,
      humanHandoffEmail: null,
      welcomeMessage: null,
      unknownMessageResponse: null,
      reminder24Hours: true,
      reminder2Hours: true,
      quietHoursEnabled: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      administrativeNotice: null,
      emergencyNotice: null,
      interactionMode: "buttons",
    },
    availableServices: [],
    availableLocations: [],
    selectedServiceIds: [],
    selectedLocationIds: [],
    handoffs: [],
    phoneNumber: null,
    routingMode: null,
    routingCode: null,
    bookingLink: null,
    bookingMessage: null,
    recentRoutingLinks: [],
    counts: { conversations: null, failedMessages: null },
    warnings: message ? [message] : [],
  };
}

export async function getTenantWhatsAppHandoffPresentation(
  tenantId: string,
): Promise<TenantWhatsAppPresentation> {
  if (!isSupabaseConfigured()) {
    return emptyTenantPresentation("Conecte o Supabase local para carregar a fila WhatsApp.");
  }

  const supabase = await createClient();
  const result = await loadWhatsAppHandoffs(supabase, tenantId);
  return {
    ...emptyTenantPresentation(""),
    handoffs: result.handoffs,
    warnings: result.error
      ? ["A fila de atendimento humano não pôde ser carregada por completo."]
      : [],
  };
}

export async function getTenantWhatsAppPresentation(
  tenantId: string,
  tenantName: string,
): Promise<TenantWhatsAppPresentation> {
  if (!isSupabaseConfigured()) {
    return emptyTenantPresentation("Conecte o Supabase local para carregar a configuração WhatsApp.");
  }

  const supabase = await createClient();
  const [
    settingsResult,
    relationResult,
    codeResult,
    conversationCount,
    failedMessages,
    servicesResult,
    locationsResult,
    handoffsResult,
    routingHistoryResult,
  ] = await Promise.all([
    supabase
      .from("tenant_whatsapp_settings")
      .select("enabled, booking_enabled, reminders_enabled, cancellations_enabled, rescheduling_enabled, human_handoff_enabled, human_handoff_phone, human_handoff_email, welcome_message, unknown_message_response, metadata")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("whatsapp_phone_number_tenants")
      .select("phone_number_id, routing_mode, is_primary, status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("whatsapp_routing_codes")
      .select("code, type, uses_count, status, expires_at")
      .eq("tenant_id", tenantId)
      .eq("type", "permanent_tenant_code")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("whatsapp_conversations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "failed"),
    supabase
      .from("services")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .eq("is_public", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    loadWhatsAppHandoffs(supabase, tenantId),
    supabase
      .from("whatsapp_routing_codes")
      .select("phone_number_id, code, type, campaign, source, uses_count, status, expires_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const settings = tenantSettingsSchema.safeParse(settingsResult.data);
  const relation = phoneTenantSchema.safeParse(relationResult.data);
  const routingCode = routingCodeSchema.safeParse(codeResult.data);
  const availableServices = rowsFrom(catalogOptionSchema, servicesResult.data);
  const availableLocations = rowsFrom(catalogOptionSchema, locationsResult.data);
  const routingHistory = rowsFrom(routingCodeHistorySchema, routingHistoryResult.data);
  const preferences = parseTenantWhatsAppMetadata(settings.success ? settings.data.metadata : null);
  let phone: z.infer<typeof phoneNumberSchema> | null = null;
  let phoneError = false;

  if (relation.success) {
    const phoneResult = await supabase
      .from("whatsapp_phone_numbers")
      .select("id, provider, external_phone_number_id, display_phone_number, normalized_phone_number, connection_mode, status, quality_status")
      .eq("id", relation.data.phone_number_id)
      .maybeSingle();
    const parsedPhone = phoneNumberSchema.safeParse(phoneResult.data);
    phone = parsedPhone.success ? parsedPhone.data : null;
    phoneError = Boolean(phoneResult.error);
  }

  const warnings = new Set<string>();
  if (!settings.success || !relation.success || !routingCode.success || phoneError) {
    warnings.add("Configuração WhatsApp ainda não está completa para este estabelecimento.");
  }
  if (conversationCount.error || failedMessages.error) {
    warnings.add("Resumo de conversas ainda não está disponível.");
  }
  if (servicesResult.error || locationsResult.error) {
    warnings.add("Serviços e unidades disponíveis não puderam ser carregados.");
  }
  if (routingHistoryResult.error) {
    warnings.add("Histórico de links ainda não está disponível.");
  }
  if (handoffsResult.error) {
    warnings.add("A fila de atendimento humano não pôde ser carregada por completo.");
  }

  const phoneView: PlatformPhoneNumberView | null = phone ? {
    id: phone.id,
    provider: phone.provider,
    externalPhoneNumberId: phone.external_phone_number_id,
    displayPhoneNumber: phone.display_phone_number,
    normalizedPhoneNumber: phone.normalized_phone_number,
    connectionMode: phone.connection_mode,
    status: phone.status,
    qualityStatus: phone.quality_status,
  } : null;
  const bookingLink = buildWhatsAppBookingLink({
    normalizedPhoneNumber: phone?.normalized_phone_number ?? null,
    displayPhoneNumber: phone?.display_phone_number ?? null,
    tenantName,
    routingCode: routingCode.success ? routingCode.data.code : null,
  });

  return {
    settings: settings.success ? {
      enabled: settings.data.enabled,
      bookingEnabled: settings.data.booking_enabled,
      remindersEnabled: settings.data.reminders_enabled,
      cancellationsEnabled: settings.data.cancellations_enabled,
      reschedulingEnabled: settings.data.rescheduling_enabled,
      humanHandoffEnabled: settings.data.human_handoff_enabled,
      humanHandoffPhone: settings.data.human_handoff_phone,
      humanHandoffEmail: settings.data.human_handoff_email,
      welcomeMessage: settings.data.welcome_message,
      unknownMessageResponse: settings.data.unknown_message_response,
      reminder24Hours: preferences.reminder24Hours,
      reminder2Hours: preferences.reminder2Hours,
      quietHoursEnabled: preferences.quietHoursEnabled,
      quietHoursStart: preferences.quietHoursStart,
      quietHoursEnd: preferences.quietHoursEnd,
      administrativeNotice: preferences.administrativeNotice,
      emergencyNotice: preferences.emergencyNotice,
      interactionMode: preferences.interactionMode,
    } : emptyTenantPresentation("").settings,
    availableServices,
    availableLocations,
    selectedServiceIds: preferences.allowedServiceIds === null
      ? availableServices.map(({ id }) => id)
      : preferences.allowedServiceIds.filter((id) => availableServices.some((service) => service.id === id)),
    selectedLocationIds: preferences.allowedLocationIds === null
      ? availableLocations.map(({ id }) => id)
      : preferences.allowedLocationIds.filter((id) => availableLocations.some((location) => location.id === id)),
    handoffs: handoffsResult.handoffs,
    phoneNumber: phoneView,
    routingMode: relation.success ? relation.data.routing_mode : null,
    routingCode: routingCode.success ? {
      code: routingCode.data.code,
      usesCount: routingCode.data.uses_count,
      expiresAt: routingCode.data.expires_at,
    } : null,
    bookingLink: bookingLink?.link ?? null,
    bookingMessage: bookingLink?.message ?? null,
    recentRoutingLinks: routingHistory
      .filter((item) => item.phone_number_id === relation.data?.phone_number_id)
      .flatMap((item) => {
        const generated = buildWhatsAppBookingLink({
          normalizedPhoneNumber: phone?.normalized_phone_number ?? null,
          displayPhoneNumber: phone?.display_phone_number ?? null,
          tenantName,
          routingCode: item.code,
        });
        return generated ? [{
          code: item.code,
          type: item.type,
          campaign: item.campaign,
          source: item.source,
          usesCount: item.uses_count,
          status: item.status,
          expiresAt: item.expires_at,
          createdAt: item.created_at,
          url: generated.link,
          message: generated.message,
        }] : [];
      }),
    counts: {
      conversations: countFrom(conversationCount),
      failedMessages: countFrom(failedMessages),
    },
    warnings: [...warnings],
  };
}
