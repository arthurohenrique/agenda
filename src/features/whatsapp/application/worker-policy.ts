export const whatsappWorkerPolicy = {
  maxBatchSize: 10,
  maxAttempts: 8,
  initialBackoffSeconds: 15,
  maxBackoffSeconds: 3_600,
  maxJitterSeconds: 15,
} as const;

export interface WhatsAppRetryBackoffRange {
  minSeconds: number;
  maxSeconds: number;
}

export function normalizeWhatsAppWorkerLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 10;
  return Math.min(
    whatsappWorkerPolicy.maxBatchSize,
    Math.max(1, Math.trunc(limit)),
  );
}

export function getWhatsAppRetryBackoffRange(
  attempt: number,
): WhatsAppRetryBackoffRange | null {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("whatsapp_retry_attempt_invalid");
  }
  if (attempt >= whatsappWorkerPolicy.maxAttempts) return null;
  const baseSeconds = Math.min(
    whatsappWorkerPolicy.maxBackoffSeconds,
    whatsappWorkerPolicy.initialBackoffSeconds * 2 ** Math.min(attempt, 7),
  );
  return {
    minSeconds: baseSeconds,
    maxSeconds: Math.min(
      whatsappWorkerPolicy.maxBackoffSeconds,
      baseSeconds + whatsappWorkerPolicy.maxJitterSeconds,
    ),
  };
}
