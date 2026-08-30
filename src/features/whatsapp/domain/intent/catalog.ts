import { tokenize } from "./tokens";

export interface CatalogItem {
  id: string;
  name: string;
}

export type CatalogMatch<T extends CatalogItem> =
  | { kind: "match"; item: T; matched: string }
  | { kind: "ambiguous"; items: T[] }
  | { kind: "none" };

// Plural e variação de terminação: "manicures" ↔ "manicure", "coloracoes" ↔
// "coloracao". Vale quando as duas palavras têm cinco letras ou mais e diferem
// só nas duas últimas — abaixo disso "barba" alcançaria "Bárbara".
const PREFIX_MIN = 5;

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function tokenMatches(word: string, token: string): boolean {
  if (word === token) return true;
  if (word.length < PREFIX_MIN || token.length < PREFIX_MIN) return false;
  const shared = commonPrefixLength(word, token);
  return shared >= PREFIX_MIN && shared >= Math.min(word.length, token.length) - 2;
}

// Casa nomes do catálogo (serviços, profissionais) contra a frase do cliente.
// Nome inteiro presente vale mais do que qualquer sobreposição parcial, para
// que "corte e barba" escolha "Corte e barba" e não "Corte"; e "corte" sozinho
// escolha "Corte" quando ele existe. Empate no topo é ambiguidade: a decisão
// volta para o cliente em vez de o parser adivinhar.
export function matchCatalog<T extends CatalogItem>(
  text: string,
  items: readonly T[],
): CatalogMatch<T> {
  const words = tokenize(text);
  if (words.length === 0 || items.length === 0) return { kind: "none" };
  const phrase = ` ${words.join(" ")} `;

  const scored = items.flatMap((item) => {
    const tokens = tokenize(item.name).filter((token) => token.length >= 3);
    if (tokens.length === 0) return [];
    const full = ` ${tokens.join(" ")} `;
    if (phrase.includes(full)) {
      return [{ item, score: 100 + tokens.length, matched: tokens.join(" ") }];
    }
    const matchedWords = words.filter((word) => tokens.some((token) => tokenMatches(word, token)));
    if (matchedWords.length === 0) return [];
    // Metade do nome precisa aparecer: "corte" alcança "Corte feminino", mas
    // "de" ou uma palavra solta não alcança "Tratamento de queda".
    if (matchedWords.length * 2 < tokens.length) return [];
    return [{ item, score: matchedWords.length, matched: matchedWords.join(" ") }];
  });
  if (scored.length === 0) return { kind: "none" };

  const best = Math.max(...scored.map((entry) => entry.score));
  const top = scored.filter((entry) => entry.score === best);
  if (top.length > 1) return { kind: "ambiguous", items: top.map((entry) => entry.item) };
  const [winner] = top;
  if (!winner) return { kind: "none" };
  return { kind: "match", item: winner.item, matched: winner.matched };
}
