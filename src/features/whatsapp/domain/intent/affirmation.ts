import { normalizeWords } from "@/lib/text/normalize";
import { expandSlang } from "./slang";
import { tokenize } from "./tokens";

export type Affirmation = "yes" | "no" | "change" | "cancel";

// Resposta a uma pergunta fechada ("Posso confirmar?"). Diferente do parser de
// intenção, aqui a frase inteira é a resposta, então palavras soltas bastam.
// Precedência: cancelar > trocar > negar > afirmar — "não, outro horário" é
// troca, e "sim, mas cancela o outro" continua sendo cancelamento.
const cancelPhrases = ["cancela", "cancelar", "cancele", "desiste", "desisto", "deixa pra la", "deixa para la", "esquece", "nao quero mais"];
const changePhrases = ["outro horario", "outra hora", "outro dia", "outra data", "troca", "trocar", "muda", "mudar", "mais cedo", "mais tarde", "diferente", "errado", "errada", "nao e isso", "nao e esse", "nao e essa"];
const noWords = new Set(["nao", "n", "negativo", "nunca", "nope"]);
const yesWords = new Set([
  "sim", "isso", "certo", "pode", "confirma", "confirmar", "confirmo", "confirmado",
  "fechado", "fechou", "beleza", "blz", "ok", "okay", "bora", "show", "top", "claro",
  "positivo", "exato", "correto", "perfeito", "vlw", "valeu", "ta", "tá", "bom",
  "otimo", "certinho", "isso ai", "isso mesmo", "pode ser", "pode sim", "ta bom",
  "ta otimo", "combinado", "demorou", "manda", "vai", "yes", "s",
]);

export function parseAffirmation(text: string): Affirmation | null {
  const words = expandSlang(normalizeWords(text));
  const padded = ` ${words} `;
  const tokens = new Set(tokenize(words));
  if (cancelPhrases.some((phrase) => padded.includes(` ${phrase} `))) return "cancel";
  if (changePhrases.some((phrase) => padded.includes(` ${phrase} `))) return "change";
  if ([...tokens].some((token) => noWords.has(token))) return "no";
  if ([...yesWords].some((word) => word.includes(" ") ? padded.includes(` ${word} `) : tokens.has(word))) {
    return "yes";
  }
  return null;
}

// Atalhos ao escolher horário: "o primeiro", "o último", "o mais cedo".
export type SlotShortcut = "first" | "last";

export function parseSlotShortcut(text: string): SlotShortcut | null {
  const padded = ` ${expandSlang(normalizeWords(text))} `;
  if ([" primeiro ", " primeira ", " mais cedo ", " o mais cedo "].some((p) => padded.includes(p))) return "first";
  if ([" ultimo ", " ultima ", " mais tarde ", " o mais tarde "].some((p) => padded.includes(p))) return "last";
  return null;
}

export function mentionsOtherDate(text: string): boolean {
  const padded = ` ${expandSlang(normalizeWords(text))} `;
  return [" outro dia ", " outra data ", " outra dia ", " trocar o dia ", " mudar o dia "].some((p) => padded.includes(p));
}
