import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  dateFrom: z.iso.datetime({ offset: true }),
  dateTo: z.iso.datetime({ offset: true }),
  staffId: z.guid().nullable(),
});

const slotSchema = z.object({
  starts_at: z.string(),
  ends_at: z.string(),
  staff_id: z.guid(),
  staff_name: z.string(),
});

interface RescheduleAvailabilityProps { params: Promise<{ token: string }> }

export async function GET(request: NextRequest, { params }: RescheduleAvailabilityProps) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Serviço indisponível." }, { status: 503 });
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: "Link inválido." }, { status: 404 });
  const parsed = querySchema.safeParse({
    dateFrom: request.nextUrl.searchParams.get("dateFrom"),
    dateTo: request.nextUrl.searchParams.get("dateTo"),
    staffId: request.nextUrl.searchParams.get("staffId") || null,
  });
  if (!parsed.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_reschedule_slots", {
    p_token: token,
    p_range_start: parsed.data.dateFrom,
    p_range_end: parsed.data.dateTo,
    p_staff_id: parsed.data.staffId,
    p_limit: 80,
  });
  if (error) return NextResponse.json({ error: "Reagendamento indisponível." }, { status: 422 });
  const slots = z.array(slotSchema).parse(data ?? []).map((slot) => ({
    startAt: slot.starts_at,
    endAt: slot.ends_at,
    staffId: slot.staff_id,
    staffName: slot.staff_name,
  }));
  return NextResponse.json({ slots }, { headers: { "Cache-Control": "private, no-store" } });
}
