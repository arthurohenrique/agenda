import { describe, expect, it, vi } from "vitest";
import { processSimulatorOutbox } from "@/features/whatsapp/application/process-simulator-outbox";
import type { WhatsAppProvider } from "@/features/whatsapp/domain/provider";
import { MockWhatsAppProvider } from "@/features/whatsapp/infrastructure/providers/mock-provider";

describe("WhatsApp simulator provider recovery", () => {
  it("retries with the same provider instance after the injected failure", async () => {
    const provider = new MockWhatsAppProvider({
      transientFailures: { sendText: 1 },
    });
    const processor = vi.fn(async (options: {
      provider: WhatsAppProvider;
      limit: number;
      workerId: string;
      scope: { provider: "mock"; conversationId: string };
    }) => {
      expect(options.provider).toBe(provider);
      expect(options.scope).toEqual({
        provider: "mock",
        conversationId: "11111111-1111-4111-8111-111111111111",
      });
      // Uma única mensagem na fila: depois de entregue, não há o que reivindicar.
      if (provider.sentMessages.length > 0) return { claimed: 0, sent: 0, failed: 0 };
      try {
        await options.provider.sendText({
          externalPhoneNumberId: "mock-phone",
          recipient: "+5511999999999",
          idempotencyKey: "simulator-response",
          body: "Resposta",
        });
        return { claimed: 1, sent: 1, failed: 0 };
      } catch {
        return { claimed: 1, sent: 0, failed: 1 };
      }
    });

    const result = await processSimulatorOutbox({
      provider,
      conversationId: "11111111-1111-4111-8111-111111111111",
      workerId: "simulator:owner",
      providerFailureInjected: true,
      processor,
    });

    // Falha, retentativa e a passada que confirma a fila vazia.
    expect(processor).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      providerFailureInjected: true,
      attempts: 2,
      firstAttempt: { claimed: 1, sent: 0, failed: 1 },
      retryAttempt: { claimed: 1, sent: 1, failed: 0 },
      recovered: true,
    });
    expect(provider.sentMessages).toHaveLength(1);
  });

  it("repete a passada até entregar todas as respostas da mesma transição", async () => {
    // A outbox só reivindica uma mensagem por conversa por passada; uma transição
    // com duas respostas precisava de duas requisições para o cliente ver a segunda.
    const provider = new MockWhatsAppProvider();
    const queue = ["Anotei: Manicure · com Bia.", "Qual data funciona melhor?"];
    const processor = vi.fn(async (options: { provider: WhatsAppProvider }) => {
      const body = queue.shift();
      if (!body) return { claimed: 0, sent: 0, failed: 0 };
      await options.provider.sendText({
        externalPhoneNumberId: "mock-phone",
        recipient: "+5511999999999",
        idempotencyKey: `simulator-response-${queue.length}`,
        body,
      });
      return { claimed: 1, sent: 1, failed: 0 };
    });

    const result = await processSimulatorOutbox({
      provider,
      conversationId: "11111111-1111-4111-8111-111111111111",
      workerId: "simulator:owner",
      providerFailureInjected: false,
      processor,
    });

    expect(processor).toHaveBeenCalledTimes(3);
    expect(provider.sentMessages).toHaveLength(2);
    expect(result).toEqual({
      providerFailureInjected: false,
      attempts: 1,
      firstAttempt: { claimed: 2, sent: 2, failed: 0 },
      retryAttempt: null,
      recovered: false,
    });
  });
});
