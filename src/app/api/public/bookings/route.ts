import { NextResponse, type NextRequest } from "next/server";
import { publicBookingSchema } from "@/features/booking/schemas";
import { isSupabaseConfigured } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";
import { requestFingerprint } from "@/lib/rate-limit";
import { isTrustedMutationRequest } from "@/lib/security/origin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Serviço indisponível." }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = publicBookingSchema.safeParse(body);
  if (!parsed.success || parsed.data.website) {
    return NextResponse.json({ error: "Dados da reserva inválidos." }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.customer.phone);
  if (!phone) {
    return NextResponse.json({ error: "Informe um telefone válido com DDD." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_public_booking", {
    p_tenant_slug: parsed.data.slug,
    p_location_id: parsed.data.locationId,
    p_service_ids: parsed.data.serviceIds,
    p_staff_id: parsed.data.staffId,
    p_starts_at: parsed.data.startsAt,
    p_timezone: parsed.data.timezone,
    p_customer_name: parsed.data.customer.name,
    p_customer_phone: phone,
    p_customer_email: parsed.data.customer.email || null,
    p_customer_notes: parsed.data.notes || null,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_rate_limit_key: requestFingerprint(request, parsed.data.slug),
  });

  if (error) {
    const conflict = error.code === "23P01" || error.message.includes("slot_unavailable");
    const limited = error.message.includes("rate_limit_exceeded");
    return NextResponse.json(
      {
        error: limited
          ? "Muitas tentativas. Aguarde alguns minutos."
          : conflict
            ? "Este horário acabou de ser reservado. Selecione uma das novas opções disponíveis."
            : "Não foi possível confirmar a reserva. Tente novamente.",
        code: limited ? "rate_limited" : conflict ? "slot_unavailable" : "booking_failed",
      },
      { status: limited ? 429 : conflict ? 409 : 422 },
    );
  }

  return NextResponse.json(data, {
    status: 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}
