import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const messagePurposes = [
  "conversation_reply",
  "handoff_acknowledgement",
  "appointment_created",
  "appointment_confirmed",
  "appointment_reminder",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_confirmation_request",
  "human_follow_up",
] as const;

export type MessagePurpose = (typeof messagePurposes)[number];

type ReactiveMessagePurpose = "conversation_reply" | "handoff_acknowledgement";

function isReactiveMessagePurpose(
  purpose: MessagePurpose,
): purpose is ReactiveMessagePurpose {
  return purpose === "conversation_reply" || purpose === "handoff_acknowledgement";
}

const proactivePurposeCategories: Record<
  Exclude<MessagePurpose, "conversation_reply" | "handoff_acknowledgement">,
  "transactional" | "reminders" | "service_updates"
> = {
  appointment_created: "transactional",
  appointment_confirmed: "transactional",
  appointment_reminder: "reminders",
  appointment_rescheduled: "service_updates",
  appointment_cancelled: "service_updates",
  appointment_confirmation_request: "transactional",
  human_follow_up: "service_updates",
};

export type MessagingPermission =
  | { allowed: true; mode: "free_form" }
  | { allowed: true; mode: "template"; templateName: string; language: string }
  | { allowed: false; reason: string };

const policyRowSchema = z.object({
  service_window_expires_at: z.string().nullable(),
  tenant_id: z.guid().nullable(),
  contact_id: z.guid(),
});

export async function getMessagingPermission(input: {
  contactId: string;
  tenantId: string | null;
  conversationId: string;
  messagePurpose: MessagePurpose;
  now: Date;
  provider: "mock" | "meta_cloud";
}): Promise<MessagingPermission> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_conversations")
    .select("service_window_expires_at, tenant_id, contact_id")
    .eq("id", input.conversationId)
    .eq("contact_id", input.contactId)
    .maybeSingle();
  if (error) throw new Error("conversation_query_failed");
  if (!data) return { allowed: false, reason: "conversation_not_found" };
  const conversation = policyRowSchema.parse(data);
  if (conversation.tenant_id !== input.tenantId) {
    return { allowed: false, reason: "tenant_context_mismatch" };
  }

  if (input.tenantId) {
    const { data: settings, error: settingsError } = await admin
      .from("tenant_whatsapp_settings")
      .select("enabled")
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (settingsError) throw new Error("tenant_settings_query_failed");
    if (!settings?.enabled) {
      return { allowed: false, reason: "tenant_whatsapp_disabled" };
    }
    if (!isReactiveMessagePurpose(input.messagePurpose)) {
      const category = proactivePurposeCategories[input.messagePurpose];
      const { data: consent, error: consentError } = await admin
        .from("whatsapp_opt_ins")
        .select("status")
        .eq("contact_id", input.contactId)
        .eq("tenant_id", input.tenantId)
        .eq("category", category)
        .is("superseded_at", null)
        .maybeSingle();
      if (consentError) throw new Error("opt_in_query_failed");
      if (consent?.status === "revoked") {
        return { allowed: false, reason: "contact_opted_out" };
      }
      if (consent?.status !== "granted") {
        return { allowed: false, reason: "opt_in_required" };
      }
    }
  }

  const windowExpires = conversation.service_window_expires_at
    ? new Date(conversation.service_window_expires_at)
    : null;
  if (windowExpires && windowExpires.getTime() > input.now.getTime()) {
    return { allowed: true, mode: "free_form" };
  }
  if (isReactiveMessagePurpose(input.messagePurpose)) {
    return { allowed: false, reason: "service_window_closed" };
  }
  if (!input.tenantId) return { allowed: false, reason: "service_window_closed" };

  const { data: template, error: templateError } = await admin
    .from("tenant_whatsapp_templates")
    .select(
      "whatsapp_template_definitions!inner(name, language, status), enabled",
    )
    .eq("tenant_id", input.tenantId)
    .eq("purpose", input.messagePurpose)
    .eq("enabled", true)
    .in(
      "whatsapp_template_definitions.status",
      input.provider === "mock" ? ["approved", "local_draft"] : ["approved"],
    )
    .limit(1)
    .maybeSingle();
  if (templateError) throw new Error("template_query_failed");
  if (!template) {
    return { allowed: false, reason: "approved_template_not_found" };
  }
  const parsed = z
    .object({
      whatsapp_template_definitions: z.object({
        name: z.string(),
        language: z.string(),
        status: z.enum(["approved", "local_draft"]),
      }),
    })
    .parse(template);
  if (
    input.provider === "meta_cloud" &&
    parsed.whatsapp_template_definitions.status !== "approved"
  ) {
    return { allowed: false, reason: "approved_template_not_found" };
  }
  return {
    allowed: true,
    mode: "template",
    templateName: parsed.whatsapp_template_definitions.name,
    language: parsed.whatsapp_template_definitions.language,
  };
}

const optOutExpressions = [
  "parar",
  "sair",
  "cancelar mensagens",
  "nao quero receber",
  "descadastrar",
] as const;

export function isExplicitOptOut(input: string): boolean {
  const normalized = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/[.!?]+$/g, "");
  return optOutExpressions.some((expression) => normalized === expression);
}

export async function recordOptOut(input: {
  contactId: string;
  tenantId: string;
  sourceMessageId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_whatsapp_opt_out", {
    p_contact_id: input.contactId,
    p_tenant_id: input.tenantId,
    p_source_message_id: input.sourceMessageId,
  });
  if (error || data !== true) throw new Error("opt_out_store_failed");
}
