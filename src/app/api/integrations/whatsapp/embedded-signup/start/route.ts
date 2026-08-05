import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantAccess } from "@/features/tenants/access";
import { getWhatsAppConfig } from "@/features/whatsapp/config";
import { isTrustedMutationRequest } from "@/lib/security/origin";

const startSchema = z.object({ slug: z.string().min(3).max(80) }).strict();

export async function POST(request: NextRequest) {
  if (!getWhatsAppConfig().embeddedSignupEnabled) {
    return NextResponse.json({ error: "Recurso indisponível." }, { status: 404 });
  }
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Origem não autorizada." }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const tenant = await requireTenantAccess(parsed.data.slug);
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  return NextResponse.json(
    {
      error: "Embedded Signup aguarda revisão da documentação oficial vigente.",
      code: "embedded_signup_not_implemented",
    },
    { status: 501 },
  );
}
