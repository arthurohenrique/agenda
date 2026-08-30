// Normalização de texto em pt-BR compartilhada por comandos, busca e parser.
// Antes havia cinco cópias da mesma cadeia NFD → remover acentos → minúsculas,
// cada uma com um detalhe próprio. Uma diferença de detalhe entre elas é o tipo
// de bug que só aparece com cliente real digitando.

export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Sem acentos, minúsculas, sem espaços nas pontas e sem espaços repetidos.
export function normalizeText(value: string): string {
  return stripDiacritics(value)
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}

// `normalizeText` mais a pontuação final descartada: "Menu!" e "menu" são o
// mesmo comando. Só a pontuação final: no meio ela pode ser parte de um nome.
export function normalizeCommand(value: string): string {
  return normalizeText(value).replace(/[.!?]+$/g, "").trim();
}

// Só letras, dígitos e espaços simples. Serve para comparar rótulos e nomes
// ("Sim, cancelar" ↔ "sim cancelar") e para quebrar frases em palavras.
export function normalizeWords(value: string): string {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
