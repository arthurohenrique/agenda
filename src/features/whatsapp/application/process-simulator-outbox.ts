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

// `claim_whatsapp_outbox` entrega uma mensagem por conversa por passada: a
// segunda de uma mesma transição tem predecessor ainda não enviado. Uma passada
// só devolvia a primeira resposta ("Anotei…") e deixava a pergunta para a
// requisição seguinte — o mesmo defeito da cauda de rajada em produção, que o
// webhook resolve repetindo o dreno. O teto evita laço com provedor em loop.
const MAX_DRAIN_PASSES = 5;

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

  // Passadas extras enquanto a anterior entregou algo; os totais entram na
  // tentativa que as originou, mantendo o formato do diagnóstico.
  const tail = retryAttempt ?? firstAttempt;
  let last = tail;
  for (let pass = retryAttempt ? 3 : 2; pass <= MAX_DRAIN_PASSES && last.sent > 0; pass += 1) {
    last = await processor(options);
    if (last.claimed === 0) break;
    tail.claimed += last.claimed;
    tail.sent += last.sent;
    tail.failed += last.failed;
  }

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
