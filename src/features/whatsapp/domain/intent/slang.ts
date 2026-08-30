// Abreviações e gírias de WhatsApp em pt-BR, expandidas antes de qualquer
// parser. Só por palavra inteira: "hj" vira "hoje", mas "hjk" fica como está.
// Recebe texto já normalizado (minúsculas, sem acento).

const words: Record<string, string> = {
  hj: "hoje",
  hoj: "hoje",
  amn: "amanha",
  amnh: "amanha",
  amanhan: "amanha",
  amanha: "amanha",
  dps: "depois",
  hr: "horas",
  hrs: "horas",
  vc: "voce",
  vcs: "voces",
  q: "que",
  pq: "porque",
  tb: "tambem",
  tbm: "tambem",
  n: "nao",
  msm: "mesmo",
  qq: "qualquer",
  fz: "faz",
  td: "tudo",
  tds: "todos",
  obg: "obrigado",
  pfv: "por favor",
  pfvr: "por favor",
  pf: "por favor",
  agr: "agora",
  kd: "cade",
  mto: "muito",
  mt: "muito",
  cmg: "comigo",
  ctg: "contigo",
  qnd: "quando",
  qndo: "quando",
  qm: "quem",
  hrr: "horario",
};

// Dias da semana abreviados. "ter" também é verbo ("vou ter que"), "sex" e
// "dom" podem ser outra coisa: a expansão exige que a palavra seguinte não seja
// "que" nem um número precedido de nada que pareça mês ("3 set" é setembro e
// nem entra aqui porque "set" não está na lista).
const weekdays: Record<string, string> = {
  seg: "segunda",
  segunda: "segunda",
  ter: "terca",
  qua: "quarta",
  qui: "quinta",
  sex: "sexta",
  sab: "sabado",
  dom: "domingo",
};

const phrases: Array<[RegExp, string]> = [
  [/\bmei[- ]dia\b/g, "meio dia"],
  [/\bmeio[- ]dia e meia\b/g, "12:30"],
  [/\btanto fz\b/g, "tanto faz"],
  [/\bde manh\b/g, "de manha"],
  [/\bd tarde\b/g, "de tarde"],
  [/\bd noite\b/g, "de noite"],
  [/\bd manha\b/g, "de manha"],
];

export function expandSlang(normalized: string): string {
  let text = normalized;
  for (const [pattern, replacement] of phrases) text = text.replace(pattern, replacement);
  // Palavra a palavra, preservando pontuação colada ("amn?" → "amanha?").
  const parts = text.split(/([a-z0-9]+)/);
  const wordIndexes = parts.map((part, index) => index).filter((index) => index % 2 === 1);
  for (let position = 0; position < wordIndexes.length; position += 1) {
    const index = wordIndexes[position]!;
    const token = parts[index]!;
    const next = wordIndexes[position + 1] !== undefined ? parts[wordIndexes[position + 1]!] : undefined;
    const weekday = weekdays[token];
    if (weekday && next !== "que" && !(next && /^\d/.test(next) && token === "ter")) {
      parts[index] = weekday;
      continue;
    }
    parts[index] = words[token] ?? token;
  }
  return parts.join("");
}
