import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";
import { deliverNotification } from "./provider";
import type { NotificationMessage } from "./types";

const outboxEventSchema = z.object({
  id: z.guid(),
  tenant_id: z.guid(),
  aggregate_id: z.guid(),
  event_type: z.string(),
});

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.message.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown_error";
}

async function loadMessage(
  event: z.infer<typeof outboxEventSchema>,
): Promise<NotificationMessage> {
  const admin = createAdminClient();
  const { data: appointment, error: appointmentError } = await admin
    .from("appointments")
    .select("id, tenant_id, customer_tenant_id, starts_at, status")
    .eq("id", event.aggregate_id)
    .eq("tenant_id", event.tenant_id)
    .single();
  if (appointmentError || !appointment) throw new Error("appointment_not_found");

  const [{ data: relation }, { data: tenant }, { data: services }] = await Promise.all([
    admin
      .from("customer_tenants")
      .select("customer_id")
      .eq("id", appointment.customer_tenant_id)
      .eq("tenant_id", event.tenant_id)
      .single(),
    admin.from("tenants").select("id, name").eq("id", event.tenant_id).single(),
    admin
      .from("appointment_services")
      .select("name_snapshot")
      .eq("appointment_id", appointment.id)
      .eq("tenant_id", event.tenant_id)
      .order("sort_order"),
  ]);
  if (!relation || !tenant) throw new Error("notification_context_not_found");

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("full_name, email, phone_e164")
    .eq("id", relation.customer_id)
    .single();
  if (customerError || !customer) throw new Error("notification_recipient_not_found");

  return {
    eventId: event.id,
    eventType: event.event_type,
    tenant: { id: tenant.id, name: tenant.name },
    appointment: {
      id: appointment.id,
      startsAt: appointment.starts_at,
      status: appointment.status,
      serviceNames: (services ?? []).map((service) => service.name_snapshot),
    },
    recipient: {
      name: customer.full_name,
      email: customer.email,
      phone: customer.phone_e164,
    },
  };
}

export async function processOutbox(limit = 10) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_outbox_events", { p_limit: limit });
  if (error) throw new Error("outbox_claim_failed");

  const events = z.array(outboxEventSchema).parse(data ?? []);
  let processed = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const message = await loadMessage(event);
      await deliverNotification(message);
      const { error: completeError } = await admin.rpc("complete_outbox_event", {
        p_event_id: event.id,
      });
      if (completeError) throw new Error("outbox_complete_failed");
      processed += 1;
    } catch (eventError) {
      failed += 1;
      logger.error("notification_delivery_failed", {
        eventId: event.id,
        errorCode: errorCode(eventError),
      });
      await admin.rpc("defer_outbox_event", {
        p_event_id: event.id,
        p_error_code: errorCode(eventError),
      });
    }
  }

  return { claimed: events.length, processed, failed };
}
