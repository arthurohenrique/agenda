"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { requireTenantAccess } from "@/features/tenants/access";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const blockSchema = z.object({
  slug: z.string().min(3),
  locationId: z.guid(),
  staffId: z.guid(),
  date: z.iso.date(),
  startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  title: z.string().trim().min(2).max(120),
}).refine((data) => data.endsAt > data.startsAt, {
  path: ["endsAt"],
  message: "Fim deve ser depois do início.",
});

export async function createCalendarBlockAction(formData: FormData) {
  const parsed = blockSchema.safeParse({
    slug: formData.get("slug"),
    locationId: formData.get("locationId"),
    staffId: formData.get("staffId"),
    date: formData.get("date"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    title: formData.get("title"),
  });
  if (!parsed.success) throw new Error("Dados do bloqueio inválidos.");
  const [tenant, user] = await Promise.all([
    requireTenantAccess(parsed.data.slug),
    requireUser(),
  ]);
  if (!(["owner", "admin", "receptionist"] as string[]).includes(tenant.role)) {
    throw new Error("Sem permissão para bloquear agenda.");
  }

  const startsAt = fromZonedTime(
    `${parsed.data.date}T${parsed.data.startsAt}:00`,
    tenant.timezone,
  ).toISOString();
  const endsAt = fromZonedTime(
    `${parsed.data.date}T${parsed.data.endsAt}:00`,
    tenant.timezone,
  ).toISOString();
  const supabase = await createClient();
  const { error } = await supabase.from("calendar_blocks").insert({
    tenant_id: tenant.id,
    location_id: parsed.data.locationId,
    staff_id: parsed.data.staffId,
    starts_at: startsAt,
    ends_at: endsAt,
    title: parsed.data.title,
    created_by: user.id,
  });
  if (error) {
    throw new Error(
      error.code === "23P01"
        ? "Existe atendimento ou bloqueio neste intervalo."
        : "Não foi possível bloquear o horário.",
    );
  }
  revalidatePath(`/app/${tenant.slug}`);
}
