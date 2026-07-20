"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantAccess } from "@/features/tenants/access";
import { createClient } from "@/lib/supabase/server";

const publicationSchema = z.object({
  slug: z.string().min(3),
  intent: z.enum(["publish", "unpublish"]),
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
