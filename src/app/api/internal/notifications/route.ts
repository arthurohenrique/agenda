import { NextResponse, type NextRequest } from "next/server";
import { notificationErrorContext } from "@/features/notifications/policy";
import { processOutbox } from "@/features/notifications/worker";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import { hasValidBearerToken } from "@/lib/security/bearer";

export async function POST(request: NextRequest) {
  try {
    const secret = getServerEnv().NOTIFICATION_WORKER_SECRET;
    if (!secret) throw new Error("notification_worker_not_configured");
    if (!hasValidBearerToken(request.headers.get("authorization"), secret)) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 401 });
    }

    const result = await processOutbox(10);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("notification_worker_unavailable", notificationErrorContext(error));
    return NextResponse.json({ error: "Worker indisponível." }, { status: 503 });
  }
}
