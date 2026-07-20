import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantAccess } from "@/features/tenants/access";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

interface ExportRouteProps {
  params: Promise<{ slug: string; customerTenantId: string }>;
}

export async function GET(_request: Request, { params }: ExportRouteProps) {
  const { slug, customerTenantId } = await params;
  const parsedId = z.guid().safeParse(customerTenantId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária." }, { status: 401 });
  const tenant = await getTenantAccess(slug, user.id);
  if (!tenant || !["owner", "admin"].includes(tenant.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: customer, error: customerError } = await supabase
    .from("customer_tenants")
    .select(
      "id, display_name, tags, first_visit_at, last_visit_at, next_appointment_at, appointments_count, completed_count, cancellation_count, no_show_count, source, created_at, customers!customer_tenants_customer_id_fkey(full_name, phone_e164, email, birth_date, locale, created_at, updated_at)",
    )
    .eq("tenant_id", tenant.id)
    .eq("id", parsedId.data)
    .single();
  if (customerError || !customer) {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }

  const { data: appointments, error: appointmentError } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, ends_at, timezone, total_cents, currency, origin, status, customer_notes, cancellation_reason, created_at, updated_at",
    )
    .eq("tenant_id", tenant.id)
    .eq("customer_tenant_id", parsedId.data)
    .order("starts_at", { ascending: false });
  if (appointmentError) {
    return NextResponse.json({ error: "Exportação indisponível." }, { status: 503 });
  }

  const appointmentIds = (appointments ?? []).map((appointment) => appointment.id);
  const services = appointmentIds.length
    ? await supabase
        .from("appointment_services")
        .select("appointment_id, name_snapshot, duration_minutes, price_cents")
        .eq("tenant_id", tenant.id)
        .in("appointment_id", appointmentIds)
        .order("sort_order")
    : { data: [], error: null };
  if (services.error) {
    return NextResponse.json({ error: "Exportação indisponível." }, { status: 503 });
  }

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      establishment: { id: tenant.id, name: tenant.name },
      customer,
      appointments: (appointments ?? []).map((appointment) => ({
        ...appointment,
        services: (services.data ?? []).filter(
          (service) => service.appointment_id === appointment.id,
        ),
      })),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="cliente-${parsedId.data}.json"`,
      },
    },
  );
}
