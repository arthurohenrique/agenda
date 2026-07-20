import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { appointmentStatuses } from "@/types/domain";

const reportAppointmentSchema = z.object({
  status: z.enum(appointmentStatuses),
  total_cents: z.number().int(),
  origin: z.string(),
  customer_tenant_id: z.guid(),
  appointment_services: z.array(z.object({ name_snapshot: z.string() })),
});

export interface ReportSummary {
  total: number;
  projectedRevenueCents: number;
  realizedRevenueCents: number;
  cancellations: number;
  noShows: number;
  uniqueCustomers: number;
  topServices: Array<{ name: string; count: number }>;
  origins: Array<{ name: string; count: number }>;
}

export async function getReportSummary(
  tenantId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<ReportSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select("status, total_cents, origin, customer_tenant_id, appointment_services(name_snapshot)")
    .eq("tenant_id", tenantId)
    .gte("starts_at", rangeStart)
    .lt("starts_at", rangeEnd);
  if (error) throw new Error("Não foi possível carregar os indicadores.");
  const appointments = z.array(reportAppointmentSchema).parse(data ?? []);
  const serviceCounts = new Map<string, number>();
  const originCounts = new Map<string, number>();
  for (const appointment of appointments) {
    for (const service of appointment.appointment_services) {
      serviceCounts.set(service.name_snapshot, (serviceCounts.get(service.name_snapshot) ?? 0) + 1);
    }
    originCounts.set(appointment.origin, (originCounts.get(appointment.origin) ?? 0) + 1);
  }

  const occupying = appointments.filter((item) => !item.status.startsWith("cancelled") && item.status !== "no_show");
  return {
    total: appointments.length,
    projectedRevenueCents: occupying.reduce((sum, item) => sum + item.total_cents, 0),
    realizedRevenueCents: appointments.filter((item) => item.status === "completed").reduce((sum, item) => sum + item.total_cents, 0),
    cancellations: appointments.filter((item) => item.status.startsWith("cancelled")).length,
    noShows: appointments.filter((item) => item.status === "no_show").length,
    uniqueCustomers: new Set(appointments.map((item) => item.customer_tenant_id)).size,
    topServices: [...serviceCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    origins: [...originCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}
