import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  conversationContextSchema,
  conversationStateSchema,
  conversationStatusSchema,
  type ConversationContext,
  type ConversationState,
  type ConversationStatus,
  type ConversationTransition,
  type PersistedConversation,
} from "../../domain/conversation";
import type { ConversationResponse } from "../../domain/provider";
import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

// `classifyWhatsAppError` casa a mensagem exata contra a tabela de códigos
// transitórios, então a mensagem lançada não pode mudar. O que se perdia era o
// erro do PostgREST por baixo: deadlock (40P01), timeout de statement (57014) e
// violação de constraint viravam todos a mesma string opaca, impossível de
// diagnosticar depois do fato. O código do Postgres vai para o log estruturado e
// o erro original segue como `cause`, que o Node imprime junto do stack.
function repositoryFailure(code: string, operation: string, error: unknown): Error {
  const cause = error as { code?: unknown } | null | undefined;
  logger.error("whatsapp_repository_failed", {
    // Somente o código: a mensagem do Postgres pode carregar valores da linha.
    errorCode: typeof cause?.code === "string" ? cause.code : "rpc_contract_violation",
    stage: code,
    operation,
    result: "failed",
  });
  return cause ? new Error(code, { cause }) : new Error(code);
}

const phoneNumberSchema = z.object({
  id: z.guid(),
  provider: z.enum(["mock", "meta_cloud"]),
  external_phone_number_id: z.string(),
  normalized_phone_number: z.string(),
  connection_mode: z.enum(["shared_platform", "exclusive_platform", "tenant_owned"]),
  status: z.string(),
});

export type WhatsAppPhoneNumber = {
  id: string;
  provider: "mock" | "meta_cloud";
  externalPhoneNumberId: string;
  normalizedPhoneNumber: string;
  connectionMode: "shared_platform" | "exclusive_platform" | "tenant_owned";
};

const contactSchema = z.object({
  id: z.guid(),
  normalized_phone: z.string(),
  whatsapp_user_id: z.string(),
  profile_name: z.string().nullable(),
  customer_id: z.guid().nullable(),
});

export type WhatsAppContact = {
  id: string;
  normalizedPhone: string;
  whatsappUserId: string;
  profileName: string | null;
  customerId: string | null;
};

const conversationRowSchema = z.object({
  id: z.guid(),
  phone_number_id: z.guid(),
  contact_id: z.guid(),
  tenant_id: z.guid().nullable(),
  status: conversationStatusSchema,
  current_state: conversationStateSchema,
  service_window_expires_at: z.string().nullable(),
  session_expires_at: z.string().nullable(),
  last_inbound_at: z.string().nullable(),
  context: z.unknown(),
  version: z.number().int().nonnegative(),
});

const claimedWebhookSchema = z.object({
  id: z.guid(),
  provider: z.string(),
  payload: z.unknown(),
  attempts: z.number().int().positive(),
  correlation_id: z.guid(),
});

export type ClaimedWebhookEvent = z.infer<typeof claimedWebhookSchema>;

const claimedOutboxSchema = z.object({
  id: z.guid(),
  provider: z.enum(["mock", "meta_cloud"]),
  tenant_id: z.guid().nullable(),
  phone_number_id: z.guid(),
  conversation_id: z.guid(),
  message_id: z.guid(),
  message_kind: z.string(),
  payload: z.unknown(),
  attempt_count: z.number().int().positive(),
});

export type ClaimedOutboxMessage = z.infer<typeof claimedOutboxSchema>;

function mapConversation(input: unknown): PersistedConversation {
  const row = conversationRowSchema.parse(input);
  return {
    id: row.id,
    phoneNumberId: row.phone_number_id,
    contactId: row.contact_id,
    tenantId: row.tenant_id,
    status: row.status,
    currentState: row.current_state,
    serviceWindowExpiresAt: row.service_window_expires_at,
    sessionExpiresAt: row.session_expires_at,
    lastInboundAt: row.last_inbound_at,
    context: conversationContextSchema.parse(row.context),
    version: row.version,
  };
}

function mapContact(input: unknown): WhatsAppContact {
  const row = contactSchema.parse(input);
  return {
    id: row.id,
    normalizedPhone: row.normalized_phone,
    whatsappUserId: row.whatsapp_user_id,
    profileName: row.profile_name,
    customerId: row.customer_id,
  };
}

export interface ExistingInboundMessage {
  messageId: string;
  conversationId: string;
  tenantId: string | null;
  conversationStatus: ConversationStatus;
  currentState: ConversationState;
  processed: boolean;
}

export async function findInboundMessage(input: {
  provider: string;
  providerMessageId: string;
}): Promise<ExistingInboundMessage | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("find_whatsapp_inbound_message", {
    p_provider: input.provider,
    p_provider_message_id: input.providerMessageId,
  });
  if (error) throw new Error("inbound_message_query_failed");
  const rows = z.array(z.object({
    message_id: z.guid(),
    conversation_id: z.guid(),
    tenant_id: z.guid().nullable(),
    conversation_status: conversationStatusSchema,
    current_state: conversationStateSchema,
    processed: z.boolean(),
  })).max(1).parse(data ?? []);
  const row = rows[0];
  return row
    ? {
        messageId: row.message_id,
        conversationId: row.conversation_id,
        tenantId: row.tenant_id,
        conversationStatus: row.conversation_status,
        currentState: row.current_state,
        processed: row.processed,
      }
    : null;
}

export function webhookExternalKey(
  provider: string,
  rawBody: string | Uint8Array,
): string {
  return `${provider}:${createHash("sha256").update(rawBody).digest("hex")}`;
}

export function serializeConversationResponse(
  response: ConversationResponse,
  idempotencyKey: string,
) {
  const messageType = response.kind === "reply_buttons" ? "button" : response.kind;
  const content = response.kind === "text"
    ? { text: response.body }
    : response.kind === "reply_buttons" || response.kind === "list"
      ? { text: response.body }
      : response.kind === "flow"
        ? { text: response.body }
        : { templateName: response.name, language: response.language };
  return {
    idempotency_key: idempotencyKey,
    message_type: messageType,
    content,
    normalized_content: content,
    payload: response,
  };
}

export async function storeWebhookEnvelope(input: {
  provider: string;
  rawBody: string | Uint8Array;
  payload: unknown;
  signatureValid: boolean;
  orderingKeys: string[];
  orderingGlobalFallback: boolean;
  correlationId?: string;
}): Promise<{ id: string | null; duplicate: boolean; correlationId: string }> {
  const admin = createAdminClient();
  const correlationId = input.correlationId ?? randomUUID();
  const externalEventKey = webhookExternalKey(input.provider, input.rawBody);
  const parsedOrderingKeys = z.array(
    z.string().regex(/^[0-9a-f]{64}$/),
  ).min(1).max(256).parse(input.orderingKeys);
  if (
    new Set(parsedOrderingKeys).size !== parsedOrderingKeys.length ||
    (input.orderingGlobalFallback && parsedOrderingKeys.length !== 1)
  ) {
    throw new Error("whatsapp_ordering_keys_invalid");
  }
  const orderingKeys = [...parsedOrderingKeys].sort();
  const { data, error } = await admin
    .from("whatsapp_webhook_events")
    .insert({
      provider: input.provider,
      external_event_key: externalEventKey,
      event_type: "envelope",
      signature_valid: input.signatureValid,
      payload: input.payload,
      processing_status: "received",
      correlation_id: correlationId,
      ordering_keys: orderingKeys,
      ordering_global_fallback: input.orderingGlobalFallback,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      const { data: existing, error: existingError } = await admin
        .from("whatsapp_webhook_events")
        .select("id, correlation_id")
        .eq("provider", input.provider)
        .eq("external_event_key", externalEventKey)
        .maybeSingle();
      if (existingError || !existing) {
        throw repositoryFailure(
          "whatsapp_inbox_duplicate_query_failed",
          "store_webhook_envelope",
          existingError,
        );
      }
      const parsed = z.object({ id: z.guid(), correlation_id: z.guid() }).parse(existing);
      return {
        id: parsed.id,
        duplicate: true,
        correlationId: parsed.correlation_id,
      };
    }
    throw repositoryFailure("whatsapp_inbox_store_failed", "store_webhook_envelope", error);
  }
  const id = z.object({ id: z.guid() }).parse(data).id;
  return { id, duplicate: false, correlationId };
}

export async function claimWebhookEvents(
  limit: number,
  workerId: string,
  provider: string,
  scope?: { provider: string; correlationId: string },
): Promise<ClaimedWebhookEvent[]> {
  const admin = createAdminClient();
  const { data, error } = scope
    ? await admin.rpc("claim_whatsapp_webhook_events_scoped", {
        p_limit: limit,
        p_worker_id: workerId,
        p_provider: scope.provider,
        p_correlation_id: scope.correlationId,
      })
    : await admin.rpc("claim_whatsapp_webhook_events", {
        p_limit: limit,
        p_worker_id: workerId,
        p_provider: provider,
      });
  if (error) throw repositoryFailure("whatsapp_inbox_claim_failed", "claim_inbox", error);
  return z.array(claimedWebhookSchema).parse(data ?? []);
}

export async function completeWebhookEvent(eventId: string, workerId: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_whatsapp_webhook_event", {
    p_event_id: eventId,
    p_worker_id: workerId,
  });
  if (error || data !== true) {
    throw repositoryFailure("whatsapp_inbox_complete_failed", "complete_inbox", error);
  }
}

export async function deferWebhookEvent(input: {
  eventId: string;
  workerId: string;
  errorCode: string;
  retry: boolean;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("defer_whatsapp_webhook_event", {
    p_event_id: input.eventId,
    p_worker_id: input.workerId,
    p_error: input.errorCode,
    p_retry: input.retry,
  });
  if (error || data !== true) {
    throw repositoryFailure("whatsapp_inbox_defer_failed", "defer_inbox", error);
  }
}

export async function findPhoneNumber(input: {
  provider: string;
  externalPhoneNumberId: string;
}): Promise<WhatsAppPhoneNumber> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_phone_numbers")
    .select(
      "id, provider, external_phone_number_id, normalized_phone_number, connection_mode, status",
    )
    .eq("provider", input.provider)
    .eq("external_phone_number_id", input.externalPhoneNumberId)
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw new Error("phone_number_query_failed");
  if (!data) throw new Error("phone_number_not_found");
  const row = phoneNumberSchema.parse(data);
  return {
    id: row.id,
    provider: row.provider,
    externalPhoneNumberId: row.external_phone_number_id,
    normalizedPhoneNumber: row.normalized_phone_number,
    connectionMode: row.connection_mode,
  };
}

export async function getPhoneNumberById(phoneNumberId: string): Promise<WhatsAppPhoneNumber> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_phone_numbers")
    .select(
      "id, provider, external_phone_number_id, normalized_phone_number, connection_mode, status",
    )
    .eq("id", phoneNumberId)
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw new Error("phone_number_query_failed");
  if (!data) throw new Error("phone_number_not_found");
  const row = phoneNumberSchema.parse(data);
  return {
    id: row.id,
    provider: row.provider,
    externalPhoneNumberId: row.external_phone_number_id,
    normalizedPhoneNumber: row.normalized_phone_number,
    connectionMode: row.connection_mode,
  };
}

export async function getConversationDeliveryContext(conversationId: string): Promise<{
  contactId: string;
  tenantId: string | null;
  phoneNumberId: string;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_conversations")
    .select("contact_id, tenant_id, phone_number_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error("conversation_query_failed");
  if (!data) throw new Error("conversation_not_found");
  const row = z.object({
    contact_id: z.guid(),
    tenant_id: z.guid().nullable(),
    phone_number_id: z.guid(),
  }).parse(data);
  return {
    contactId: row.contact_id,
    tenantId: row.tenant_id,
    phoneNumberId: row.phone_number_id,
  };
}

// O WhatsApp mantém os botões de mensagens antigas tocáveis para sempre. Saber
// qual foi a última saída permite distinguir o toque atual do toque atrasado,
// que responde a uma pergunta que já não está de pé.
export async function findLatestOutboundProviderMessageId(
  conversationId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_messages")
    .select("provider_message_id")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .not("provider_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw repositoryFailure(
      "inbound_message_query_failed",
      "find_latest_outbound",
      error,
    );
  }
  return z.object({ provider_message_id: z.string() })
    .nullable()
    .parse(data)?.provider_message_id ?? null;
}

// Toques concorrentes na mesma pergunta. Só são visíveis aqui porque a mensagem
// passa a ser gravada antes de a conversa ser travada — enquanto a gravação
// acontecia sob trava, o segundo toque ficava bloqueado e invisível ao primeiro.
export async function findUnprocessedRepliesToPrompt(input: {
  conversationId: string;
  providerReplyToId: string;
  excludeMessageId: string;
}): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_messages")
    .select("id")
    .eq("conversation_id", input.conversationId)
    .eq("direction", "inbound")
    .eq("provider_reply_to_id", input.providerReplyToId)
    .is("processed_at", null)
    .neq("id", input.excludeMessageId)
    .limit(10);
  if (error) {
    throw repositoryFailure(
      "inbound_message_query_failed",
      "find_prompt_replies",
      error,
    );
  }
  return z.array(z.object({ id: z.guid() })).parse(data ?? []).map((row) => row.id);
}

export async function upsertContact(input: {
  provider: string;
  normalizedPhone: string;
  whatsappUserId: string;
  profileName: string | null;
}): Promise<WhatsAppContact> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("upsert_whatsapp_contact", {
    p_provider: input.provider,
    p_whatsapp_user_id: input.whatsappUserId,
    p_normalized_phone: input.normalizedPhone,
    p_profile_name: input.profileName,
  });
  if (error || !data) throw new Error("whatsapp_contact_upsert_failed");
  return mapContact(data);
}

export async function getOrCreateConversation(input: {
  phoneNumberId: string;
  contactId: string;
  sessionTimeoutMinutes: number;
}): Promise<PersistedConversation> {
  const admin = createAdminClient();
  const openStatuses = ["open", "waiting_customer", "processing", "human_handoff"];
  const { data: existing, error: existingError } = await admin
    .from("whatsapp_conversations")
    .select(
      "id, phone_number_id, contact_id, tenant_id, status, current_state, service_window_expires_at, session_expires_at, last_inbound_at, context, version",
    )
    .eq("phone_number_id", input.phoneNumberId)
    .eq("contact_id", input.contactId)
    .in("status", openStatuses)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error("conversation_query_failed");
  if (existing) return mapConversation(existing);

  const expiresAt = new Date(Date.now() + input.sessionTimeoutMinutes * 60_000).toISOString();
  const { data, error } = await admin
    .from("whatsapp_conversations")
    .insert({
      phone_number_id: input.phoneNumberId,
      contact_id: input.contactId,
      status: "open",
      current_state: "START",
      service_window_expires_at: expiresAt,
      session_expires_at: expiresAt,
      context: conversationContextSchema.parse({}),
    })
    .select(
      "id, phone_number_id, contact_id, tenant_id, status, current_state, service_window_expires_at, session_expires_at, last_inbound_at, context, version",
    )
    .single();
  if (error) {
    if (error.code === "23505") return getOrCreateConversation(input);
    throw new Error("conversation_create_failed");
  }
  return mapConversation(data);
}

export async function getConversationById(
  conversationId: string,
): Promise<PersistedConversation> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_conversations")
    .select(
      "id, phone_number_id, contact_id, tenant_id, status, current_state, service_window_expires_at, session_expires_at, last_inbound_at, context, version",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data) throw new Error("conversation_query_failed");
  return mapConversation(data);
}

export async function lockConversation(input: {
  conversation: PersistedConversation;
  workerId: string;
}): Promise<PersistedConversation> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("lock_whatsapp_conversation", {
    p_conversation_id: input.conversation.id,
    p_expected_version: input.conversation.version,
    p_worker_id: input.workerId,
  });
  if (error || !data) {
    if (error?.code === "55P03" || error?.message.includes("conversation_locked")) {
      throw new Error("conversation_locked");
    }
    if (error?.code === "40001" || error?.message.includes("version_conflict")) {
      throw new Error("conversation_version_conflict");
    }
    throw new Error("conversation_lock_failed");
  }
  return mapConversation(data);
}

export async function releaseConversationLock(input: {
  conversationId: string;
  workerId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("whatsapp_conversations")
    .update({
      processing_locked_at: null,
      processing_locked_until: null,
      processing_locked_by: null,
    })
    .eq("id", input.conversationId)
    .eq("processing_locked_by", input.workerId);
  if (error) throw new Error("conversation_unlock_failed");
}

export async function recordInboundMessage(input: {
  provider: string;
  providerMessageId: string;
  conversation: PersistedConversation;
  tenantId: string | null;
  messageType: string;
  text: string;
  providerReplyToId: string | null;
  receivedAt: string;
}): Promise<{ id: string; duplicate: boolean; processed: boolean; stale: boolean }> {
  const admin = createAdminClient();
  void input.tenantId;
  const { data, error } = await admin.rpc("record_whatsapp_inbound_message", {
    p_provider: input.provider,
    p_provider_message_id: input.providerMessageId,
    p_conversation_id: input.conversation.id,
    p_message_type: input.messageType,
    p_text: input.text,
    p_provider_reply_to_id: input.providerReplyToId,
    p_received_at: input.receivedAt,
  });
  if (error) throw new Error("inbound_message_store_failed");
  const result = z
    .array(
      z.object({
        message_id: z.guid(),
        duplicate: z.boolean(),
        processed: z.boolean(),
        stale: z.boolean(),
      }),
    )
    .length(1)
    .parse(data)[0];
  if (!result) throw new Error("inbound_message_store_failed");
  return {
    id: result.message_id,
    duplicate: result.duplicate,
    processed: result.processed,
    stale: result.stale,
  };
}

export async function ignoreInboundMessage(messageId: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_messages")
    .update({
      status: "ignored",
      processed_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .is("processed_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("inbound_message_ignore_failed");
  if (!data) {
    const { data: existing, error: existingError } = await admin
      .from("whatsapp_messages")
      .select("id, processed_at")
      .eq("id", messageId)
      .maybeSingle();
    if (existingError || !existing?.processed_at) {
      throw new Error("inbound_message_ignore_failed");
    }
  }
}

export async function commitTransition(input: {
  conversation: PersistedConversation;
  transition: ConversationTransition;
  recipient: string;
  inboundMessageId: string;
}): Promise<PersistedConversation> {
  const admin = createAdminClient();
  const responses = input.transition.responses.map((response, index) =>
    serializeConversationResponse(
      response,
      `${input.conversation.id}:${input.conversation.version + 1}:${index}`,
    ),
  );
  if (input.transition.restartReason) {
    const { data, error } = await admin.rpc("commit_whatsapp_conversation_restart", {
      p_conversation_id: input.conversation.id,
      p_inbound_message_id: input.inboundMessageId,
      p_expected_version: input.conversation.version,
      p_restart_reason: input.transition.restartReason,
      p_state: input.transition.state,
      p_status: input.transition.status ?? "waiting_customer",
      p_tenant_id:
        input.transition.tenantId === undefined
          ? input.conversation.tenantId
          : input.transition.tenantId,
      p_context: input.transition.context,
      p_responses: responses,
      p_recipient: input.recipient,
    });
    if (error || !data) {
      if (error?.message.includes("conversation_version_conflict")) {
        throw new Error("conversation_version_conflict");
      }
      throw new Error("conversation_restart_failed");
    }
    return mapConversation(data);
  }
  const { data, error } = await admin.rpc("commit_whatsapp_conversation_transition", {
    p_conversation_id: input.conversation.id,
    p_inbound_message_id: input.inboundMessageId,
    p_expected_version: input.conversation.version,
    p_state: input.transition.state,
    p_status: input.transition.status ?? "waiting_customer",
    p_tenant_id:
      input.transition.tenantId === undefined
        ? input.conversation.tenantId
        : input.transition.tenantId,
    p_context: input.transition.context,
    p_responses: responses,
    p_recipient: input.recipient,
  });
  if (error) {
    if (error.message.includes("conversation_version_conflict")) {
      throw new Error("conversation_version_conflict");
    }
    throw new Error("conversation_transition_failed");
  }
  if (data !== true) throw new Error("conversation_version_conflict");
  const { data: updated, error: updatedError } = await admin
    .from("whatsapp_conversations")
    .select(
      "id, phone_number_id, contact_id, tenant_id, status, current_state, service_window_expires_at, session_expires_at, last_inbound_at, context, version",
    )
    .eq("id", input.conversation.id)
    .single();
  if (updatedError || !updated) throw new Error("conversation_transition_read_failed");
  return mapConversation(updated);
}

export async function enqueueResponse(input: {
  conversation: PersistedConversation;
  response: ConversationResponse;
  recipient: string;
  idempotencyKey: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("enqueue_whatsapp_response", {
    p_conversation_id: input.conversation.id,
    p_response: input.response,
    p_recipient: input.recipient,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error || data !== true) throw new Error("whatsapp_outbox_enqueue_failed");
}

export async function claimOutboxMessages(
  limit: number,
  workerId: string,
  provider: string,
  scope?: { provider: string; conversationId: string },
): Promise<ClaimedOutboxMessage[]> {
  const admin = createAdminClient();
  const { data, error } = scope
    ? await admin.rpc("claim_whatsapp_outbox_scoped", {
        p_limit: limit,
        p_worker_id: workerId,
        p_provider: scope.provider,
        p_conversation_id: scope.conversationId,
      })
    : await admin.rpc("claim_whatsapp_outbox", {
        p_limit: limit,
        p_worker_id: workerId,
        p_provider: provider,
      });
  if (error) throw repositoryFailure("whatsapp_outbox_claim_failed", "claim_outbox", error);
  return z.array(claimedOutboxSchema).parse(data ?? []);
}

export async function completeOutboxMessage(input: {
  outboxId: string;
  workerId: string;
  providerMessageId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_whatsapp_outbox", {
    p_outbox_id: input.outboxId,
    p_worker_id: input.workerId,
    p_provider_message_id: input.providerMessageId,
  });
  if (error || data !== true) {
    throw repositoryFailure("whatsapp_outbox_complete_failed", "complete_outbox", error);
  }
}

export async function validateOutboxDelivery(input: {
  outboxId: string;
  workerId: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("validate_whatsapp_outbox_delivery", {
    p_outbox_id: input.outboxId,
    p_worker_id: input.workerId,
  });
  if (error) {
    throw repositoryFailure("whatsapp_outbox_validation_failed", "validate_outbox", error);
  }
  return data === true;
}

export async function markOutboxDeliveryAmbiguous(input: {
  outboxId: string;
  workerId: string;
  providerMessageId: string | null;
  errorCode: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mark_whatsapp_outbox_delivery_ambiguous", {
    p_outbox_id: input.outboxId,
    p_worker_id: input.workerId,
    p_provider_message_id: input.providerMessageId,
    p_error: input.errorCode,
  });
  if (error || data !== true) {
    throw repositoryFailure("whatsapp_outbox_ambiguous_failed", "mark_outbox_ambiguous", error);
  }
}

export async function deferOutboxMessage(input: {
  outboxId: string;
  workerId: string;
  errorCode: string;
  retry: boolean;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("defer_whatsapp_outbox", {
    p_outbox_id: input.outboxId,
    p_worker_id: input.workerId,
    p_error: input.errorCode,
    p_retry: input.retry,
  });
  if (error || data !== true) {
    throw repositoryFailure("whatsapp_outbox_defer_failed", "defer_outbox", error);
  }
}

export async function updateMessageStatus(input: {
  provider: string;
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  errorCode?: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_whatsapp_message_status", {
    p_provider: input.provider,
    p_provider_message_id: input.providerMessageId,
    p_status: input.status,
    p_timestamp: input.timestamp,
    p_error_code: input.errorCode ?? null,
  });
  if (error) throw new Error("message_status_update_failed");
  return data === true;
}

export function stateUpdate(
  state: ConversationState,
  status: ConversationStatus,
  context: ConversationContext,
  responses: ConversationResponse[],
): ConversationTransition {
  return { state, status, context, responses };
}
