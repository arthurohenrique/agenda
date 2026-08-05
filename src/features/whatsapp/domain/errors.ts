export type WhatsAppErrorKind = "transient" | "permanent" | "business";

const transientCodes = new Set([
  "conversation_version_conflict",
  "conversation_query_failed",
  "conversation_create_failed",
  "conversation_lock_failed",
  "conversation_locked",
  "conversation_restart_failed",
  "conversation_transition_failed",
  "conversation_transition_read_failed",
  "conversation_unlock_failed",
  "customer_tenant_query_failed",
  "customer_tenant_resolution_failed",
  "availability_query_failed",
  "booking_transient_failure",
  "cancellation_transient_failure",
  "message_status_update_failed",
  "opt_in_query_failed",
  "opt_out_store_failed",
  "phone_number_query_failed",
  "phone_tenant_query_failed",
  "provider_rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "provider_context_mismatch",
  "reschedule_slots_failed",
  "reschedule_transient_failure",
  "routing_code_query_failed",
  "service_query_failed",
  "staff_query_failed",
  "tenant_history_query_failed",
  "tenant_query_failed",
  "tenant_search_failed",
  "tenant_settings_query_failed",
  "template_query_failed",
  "upcoming_booking_query_failed",
  "whatsapp_contact_create_failed",
  "whatsapp_contact_query_failed",
  "whatsapp_contact_update_failed",
  "whatsapp_inbox_duplicate_query_failed",
  "whatsapp_inbox_claim_failed",
  "whatsapp_inbox_complete_failed",
  "whatsapp_inbox_defer_failed",
  "whatsapp_inbox_store_failed",
  "whatsapp_outbox_claim_failed",
  "whatsapp_outbox_complete_failed",
  "whatsapp_outbox_defer_failed",
  "whatsapp_outbox_enqueue_failed",
  "whatsapp_outbox_validation_failed",
  "whatsapp_outbox_ambiguous_failed",
  "whatsapp_contact_upsert_failed",
  "whatsapp_retention_failed",
  "whatsapp_webhook_rate_limit_failed",
  "inbound_message_store_failed",
  "inbound_message_query_failed",
  "inbound_message_ignore_failed",
]);

const businessCodes = new Set([
  "booking_conflict",
  "approved_template_mismatch",
  "approved_template_not_found",
  "cancellation_not_allowed",
  "contact_opted_out",
  "service_unavailable",
  "service_window_closed",
  "staff_unavailable",
  "template_required",
  "tenant_not_found",
  "tenant_whatsapp_disabled",
]);

export class WhatsAppApplicationError extends Error {
  constructor(
    public readonly code: string,
    public readonly kind: WhatsAppErrorKind,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "WhatsAppApplicationError";
  }
}

export function classifyWhatsAppError(error: unknown): {
  code: string;
  kind: WhatsAppErrorKind;
} {
  if (error instanceof WhatsAppApplicationError) {
    return { code: error.code, kind: error.kind };
  }
  if (error instanceof WhatsAppProviderError) {
    return {
      code: error.message.slice(0, 80),
      kind: error.retryable ? "transient" : "permanent",
    };
  }
  const message = error instanceof Error ? error.message : "unknown_whatsapp_error";
  if (transientCodes.has(message) || /(?:timeout|network|http_429|http_5\d\d)/.test(message)) {
    return { code: message.slice(0, 80), kind: "transient" };
  }
  if (businessCodes.has(message) || /(?:slot_unavailable|not_allowed)/.test(message)) {
    return { code: message.slice(0, 80), kind: "business" };
  }
  return { code: /^[a-z0-9_]{1,80}$/.test(message) ? message : "unknown_whatsapp_error", kind: "permanent" };
}
import { WhatsAppProviderError } from "./provider";
