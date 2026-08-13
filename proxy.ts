import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // O webhook da Meta é público, sem cookie e sem sessão. Mantê-lo fora do proxy
  // evita refresh de sessão, reescrita de cabeçalhos e latência no caminho quente.
  matcher: [
    "/((?!api/integrations/whatsapp/webhook|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
