import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTenantAccess } from "@/features/tenants/access";
import { getCurrentUser } from "@/lib/auth/session";
import { normalizePhone } from "@/lib/phone";
import { isTrustedMutationRequest } from "@/lib/security/origin";
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
  walkIn: z.boolean().optional().default(false),
  idempotencyKey: z.guid(),
});

interface AdminBookingRouteProps { params: Promise<{ slug: string }> }

export async function POST(request: NextRequest, { params }: AdminBookingRouteProps) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  }
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 });
  }
  const tenant = await getTenantAccess(slug, user.id);
  if (!tenant || !["owner", "admin", "receptionist"].includes(tenant.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }
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

  if (parsed.data.walkIn) {
    const appointmentId = z.object({ appointmentId: z.guid() }).parse(data).appointmentId;
    const { error: confirmError } = await supabase.rpc("change_appointment_status", {
      p_tenant_id: tenant.id,
      p_appointment_id: appointmentId,
      p_status: "confirmed",
      p_reason: null,
    });
    if (confirmError && !confirmError.message.includes("invalid_status_transition")) {
      return NextResponse.json({ error: "Atendimento criado, mas não foi possível registrar a chegada." }, { status: 422 });
    }
    const { error: checkInError } = await supabase.rpc("change_appointment_status", {
      p_tenant_id: tenant.id,
      p_appointment_id: appointmentId,
      p_status: "checked_in",
      p_reason: "Atendimento presencial registrado pela equipe.",
    });
    if (checkInError) {
      return NextResponse.json({ error: "Atendimento criado, mas não foi possível registrar a chegada." }, { status: 422 });
    }
  }

  return NextResponse.json({ ...data, walkIn: parsed.data.walkIn }, { status: 201 });
}
