import { z } from "zod";

// Modo de interação do canal por estabelecimento.
//
// `buttons`: o bot envia botões e listas; texto digitado numa pergunta de
// escolha só reapresenta as opções. É o comportamento original.
// `text`: o bot nunca envia interativos. Toda mensagem é interpretada e o que
// falta é perguntado em texto, com opções numeradas.
//
// A preferência fica em `tenant_whatsapp_settings.metadata.interaction_mode`.
// Ausente ou inválida equivale a `buttons`.
export const whatsappInteractionModeSchema = z.enum(["buttons", "text"]);
export type WhatsAppInteractionMode = z.infer<typeof whatsappInteractionModeSchema>;
export const DEFAULT_WHATSAPP_INTERACTION_MODE: WhatsAppInteractionMode = "buttons";

export function parseWhatsAppInteractionMode(value: unknown): WhatsAppInteractionMode {
  const parsed = whatsappInteractionModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_WHATSAPP_INTERACTION_MODE;
}
