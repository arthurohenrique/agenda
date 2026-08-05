"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformOwner } from "@/features/platform/access";
import { requireTenantAccess } from "@/features/tenants/access";
import { generateWhatsAppBookingLink } from "@/features/whatsapp/application/generate-booking-link";
import {
  canManageTenantWhatsAppSettings,
  canOperateTenantWhatsAppHandoffs,
} from "@/features/whatsapp/presentation/access";
import {
  mergeTenantWhatsAppMetadata,
  settingsInputFromFormData,
  tenantWhatsAppSettingsFormSchema,
} from "@/features/whatsapp/presentation/settings-contract";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const slugSchema = z.string().trim().min(3).max(80);

const campaignLinkSchema = z.object({
  slug: slugSchema,
  source: z.string().trim().max(80),
  campaign: z.string().trim().max(80),
  expiresInDays: z.coerce.number().int().min(1).max(90),
});

const resolveHandoffSchema = z.object({
  slug: slugSchema,
  handoffId: z.guid(),
  resolutionNotes: z.string().trim().max(3000).transform((value) => value || null),
  resolutionMode: z.enum(["return_to_bot", "close"]),
});

const platformResolveHandoffSchema = resolveHandoffSchema.omit({ slug: true });

const acceptHandoffSchema = z.object({
  handoffId: z.guid(),
});

function requireSettingsRole(role: Parameters<typeof canManageTenantWhatsAppSettings>[0]) {
  if (!canManageTenantWhatsAppSettings(role)) {
    throw new Error("Acesso negado.");
  }
}

function requireHandoffRole(
  role: Parameters<typeof canOperateTenantWhatsAppHandoffs>[0],
  permissions: Record<string, boolean>,
) {
  if (!canOperateTenantWhatsAppHandoffs(role, permissions)) {
    throw new Error("Acesso negado.");
  }
}

function sameIds(expected: string[], rows: unknown): boolean {
  const parsed = z.array(z.object({ id: z.guid() })).safeParse(rows ?? []);
  if (!parsed.success) return false;
  const actual = new Set(parsed.data.map(({ id }) => id));
  return actual.size === expected.length && expected.every((id) => actual.has(id));
}

export async function updateTenantWhatsAppSettingsAction(formData: FormData) {
  const slug = slugSchema.safeParse(formData.get("slug"));
  if (!slug.success) throw new Error("Configuração inválida.");

  const tenant = await requireTenantAccess(slug.data);
  requireSettingsRole(tenant.role);

  const parsed = tenantWhatsAppSettingsFormSchema.safeParse(settingsInputFromFormData(formData));
  if (!parsed.success || parsed.data.slug !== tenant.slug) {
    throw new Error("Configuração inválida.");
  }

  const handoffPhone = parsed.data.humanHandoffPhone
    ? normalizePhone(parsed.data.humanHandoffPhone)
    : null;
  if (parsed.data.humanHandoffPhone && !handoffPhone) {
    throw new Error("Configuração inválida.");
  }

  const supabase = await createClient();
  const [currentSettings, services, locations] = await Promise.all([
    supabase
      .from("tenant_whatsapp_settings")
      .select("metadata")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    parsed.data.serviceIds.length
      ? supabase
          .from("services")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("is_active", true)
          .eq("is_public", true)
          .in("id", parsed.data.serviceIds)
      : Promise.resolve({ data: [], error: null }),
    parsed.data.locationIds.length
      ? supabase
          .from("locations")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("is_active", true)
          .in("id", parsed.data.locationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (
    currentSettings.error
    || services.error
    || locations.error
    || !sameIds(parsed.data.serviceIds, services.data)
    || !sameIds(parsed.data.locationIds, locations.data)
  ) {
    throw new Error("Não foi possível validar a configuração.");
  }

  const metadata = mergeTenantWhatsAppMetadata(currentSettings.data?.metadata, parsed.data);
  const { error } = await supabase.from("tenant_whatsapp_settings").upsert(
    {
      tenant_id: tenant.id,
      enabled: parsed.data.enabled,
      booking_enabled: parsed.data.bookingEnabled,
      reminders_enabled: parsed.data.remindersEnabled,
      cancellations_enabled: parsed.data.cancellationsEnabled,
      rescheduling_enabled: parsed.data.reschedulingEnabled,
      human_handoff_enabled: parsed.data.humanHandoffEnabled,
      human_handoff_phone: handoffPhone,
      human_handoff_email: parsed.data.humanHandoffEmail || null,
      welcome_message: parsed.data.welcomeMessage,
      unknown_message_response: parsed.data.unknownMessageResponse,
      metadata,
    },
    { onConflict: "tenant_id" },
  );

  if (error) throw new Error("Não foi possível salvar a configuração.");
  revalidatePath(`/app/${tenant.slug}/whatsapp`);
}

export async function generateTenantWhatsAppBookingLinkAction(formData: FormData) {
  const slug = slugSchema.safeParse(formData.get("slug"));
  if (!slug.success) throw new Error("Solicitação inválida.");

  const tenant = await requireTenantAccess(slug.data);
  requireSettingsRole(tenant.role);
  try {
    await generateWhatsAppBookingLink({
      tenantId: tenant.id,
      source: "tenant_panel",
    });
  } catch {
    throw new Error("Não foi possível gerar o link. Confirme a publicação e o número vinculado.");
  }
  revalidatePath(`/app/${tenant.slug}/whatsapp`);
}

export async function generateTenantWhatsAppCampaignLinkAction(formData: FormData) {
  const parsed = campaignLinkSchema.safeParse({
    slug: formData.get("slug"),
    source: formData.get("source"),
    campaign: formData.get("campaign"),
    expiresInDays: formData.get("expiresInDays"),
  });
  if (!parsed.success) throw new Error("Solicitação inválida.");

  const tenant = await requireTenantAccess(parsed.data.slug);
  requireSettingsRole(tenant.role);
  const expiresAt = new Date(
    Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  try {
    await generateWhatsAppBookingLink({
      tenantId: tenant.id,
      source: parsed.data.source || "tenant_panel",
      ...(parsed.data.campaign ? { campaign: parsed.data.campaign } : {}),
      expiresAt,
    });
  } catch {
    throw new Error("Não foi possível gerar o link temporário.");
  }
  revalidatePath(`/app/${tenant.slug}/whatsapp`);
}

export async function resolveTenantWhatsAppHandoffAction(formData: FormData) {
  const slug = slugSchema.safeParse(formData.get("slug"));
  if (!slug.success) throw new Error("Solicitação inválida.");

  const tenant = await requireTenantAccess(slug.data);
  requireHandoffRole(tenant.role, tenant.permissions);

  const parsed = resolveHandoffSchema.safeParse({
    slug: formData.get("slug"),
    handoffId: formData.get("handoffId"),
    resolutionNotes: formData.get("resolutionNotes"),
    resolutionMode: formData.get("resolutionMode"),
  });
  if (!parsed.success || parsed.data.slug !== tenant.slug) {
    throw new Error("Solicitação inválida.");
  }

  const supabase = await createClient();
  const handoff = await supabase
    .from("whatsapp_handoffs")
    .select("id")
    .eq("id", parsed.data.handoffId)
    .eq("tenant_id", tenant.id)
    .eq("status", "accepted")
    .maybeSingle();
  if (handoff.error || !handoff.data) {
    throw new Error("Atendimento não encontrado.");
  }

  const { data, error } = await supabase.rpc("resolve_whatsapp_handoff", {
    p_handoff_id: parsed.data.handoffId,
    p_resolution_notes: parsed.data.resolutionNotes,
    p_return_to_bot: parsed.data.resolutionMode === "return_to_bot",
  });
  if (error || data !== true) {
    throw new Error("Não foi possível concluir o atendimento.");
  }

  revalidatePath(`/app/${tenant.slug}/whatsapp`);
}

export async function acceptTenantWhatsAppHandoffAction(formData: FormData) {
  const slug = slugSchema.safeParse(formData.get("slug"));
  const parsed = acceptHandoffSchema.safeParse({ handoffId: formData.get("handoffId") });
  if (!slug.success || !parsed.success) throw new Error("Solicitação inválida.");

  const tenant = await requireTenantAccess(slug.data);
  requireHandoffRole(tenant.role, tenant.permissions);

  const supabase = await createClient();
  const handoff = await supabase
    .from("whatsapp_handoffs")
    .select("id")
    .eq("id", parsed.data.handoffId)
    .eq("tenant_id", tenant.id)
    .eq("status", "requested")
    .maybeSingle();
  if (handoff.error || !handoff.data) throw new Error("Atendimento não encontrado.");

  const { data, error } = await supabase.rpc("accept_whatsapp_handoff", {
    p_handoff_id: parsed.data.handoffId,
  });
  if (error || data !== true) throw new Error("Não foi possível assumir o atendimento.");

  revalidatePath(`/app/${tenant.slug}/whatsapp`);
}

export async function acceptPlatformWhatsAppHandoffAction(formData: FormData) {
  await requirePlatformOwner();
  const parsed = acceptHandoffSchema.safeParse({ handoffId: formData.get("handoffId") });
  if (!parsed.success) throw new Error("Solicitação inválida.");

  const supabase = await createClient();
  const handoff = await supabase
    .from("whatsapp_handoffs")
    .select("id")
    .eq("id", parsed.data.handoffId)
    .is("tenant_id", null)
    .eq("status", "requested")
    .maybeSingle();
  if (handoff.error || !handoff.data) throw new Error("Atendimento não encontrado.");

  const { data, error } = await supabase.rpc("accept_whatsapp_handoff", {
    p_handoff_id: parsed.data.handoffId,
  });
  if (error || data !== true) throw new Error("Não foi possível assumir o atendimento.");

  revalidatePath("/app/platform/whatsapp");
}

export async function resolvePlatformWhatsAppHandoffAction(formData: FormData) {
  await requirePlatformOwner();
  const parsed = platformResolveHandoffSchema.safeParse({
    handoffId: formData.get("handoffId"),
    resolutionNotes: formData.get("resolutionNotes"),
    resolutionMode: formData.get("resolutionMode"),
  });
  if (!parsed.success) throw new Error("Solicitação inválida.");

  const supabase = await createClient();
  const handoff = await supabase
    .from("whatsapp_handoffs")
    .select("id")
    .eq("id", parsed.data.handoffId)
    .is("tenant_id", null)
    .eq("status", "accepted")
    .maybeSingle();
  if (handoff.error || !handoff.data) throw new Error("Atendimento não encontrado.");

  const { data, error } = await supabase.rpc("resolve_whatsapp_handoff", {
    p_handoff_id: parsed.data.handoffId,
    p_resolution_notes: parsed.data.resolutionNotes,
    p_return_to_bot: parsed.data.resolutionMode === "return_to_bot",
  });
  if (error || data !== true) throw new Error("Não foi possível concluir o atendimento.");

  revalidatePath("/app/platform/whatsapp");
}
