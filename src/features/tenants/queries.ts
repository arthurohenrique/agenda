import "server-only";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { tenantRoles, type TenantSummary } from "@/types/domain";

const membershipRowSchema = z.object({
  role: z.enum(tenantRoles),
  tenants: z.object({
    id: z.guid(),
    slug: z.string(),
    name: z.string(),
    state: z.enum(["draft", "published", "suspended", "archived"]),
  }),
});

export async function getTenantMemberships(): Promise<TenantSummary[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_members")
    .select("role, tenants!inner(id, slug, name, state)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at");

  if (error) throw new Error("Não foi possível carregar os estabelecimentos.");

  const rows = z.array(membershipRowSchema).parse(data ?? []);
  return rows.map(({ role, tenants }) => ({ ...tenants, role }));
}
