import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { isTrustedMutationRequest } from "@/lib/security/origin";
import { createClient } from "@/lib/supabase/server";

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
});

interface BookingRouteProps {
  params: Promise<{ token: string }>;
}

export async function DELETE(request: NextRequest, { params }: BookingRouteProps) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Serviço indisponível." }, { status: 503 });
  }

  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => ({}));
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Motivo inválido." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_public_booking", {
    p_token: token,
    p_reason: parsed.data.reason || null,
  });

  if (error) {
    const unavailable = error.message.includes("cancellation_not_allowed");
    return NextResponse.json(
      {
        error: unavailable
          ? "O prazo para cancelamento online terminou. Fale com o estabelecimento."
          : "Link inválido, expirado ou já utilizado.",
      },
      { status: unavailable ? 422 : 404 },
    );
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
