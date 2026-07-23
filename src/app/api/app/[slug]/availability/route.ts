import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTenantAccess } from "@/features/tenants/access";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  locationId: z.guid(),
  serviceId: z.guid(),
  staffId: z.guid().nullable(),
  dateFrom: z.iso.datetime({ offset: true }),
  dateTo: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(64),
});
const rpcSlotSchema = z.object({
  starts_at: z.string(),
  ends_at: z.string(),
  staff_id: z.guid(),
  staff_name: z.string(),
});

interface AdminAvailabilityRouteProps { params: Promise<{ slug: string }> }

export async function GET(request: NextRequest, { params }: AdminAvailabilityRouteProps) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 });
  const tenant = await getTenantAccess(slug, user.id);
  if (!tenant || !["owner", "admin", "receptionist"].includes(tenant.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const query = request.nextUrl.searchParams;
  const parsed = requestSchema.safeParse({
    locationId: query.get("locationId"),
    serviceId: query.get("serviceId"),
    staffId: query.get("staffId") || null,
    dateFrom: query.get("dateFrom"),
    dateTo: query.get("dateTo"),
    timezone: query.get("timezone"),
  });
  if (!parsed.success) return NextResponse.json({ error: "Consulta de disponibilidade inválida." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_tenant_slug: slug,
    p_location_id: parsed.data.locationId,
    p_service_ids: [parsed.data.serviceId],
    p_staff_id: parsed.data.staffId,
    p_range_start: parsed.data.dateFrom,
    p_range_end: parsed.data.dateTo,
    p_timezone: parsed.data.timezone,
    p_limit: 80,
  });
  if (error) return NextResponse.json({ error: "Não foi possível consultar horários." }, { status: 422 });
  const slots = z.array(rpcSlotSchema).parse(data ?? []).map((slot) => ({
    startAt: slot.starts_at,
    endAt: slot.ends_at,
    staffId: slot.staff_id,
    staffName: slot.staff_name,
  }));
  return NextResponse.json({ slots }, { headers: { "Cache-Control": "private, no-store" } });
}
