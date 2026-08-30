import { normalizeWords } from "@/lib/text/normalize";

// Palavras sem conteúdo para casar catálogo: "corte com a maria" e "corte
// maria" precisam significar o mesmo. Conectivos de data e hora ficam fora da
// lista porque os parsers de data/hora leem o texto antes da tokenização.
const stopwords = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas",
  "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
  "para", "pra", "pro", "com", "por", "que", "ao", "aos",
]);

export function tokenize(value: string): string[] {
  return normalizeWords(value)
    .split(" ")
    .filter((token) => token.length > 0 && !stopwords.has(token));
}

// Remove a primeira ocorrência de um trecho já interpretado, para que o resto
// do texto siga para o próximo parser sem o mesmo pedaço ser lido duas vezes.
export function withoutMatch(text: string, matched: string | null | undefined): string {
  if (!matched) return text;
  const index = text.indexOf(matched);
  if (index < 0) return text;
  return `${text.slice(0, index)} ${text.slice(index + matched.length)}`.replace(/\s+/g, " ").trim();
}

// Remove palavras soltas, uma ocorrência de cada. O nome casado do catálogo
// pode aparecer no texto com conectivos no meio ("corte com maria" para o
// serviço "Corte com Maria"), então a remoção é por palavra, não por trecho.
export function withoutWords(text: string, words: string): string {
  let remainder = text;
  for (const word of words.split(" ").filter(Boolean)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    remainder = remainder.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`), "$1");
  }
  return remainder.replace(/\s+/g, " ").trim();
}
