import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export interface WhatsAppChannelActor {
  channel: "whatsapp";
  phoneNumberId: string;
  conversationId: string;
  externalContactId: string;
}

export interface ServiceOption {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
  allowStaffSelection: boolean;
}

export interface StaffOption {
  id: string;
  name: string;
}

export interface AvailableSlot {
  startAt: string;
  endAt: string;
  staffId: string;
  staffName: string;
}

export interface BookingTenantContext {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  locationId: string;
  humanHandoffEnabled: boolean;
  welcomeMessage: string | null;
  unknownMessageResponse: string | null;
  administrativeNotice: string | null;
  emergencyNotice: string | null;
}

export interface CreateBookingInput {
  tenantId: string;
  locationId: string;
  serviceIds: string[];
  staffId: string | null;
  startsAt: string;
  timezone: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  notes: string | null;
  idempotencyKey: string;
  actor: WhatsAppChannelActor;
}

export interface CreateBookingResult {
  appointmentId: string;
  managementToken: string;
  status: string;
  startsAt: string;
  endsAt: string;
  staffName: string;
}

export interface UpcomingBooking {
  id: string;
  startsAt: string;
  status: string;
  staffName: string | null;
  serviceNames: string[];
}

export interface WhatsAppBookingGateway {
  getTenantContext(tenantId: string): Promise<BookingTenantContext>;
  listServices(tenantId: string): Promise<ServiceOption[]>;
  listStaff(tenantId: string, serviceId: string): Promise<StaffOption[]>;
  getAvailableSlots(input: {
    tenant: BookingTenantContext;
    serviceId: string;
    staffId: string | null;
    rangeStart: string;
    rangeEnd: string;
  }): Promise<AvailableSlot[]>;
  createBooking(input: CreateBookingInput): Promise<CreateBookingResult>;
  listUpcomingBookings(input: {
    tenantId: string;
    customerId: string;
  }): Promise<UpcomingBooking[]>;
  getRescheduleSlots(input: {
    tenantId: string;
    customerId: string;
    appointmentId: string;
    rangeStart: string;
    rangeEnd: string;
    staffId: string | null;
  }): Promise<AvailableSlot[]>;
  cancelBooking(input: {
    tenantId: string;
    customerId: string;
    appointmentId: string;
    reason: string | null;
    idempotencyKey: string;
    actor: WhatsAppChannelActor;
  }): Promise<{ appointmentId: string; status: string }>;
  rescheduleBooking(input: {
    tenantId: string;
    customerId: string;
    appointmentId: string;
    startsAt: string;
    staffId: string | null;
    idempotencyKey: string;
    actor: WhatsAppChannelActor;
  }): Promise<CreateBookingResult>;
}

const tenantSchema = z.object({
  id: z.guid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  locations: z.array(z.object({ id: z.guid(), is_primary: z.boolean() })),
});

const whatsappSettingsSchema = z.object({
  enabled: z.boolean(),
  booking_enabled: z.boolean(),
  human_handoff_enabled: z.boolean(),
  welcome_message: z.string().nullable(),
  unknown_message_response: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

const allowedIdsSchema = z.array(z.guid()).max(200);

function allowedIds(metadata: Record<string, unknown>, key: string): string[] | null {
  if (metadata[key] === undefined) return null;
  const parsed = allowedIdsSchema.safeParse(metadata[key]);
  return parsed.success ? parsed.data : [];
}

function optionalNotice(value: unknown): string | null {
  const parsed = z.string().trim().min(1).max(2000).safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function loadBookingSettings(tenantId: string): Promise<{
  allowedServiceIds: string[] | null;
  allowedLocationIds: string[] | null;
  humanHandoffEnabled: boolean;
  welcomeMessage: string | null;
  unknownMessageResponse: string | null;
  administrativeNotice: string | null;
  emergencyNotice: string | null;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenant_whatsapp_settings")
    .select("enabled, booking_enabled, human_handoff_enabled, welcome_message, unknown_message_response, metadata")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error("tenant_settings_query_failed");
  if (!data) throw new Error("tenant_whatsapp_disabled");
  const settings = whatsappSettingsSchema.parse(data);
  if (!settings.enabled || !settings.booking_enabled) {
    throw new Error("tenant_whatsapp_disabled");
  }
  return {
    allowedServiceIds: allowedIds(settings.metadata, "allowed_service_ids"),
    allowedLocationIds: allowedIds(settings.metadata, "allowed_location_ids"),
    humanHandoffEnabled: settings.human_handoff_enabled,
    welcomeMessage: optionalNotice(settings.welcome_message),
    unknownMessageResponse: optionalNotice(settings.unknown_message_response),
    administrativeNotice: optionalNotice(settings.metadata.administrative_notice),
    emergencyNotice: optionalNotice(settings.metadata.emergency_notice),
  };
}

const serviceSchema = z.object({
  id: z.guid(),
  name: z.string(),
  duration_minutes: z.number().int().positive(),
  price_cents: z.number().int().nonnegative(),
  promotional_price_cents: z.number().int().nonnegative().nullable(),
  allow_staff_selection: z.boolean(),
});

const staffSchema = z.object({ id: z.guid(), name: z.string() });
const slotSchema = z.object({
  starts_at: z.string(),
  ends_at: z.string(),
  staff_id: z.guid(),
  staff_name: z.string(),
});

const createResultSchema = z.object({
  appointmentId: z.guid(),
  managementToken: z.string().min(20),
  status: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  staffName: z.string(),
});

const upcomingSchema = z.object({
  id: z.guid(),
  starts_at: z.string(),
  status: z.string(),
  staff: z.object({ name: z.string() }).nullable(),
  appointment_services: z.array(z.object({ name_snapshot: z.string() })),
});

interface SupabaseGatewayError {
  code?: string;
  message: string;
  status?: number;
}

export function isTransientGatewayError(error: SupabaseGatewayError): boolean {
  return Boolean(
    error.status && error.status >= 500
    || error.code && (
      ["40001", "40P01", "55P03", "57014"].includes(error.code)
      || error.code.startsWith("08")
      || /^PGRST(?:00[0-3]|5\d\d)$/.test(error.code)
    )
    || /(?:timeout|timed out|network|fetch failed|connection|temporar)/i.test(error.message),
  );
}

export function whatsappIdempotencyKey(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export class SupabaseWhatsAppBookingGateway implements WhatsAppBookingGateway {
  // Treze pontos da máquina de estados pedem o contexto do tenant, e cada
  // chamada custa duas consultas. Uma instância do gateway vive exatamente uma
  // mensagem recebida, então guardar a promessa aqui elimina as repetições sem
  // arriscar servir dado velho entre mensagens. Guardar a promessa, e não o
  // valor, também funde chamadas concorrentes numa ida só.
  private readonly tenantContexts = new Map<string, Promise<BookingTenantContext>>();

  getTenantContext(tenantId: string): Promise<BookingTenantContext> {
    const cached = this.tenantContexts.get(tenantId);
    if (cached) return cached;
    const pending = this.loadTenantContext(tenantId);
    this.tenantContexts.set(tenantId, pending);
    // Falha não fica memorizada: a próxima tentativa refaz a consulta.
    void pending.catch(() => this.tenantContexts.delete(tenantId));
    return pending;
  }

  private async loadTenantContext(tenantId: string): Promise<BookingTenantContext> {
    const admin = createAdminClient();
    const [{ data, error }, settings] = await Promise.all([
      admin
      .from("tenants")
      .select("id, slug, name, timezone, locations!locations_tenant_id_fkey(id, is_primary)")
      .eq("id", tenantId)
      .eq("state", "published")
      .eq("locations.is_active", true)
      .single(),
      loadBookingSettings(tenantId),
    ]);
    if (error) throw new Error("tenant_query_failed");
    if (!data) throw new Error("tenant_not_found");
    const tenant = tenantSchema.parse(data);
    const eligibleLocations = settings.allowedLocationIds === null
      ? tenant.locations
      : tenant.locations.filter((item) => settings.allowedLocationIds?.includes(item.id));
    const location = eligibleLocations.find((item) => item.is_primary) ?? eligibleLocations[0];
    if (!location) throw new Error("tenant_location_not_found");
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      locationId: location.id,
      humanHandoffEnabled: settings.humanHandoffEnabled,
      welcomeMessage: settings.welcomeMessage,
      unknownMessageResponse: settings.unknownMessageResponse,
      administrativeNotice: settings.administrativeNotice,
      emergencyNotice: settings.emergencyNotice,
    };
  }

  async listServices(tenantId: string): Promise<ServiceOption[]> {
    const admin = createAdminClient();
    const settings = await loadBookingSettings(tenantId);
    if (settings.allowedServiceIds?.length === 0) return [];
    let query = admin
      .from("services")
      .select(
        "id, name, duration_minutes, price_cents, promotional_price_cents, allow_staff_selection",
      )
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .eq("is_public", true)
      .order("sort_order")
      .order("name");
    if (settings.allowedServiceIds) {
      query = query.in("id", settings.allowedServiceIds);
    }
    const { data, error } = await query;
    if (error) throw new Error("service_query_failed");
    return z.array(serviceSchema).parse(data ?? []).map((service) => ({
      id: service.id,
      name: service.name,
      durationMinutes: service.duration_minutes,
      priceCents: service.promotional_price_cents ?? service.price_cents,
      allowStaffSelection: service.allow_staff_selection,
    }));
  }

  async listStaff(tenantId: string, serviceId: string): Promise<StaffOption[]> {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("staff")
      .select("id, name, staff_services!inner(service_id, is_active)")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .eq("is_public", true)
      .eq("staff_services.service_id", serviceId)
      .eq("staff_services.is_active", true)
      .order("sort_order")
      .order("name");
    if (error) throw new Error("staff_query_failed");
    return z.array(staffSchema.passthrough()).parse(data ?? []).map(({ id, name }) => ({ id, name }));
  }

  async getAvailableSlots(input: {
    tenant: BookingTenantContext;
    serviceId: string;
    staffId: string | null;
    rangeStart: string;
    rangeEnd: string;
  }): Promise<AvailableSlot[]> {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_available_slots", {
      p_tenant_slug: input.tenant.slug,
      p_location_id: input.tenant.locationId,
      p_service_ids: [input.serviceId],
      p_staff_id: input.staffId,
      p_range_start: input.rangeStart,
      p_range_end: input.rangeEnd,
      p_timezone: input.tenant.timezone,
      p_limit: 80,
    });
    if (error) throw new Error("availability_query_failed");
    return z.array(slotSchema).parse(data ?? []).map((slot) => ({
      startAt: slot.starts_at,
      endAt: slot.ends_at,
      staffId: slot.staff_id,
      staffName: slot.staff_name,
    }));
  }

  async createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("create_whatsapp_booking", {
      p_tenant_id: input.tenantId,
      p_location_id: input.locationId,
      p_service_ids: input.serviceIds,
      p_staff_id: input.staffId,
      p_starts_at: input.startsAt,
      p_timezone: input.timezone,
      p_customer_name: input.customerName,
      p_customer_phone: input.customerPhone,
      p_customer_email: input.customerEmail,
      p_customer_notes: input.notes,
      p_idempotency_key: input.idempotencyKey,
      p_conversation_id: input.actor.conversationId,
      p_external_contact_id: input.actor.externalContactId,
    });
    if (error) {
      if (error.code === "23P01" || error.message.includes("slot_unavailable")) {
        throw new Error("booking_conflict");
      }
      if (isTransientGatewayError(error)) throw new Error("booking_transient_failure");
      throw new Error("booking_failed");
    }
    return createResultSchema.parse(data);
  }

  async listUpcomingBookings(input: {
    tenantId: string;
    customerId: string;
  }): Promise<UpcomingBooking[]> {
    const admin = createAdminClient();
    const { data: relation, error: relationError } = await admin
      .from("customer_tenants")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("customer_id", input.customerId)
      .maybeSingle();
    if (relationError) throw new Error("customer_tenant_query_failed");
    if (!relation) return [];
    const { data, error } = await admin
      .from("appointments")
      .select("id, starts_at, status, staff(name), appointment_services(name_snapshot)")
      .eq("tenant_id", input.tenantId)
      .eq("customer_tenant_id", relation.id)
      .eq("occupies_slot", true)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(100);
    if (error) throw new Error("upcoming_booking_query_failed");
    return z.array(upcomingSchema).parse(data ?? []).map((booking) => ({
      id: booking.id,
      startsAt: booking.starts_at,
      status: booking.status,
      staffName: booking.staff?.name ?? null,
      serviceNames: booking.appointment_services.map((service) => service.name_snapshot),
    }));
  }

  async cancelBooking(input: {
    tenantId: string;
    customerId: string;
    appointmentId: string;
    reason: string | null;
    idempotencyKey: string;
    actor: WhatsAppChannelActor;
  }): Promise<{ appointmentId: string; status: string }> {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("cancel_whatsapp_booking", {
      p_tenant_id: input.tenantId,
      p_customer_id: input.customerId,
      p_appointment_id: input.appointmentId,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
      p_conversation_id: input.actor.conversationId,
    });
    if (error) {
      if (error.message.includes("not_allowed")) throw new Error("cancellation_not_allowed");
      if (isTransientGatewayError(error)) {
        throw new Error("cancellation_transient_failure");
      }
      throw new Error("cancellation_failed");
    }
    return z.object({ appointmentId: z.guid(), status: z.string() }).parse(data);
  }

  async getRescheduleSlots(input: {
    tenantId: string;
    customerId: string;
    appointmentId: string;
    rangeStart: string;
    rangeEnd: string;
    staffId: string | null;
  }): Promise<AvailableSlot[]> {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_whatsapp_reschedule_slots", {
      p_tenant_id: input.tenantId,
      p_customer_id: input.customerId,
      p_appointment_id: input.appointmentId,
      p_range_start: input.rangeStart,
      p_range_end: input.rangeEnd,
      p_staff_id: input.staffId,
      p_limit: 80,
    });
    if (error) throw new Error("reschedule_slots_failed");
    return z.array(slotSchema).parse(data ?? []).map((slot) => ({
      startAt: slot.starts_at,
      endAt: slot.ends_at,
      staffId: slot.staff_id,
      staffName: slot.staff_name,
    }));
  }

  async rescheduleBooking(input: {
    tenantId: string;
    customerId: string;
    appointmentId: string;
    startsAt: string;
    staffId: string | null;
    idempotencyKey: string;
    actor: WhatsAppChannelActor;
  }): Promise<CreateBookingResult> {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("reschedule_whatsapp_booking", {
      p_tenant_id: input.tenantId,
      p_customer_id: input.customerId,
      p_appointment_id: input.appointmentId,
      p_starts_at: input.startsAt,
      p_staff_id: input.staffId,
      p_idempotency_key: input.idempotencyKey,
      p_conversation_id: input.actor.conversationId,
    });
    if (error) {
      if (error.code === "23P01" || error.message.includes("slot_unavailable")) {
        throw new Error("booking_conflict");
      }
      if (isTransientGatewayError(error)) {
        throw new Error("reschedule_transient_failure");
      }
      throw new Error("reschedule_failed");
    }
    return createResultSchema.parse(data);
  }
}
