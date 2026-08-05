import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { processWhatsAppInbox } from "@/features/whatsapp/application/process-inbox";
import {
  processSimulatorOutbox,
  type SimulatorDeliveryDiagnostic,
} from "@/features/whatsapp/application/process-simulator-outbox";
import { getWhatsAppOrdering } from "@/features/whatsapp/application/webhook-ordering";
import { getWhatsAppConfig } from "@/features/whatsapp/config";
import { conversationContextSchema } from "@/features/whatsapp/domain/conversation";
import type { NormalizedWhatsAppEvent } from "@/features/whatsapp/domain/provider";
import { resolveWhatsAppSimulatorProvider } from "@/features/whatsapp/infrastructure/providers/resolver";
import { storeWebhookEnvelope } from "@/features/whatsapp/infrastructure/repositories/channel-repository";
import { whatsappSimulatorInputSchema } from "@/features/whatsapp/presentation/simulator-contract";
import { getWhatsAppReadiness } from "@/features/whatsapp/readiness";
import { getPlatformOwnerAccess } from "@/features/platform/access";
import { isTrustedMutationRequest } from "@/lib/security/origin";
import { createAdminClient } from "@/lib/supabase/admin";

function interactiveEvent(
  input: z.infer<typeof whatsappSimulatorInputSchema>,
  provider: ReturnType<typeof resolveWhatsAppSimulatorProvider>,
): NormalizedWhatsAppEvent {
  const base = provider.simulateInboundText({
    idempotencyKey: randomUUID(),
    externalPhoneNumberId: input.receiverPhoneNumberId,
    sender: input.customerPhone.replace(/^\+/, ""),
    body: input.message,
    profileName: "Cliente Simulado",
  });
  if (base.kind !== "message.text") throw new Error("mock_event_invalid");
  if (input.interactionType === "button") {
    return {
      ...base,
      kind: "message.button",
      buttonId: input.selectionId ?? input.message,
      title: input.message,
    };
  }
  if (input.interactionType === "list") {
    return {
      ...base,
      kind: "message.list",
      rowId: input.selectionId ?? input.message,
      title: input.message,
      description: null,
    };
  }
  return base;
}

async function loadSimulationResult(input: {
  externalPhoneNumberId: string;
  sender: string;
  conversationId?: string;
}) {
  const admin = createAdminClient();
  const { data: phone, error: phoneError } = await admin
    .from("whatsapp_phone_numbers")
    .select("id")
    .eq("provider", "mock")
    .eq("external_phone_number_id", input.externalPhoneNumberId)
    .maybeSingle();
  if (phoneError) throw new Error("simulator_phone_query_failed");
  if (!phone) return { conversation: null, tenant: null, messages: [], appointment: null };
  const { data: contact, error: contactError } = await admin
    .from("whatsapp_contacts")
    .select("id")
    .eq("provider", "mock")
    .eq("whatsapp_user_id", input.sender)
    .maybeSingle();
  if (contactError) throw new Error("simulator_contact_query_failed");
  if (!contact) return { conversation: null, tenant: null, messages: [], appointment: null };
  let conversationQuery = admin
    .from("whatsapp_conversations")
    .select("id, current_state, status, tenant_id, context")
    .eq("phone_number_id", phone.id)
    .eq("contact_id", contact.id);
  if (input.conversationId) {
    conversationQuery = conversationQuery.eq("id", input.conversationId);
  }
  const { data: conversation, error: conversationError } = await conversationQuery
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conversationError) throw new Error("simulator_conversation_query_failed");
  if (!conversation) {
    return { conversation: null, tenant: null, messages: [], appointment: null };
  }
  const context = conversationContextSchema.safeParse(conversation.context);
  const appointmentId = context.success
    ? context.data.booking.appointmentId ?? null
    : null;
  const [tenantResult, messagesResult, appointmentResult] = await Promise.all([
    conversation.tenant_id
      ? admin.from("tenants").select("id, name, slug").eq("id", conversation.tenant_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("whatsapp_messages")
      .select("id, direction, message_type, content, status")
      .eq("conversation_id", conversation.id)
      .order("created_at")
      .limit(100),
    appointmentId && conversation.tenant_id
      ? admin
          .from("appointments")
          .select("id, starts_at, status")
          .eq("id", appointmentId)
          .eq("tenant_id", conversation.tenant_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if ("error" in tenantResult && tenantResult.error) {
    throw new Error("simulator_tenant_query_failed");
  }
  if (messagesResult.error) throw new Error("simulator_messages_query_failed");
  if ("error" in appointmentResult && appointmentResult.error) {
    throw new Error("simulator_appointment_query_failed");
  }
  const tenant = tenantResult.data;
  const messages = messagesResult.data;
  const appointment = appointmentResult.data;
  return {
    conversation: {
      id: conversation.id,
      currentState: conversation.current_state,
      status: conversation.status,
    },
    tenant,
    appointment: appointment
      ? {
          id: appointment.id,
          startsAt: appointment.starts_at,
          status: appointment.status,
        }
      : null,
    messages: (messages ?? []).map((message) => ({
      id: message.id,
      direction: message.direction,
      kind: message.message_type,
      body:
        message.content &&
        typeof message.content === "object" &&
        "text" in message.content &&
        typeof message.content.text === "string"
          ? message.content.text
          : message.message_type,
      status: message.status,
    })),
  };
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("origin") || !isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  }
  const owner = await getPlatformOwnerAccess();
  if (!owner) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const config = getWhatsAppConfig();
  if (getWhatsAppReadiness(config).simulator.status !== "ready") {
    return NextResponse.json({ error: "Simulador indisponível." }, { status: 404 });
  }
  const parsed = whatsappSimulatorInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
  }
  const input = parsed.data;
  if (input.conversationId) {
    const existing = await loadSimulationResult({
      externalPhoneNumberId: input.receiverPhoneNumberId,
      sender: input.customerPhone.replace(/^\+/, ""),
      conversationId: input.conversationId,
    });
    if (!existing.conversation) {
      return NextResponse.json({ error: "Conversa inválida." }, { status: 409 });
    }
  }
  const provider = resolveWhatsAppSimulatorProvider({
    config,
    mock: {
      duplicateEvents: input.simulation.duplicate,
      outOfOrderEvents: input.simulation.outOfOrder,
      transientFailures: input.simulation.providerFailure
        ? { sendText: 1, sendInteractive: 1, sendTemplate: 1 }
        : 0,
    },
  });
  const inbound = interactiveEvent(input, provider);
  const events: NormalizedWhatsAppEvent[] = [inbound];
  if (input.simulation.outOfOrder) {
    events.push({
      kind: "status",
      provider: "mock",
      eventId: `${inbound.eventId}:status`,
      externalPhoneNumberId: input.receiverPhoneNumberId,
      externalWabaId: null,
      occurredAt: new Date(Date.now() - 1_000).toISOString(),
      messageId: `mock:out:${inbound.eventId}`,
      recipient: input.customerPhone.replace(/^\+/, ""),
      status: "delivered",
      conversationId: null,
    });
  }
  const payload = { events };
  const rawBody = JSON.stringify(payload);
  let ordering = getWhatsAppOrdering(provider.provider, []);
  try {
    ordering = getWhatsAppOrdering(
      provider.provider,
      await provider.normalizeWebhook(payload),
    );
  } catch {
    // O simulador deve preservar o envelope para o worker reproduzir a falha.
  }
  const stored = await storeWebhookEnvelope({
    provider: "mock",
    rawBody,
    payload,
    signatureValid: true,
    orderingKeys: ordering.keys,
    orderingGlobalFallback: ordering.globalFallback,
  });
  if (input.simulation.delayMs) {
    await new Promise((resolve) => setTimeout(resolve, input.simulation.delayMs));
  }
  await processWhatsAppInbox({
    provider,
    limit: 1,
    workerId: `simulator:${owner.id}`,
    scope: { provider: "mock", correlationId: stored.correlationId },
  });
  let result = await loadSimulationResult({
    externalPhoneNumberId: input.receiverPhoneNumberId,
    sender: input.customerPhone.replace(/^\+/, ""),
  });
  let delivery: SimulatorDeliveryDiagnostic | null = null;
  if (result.conversation) {
    delivery = await processSimulatorOutbox({
      provider,
      workerId: `simulator:${owner.id}`,
      conversationId: result.conversation.id,
      providerFailureInjected: input.simulation.providerFailure,
    });
    result = await loadSimulationResult({
      externalPhoneNumberId: input.receiverPhoneNumberId,
      sender: input.customerPhone.replace(/^\+/, ""),
    });
  }
  const responses = provider.sentMessages.map((entry) =>
    entry.kind === "text" ? { kind: "text", body: entry.input.body } : entry.input.response,
  );
  return NextResponse.json(
    {
      correlationId: stored.correlationId,
      ...result,
      responses,
      delivery,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
