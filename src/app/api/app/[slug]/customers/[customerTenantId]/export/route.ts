import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantAccess } from "@/features/tenants/access";
import { projectWhatsAppConversationContext } from "@/features/whatsapp/presentation/data-export";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

interface ExportRouteProps {
  params: Promise<{ slug: string; customerTenantId: string }>;
}

export async function GET(_request: Request, { params }: ExportRouteProps) {
  const { slug, customerTenantId } = await params;
  const parsedId = z.guid().safeParse(customerTenantId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 });
  const tenant = await getTenantAccess(slug, user.id);
  if (!tenant || !["owner", "admin"].includes(tenant.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: customer, error: customerError } = await supabase
    .from("customer_tenants")
    .select(
      "id, customer_id, display_name, tags, first_visit_at, last_visit_at, next_appointment_at, appointments_count, completed_count, cancellation_count, no_show_count, source, created_at, customers!customer_tenants_customer_id_fkey(full_name, phone_e164, email, birth_date, locale, created_at, updated_at)",
    )
    .eq("tenant_id", tenant.id)
    .eq("id", parsedId.data)
    .single();
  if (customerError || !customer) {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }
  const customerIdentity = Array.isArray(customer.customers)
    ? customer.customers[0]
    : customer.customers;
  if (!customerIdentity?.phone_e164) {
    return NextResponse.json({ error: "Exportação indisponível." }, { status: 503 });
  }

  const { data: appointments, error: appointmentError } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, ends_at, timezone, total_cents, currency, origin, status, customer_notes, cancellation_reason, created_at, updated_at",
    )
    .eq("tenant_id", tenant.id)
    .eq("customer_tenant_id", parsedId.data)
    .order("starts_at", { ascending: false });
  if (appointmentError) {
    return NextResponse.json({ error: "Exportação indisponível." }, { status: 503 });
  }

  const appointmentIds = (appointments ?? []).map((appointment) => appointment.id);
  const services = appointmentIds.length
    ? await supabase
        .from("appointment_services")
        .select("appointment_id, name_snapshot, duration_minutes, price_cents")
        .eq("tenant_id", tenant.id)
        .in("appointment_id", appointmentIds)
        .order("sort_order")
    : { data: [], error: null };
  if (services.error) {
    return NextResponse.json({ error: "Exportação indisponível." }, { status: 503 });
  }

  const conversations = await supabase
    .from("whatsapp_conversations")
    .select(
      "id, contact_id, status, current_state, context, service_window_expires_at, session_expires_at, handoff_requested_at, last_inbound_at, last_outbound_at, started_at, closed_at, created_at, updated_at, whatsapp_contacts!inner(id, normalized_phone, profile_name)",
    )
    .eq("tenant_id", tenant.id)
    .eq("whatsapp_contacts.normalized_phone", customerIdentity.phone_e164)
    .order("started_at");
  if (conversations.error) {
    return NextResponse.json({ error: "Exportação indisponível." }, { status: 503 });
  }

  const contactIds = [
    ...new Set((conversations.data ?? []).map((conversation) => conversation.contact_id)),
  ];
  const optIns = contactIds.length
    ? await supabase
        .from("whatsapp_opt_ins")
        .select(
          "id, contact_id, category, status, source, policy_version, evidence, granted_at, revoked_at, created_at, updated_at",
        )
        .eq("tenant_id", tenant.id)
        .in("contact_id", contactIds)
        .order("created_at")
    : { data: [], error: null };
  if (optIns.error) {
    return NextResponse.json({ error: "Exportação indisponível." }, { status: 503 });
  }

  const conversationIds = (conversations.data ?? []).map((conversation) => conversation.id);
  const [messages, handoffs] = conversationIds.length
    ? await Promise.all([
        supabase
          .from("whatsapp_messages")
          .select(
            "id, conversation_id, direction, message_type, status, content, sent_at, delivered_at, read_at, failed_at, created_at, updated_at",
          )
          .eq("tenant_id", tenant.id)
          .in("conversation_id", conversationIds)
          .order("created_at"),
        supabase
          .from("whatsapp_handoffs")
          .select(
            "id, conversation_id, requested_by, reason, status, requested_at, accepted_at, resolved_at, resolution_notes, created_at, updated_at",
          )
          .eq("tenant_id", tenant.id)
          .in("conversation_id", conversationIds)
          .order("requested_at"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (messages.error || handoffs.error) {
    return NextResponse.json({ error: "Exportação indisponível." }, { status: 503 });
  }

  const contactsById = new Map<
    string,
    {
      id: string;
      normalizedPhone: string;
      profileName: string | null;
      firstSeenAt: string;
      lastSeenAt: string;
    }
  >();
  for (const conversation of conversations.data ?? []) {
    const contact = Array.isArray(conversation.whatsapp_contacts)
      ? conversation.whatsapp_contacts[0]
      : conversation.whatsapp_contacts;
    if (!contact) continue;
    const firstSeenAt = conversation.started_at ?? conversation.created_at;
    const lastSeenAt =
      conversation.last_inbound_at ??
      conversation.last_outbound_at ??
      conversation.updated_at;
    const existing = contactsById.get(contact.id);
    contactsById.set(contact.id, {
      id: contact.id,
      normalizedPhone: contact.normalized_phone,
      profileName: contact.profile_name,
      firstSeenAt:
        existing && existing.firstSeenAt < firstSeenAt ? existing.firstSeenAt : firstSeenAt,
      lastSeenAt:
        existing && existing.lastSeenAt > lastSeenAt ? existing.lastSeenAt : lastSeenAt,
    });
  }

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      establishment: { id: tenant.id, name: tenant.name },
      customer,
      appointments: (appointments ?? []).map((appointment) => ({
        ...appointment,
        services: (services.data ?? []).filter(
          (service) => service.appointment_id === appointment.id,
        ),
      })),
      whatsapp: {
        contacts: [...contactsById.values()],
        optIns: optIns.data ?? [],
        conversations: (conversations.data ?? []).map((conversation) => ({
          id: conversation.id,
          contact_id: conversation.contact_id,
          status: conversation.status,
          current_state: conversation.current_state,
          customer_provided_context: projectWhatsAppConversationContext(
            conversation.context,
          ),
          service_window_expires_at: conversation.service_window_expires_at,
          session_expires_at: conversation.session_expires_at,
          handoff_requested_at: conversation.handoff_requested_at,
          last_inbound_at: conversation.last_inbound_at,
          last_outbound_at: conversation.last_outbound_at,
          started_at: conversation.started_at,
          closed_at: conversation.closed_at,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
          messages: (messages.data ?? []).filter(
            (message) => message.conversation_id === conversation.id,
          ),
          handoffs: (handoffs.data ?? []).filter(
            (handoff) => handoff.conversation_id === conversation.id,
          ),
        })),
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="cliente-${parsedId.data}.json"`,
      },
    },
  );
}
