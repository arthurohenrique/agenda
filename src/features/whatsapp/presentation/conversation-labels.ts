import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { todayInTimezone } from "@/lib/dates";

export type WhatsAppMessageDirection = "inbound" | "outbound";

export type WhatsAppMessageType =
  | "text" | "button" | "list" | "template" | "flow"
  | "image" | "document" | "location" | "unsupported";

export type WhatsAppMessageStatus =
  | "received" | "queued" | "accepted" | "sent"
  | "delivered" | "read" | "failed" | "ignored";

export type WhatsAppConversationStatus =
  | "open" | "waiting_customer" | "processing" | "human_handoff"
  | "completed" | "expired" | "closed" | "failed";

export type WhatsAppBodyKind = "text" | "template" | "media" | "redacted" | "unknown";

export interface WhatsAppMessageBody {
  kind: WhatsAppBodyKind;
  text: string;
}

// A retenção redige `content` no lugar (0024_whatsapp_retention.sql) e marca a
// linha em `content_redacted_at` — coluna que `authenticated` não seleciona. O
// mesmo job grava a marca dentro do próprio `content`, e é dela que derivamos.
export function isRedactedContent(content: unknown): boolean {
  if (!content || typeof content !== "object") return false;
  const retention = (content as { _retention?: unknown })._retention;
  if (!retention || typeof retention !== "object") return false;
  return (retention as { redacted?: unknown }).redacted === true;
}

const mediaPlaceholders: Partial<Record<WhatsAppMessageType, string>> = {
  image: "Imagem enviada pelo cliente",
  document: "Documento enviado pelo cliente",
  location: "Localização enviada pelo cliente",
  unsupported: "Mensagem em formato não suportado",
};

function textFrom(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const value = (content as { text?: unknown }).text;
  return typeof value === "string" && value.trim() ? value : null;
}

function templateFrom(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const value = (content as { templateName?: unknown }).templateName;
  return typeof value === "string" && value.trim() ? value : null;
}

// Precisa ser total: `content` tem o formato do provedor e evolui. Um
// `message_type` inesperado não pode apagar um balão em produção.
export function messageBody(input: {
  messageType: WhatsAppMessageType;
  content: unknown;
}): WhatsAppMessageBody {
  if (isRedactedContent(input.content)) {
    return { kind: "redacted", text: "Conteúdo removido pela política de retenção." };
  }

  const text = textFrom(input.content);
  if (text) return { kind: "text", text };

  const templateName = templateFrom(input.content);
  if (templateName) return { kind: "template", text: `Modelo aprovado: ${templateName}` };

  const placeholder = mediaPlaceholders[input.messageType];
  if (placeholder) return { kind: "media", text: placeholder };

  return { kind: "unknown", text: "Mensagem sem texto exibível" };
}

export type WhatsAppStatusTone = "neutral" | "active" | "attention" | "closed";

const conversationStatusLabels: Record<
  WhatsAppConversationStatus,
  { label: string; tone: WhatsAppStatusTone }
> = {
  open: { label: "Em andamento", tone: "active" },
  waiting_customer: { label: "Aguardando cliente", tone: "neutral" },
  processing: { label: "Bot respondendo", tone: "active" },
  human_handoff: { label: "Atendimento humano", tone: "attention" },
  completed: { label: "Encerrada", tone: "closed" },
  expired: { label: "Encerrada por inatividade", tone: "closed" },
  closed: { label: "Encerrada", tone: "closed" },
  failed: { label: "Encerrada com falha", tone: "attention" },
};

export function conversationStatusLabel(status: string) {
  return conversationStatusLabels[status as WhatsAppConversationStatus]
    ?? { label: "Em andamento", tone: "neutral" as WhatsAppStatusTone };
}

// `current_state` é contrato interno da máquina de estados. Estado desconhecido
// não é renderizado cru: o token revelaria o desenho do fluxo ao gestor.
const conversationStateLabels: Record<string, string> = {
  START: "Início da conversa",
  TENANT_SEARCH: "Identificando estabelecimento",
  TENANT_CONFIRMATION: "Confirmando estabelecimento",
  MAIN_MENU: "Escolhendo o que fazer",
  SERVICE_SELECTION: "Escolhendo serviço",
  STAFF_SELECTION: "Escolhendo profissional",
  DATE_SELECTION: "Escolhendo data",
  TIME_SELECTION: "Escolhendo horário",
  BOOKING_CONFIRMATION: "Confirmando agendamento",
  BOOKING_COMPLETED: "Agendamento concluído",
  CANCELLATION: "Cancelando agendamento",
  RESCHEDULE: "Reagendando",
  HUMAN_HANDOFF: "Com a equipe",
};

export function conversationStateLabel(state: string): string | null {
  return conversationStateLabels[state] ?? null;
}

// A linha que explica por que o bot ficou mudo: fora da janela de 24h só é
// possível enviar template aprovado.
export function serviceWindowLabel(
  expiresAt: string | null,
  timezone: string,
  now: Date = new Date(),
): { label: string; open: boolean } {
  if (!expiresAt) {
    return { label: "Janela de 24h fechada — só template", open: false };
  }
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()) {
    return { label: "Janela de 24h fechada — só template", open: false };
  }
  return {
    label: `Janela aberta até ${formatInTimeZone(expiry, timezone, "HH:mm", { locale: ptBR })}`,
    open: true,
  };
}

export function isAwaitingReply(
  lastInboundAt: string | null,
  lastOutboundAt: string | null,
): boolean {
  if (!lastInboundAt) return false;
  if (!lastOutboundAt) return true;
  return new Date(lastInboundAt).getTime() > new Date(lastOutboundAt).getTime();
}

// Resposta cancelada porque o atendimento humano assumiu não é resposta
// entregue (0021_whatsapp_workers.sql grava status `ignored`).
export function outboundDeliveryLabel(
  status: string,
  errorCode: string | null,
): string | null {
  if (status === "ignored") {
    return errorCode === "conversation_handoff_requested"
      ? "Não enviada — atendimento humano assumiu"
      : "Não enviada";
  }
  if (status === "failed") return "Falha no envio";
  if (status === "read") return "Lida";
  if (status === "delivered") return "Entregue";
  if (status === "sent" || status === "accepted") return "Enviada";
  if (status === "queued") return "Na fila";
  return null;
}

export function messageTime(value: string, timezone: string): string {
  return formatInTimeZone(new Date(value), timezone, "HH:mm", { locale: ptBR });
}

// Separadores de dia sempre no fuso do tenant. O servidor roda em UTC e o
// navegador do gestor pode estar em outro fuso; misturar os dois na mesma tela
// é pior que qualquer um dos dois isolado.
export function dayLabel(value: string, timezone: string): string {
  const day = formatInTimeZone(new Date(value), timezone, "yyyy-MM-dd");
  const today = todayInTimezone(timezone);
  if (day === today) return "Hoje";
  const yesterday = formatInTimeZone(
    new Date(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000),
    timezone,
    "yyyy-MM-dd",
  );
  if (day === yesterday) return "Ontem";
  return formatInTimeZone(new Date(value), timezone, "d 'de' MMMM", { locale: ptBR });
}

export function conversationTimestamp(value: string, timezone: string): string {
  return `${dayLabel(value, timezone)} · ${messageTime(value, timezone)}`;
}
