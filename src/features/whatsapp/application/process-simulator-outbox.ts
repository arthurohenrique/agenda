import "server-only";

import { processWhatsAppOutbox } from "./process-outbox";
import type { WhatsAppProvider } from "../domain/provider";

export interface OutboxAttemptResult {
  claimed: number;
  sent: number;
  failed: number;
}

export interface SimulatorDeliveryDiagnostic {
  providerFailureInjected: boolean;
  attempts: 1 | 2;
  firstAttempt: OutboxAttemptResult;
  retryAttempt: OutboxAttemptResult | null;
  recovered: boolean;
}

type SimulatorOutboxProcessor = (options: {
  provider: WhatsAppProvider;
  limit: number;
  workerId: string;
  scope: { provider: "mock"; conversationId: string };
}) => Promise<OutboxAttemptResult>;

export async function processSimulatorOutbox(input: {
  provider: WhatsAppProvider;
  conversationId: string;
  workerId: string;
  providerFailureInjected: boolean;
  processor?: SimulatorOutboxProcessor;
}): Promise<SimulatorDeliveryDiagnostic> {
  if (input.provider.provider !== "mock") {
    throw new Error("simulator_provider_invalid");
  }
  const processor = input.processor ?? processWhatsAppOutbox;
  const options = {
    provider: input.provider,
    limit: 10,
    workerId: input.workerId,
    scope: { provider: "mock" as const, conversationId: input.conversationId },
  };
  const firstAttempt = await processor(options);
  const retryAttempt = input.providerFailureInjected
    ? await processor(options)
    : null;

  return {
    providerFailureInjected: input.providerFailureInjected,
    attempts: retryAttempt ? 2 : 1,
    firstAttempt,
    retryAttempt,
    recovered: Boolean(
      input.providerFailureInjected &&
      firstAttempt.failed > 0 &&
      retryAttempt &&
      retryAttempt.sent > 0,
    ),
  };
}
