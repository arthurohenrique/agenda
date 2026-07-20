import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const adminServiceSchema = z.object({
  id: z.guid(),
  name: z.string(),
  duration_minutes: z.number().int(),
  price_cents: z.number().int(),
  promotional_price_cents: z.number().int().nullable(),
  is_active: z.boolean(),
  is_public: z.boolean(),
  staff_services: z.array(z.object({ staff_id: z.guid() })),
});

const adminStaffSchema = z.object({
  id: z.guid(),
  name: z.string(),
  title: z.string().nullable(),
  color: z.string(),
  is_active: z.boolean(),
  is_public: z.boolean(),
  staff_services: z.array(
    z.object({ services: z.object({ id: z.guid(), name: z.string() }) }),
  ),
});

export type AdminService = z.infer<typeof adminServiceSchema>;
export type AdminStaff = z.infer<typeof adminStaffSchema>;

export async function getAdminServices(tenantId: string): Promise<AdminService[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, duration_minutes, price_cents, promotional_price_cents, is_active, is_public, staff_services(staff_id)",
    )
    .eq("tenant_id", tenantId)
    .order("sort_order")
    .order("name");
  if (error) throw new Error("Não foi possível carregar os serviços.");
  return z.array(adminServiceSchema).parse(data ?? []);
}

export async function getAdminStaff(tenantId: string): Promise<AdminStaff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, name, title, color, is_active, is_public, staff_services(services(id, name))")
    .eq("tenant_id", tenantId)
    .order("sort_order")
    .order("name");
  if (error) throw new Error("Não foi possível carregar a equipe.");
  return z.array(adminStaffSchema).parse(data ?? []);
}

export async function getPrimaryLocationId(tenantId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("is_primary", { ascending: false })
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Não foi possível carregar a unidade.");
  return data?.id ?? null;
}
