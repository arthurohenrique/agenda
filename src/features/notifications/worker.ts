import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";
import {
  NotificationWorkerError,
  isRetryableNotificationError,
  notificationErrorCode,
  notificationFailureLevel,
  shouldLogNotificationFailure,
} from "./policy";
import {
  assertNotificationProviderConfigured,
  deliverNotification,
} from "./provider";
import type { NotificationMessage } from "./types";

const outboxEventSchema = z.object({
  id: z.guid(),
  tenant_id: z.guid(),
  aggregate_id: z.guid(),
  event_type: z.string(),
  attempts: z.number().int().min(1).max(8),
});

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

  const [
    { data: relation, error: relationError },
    { data: tenant, error: tenantError },
    { data: services, error: servicesError },
  ] = await Promise.all([
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
  if (relationError || tenantError || servicesError || !relation || !tenant) {
    throw new Error("notification_context_not_found");
  }

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
  assertNotificationProviderConfigured();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_outbox_events", { p_limit: limit });
  if (error) throw new Error("outbox_claim_failed");

  const parsedEvents = z.array(outboxEventSchema).safeParse(data ?? []);
  if (!parsedEvents.success) throw new Error("outbox_payload_invalid");
  const events = parsedEvents.data;
  let processed = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const message = await loadMessage(event);
      await deliverNotification(message);
      const { data: completed, error: completeError } = await admin.rpc("complete_outbox_event", {
        p_event_id: event.id,
      });
      if (completeError || completed !== true) throw new Error("outbox_complete_failed");
      processed += 1;
    } catch (eventError) {
      failed += 1;
      const errorCode = notificationErrorCode(eventError);
      const { data: deferred, error: deferError } = await admin.rpc("defer_outbox_event", {
        p_event_id: event.id,
        p_error_code: errorCode,
      });
      if (deferError || deferred !== true) {
        throw new NotificationWorkerError("outbox_defer_failed", event.id, event.attempts);
      }

      const context = { eventId: event.id, errorCode, attempt: event.attempts };
      if (
        errorCode === "outbox_complete_failed" &&
        shouldLogNotificationFailure(event.attempts)
      ) {
        logger.error(
          event.attempts >= 8
            ? "notification_completion_abandoned"
            : "notification_completion_deferred",
          context,
        );
      } else if (shouldLogNotificationFailure(event.attempts)) {
        if (!isRetryableNotificationError(errorCode)) {
          if (event.attempts === 1) {
            logger.error("notification_delivery_rejected", context);
          } else if (notificationFailureLevel(event.attempts) === "error") {
            logger.error("notification_delivery_abandoned", context);
          }
        } else if (notificationFailureLevel(event.attempts) === "error") {
          logger.error("notification_delivery_abandoned", context);
        } else {
          logger.warn("notification_delivery_deferred", context);
        }
      }
    }
  }

  return { claimed: events.length, processed, failed };
}
