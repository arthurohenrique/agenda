import "server-only";

import { logger } from "@/lib/observability/logger";
import {
  llmExtractionSchema,
  type LlmExtraction,
  type LlmExtractionInput,
  type WhatsAppIntentLlm,
} from "./intent-llm";

// Origem fixa, como no adapter Meta: nenhuma URL vinda de dado externo.
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Depois de um 429 a instância serverless espera antes de tentar de novo. O
// tier gratuito do Groq limita por tokens/minuto; martelar só piora. Estado por
// instância é suficiente: a cota é compartilhada, o objetivo é aliviar, não
// coordenar.
const RATE_LIMIT_COOLDOWN_MS = 60_000;
let cooldownUntil = 0;

// Só para testes: zera o estado entre casos.
export function resetGroqCooldown(): void {
  cooldownUntil = 0;
}

function systemPrompt(input: LlmExtractionInput): string {
  return [
    "Você extrai campos de agendamento de mensagens de WhatsApp em português do Brasil.",
    `Hoje é ${input.today} no fuso ${input.timezone}.`,
    `Serviços do estabelecimento: ${input.services.join(", ") || "(nenhum)"}.`,
    `Profissionais: ${input.staff.join(", ") || "(nenhum)"}.`,
    "Responda SOMENTE um objeto JSON com as chaves: intent, service_name, staff_name, staff_any, requested_staff_name, date, time, period. Use null quando o campo não aparecer na mensagem.",
    '- intent: "book" (marcar), "reschedule" (remarcar), "cancel" (cancelar), "upcoming" (ver agendamentos), "human" (falar com pessoa) ou null.',
    "- service_name: um nome EXATO da lista de serviços, ou null.",
    "- staff_name: um nome EXATO da lista de profissionais, ou null.",
    "- requested_staff_name: nome de pessoa citado que NÃO está na lista, ou null.",
    "- staff_any: true se disse que tanto faz o profissional.",
    '- date: data resolvida a partir de hoje no formato "AAAA-MM-DD" (entenda gírias como "hj", "amn", "sex"), ou null.',
    '- time: hora no formato "HH:MM" de 24h ("2 da tarde" é "14:00"), ou null.',
    '- period: "morning", "afternoon" ou "evening" se citou manhã/tarde/noite sem hora exata, ou null.',
    "Não invente valores. Não responda nada além do JSON.",
  ].join("\n");
}

const responseSchema = llmExtractionSchema;

export class GroqIntentLlm implements WhatsAppIntentLlm {
  readonly provider = "groq";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: { apiKey: string; model: string; timeoutMs: number }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
  }

  async extract(input: LlmExtractionInput): Promise<LlmExtraction | null> {
    if (Date.now() < cooldownUntil) {
      logger.info("whatsapp_llm_extraction", {
        llmProvider: this.provider,
        llmOutcome: "fallback_rate_limit",
      });
      return null;
    }
    const started = Date.now();
    const outcome = (result: string) => ({
      llmProvider: this.provider,
      llmOutcome: result,
      durationMs: Date.now() - started,
    });
    try {
      const response = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt(input) },
            { role: "user", content: input.text },
          ],
        }),
      });
      if (response.status === 429) {
        cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        logger.warn("whatsapp_llm_extraction", outcome("fallback_rate_limit"));
        return null;
      }
      if (!response.ok) {
        logger.warn("whatsapp_llm_extraction", outcome("fallback_error"));
        return null;
      }
      const payload: unknown = await response.json();
      const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
        ?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        logger.warn("whatsapp_llm_extraction", outcome("fallback_error"));
        return null;
      }
      const parsed = responseSchema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        logger.warn("whatsapp_llm_extraction", outcome("fallback_error"));
        return null;
      }
      logger.info("whatsapp_llm_extraction", outcome("hit"));
      return parsed.data;
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      logger.warn(
        "whatsapp_llm_extraction",
        outcome(timedOut ? "fallback_timeout" : "fallback_error"),
      );
      return null;
    }
  }
}
