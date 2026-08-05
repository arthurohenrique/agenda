import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { processWhatsAppInbox } from "@/features/whatsapp/application/process-inbox";
import { whatsappWorkerPolicy } from "@/features/whatsapp/application/worker-policy";
import { getWhatsAppConfig } from "@/features/whatsapp/config";
import { classifyWhatsAppError } from "@/features/whatsapp/domain/errors";
import { logger } from "@/lib/observability/logger";
import { hasValidBearerToken } from "@/lib/security/bearer";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(whatsappWorkerPolicy.maxBatchSize).default(10),
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
    const result = await processWhatsAppInbox({ limit: parsed.data.limit });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("whatsapp_inbox_worker_unavailable", {
      errorCode: classifyWhatsAppError(error).code,
      operation: "process_inbox_worker",
      result: "unavailable",
    });
    return NextResponse.json({ error: "Worker indisponível." }, { status: 503 });
  }
}
