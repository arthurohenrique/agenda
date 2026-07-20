import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const rescheduleSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  staffId: z.guid().nullable(),
  idempotencyKey: z.guid(),
});

interface RescheduleRouteProps { params: Promise<{ token: string }> }

export async function POST(request: NextRequest, { params }: RescheduleRouteProps) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Serviço indisponível." }, { status: 503 });
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: "Link inválido." }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  const parsed = rescheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Novo horário inválido." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reschedule_public_booking", {
    p_token: token,
    p_starts_at: parsed.data.startsAt,
    p_staff_id: parsed.data.staffId,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    const conflict = error.code === "23P01" || error.message.includes("slot_unavailable");
    return NextResponse.json(
      { error: conflict ? "Horário ocupado há instantes. Escolha outra opção." : "Não foi possível reagendar." },
      { status: conflict ? 409 : 422 },
    );
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
