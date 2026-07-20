import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface PublicationChecklist {
  location: boolean;
  services: boolean;
  staff: boolean;
  staffServices: boolean;
  workingHours: boolean;
  contrast: boolean;
}

export async function getPublicationChecklist(tenantId: string): Promise<PublicationChecklist> {
  const supabase = await createClient();
  const [locations, services, staff, staffServices, hours, theme] = await Promise.all([
    supabase.from("locations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("services").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true).eq("is_public", true),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true).eq("is_public", true),
    supabase.from("staff_services").select("staff_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("working_hours").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_open", true),
    supabase.from("theme_settings").select("is_contrast_valid").eq("tenant_id", tenantId).single(),
  ]);

  return {
    location: (locations.count ?? 0) > 0,
    services: (services.count ?? 0) > 0,
    staff: (staff.count ?? 0) > 0,
    staffServices: (staffServices.count ?? 0) > 0,
    workingHours: (hours.count ?? 0) > 0,
    contrast: theme.data?.is_contrast_valid === true,
  };
}
