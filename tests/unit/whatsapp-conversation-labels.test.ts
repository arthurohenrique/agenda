import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationStateLabel,
  conversationStatusLabel,
  dayLabel,
  isAwaitingReply,
  isRedactedContent,
  messageBody,
  messageTime,
  outboundDeliveryLabel,
  serviceWindowLabel,
} from "@/features/whatsapp/presentation/conversation-labels";

const SP = "America/Sao_Paulo";

describe("corpo da mensagem", () => {
  it("lê texto das mensagens de texto, botão, lista e flow", () => {
    for (const messageType of ["text", "button", "list", "flow"] as const) {
      expect(messageBody({ messageType, content: { text: "Oi" } })).toEqual({
        kind: "text",
        text: "Oi",
      });
    }
  });

  it("nomeia o modelo aprovado quando a mensagem é template", () => {
    expect(messageBody({
      messageType: "template",
      content: { templateName: "lembrete_24h", language: "pt_BR" },
    })).toEqual({ kind: "template", text: "Modelo aprovado: lembrete_24h" });
  });

  it("descreve mídia por tipo, já que o conteúdo não é persistido", () => {
    expect(messageBody({ messageType: "image", content: {} }).kind).toBe("media");
    expect(messageBody({ messageType: "document", content: {} }).text).toContain("Documento");
    expect(messageBody({ messageType: "location", content: {} }).text).toContain("Localização");
    expect(messageBody({ messageType: "unsupported", content: {} }).text).toContain("não suportado");
  });

  it("nunca devolve balão vazio para conteúdo inesperado", () => {
    const cases: unknown[] = [null, undefined, {}, { text: "   " }, { foo: 1 }, "texto solto", 42];
    for (const content of cases) {
      const body = messageBody({ messageType: "text", content });
      expect(body.text.length).toBeGreaterThan(0);
    }
  });

  it("mensagem redigida pela retenção vira lápide, não texto vazio", () => {
    const content = { _retention: { redacted: true } };
    expect(isRedactedContent(content)).toBe(true);
    expect(messageBody({ messageType: "text", content })).toEqual({
      kind: "redacted",
      text: "Conteúdo removido pela política de retenção.",
    });
  });

  it("não confunde conteúdo comum com conteúdo redigido", () => {
    expect(isRedactedContent({ text: "Oi" })).toBe(false);
    expect(isRedactedContent({ _retention: { redacted: false } })).toBe(false);
    expect(isRedactedContent(null)).toBe(false);
  });
});

describe("rótulos de conversa", () => {
  it("traduz cada status da máquina de estados", () => {
    expect(conversationStatusLabel("human_handoff")).toEqual({
      label: "Atendimento humano",
      tone: "attention",
    });
    expect(conversationStatusLabel("processing").label).toBe("Bot respondendo");
    expect(conversationStatusLabel("waiting_customer").label).toBe("Aguardando cliente");
    expect(conversationStatusLabel("expired").tone).toBe("closed");
  });

  it("status desconhecido não quebra a lista", () => {
    expect(conversationStatusLabel("estado_novo").label).toBe("Em andamento");
  });

  it("nunca renderiza o token cru de um estado desconhecido", () => {
    expect(conversationStateLabel("SERVICE_SELECTION")).toBe("Escolhendo serviço");
    expect(conversationStateLabel("HUMAN_HANDOFF")).toBe("Com a equipe");
    expect(conversationStateLabel("ESTADO_INTERNO_NOVO")).toBeNull();
  });

  it("deriva a espera por resposta sem tabela de não lidas", () => {
    expect(isAwaitingReply("2026-09-02T12:00:00.000Z", null)).toBe(true);
    expect(isAwaitingReply("2026-09-02T12:00:00.000Z", "2026-09-02T12:00:01.000Z")).toBe(false);
    expect(isAwaitingReply("2026-09-02T12:00:02.000Z", "2026-09-02T12:00:01.000Z")).toBe(true);
    expect(isAwaitingReply(null, "2026-09-02T12:00:01.000Z")).toBe(false);
  });
});

describe("entrega de mensagens de saída", () => {
  it("resposta cancelada pelo handoff não aparece como entregue", () => {
    expect(outboundDeliveryLabel("ignored", "conversation_handoff_requested"))
      .toBe("Não enviada — atendimento humano assumiu");
    expect(outboundDeliveryLabel("ignored", null)).toBe("Não enviada");
  });

  it("mapeia os demais status do provedor", () => {
    expect(outboundDeliveryLabel("failed", "rate_limited")).toBe("Falha no envio");
    expect(outboundDeliveryLabel("read", null)).toBe("Lida");
    expect(outboundDeliveryLabel("delivered", null)).toBe("Entregue");
    expect(outboundDeliveryLabel("sent", null)).toBe("Enviada");
    expect(outboundDeliveryLabel("received", null)).toBeNull();
  });
});

describe("janela de serviço", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-02T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("informa o horário limite no fuso do tenant", () => {
    // 2026-09-02 20:00 UTC = 17:00 em São Paulo.
    const result = serviceWindowLabel("2026-09-02T20:00:00.000Z", SP);
    expect(result).toEqual({ label: "Janela aberta até 17:00", open: true });
  });

  it("janela vencida ou ausente explica por que o bot ficou mudo", () => {
    expect(serviceWindowLabel("2026-09-02T11:00:00.000Z", SP))
      .toEqual({ label: "Janela de 24h fechada — só template", open: false });
    expect(serviceWindowLabel(null, SP).open).toBe(false);
    expect(serviceWindowLabel("não é data", SP).open).toBe(false);
  });
});

describe("horários no fuso do estabelecimento", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formata a hora no fuso do tenant, não no UTC do servidor", () => {
    // O processo roda em UTC na Vercel; 02:30 UTC é 23:30 do dia anterior em SP.
    vi.setSystemTime(new Date("2026-09-02T12:00:00.000Z"));
    expect(messageTime("2026-09-02T02:30:00.000Z", SP)).toBe("23:30");
  });

  it("separa os dias pelo calendário do tenant", () => {
    // 2026-09-02 02:30 UTC ainda é 01/09 em São Paulo.
    vi.setSystemTime(new Date("2026-09-02T12:00:00.000Z"));
    expect(dayLabel("2026-09-02T02:30:00.000Z", SP)).toBe("Ontem");
    expect(dayLabel("2026-09-02T15:00:00.000Z", SP)).toBe("Hoje");
    expect(dayLabel("2026-08-20T15:00:00.000Z", SP)).toBe("20 de agosto");
  });

  it("vira o dia às 21h em São Paulo sem arrastar a tela para o dia seguinte", () => {
    // 2026-09-03 01:00 UTC = 2026-09-02 22:00 em São Paulo.
    vi.setSystemTime(new Date("2026-09-03T01:00:00.000Z"));
    expect(dayLabel("2026-09-03T01:00:00.000Z", SP)).toBe("Hoje");
    expect(dayLabel("2026-09-02T10:00:00.000Z", SP)).toBe("Hoje");
    expect(dayLabel("2026-09-01T10:00:00.000Z", SP)).toBe("Ontem");
  });
});
