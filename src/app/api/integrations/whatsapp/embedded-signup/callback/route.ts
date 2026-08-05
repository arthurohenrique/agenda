import { NextResponse } from "next/server";
import { getWhatsAppConfig } from "@/features/whatsapp/config";

export async function GET() {
  if (!getWhatsAppConfig().embeddedSignupEnabled) {
    return NextResponse.json({ error: "Recurso indisponível." }, { status: 404 });
  }

  return NextResponse.json(
    {
      error: "Embedded Signup aguarda revisão da documentação oficial vigente.",
      code: "embedded_signup_not_implemented",
    },
    { status: 501 },
  );
}
