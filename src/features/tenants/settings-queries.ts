import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export interface PublicationChecklist {
  location: boolean;
  services: boolean;
  staff: boolean;
  staffServices: boolean;
  workingHours: boolean;
  contrast: boolean;
}

const tenantThemeSchema = z.object({
  primary_color: z.string(),
  accent_color: z.string(),
  background_color: z.string(),
  surface_color: z.string(),
  text_color: z.string(),
});

export interface TenantTheme {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
}

const fallbackTheme: TenantTheme = {
  primary: "#171717",
  accent: "#2563EB",
  background: "#F6F7F8",
  surface: "#FFFFFF",
  text: "#171717",
};

export async function getTenantTheme(tenantId: string): Promise<TenantTheme> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("theme_settings")
    .select("primary_color, accent_color, background_color, surface_color, text_color")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) return fallbackTheme;
  const theme = tenantThemeSchema.parse(data);
  return {
    primary: theme.primary_color,
    accent: theme.accent_color,
    background: theme.background_color,
    surface: theme.surface_color,
    text: theme.text_color,
  };
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
