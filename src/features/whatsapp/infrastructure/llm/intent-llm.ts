import { z } from "zod";

// Contrato do extrator por LLM. O modelo devolve NOMES e campos crus; quem
// transforma em `ParsedIntent` validado é `domain/intent/llm-mapping.ts` —
// nenhum id, texto de resposta ou decisão vem do modelo.

export interface LlmExtractionInput {
  // Mensagem do cliente, já truncada por quem chama.
  text: string;
  // yyyy-MM-dd no fuso do estabelecimento.
  today: string;
  timezone: string;
  // Só nomes; nunca ids nem dados do cliente.
  services: readonly string[];
  staff: readonly string[];
}

export const llmExtractionSchema = z.object({
  intent: z.enum(["book", "reschedule", "cancel", "upcoming", "human"]).nullish(),
  service_name: z.string().max(160).nullish(),
  staff_name: z.string().max(120).nullish(),
  staff_any: z.boolean().nullish(),
  requested_staff_name: z.string().max(80).nullish(),
  date: z.string().max(20).nullish(),
  time: z.string().max(5).nullish(),
  period: z.enum(["morning", "afternoon", "evening"]).nullish(),
});

export type LlmExtraction = z.infer<typeof llmExtractionSchema>;

export interface WhatsAppIntentLlm {
  readonly provider: string;
  // `null` = indisponível ou falhou. Nunca lança: o chamador cai nas regras.
  extract(input: LlmExtractionInput): Promise<LlmExtraction | null>;
}
