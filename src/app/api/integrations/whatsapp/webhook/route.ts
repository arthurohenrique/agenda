import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { processWhatsAppInbox } from "@/features/whatsapp/application/process-inbox";
import { processWhatsAppOutbox } from "@/features/whatsapp/application/process-outbox";
import { getWhatsAppOrdering } from "@/features/whatsapp/application/webhook-ordering";
import { getWhatsAppConfig } from "@/features/whatsapp/config";
import type { WhatsAppProvider } from "@/features/whatsapp/domain/provider";
import { classifyWhatsAppError } from "@/features/whatsapp/domain/errors";
import { resolveWhatsAppProvider } from "@/features/whatsapp/infrastructure/providers/resolver";
import { storeWebhookEnvelope } from "@/features/whatsapp/infrastructure/repositories/channel-repository";
import {
  consumeWhatsAppWebhookRateLimit,
  type WhatsAppWebhookRateLimitAction,
} from "@/features/whatsapp/infrastructure/repositories/webhook-rate-limit";
import { getWhatsAppReadiness } from "@/features/whatsapp/readiness";
import { logger } from "@/lib/observability/logger";
import { requestFingerprint } from "@/lib/rate-limit";

// node:crypto e os workers exigem runtime Node; a inferência automática não deve
// promover esta rota para Edge.
export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1_048_576;
// Lote pequeno: o dreno roda depois da resposta, dentro do orçamento da função.
const DRAIN_BATCH_SIZE = 5;
// Teto de passadas e espera entre elas: no pior caso somam pouco mais de um
// segundo depois da resposta, sem competir com o pg_cron que cobre a cauda.
const MAX_DRAIN_PASSES = 3;
const DRAIN_RETRY_DELAY_MS = 750;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Drena a inbox e a outbox depois que a Meta já recebeu 200. O lote não é escopado
// ao evento recém-gravado de propósito: a mesma passada processa o evento atual e
// recupera o backlog cujo next_attempt_at já venceu. A inbox persistida no Supabase
// continua sendo a fonte de verdade — se a função morrer aqui, o evento permanece
// reivindicável, com backoff e dead letter aplicados pelas funções de claim.
//
// A passada é repetida porque `claim_whatsapp_webhook_events` recusa um evento
// enquanto existir predecessor não processado com chave de ordenação em comum. A
// Meta entrega status em rajada — dois eventos da mesma conversa chegam com décimos
// de segundo de diferença — então o dreno do segundo encontra o primeiro em voo,
// não reivindica nada e termina. Sem uma nova passada, esse evento só seria
// recuperado pela próxima entrega; sendo ele o último da rajada, ficaria parado.
// `expectPending` distingue o envelope recém-gravado de uma duplicata, cuja fila
// pode legitimamente estar vazia.
async function drainWhatsAppQueues(
  provider: WhatsAppProvider,
  correlationId: string,
  expectPending: boolean,
): Promise<void> {
  const workerId = `webhook:${correlationId}`;
  try {
    for (let pass = 1; pass <= MAX_DRAIN_PASSES; pass += 1) {
      const { claimed } = await processWhatsAppInbox({
        provider,
        limit: DRAIN_BATCH_SIZE,
        workerId,
      });
      // Uma passada produtiva pode ter destravado sucessores bloqueados; uma
      // primeira passada vazia com envelope novo indica exatamente o bloqueio.
      const worthRetrying = claimed > 0 || (pass === 1 && expectPending);
      if (!worthRetrying || pass === MAX_DRAIN_PASSES) break;
      await delay(DRAIN_RETRY_DELAY_MS);
    }
  } catch (error) {
    logger.error("whatsapp_webhook_inbox_drain_failed", {
      correlationId,
      errorCode: classifyWhatsAppError(error).code,
      operation: "receive_webhook",
      result: "deferred_to_recovery",
    });
  }
  try {
    await processWhatsAppOutbox({ provider, limit: DRAIN_BATCH_SIZE, workerId });
  } catch (error) {
    logger.error("whatsapp_webhook_outbox_drain_failed", {
      correlationId,
      errorCode: classifyWhatsAppError(error).code,
      operation: "receive_webhook",
      result: "deferred_to_recovery",
    });
  }
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
  after(() => drainWhatsAppQueues(provider, stored.correlationId, !stored.duplicate));
  return NextResponse.json(
    { received: true, duplicate: stored.duplicate, correlationId: stored.correlationId },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
