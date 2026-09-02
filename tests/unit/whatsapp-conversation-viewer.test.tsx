import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppConversationList } from "@/components/whatsapp/whatsapp-conversation-list";
import { WhatsAppTranscriptView } from "@/components/whatsapp/whatsapp-transcript";
import type {
  WhatsAppConversationListItem,
  WhatsAppTranscript,
  WhatsAppTranscriptMessage,
} from "@/features/whatsapp/presentation/conversations";

const SP = "America/Sao_Paulo";

afterEach(cleanup);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-02T15:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function conversation(overrides: Partial<WhatsAppConversationListItem> = {}): WhatsAppConversationListItem {
  return {
    id: "95000000-0000-4000-8000-000000000001",
    contactLabel: "M•• •••• 0001",
    customerName: null,
    status: "open",
    currentState: "SERVICE_SELECTION",
    serviceWindowExpiresAt: "2026-09-02T20:00:00.000Z",
    lastInboundAt: "2026-09-02T14:59:00.000Z",
    lastOutboundAt: "2026-09-02T14:59:30.000Z",
    updatedAt: "2026-09-02T14:59:30.000Z",
    preview: "Quero cortar o cabelo",
    previewDirection: "inbound",
    ...overrides,
  };
}

function message(overrides: Partial<WhatsAppTranscriptMessage> = {}): WhatsAppTranscriptMessage {
  return {
    id: "96000000-0000-4000-8000-000000000001",
    conversationId: "95000000-0000-4000-8000-000000000001",
    direction: "inbound",
    messageType: "text",
    status: "received",
    errorCode: null,
    content: { text: "Quero cortar o cabelo" },
    createdAt: "2026-09-02T14:59:00.000Z",
    ...overrides,
  };
}

function transcript(overrides: Partial<WhatsAppTranscript> = {}): WhatsAppTranscript {
  return {
    conversationId: "95000000-0000-4000-8000-000000000001",
    contactLabel: "M•• •••• 0001",
    customerName: null,
    status: "open",
    currentState: "SERVICE_SELECTION",
    serviceWindowExpiresAt: "2026-09-02T20:00:00.000Z",
    messages: [],
    hasMore: false,
    oldestCreatedAt: null,
    ...overrides,
  };
}

describe("lista de conversas", () => {
  it("mostra o contato mascarado e a prévia da última mensagem", () => {
    render(
      <WhatsAppConversationList
        conversations={[conversation()]}
        emptyLabel="vazio"
        selectedId={null}
        slug="barbearia"
        timezone={SP}
      />,
    );

    expect(screen.getByText("M•• •••• 0001")).toBeDefined();
    expect(screen.getByText("Quero cortar o cabelo")).toBeDefined();
    expect(screen.getByRole("link").getAttribute("href"))
      .toBe("/app/barbearia/whatsapp?aba=conversas&conversa=95000000-0000-4000-8000-000000000001");
  });

  it("prefere o nome do cliente do próprio estabelecimento quando existe", () => {
    render(
      <WhatsAppConversationList
        conversations={[conversation({ customerName: "Marina Alves" })]}
        emptyLabel="vazio"
        selectedId={null}
        slug="barbearia"
        timezone={SP}
      />,
    );

    expect(screen.getByText("Marina Alves")).toBeDefined();
    expect(screen.queryByText("M•• •••• 0001")).toBeNull();
  });

  it("marca a conversa que espera resposta e prefixa a fala do bot", () => {
    render(
      <WhatsAppConversationList
        conversations={[conversation({
          lastInboundAt: "2026-09-02T14:59:40.000Z",
          preview: "Qual serviço você quer?",
          previewDirection: "outbound",
        })]}
        emptyLabel="vazio"
        selectedId={null}
        slug="barbearia"
        timezone={SP}
      />,
    );

    expect(screen.getByText("Aguardando resposta")).toBeDefined();
    expect(screen.getByText("Bot: Qual serviço você quer?")).toBeDefined();
  });

  it("sem prévia disponível a linha mostra um traço, não vazio", () => {
    render(
      <WhatsAppConversationList
        conversations={[conversation({ preview: null, previewDirection: null })]}
        emptyLabel="vazio"
        selectedId={null}
        slug="barbearia"
        timezone={SP}
      />,
    );

    expect(screen.getByText("—")).toBeDefined();
  });

  it("estado vazio de quem só opera atendimento humano explica a fila", () => {
    render(
      <WhatsAppConversationList
        conversations={[]}
        emptyLabel="Nenhuma conversa aguardando atendimento humano agora."
        selectedId={null}
        slug="barbearia"
        timezone={SP}
      />,
    );

    expect(screen.getByText("Nenhuma conversa aguardando atendimento humano agora.")).toBeDefined();
  });
});

describe("transcrição da conversa", () => {
  it("descreve status, etapa e janela de 24h sem vazar o token interno", () => {
    render(
      <WhatsAppTranscriptView
        emptyLabel="vazio"
        messages={[]}
        timezone={SP}
        transcript={transcript({ status: "human_handoff" })}
      />,
    );

    expect(screen.getByText("Atendimento humano")).toBeDefined();
    expect(screen.getByText("Escolhendo serviço")).toBeDefined();
    expect(screen.getByText("Janela aberta até 17:00")).toBeDefined();
    expect(screen.queryByText("SERVICE_SELECTION")).toBeNull();
  });

  it("separa cliente e bot nos balões", () => {
    const messages = [
      message(),
      message({
        id: "96000000-0000-4000-8000-000000000002",
        direction: "outbound",
        status: "delivered",
        content: { text: "Qual serviço você quer?" },
        createdAt: "2026-09-02T14:59:30.000Z",
      }),
    ];

    render(
      <WhatsAppTranscriptView
        emptyLabel="vazio"
        messages={messages}
        timezone={SP}
        transcript={transcript({ messages })}
      />,
    );

    const log = screen.getByRole("log");
    expect(within(log).getByText("Cliente")).toBeDefined();
    expect(within(log).getByText("Bot")).toBeDefined();
    expect(within(log).getByText("11:59 · Entregue")).toBeDefined();
  });

  it("mensagem redigida pela retenção vira lápide e não balão vazio", () => {
    const messages = [message({ content: { _retention: { redacted: true } } })];

    render(
      <WhatsAppTranscriptView
        emptyLabel="vazio"
        messages={messages}
        timezone={SP}
        transcript={transcript({ messages })}
      />,
    );

    expect(screen.getByText("Conteúdo removido pela política de retenção.")).toBeDefined();
  });

  it("resposta cancelada pelo handoff não aparece como entregue", () => {
    const messages = [message({
      direction: "outbound",
      status: "ignored",
      errorCode: "conversation_handoff_requested",
      content: { text: "Posso confirmar às 14h?" },
    })];

    render(
      <WhatsAppTranscriptView
        emptyLabel="vazio"
        messages={messages}
        timezone={SP}
        transcript={transcript({ messages })}
      />,
    );

    expect(screen.getByText(/Não enviada — atendimento humano assumiu/)).toBeDefined();
  });

  it("sem conversa escolhida convida a escolher uma", () => {
    render(
      <WhatsAppTranscriptView
        emptyLabel="Escolha uma conversa para acompanhar as mensagens."
        messages={[]}
        timezone={SP}
        transcript={null}
      />,
    );

    expect(screen.getByText("Escolha uma conversa para acompanhar as mensagens.")).toBeDefined();
  });
});
