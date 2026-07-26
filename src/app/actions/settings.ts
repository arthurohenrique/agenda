"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantAccess } from "@/features/tenants/access";
import { getTenantPalette, tenantPaletteIds } from "@/lib/tenant-palettes";
import { createClient } from "@/lib/supabase/server";

const publicationSchema = z.object({
  slug: z.string().min(3),
  intent: z.enum(["publish", "unpublish"]),
});

const paletteSchema = z.object({
  slug: z.string().min(3),
  paletteId: z.enum(tenantPaletteIds),
});

export async function changePublicationAction(formData: FormData) {
  const parsed = publicationSchema.parse({
    slug: formData.get("slug"),
    intent: formData.get("intent"),
  });
  const tenant = await requireTenantAccess(parsed.slug);
  const supabase = await createClient();
  const functionName = parsed.intent === "publish" ? "publish_tenant" : "unpublish_tenant";
  const { error } = await supabase.rpc(functionName, { p_tenant_id: tenant.id });
  if (error) {
    throw new Error(
      error.message.includes("tenant_not_ready")
        ? "Conclua unidade, serviços, equipe, horários e contraste antes de publicar."
        : "Não foi possível alterar a publicação.",
    );
  }
  revalidatePath(`/app/${tenant.slug}/configuracoes`);
  revalidatePath(`/${tenant.slug}`);
}

export async function updateTenantPaletteAction(formData: FormData) {
  const parsed = paletteSchema.parse({
    slug: formData.get("slug"),
    paletteId: formData.get("paletteId"),
  });
  const tenant = await requireTenantAccess(parsed.slug);
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    throw new Error("Você não tem permissão para alterar a paleta.");
  }

  const palette = getTenantPalette(parsed.paletteId);
  if (!palette) throw new Error("Paleta inválida.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("theme_settings")
    .update({
      primary_color: palette.primary,
      accent_color: palette.accent,
      background_color: palette.background,
      surface_color: palette.surface,
      text_color: palette.text,
    })
    .eq("tenant_id", tenant.id);

  if (error) throw new Error("Não foi possível atualizar a paleta.");

  revalidatePath(`/app/${tenant.slug}`, "layout");
  revalidatePath(`/${tenant.slug}`);
}
