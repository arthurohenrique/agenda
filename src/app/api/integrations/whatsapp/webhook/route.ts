import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getWhatsAppOrdering } from "@/features/whatsapp/application/webhook-ordering";
import { getWhatsAppConfig } from "@/features/whatsapp/config";
import { resolveWhatsAppProvider } from "@/features/whatsapp/infrastructure/providers/resolver";
import { storeWebhookEnvelope } from "@/features/whatsapp/infrastructure/repositories/channel-repository";
import {
  consumeWhatsAppWebhookRateLimit,
  type WhatsAppWebhookRateLimitAction,
} from "@/features/whatsapp/infrastructure/repositories/webhook-rate-limit";
import { getWhatsAppReadiness } from "@/features/whatsapp/readiness";
import { logger } from "@/lib/observability/logger";
import { requestFingerprint } from "@/lib/rate-limit";

const MAX_WEBHOOK_BYTES = 1_048_576;
const challengeSchema = z.string().min(1).max(1024);
const envelopeSchema = z.record(z.string(), z.unknown());

function secureEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

class WebhookBodyTooLargeError extends Error {}

async function enforceRateLimit(
  request: NextRequest,
  action: WhatsAppWebhookRateLimitAction,
): Promise<NextResponse | null> {
  try {
    const result = await consumeWhatsAppWebhookRateLimit({
      action,
      rateKey: requestFingerprint(request, `whatsapp-webhook:${action}`),
    });
    if (result.allowed) return null;

    logger.warn("whatsapp_webhook_rate_limited", {
      operation: action === "verify" ? "verify_webhook" : "receive_webhook",
      result: "rejected",
    });
    return NextResponse.json(
      { error: "Muitas solicitações." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(Math.max(1, result.retryAfterSeconds)),
        },
      },
    );
  } catch {
    logger.warn("whatsapp_webhook_rate_limit_unavailable", {
      operation: action === "verify" ? "verify_webhook" : "receive_webhook",
      result: "unavailable",
    });
    return NextResponse.json(
      { error: "Canal indisponível." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function readWebhookBody(request: NextRequest): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        throw new WebhookBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "verify");
  if (rateLimited) return rateLimited;

  const config = getWhatsAppConfig();
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const providedToken = request.nextUrl.searchParams.get("hub.verify_token");
  const parsedChallenge = challengeSchema.safeParse(
    request.nextUrl.searchParams.get("hub.challenge"),
  );
  if (
    mode !== "subscribe" ||
    !providedToken ||
    !config.webhookVerifyToken ||
    !parsedChallenge.success ||
    !secureEqual(providedToken, config.webhookVerifyToken)
  ) {
    return new NextResponse("Verificação recusada.", { status: 403 });
  }
  return new NextResponse(parsedChallenge.data, {
    status: 200,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  const config = getWhatsAppConfig();
  const readiness = getWhatsAppReadiness(config);
  if (readiness.channel.status !== "ready") {
    return NextResponse.json({ error: "Canal indisponível." }, { status: 503 });
  }
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload excede o limite." }, { status: 413 });
  }
  const rateLimited = await enforceRateLimit(request, "receive");
  if (rateLimited) return rateLimited;

  let rawBody: Uint8Array;
  try {
    rawBody = await readWebhookBody(request);
  } catch (error) {
    if (!(error instanceof WebhookBodyTooLargeError)) {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }
    return NextResponse.json({ error: "Payload excede o limite." }, { status: 413 });
  }
  const provider = resolveWhatsAppProvider({ config });
  const signatureValid = await provider.validateWebhookSignature({
    rawBody,
    signature: request.headers.get("x-hub-signature-256"),
  });
  if (!signatureValid) {
    logger.warn("whatsapp_webhook_signature_invalid", {
      operation: "receive_webhook",
      result: "rejected",
    });
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  let parsedJson: unknown;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    parsedJson = JSON.parse(decoded || "null");
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }
  const parsedEnvelope = envelopeSchema.safeParse(parsedJson);
  if (!parsedEnvelope.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }
  let ordering = getWhatsAppOrdering(provider.provider, []);
  try {
    ordering = getWhatsAppOrdering(
      provider.provider,
      await provider.normalizeWebhook(parsedEnvelope.data),
    );
  } catch {
    logger.warn("whatsapp_webhook_normalization_failed", {
      operation: "receive_webhook",
      result: "global_ordering_fallback",
    });
  }
  const stored = await storeWebhookEnvelope({
    provider: provider.provider,
    rawBody,
    payload: parsedEnvelope.data,
    signatureValid,
    orderingKeys: ordering.keys,
    orderingGlobalFallback: ordering.globalFallback,
  });
  logger.info("whatsapp_webhook_received", {
    webhookEventId: stored.id,
    correlationId: stored.correlationId,
    operation: "receive_webhook",
    result: stored.duplicate ? "duplicate" : "queued",
  });
  return NextResponse.json(
    { received: true, duplicate: stored.duplicate, correlationId: stored.correlationId },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
