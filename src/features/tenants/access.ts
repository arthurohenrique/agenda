import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { tenantRoles, type TenantRole } from "@/types/domain";

const contextSchema = z.object({
  role: z.enum(tenantRoles),
  permissions: z.record(z.string(), z.boolean()).default({}),
  staff_id: z.guid().nullable(),
  tenants: z.object({
    id: z.guid(),
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    currency: z.string(),
    state: z.enum(["draft", "published", "suspended", "archived"]),
  }),
});

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  state: "draft" | "published" | "suspended" | "archived";
  role: TenantRole;
  permissions: Record<string, boolean>;
  staffId: string | null;
}

export const requireTenantAccess = cache(async (slug: string): Promise<TenantContext> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_members")
    .select(
      "role, permissions, staff_id, tenants!inner(id, slug, name, timezone, currency, state)",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("tenants.slug", slug)
    .maybeSingle();

  if (error || !data) notFound();
  const row = contextSchema.parse(data);
  return {
    ...row.tenants,
    role: row.role,
    permissions: row.permissions,
    staffId: row.staff_id,
  };
});
