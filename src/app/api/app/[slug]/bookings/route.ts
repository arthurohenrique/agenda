import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAccess } from "@/features/tenants/access";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const adminBookingSchema = z.object({
  locationId: z.guid(),
  serviceId: z.guid(),
  staffId: z.guid().nullable(),
  startsAt: z.iso.datetime({ offset: true }),
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z.string().trim().min(8).max(30),
  customerEmail: z.union([z.email(), z.literal("")]).optional(),
  customerNotes: z.string().trim().max(2000).optional().default(""),
  internalNotes: z.string().trim().max(2000).optional().default(""),
  idempotencyKey: z.guid(),
});

interface AdminBookingRouteProps { params: Promise<{ slug: string }> }

export async function POST(request: NextRequest, { params }: AdminBookingRouteProps) {
  const { slug } = await params;
  const tenant = await requireTenantAccess(slug);
  const body: unknown = await request.json().catch(() => null);
  const parsed = adminBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados do agendamento inválidos." }, { status: 400 });
  }
  const phone = normalizePhone(parsed.data.customerPhone);
  if (!phone) {
    return NextResponse.json({ error: "Informe telefone válido com DDD." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_admin_booking", {
    p_tenant_id: tenant.id,
    p_location_id: parsed.data.locationId,
    p_service_ids: [parsed.data.serviceId],
    p_staff_id: parsed.data.staffId,
    p_starts_at: parsed.data.startsAt,
    p_timezone: tenant.timezone,
    p_customer_name: parsed.data.customerName,
    p_customer_phone: phone,
    p_customer_email: parsed.data.customerEmail || null,
    p_customer_notes: parsed.data.customerNotes || null,
    p_internal_notes: parsed.data.internalNotes || null,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    const conflict = error.code === "23P01" || error.message.includes("slot_unavailable");
    return NextResponse.json(
      {
        error: conflict
          ? "Horário ocupado há instantes. Escolha outra opção."
          : "Não foi possível criar o agendamento.",
      },
      { status: conflict ? 409 : 422 },
    );
  }

  return NextResponse.json(data, { status: 201 });
}
