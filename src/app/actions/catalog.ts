"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantAccess } from "@/features/tenants/access";
import { parseBrlToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const createServiceSchema = z.object({
  slug: z.string().min(3),
  name: z.string().trim().min(2).max(120),
  durationMinutes: z.coerce.number().int().min(5).max(1440),
  price: z.string(),
});

const createStaffSchema = z.object({
  slug: z.string().min(3),
  name: z.string().trim().min(2).max(120),
  title: z.string().trim().max(120),
  serviceIds: z.array(z.guid()).min(1),
});

const toggleSchema = z.object({
  slug: z.string().min(3),
  id: z.guid(),
  active: z.enum(["true", "false"]),
});

export async function createServiceAction(formData: FormData) {
  const parsed = createServiceSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    durationMinutes: formData.get("durationMinutes"),
    price: formData.get("price"),
  });
  if (!parsed.success) throw new Error("Dados do serviço inválidos.");
  const priceCents = parseBrlToCents(parsed.data.price);
  if (priceCents === null) throw new Error("Preço inválido.");

  const tenant = await requireTenantAccess(parsed.data.slug);
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    throw new Error("Sem permissão para criar serviço.");
  }
  const supabase = await createClient();
  let { data: category } = await supabase
    .from("service_categories")
    .select("id")
    .eq("tenant_id", tenant.id)
    .order("sort_order")
    .limit(1)
    .maybeSingle();

  if (!category) {
    const created = await supabase
      .from("service_categories")
      .insert({ tenant_id: tenant.id, name: "Serviços" })
      .select("id")
      .single();
    if (created.error) throw new Error("Não foi possível criar a categoria.");
    category = created.data;
  }

  const created = await supabase
    .from("services")
    .insert({
      tenant_id: tenant.id,
      category_id: category.id,
      name: parsed.data.name,
      duration_minutes: parsed.data.durationMinutes,
      price_cents: priceCents,
      currency: tenant.currency,
      is_active: true,
      is_public: true,
    })
    .select("id")
    .single();
  if (created.error) throw new Error("Não foi possível criar o serviço.");

  const { data: location } = await supabase
    .from("locations")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("is_primary", true)
    .maybeSingle();
  if (location) {
    await supabase.from("service_locations").insert({
      tenant_id: tenant.id,
      service_id: created.data.id,
      location_id: location.id,
    });
  }

  revalidatePath(`/app/${tenant.slug}/servicos`);
}

export async function toggleServiceAction(formData: FormData) {
  const parsed = toggleSchema.parse({
    slug: formData.get("slug"),
    id: formData.get("id"),
    active: formData.get("active"),
  });
  const tenant = await requireTenantAccess(parsed.slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .update({ is_active: parsed.active === "true" })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.id);
  if (error) throw new Error("Não foi possível alterar o serviço.");
  revalidatePath(`/app/${tenant.slug}/servicos`);
}

export async function createStaffAction(formData: FormData) {
  const parsed = createStaffSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    title: formData.get("title") ?? "",
    serviceIds: formData.getAll("serviceIds"),
  });
  if (!parsed.success) throw new Error("Dados do profissional inválidos.");

  const tenant = await requireTenantAccess(parsed.data.slug);
  const supabase = await createClient();
  const created = await supabase
    .from("staff")
    .insert({
      tenant_id: tenant.id,
      name: parsed.data.name,
      title: parsed.data.title || null,
      is_active: true,
      is_public: true,
      inherits_tenant_hours: true,
    })
    .select("id")
    .single();
  if (created.error) throw new Error("Não foi possível criar o profissional.");

  const { data: location } = await supabase
    .from("locations")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("is_primary", true)
    .maybeSingle();

  const relations = parsed.data.serviceIds.map((serviceId) => ({
    tenant_id: tenant.id,
    staff_id: created.data.id,
    service_id: serviceId,
  }));
  const { error: relationError } = await supabase.from("staff_services").insert(relations);
  if (relationError) throw new Error("Profissional criado, mas serviços não foram associados.");

  if (location) {
    await supabase.from("staff_locations").insert({
      tenant_id: tenant.id,
      staff_id: created.data.id,
      location_id: location.id,
    });
  }
  revalidatePath(`/app/${tenant.slug}/profissionais`);
}

export async function toggleStaffAction(formData: FormData) {
  const parsed = toggleSchema.parse({
    slug: formData.get("slug"),
    id: formData.get("id"),
    active: formData.get("active"),
  });
  const tenant = await requireTenantAccess(parsed.slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from("staff")
    .update({ is_active: parsed.active === "true" })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.id);
  if (error) throw new Error("Não foi possível alterar o profissional.");
  revalidatePath(`/app/${tenant.slug}/profissionais`);
}
