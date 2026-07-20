import type { MetadataRoute } from "next";
import { getPublishedTenantSlugs } from "@/features/booking/public-queries";
import { isSupabaseConfigured } from "@/lib/env";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured()) return [];
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const tenants = await getPublishedTenantSlugs();
  return tenants.map((tenant) => ({
    url: `${baseUrl}/${tenant.slug}`,
    lastModified: new Date(tenant.updatedAt),
    changeFrequency: "weekly",
    priority: 0.8,
  }));
}
