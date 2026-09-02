import "server-only";

import { z } from "zod";
import {
  isRedactedContent,
  messageBody,
  type WhatsAppMessageType,
} from "@/features/whatsapp/presentation/conversation-labels";
import { maskWhatsAppContact } from "@/features/whatsapp/presentation/queries";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const CONVERSATION_PAGE_SIZE = 30;
const TRANSCRIPT_PAGE_SIZE = 100;
// Prévia: uma consulta só para todas as conversas listadas, reduzida em JS à
// primeira mensagem de cada uma. Uma conversa muito falante pode consumir a
// fatia e privar outra da prévia — nesse caso a lista mostra "—".
const PREVIEW_MESSAGES_PER_CONVERSATION = 6;

const conversationRowSchema = z.object({
  id: z.guid(),
  contact_id: z.guid(),
  status: z.string(),
  current_state: z.string(),
  service_window_expires_at: z.string().nullable(),
  last_inbound_at: z.string().nullable(),
  last_outbound_at: z.string().nullable(),
  updated_at: z.string(),
  started_at: z.string(),
});

const contactRowSchema = z.object({
  id: z.guid(),
  normalized_phone: z.string().nullable(),
  profile_name: z.string().nullable(),
});

const messageRowSchema = z.object({
  id: z.guid(),
  conversation_id: z.guid(),
  direction: z.enum(["inbound", "outbound"]),
  message_type: z.string(),
  status: z.string(),
  error_code: z.string().nullable(),
  content: z.unknown(),
  sent_at: z.string().nullable(),
  created_at: z.string(),
});

const customerRowSchema = z.object({
  id: z.guid(),
  full_name: z.string(),
  phone_e164: z.string(),
});

const customerTenantRowSchema = z.object({
  customer_id: z.guid(),
  display_name: z.string().nullable(),
});

const MESSAGE_COLUMNS =
  "id, conversation_id, direction, message_type, status, error_code, content, sent_at, created_at";
const CONVERSATION_COLUMNS =
  "id, contact_id, status, current_state, service_window_expires_at, last_inbound_at, last_outbound_at, updated_at, started_at";

export interface WhatsAppConversationListItem {
  id: string;
  contactLabel: string;
  customerName: string | null;
  status: string;
  currentState: string;
  serviceWindowExpiresAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  updatedAt: string;
  preview: string | null;
  previewDirection: "inbound" | "outbound" | null;
}

export interface WhatsAppTranscriptMessage {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  messageType: WhatsAppMessageType;
  status: string;
  errorCode: string | null;
  content: unknown;
  createdAt: string;
}

export interface WhatsAppTranscript {
  conversationId: string;
  contactLabel: string;
  customerName: string | null;
  status: string;
  currentState: string;
  serviceWindowExpiresAt: string | null;
  messages: WhatsAppTranscriptMessage[];
  hasMore: boolean;
  oldestCreatedAt: string | null;
}

export interface WhatsAppConversationsView {
  conversations: WhatsAppConversationListItem[];
  transcript: WhatsAppTranscript | null;
  handoffOnly: boolean;
  warnings: string[];
}

function rowsFrom<T>(schema: z.ZodType<T>, value: unknown): T[] {
  const parsed = z.array(schema).safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

function asMessageType(value: string): WhatsAppMessageType {
  return value as WhatsAppMessageType;
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Rótulo do contato. `whatsapp_contacts` é identidade global sem `tenant_id`, e
// `authenticated` só enxerga id, normalized_phone e profile_name — por isso o
// telefone só aparece mascarado. O nome escopado ao tenant vem pelo caminho
// inverso (customers + customer_tenants), que é o único com RLS por tenant.
async function loadContactLabels(
  supabase: ServerClient,
  tenantId: string,
  contactIds: string[],
): Promise<{
  labels: Map<string, string>;
  customerNames: Map<string, string>;
  error: boolean;
}> {
  const labels = new Map<string, string>();
  const customerNames = new Map<string, string>();
  if (!contactIds.length) return { labels, customerNames, error: false };

  const contactsResult = await supabase
    .from("whatsapp_contacts")
    .select("id, normalized_phone, profile_name")
    .in("id", contactIds);
  const contacts = rowsFrom(contactRowSchema, contactsResult.data);

  for (const contact of contacts) {
    labels.set(
      contact.id,
      maskWhatsAppContact({
        profileName: contact.profile_name,
        normalizedPhone: contact.normalized_phone,
      }),
    );
  }

  const phones = [
    ...new Set(
      contacts
        .map(({ normalized_phone }) => normalized_phone)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  if (phones.length) {
    // Melhor esforço: para quem só tem a permissão `whatsapp_handoff` a RLS de
    // clientes costuma negar, zero linhas voltam e a lista fica no rótulo
    // mascarado. Sem erro e sem página quebrada.
    const customersResult = await supabase
      .from("customers")
      .select("id, full_name, phone_e164")
      .in("phone_e164", phones)
      .is("deleted_at", null);
    const customers = rowsFrom(customerRowSchema, customersResult.data);

    if (customers.length) {
      const linkResult = await supabase
        .from("customer_tenants")
        .select("customer_id, display_name")
        .eq("tenant_id", tenantId)
        .in("customer_id", customers.map(({ id }) => id));
      const displayNames = new Map(
        rowsFrom(customerTenantRowSchema, linkResult.data).map((row) => [row.customer_id, row.display_name]),
      );
      const namesByPhone = new Map<string, string>();
      for (const customer of customers) {
        if (!displayNames.has(customer.id)) continue;
        namesByPhone.set(customer.phone_e164, displayNames.get(customer.id) ?? customer.full_name);
      }
      for (const contact of contacts) {
        const name = contact.normalized_phone ? namesByPhone.get(contact.normalized_phone) : undefined;
        if (name) customerNames.set(contact.id, name);
      }
    }
  }

  return { labels, customerNames, error: Boolean(contactsResult.error) };
}

async function loadPreviews(
  supabase: ServerClient,
  tenantId: string,
  conversationIds: string[],
): Promise<{
  byConversation: Map<string, { text: string; direction: "inbound" | "outbound" }>;
  error: boolean;
}> {
  const byConversation = new Map<string, { text: string; direction: "inbound" | "outbound" }>();
  if (!conversationIds.length) return { byConversation, error: false };

  const result = await supabase
    .from("whatsapp_messages")
    .select(MESSAGE_COLUMNS)
    .in("conversation_id", conversationIds)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(conversationIds.length * PREVIEW_MESSAGES_PER_CONVERSATION);

  for (const row of rowsFrom(messageRowSchema, result.data)) {
    if (byConversation.has(row.conversation_id)) continue;
    byConversation.set(row.conversation_id, {
      text: messageBody({ messageType: asMessageType(row.message_type), content: row.content }).text,
      direction: row.direction,
    });
  }

  return { byConversation, error: Boolean(result.error) };
}

export async function listTenantWhatsAppConversations(
  tenantId: string,
  options: { handoffOnly: boolean; limit?: number },
): Promise<{ conversations: WhatsAppConversationListItem[]; error: boolean }> {
  const supabase = await createClient();
  const limit = options.limit ?? CONVERSATION_PAGE_SIZE;

  // `.eq("tenant_id", …)` além da RLS: exclui também as conversas ainda sem
  // estabelecimento resolvido (`tenant_id null`), que num número compartilhado
  // são exatamente a janela de ambiguidade entre tenants.
  let query = supabase
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (options.handoffOnly) query = query.eq("status", "human_handoff");

  const conversationsResult = await query;
  const rows = rowsFrom(conversationRowSchema, conversationsResult.data);
  let error = Boolean(conversationsResult.error);
  if (!rows.length) return { conversations: [], error };

  const contactIds = [...new Set(rows.map(({ contact_id }) => contact_id))];
  const [contactInfo, previews] = await Promise.all([
    loadContactLabels(supabase, tenantId, contactIds),
    loadPreviews(supabase, tenantId, rows.map(({ id }) => id)),
  ]);
  error ||= contactInfo.error || previews.error;

  return {
    conversations: rows.map((row) => {
      const preview = previews.byConversation.get(row.id) ?? null;
      return {
        id: row.id,
        contactLabel: contactInfo.labels.get(row.contact_id) ?? "Contato oculto",
        customerName: contactInfo.customerNames.get(row.contact_id) ?? null,
        status: row.status,
        currentState: row.current_state,
        serviceWindowExpiresAt: row.service_window_expires_at,
        lastInboundAt: row.last_inbound_at,
        lastOutboundAt: row.last_outbound_at,
        updatedAt: row.updated_at,
        preview: preview?.text ?? null,
        previewDirection: preview?.direction ?? null,
      };
    }),
    error,
  };
}

export async function getTenantWhatsAppTranscript(
  tenantId: string,
  conversationId: string,
  options: { before?: string; limit?: number } = {},
): Promise<WhatsAppTranscript | null> {
  const supabase = await createClient();
  const limit = options.limit ?? TRANSCRIPT_PAGE_SIZE;

  // `maybeSingle`, nunca `single`: um usuário com apenas a permissão
  // `whatsapp_handoff` que abra por link uma conversa fora da fila recebe zero
  // linhas pela RLS, e `single` transformaria isso em erro 500.
  const conversationResult = await supabase
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const conversation = conversationRowSchema.safeParse(conversationResult.data);
  if (!conversation.success) return null;

  let query = supabase
    .from("whatsapp_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (options.before) query = query.lt("created_at", options.before);

  const messagesResult = await query;
  const rows = rowsFrom(messageRowSchema, messagesResult.data);
  const hasMore = rows.length > limit;
  const messages = (hasMore ? rows.slice(0, limit) : rows)
    .map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      direction: row.direction,
      messageType: asMessageType(row.message_type),
      status: row.status,
      errorCode: row.error_code,
      // Mensagem redigida pela retenção não sai daqui com resíduo de conteúdo.
      content: isRedactedContent(row.content) ? { _retention: { redacted: true } } : row.content,
      createdAt: row.created_at,
    }))
    .reverse();

  const contactInfo = await loadContactLabels(supabase, tenantId, [conversation.data.contact_id]);

  return {
    conversationId: conversation.data.id,
    contactLabel: contactInfo.labels.get(conversation.data.contact_id) ?? "Contato oculto",
    customerName: contactInfo.customerNames.get(conversation.data.contact_id) ?? null,
    status: conversation.data.status,
    currentState: conversation.data.current_state,
    serviceWindowExpiresAt: conversation.data.service_window_expires_at,
    messages,
    hasMore,
    oldestCreatedAt: messages[0]?.createdAt ?? null,
  };
}

export async function getTenantWhatsAppConversationsView(input: {
  tenantId: string;
  handoffOnly: boolean;
  conversationId?: string;
  before?: string;
}): Promise<WhatsAppConversationsView> {
  if (!isSupabaseConfigured()) {
    return {
      conversations: [],
      transcript: null,
      handoffOnly: input.handoffOnly,
      warnings: ["Conecte o Supabase local para acompanhar as conversas."],
    };
  }

  const [list, transcript] = await Promise.all([
    listTenantWhatsAppConversations(input.tenantId, { handoffOnly: input.handoffOnly }),
    input.conversationId
      ? getTenantWhatsAppTranscript(
        input.tenantId,
        input.conversationId,
        input.before ? { before: input.before } : {},
      )
      : Promise.resolve(null),
  ]);

  const warnings: string[] = [];
  if (list.error) warnings.push("Parte das conversas não pôde ser carregada agora.");

  return {
    conversations: list.conversations,
    transcript,
    handoffOnly: input.handoffOnly,
    warnings,
  };
}
