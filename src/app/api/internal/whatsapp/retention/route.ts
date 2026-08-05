import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { applyWhatsAppRetention } from "@/features/whatsapp/application/apply-retention";
import { getWhatsAppConfig } from "@/features/whatsapp/config";
import { logger } from "@/lib/observability/logger";
import { hasValidBearerToken } from "@/lib/security/bearer";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(5000).default(500),
}).strict();

export async function POST(request: NextRequest) {
  const secret = getWhatsAppConfig().workerSecret;
  if (!secret || !hasValidBearerToken(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 401 });
  }

  let input: unknown = {};
  try {
    const rawBody = await request.text();
    input = rawBody.trim() ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  try {
    const result = await applyWhatsAppRetention(parsed.data.limit);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    logger.error("whatsapp_retention_worker_unavailable", {
      operation: "apply_whatsapp_retention",
      result: "unavailable",
    });
    return NextResponse.json({ error: "Worker indisponível." }, { status: 503 });
  }
}
