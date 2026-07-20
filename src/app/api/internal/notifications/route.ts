import { NextResponse, type NextRequest } from "next/server";
import { processOutbox } from "@/features/notifications/worker";
import { getServerEnv } from "@/lib/env";
import { hasValidBearerToken } from "@/lib/security/bearer";

export async function POST(request: NextRequest) {
  const secret = getServerEnv().NOTIFICATION_WORKER_SECRET;
  if (!secret || !hasValidBearerToken(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 401 });
  }

  try {
    const result = await processOutbox(10);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Worker indisponível." }, { status: 503 });
  }
}
