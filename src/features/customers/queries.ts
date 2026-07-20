import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const customerSchema = z.object({
  id: z.guid(),
  display_name: z.string().nullable(),
  tags: z.array(z.string()),
  last_visit_at: z.string().nullable(),
  next_appointment_at: z.string().nullable(),
  appointments_count: z.number().int(),
  cancellation_count: z.number().int(),
  no_show_count: z.number().int(),
  customers: z.object({
    full_name: z.string(),
    phone_e164: z.string(),
    email: z.string().nullable(),
  }),
});

export type CustomerListItem = z.infer<typeof customerSchema>;

export async function getCustomers(tenantId: string): Promise<CustomerListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_tenants")
    .select(
      "id, display_name, tags, last_visit_at, next_appointment_at, appointments_count, cancellation_count, no_show_count, customers!inner(full_name, phone_e164, email)",
    )
    .eq("tenant_id", tenantId)
    .order("last_visit_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw new Error("Não foi possível carregar clientes.");
  return z.array(customerSchema).parse(data ?? []);
}
