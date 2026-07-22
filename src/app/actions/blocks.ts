"use server";

import { addDays, format, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantAccess } from "@/features/tenants/access";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const intervalSchema = z.object({ startsAt: timeSchema, endsAt: timeSchema }).refine(
  (interval) => interval.endsAt > interval.startsAt,
  "Fim deve ser depois do início.",
);
const blockSchema = z.object({
  slug: z.string().min(3),
  locationId: z.guid(),
  scope: z.enum(["all", "staff"]),
  staffId: z.guid().optional(),
  date: z.iso.date(),
  allDay: z.enum(["true", "false"]),
  reason: z.string().trim().max(120),
}).superRefine((data, context) => {
  if (data.scope === "staff" && !data.staffId) {
    context.addIssue({ code: "custom", path: ["staffId"], message: "Profissional obrigatório." });
  }
});

function parseIntervals(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  try {
    const parsed = intervalSchema.array().min(1).max(12).safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function createCalendarBlockAction(formData: FormData) {
  const parsed = blockSchema.safeParse({
    slug: formData.get("slug"),
    locationId: formData.get("locationId"),
    scope: formData.get("scope"),
    staffId: formData.get("staffId") || undefined,
    date: formData.get("date"),
    allDay: formData.get("allDay"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) throw new Error("Dados do bloqueio inválidos.");
  const intervals = parsed.data.allDay === "true"
    ? [{ startsAt: "00:00", endsAt: "00:00" }]
    : parseIntervals(formData.get("intervals"));
  if (!intervals) throw new Error("Informe ao menos um intervalo válido.");

  const [tenant, user] = await Promise.all([
    requireTenantAccess(parsed.data.slug),
    requireUser(),
  ]);
  if (!(["owner", "admin", "receptionist"] as string[]).includes(tenant.role)) {
    throw new Error("Sem permissão para bloquear agenda.");
  }

  const supabase = await createClient();
  const staffQuery = supabase
    .from("staff")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true);
  const { data: staff, error: staffError } = parsed.data.scope === "all"
    ? await staffQuery
    : await staffQuery.eq("id", parsed.data.staffId!);
  if (staffError || !staff?.length) throw new Error("Profissional inválido ou indisponível.");

  const nextDate = format(addDays(parseISO(parsed.data.date), 1), "yyyy-MM-dd");
  const title = parsed.data.scope === "all"
    ? "Agenda fechada"
    : parsed.data.allDay === "true" ? "Folga" : "Horário indisponível";
  const blocks = intervals.flatMap((interval) => {
    const startsAt = fromZonedTime(`${parsed.data.date}T${interval.startsAt}:00`, tenant.timezone).toISOString();
    const endDate = parsed.data.allDay === "true" ? nextDate : parsed.data.date;
    const endsAt = fromZonedTime(`${endDate}T${interval.endsAt}:00`, tenant.timezone).toISOString();
    return staff.map((person) => ({
      tenant_id: tenant.id,
      location_id: parsed.data.locationId,
      staff_id: person.id,
      starts_at: startsAt,
      ends_at: endsAt,
      title,
      reason: parsed.data.reason || null,
      created_by: user.id,
    }));
  });
  const { error } = await supabase.from("calendar_blocks").insert(blocks);
  if (error) {
    throw new Error(
      error.code === "23P01"
        ? "Existe atendimento ou bloqueio neste intervalo."
        : "Não foi possível bloquear o horário.",
    );
  }
  revalidatePath(`/app/${tenant.slug}`);
}

const removeBlockSchema = z.object({ slug: z.string().min(3), blockId: z.guid() });

export async function removeCalendarBlockAction(formData: FormData) {
  const parsed = removeBlockSchema.safeParse({
    slug: formData.get("slug"),
    blockId: formData.get("blockId"),
  });
  if (!parsed.success) throw new Error("Bloqueio inválido.");
  const tenant = await requireTenantAccess(parsed.data.slug);
  if (!(["owner", "admin", "receptionist"] as string[]).includes(tenant.role)) {
    throw new Error("Sem permissão para reabrir agenda.");
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_blocks")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.blockId);
  if (error) throw new Error("Não foi possível reabrir o período.");
  revalidatePath(`/app/${tenant.slug}`);
}
