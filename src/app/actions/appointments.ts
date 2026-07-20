"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantAccess } from "@/features/tenants/access";
import { createClient } from "@/lib/supabase/server";
import { appointmentStatuses } from "@/types/domain";

const changeStatusSchema = z.object({
  slug: z.string().min(3),
  appointmentId: z.guid(),
  status: z.enum(appointmentStatuses),
});

export async function changeAppointmentStatus(formData: FormData) {
  const parsed = changeStatusSchema.safeParse({
    slug: formData.get("slug"),
    appointmentId: formData.get("appointmentId"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error("Alteração de status inválida.");

  const tenant = await requireTenantAccess(parsed.data.slug);
  const supabase = await createClient();
  const { error } = await supabase.rpc("change_appointment_status", {
    p_tenant_id: tenant.id,
    p_appointment_id: parsed.data.appointmentId,
    p_status: parsed.data.status,
    p_reason: null,
  });
  if (error) throw new Error("Não foi possível alterar o status.");

  revalidatePath(`/app/${tenant.slug}`);
}
