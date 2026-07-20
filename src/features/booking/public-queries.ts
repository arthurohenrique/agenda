import "server-only";

import { cache } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type {
  PublicService,
  PublicStaff,
  PublicTenant,
  ThemeTokens,
} from "@/types/domain";

const profileSchema = z.object({
  description: z.string().nullable(),
  logo_url: z.string().nullable(),
  cover_url: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});

const locationSchema = z.object({
  id: z.guid(),
  name: z.string(),
  address_line_1: z.string(),
  address_line_2: z.string().nullable(),
  district: z.string().nullable(),
  city: z.string(),
  region: z.string(),
  postal_code: z.string().nullable(),
  is_primary: z.boolean(),
});

const themeSchema = z.object({
  primary_color: z.string(),
  accent_color: z.string(),
  background_color: z.string(),
  surface_color: z.string(),
  text_color: z.string(),
  header_alignment: z.enum(["left", "center"]),
  summary_position: z.enum(["right", "bottom"]),
  service_view: z.enum(["list", "cards"]),
  density: z.enum(["comfortable", "compact"]),
  cover_style: z.enum(["none", "small", "wide"]),
});

const tenantRowSchema = z.object({
  id: z.guid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  currency: z.string(),
  tenant_profiles: profileSchema.nullable(),
  theme_settings: themeSchema.nullable(),
  locations: z.array(locationSchema),
});

const fallbackTheme: ThemeTokens = {
  primary: "#171717",
  accent: "#2563eb",
  background: "#f6f7f8",
  surface: "#ffffff",
  text: "#171717",
  headerAlignment: "left",
  summaryPosition: "right",
  serviceView: "cards",
  density: "comfortable",
  coverStyle: "none",
};

export const getPublicTenant = cache(async (slug: string): Promise<PublicTenant | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, slug, name, timezone, currency, tenant_profiles(description, logo_url, cover_url, phone, email), theme_settings(primary_color, accent_color, background_color, surface_color, text_color, header_alignment, summary_position, service_view, density, cover_style), locations(id, name, address_line_1, address_line_2, district, city, region, postal_code, is_primary)",
    )
    .eq("slug", slug)
    .eq("state", "published")
    .eq("locations.is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  const row = tenantRowSchema.parse(data);
  const profile = row.tenant_profiles;
  const theme = row.theme_settings;
  const location = row.locations.find((item) => item.is_primary) ?? row.locations[0] ?? null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: profile?.description ?? null,
    logoUrl: profile?.logo_url ?? null,
    coverUrl: profile?.cover_url ?? null,
    phone: profile?.phone ?? null,
    email: profile?.email ?? null,
    timezone: row.timezone,
    currency: row.currency,
    location: location
      ? {
          id: location.id,
          name: location.name,
          addressLine1: location.address_line_1,
          addressLine2: location.address_line_2,
          district: location.district,
          city: location.city,
          region: location.region,
          postalCode: location.postal_code,
        }
      : null,
    theme: theme
      ? {
          primary: theme.primary_color,
          accent: theme.accent_color,
          background: theme.background_color,
          surface: theme.surface_color,
          text: theme.text_color,
          headerAlignment: theme.header_alignment,
          summaryPosition: theme.summary_position,
          serviceView: theme.service_view,
          density: theme.density,
          coverStyle: theme.cover_style,
        }
      : fallbackTheme,
  };
});

const serviceRowSchema = z.object({
  id: z.guid(),
  name: z.string(),
  description: z.string().nullable(),
  duration_minutes: z.number().int().positive(),
  price_cents: z.number().int().nonnegative(),
  promotional_price_cents: z.number().int().nonnegative().nullable(),
  image_url: z.string().nullable(),
  allow_staff_selection: z.boolean(),
  service_categories: z.object({ name: z.string() }).nullable(),
});

export async function getPublicServices(tenantId: string): Promise<PublicService[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, description, duration_minutes, price_cents, promotional_price_cents, image_url, allow_staff_selection, service_categories(name)",
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("sort_order")
    .order("name");

  if (error) throw new Error("Não foi possível carregar os serviços.");
  return z.array(serviceRowSchema).parse(data ?? []).map((service) => ({
    id: service.id,
    name: service.name,
    description: service.description,
    durationMinutes: service.duration_minutes,
    priceCents: service.price_cents,
    promotionalPriceCents: service.promotional_price_cents,
    categoryName: service.service_categories?.name ?? null,
    imageUrl: service.image_url,
    allowStaffSelection: service.allow_staff_selection,
  }));
}

const staffRowSchema = z.object({
  id: z.guid(),
  name: z.string(),
  title: z.string().nullable(),
  bio: z.string().nullable(),
  avatar_url: z.string().nullable(),
  staff_services: z.array(z.object({ service_id: z.guid() })),
});

export async function getPublicStaff(tenantId: string): Promise<PublicStaff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, name, title, bio, avatar_url, staff_services(service_id)")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("sort_order")
    .order("name");

  if (error) throw new Error("Não foi possível carregar os profissionais.");
  return z.array(staffRowSchema).parse(data ?? []).map((staff) => ({
    id: staff.id,
    name: staff.name,
    title: staff.title,
    bio: staff.bio,
    avatarUrl: staff.avatar_url,
    serviceIds: staff.staff_services.map((item) => item.service_id),
  }));
}

export async function getPublishedTenantSlugs(): Promise<Array<{ slug: string; updatedAt: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("slug, updated_at")
    .eq("state", "published")
    .order("slug")
    .limit(1000);
  if (error) return [];
  return z.array(z.object({ slug: z.string(), updated_at: z.string() })).parse(data ?? []).map((row) => ({
    slug: row.slug,
    updatedAt: row.updated_at,
  }));
}
