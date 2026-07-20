import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { appointmentStatuses, type AgendaAppointment } from "@/types/domain";

const appointmentRowSchema = z.object({
  id: z.guid(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: z.enum(appointmentStatuses),
  total_cents: z.number().int(),
  customer_tenants: z.object({ customers: z.object({ full_name: z.string() }) }),
  staff: z.object({ name: z.string() }).nullable(),
  appointment_services: z.array(z.object({ name_snapshot: z.string() })),
});

const staffSchema = z.object({
  id: z.guid(),
  name: z.string(),
  color: z.string(),
});

export interface AgendaStaff {
  id: string;
  name: string;
  color: string;
}

export async function getAppointments(
  tenantId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<AgendaAppointment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, ends_at, status, total_cents, customer_tenants!inner(customers!inner(full_name)), staff(name), appointment_services(name_snapshot)",
    )
    .eq("tenant_id", tenantId)
    .gte("starts_at", rangeStart)
    .lt("starts_at", rangeEnd)
    .order("starts_at");

  if (error) throw new Error("Não foi possível carregar a agenda.");
  return z.array(appointmentRowSchema).parse(data ?? []).map((appointment) => ({
    id: appointment.id,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    status: appointment.status,
    totalCents: appointment.total_cents,
    customerName: appointment.customer_tenants.customers.full_name,
    staffName: appointment.staff?.name ?? null,
    serviceName:
      appointment.appointment_services.map((service) => service.name_snapshot).join(" + ") ||
      "Atendimento",
  }));
}

export async function getAgendaStaff(tenantId: string): Promise<AgendaStaff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, name, color")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order")
    .order("name");

  if (error) throw new Error("Não foi possível carregar a equipe.");
  return z.array(staffSchema).parse(data ?? []);
}
