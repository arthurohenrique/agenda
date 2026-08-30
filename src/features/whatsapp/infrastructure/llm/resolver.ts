import "server-only";

import { getWhatsAppConfig } from "../../config";
import { GroqIntentLlm } from "./groq-intent-llm";
import type { WhatsAppIntentLlm } from "./intent-llm";

// `null` = LLM desligado: o modo texto segue só com as regras, o comportamento
// original. Configuração quebrada também desliga — o LLM nunca derruba o canal.
export function resolveWhatsAppIntentLlm(): WhatsAppIntentLlm | null {
  try {
    const config = getWhatsAppConfig();
    if (config.llm.provider !== "groq" || !config.llm.apiKey) return null;
    return new GroqIntentLlm({
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      timeoutMs: config.llm.timeoutMs,
    });
  } catch {
    return null;
  }
}
