import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { availabilityRequestSchema } from "@/features/booking/schemas";
import { isSupabaseConfigured } from "@/lib/env";
import { requestFingerprint } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const rpcSlotSchema = z.object({
  starts_at: z.string(),
  ends_at: z.string(),
  staff_id: z.guid(),
  staff_name: z.string(),
});

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Serviço indisponível." }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const parsed = availabilityRequestSchema.safeParse({
    slug: params.get("slug"),
    locationId: params.get("locationId"),
    serviceIds: params.getAll("serviceId"),
    staffId: params.get("staffId") || null,
    dateFrom: params.get("dateFrom"),
    dateTo: params.get("dateTo"),
    timezone: params.get("timezone"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Consulta de disponibilidade inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error: rateLimitError } = await supabase.rpc("consume_public_api_rate_limit", {
    p_tenant_slug: parsed.data.slug,
    p_rate_key: requestFingerprint(request, parsed.data.slug),
    p_action: "availability",
  });
  if (rateLimitError) {
    const limited = rateLimitError.message.includes("rate_limit_exceeded");
    return NextResponse.json(
      { error: limited ? "Muitas consultas. Aguarde alguns minutos." : "Agenda indisponível." },
      { status: limited ? 429 : 404 },
    );
  }
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_tenant_slug: parsed.data.slug,
    p_location_id: parsed.data.locationId,
    p_service_ids: parsed.data.serviceIds,
    p_staff_id: parsed.data.staffId,
    p_range_start: parsed.data.dateFrom,
    p_range_end: parsed.data.dateTo,
    p_timezone: parsed.data.timezone,
    p_limit: 80,
  });

  if (error) {
    return NextResponse.json({ error: "Não foi possível consultar os horários." }, { status: 422 });
  }

  const slots = z.array(rpcSlotSchema).parse(data ?? []).map((slot) => ({
    startAt: slot.starts_at,
    endAt: slot.ends_at,
    staffId: slot.staff_id,
    staffName: slot.staff_name,
  }));

  return NextResponse.json(
    { slots },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
}
