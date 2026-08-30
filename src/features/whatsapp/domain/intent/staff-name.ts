import { tokenize } from "./tokens";

// Nome de profissional citado pelo cliente que não está no cadastro. O parser
// de catálogo já tentou casar e falhou; aqui a pergunta é outra: o cliente
// pediu alguém? "com Raul" sim; "com pressa" não. A resposta a esse pedido é
// avisar e oferecer quem atende — nunca inventar um profissional.

const notNames = new Set([
  // período, data, hora
  "hoje", "amanha", "depois", "manha", "tarde", "noite", "cedo", "dia", "dias",
  "hora", "horas", "horario", "horarios", "semana", "mes", "ano", "agora",
  "segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo",
  // qualificadores comuns depois de "com"
  "pressa", "urgencia", "urgente", "desconto", "calma", "cuidado", "certeza",
  "preferencia", "voce", "voces", "ele", "ela", "eles", "elas", "quem", "outro",
  "outra", "mesmo", "mesma", "alguem", "ninguem", "qualquer", "tudo", "todos",
  "todas", "nenhum", "nenhuma", "gente", "pessoal", "equipe", "profissional",
  "profissionais", "atendente", "humano", "servico", "agendamento", "reserva",
  "vaga", "encaixe", "tempo", "antecedencia", "corte", "barba", "cabelo", "unha",
  "unhas", "escova", "coloracao", "pintura", "maquiagem", "massagem", "limpeza",
  "sobrancelha", "consulta", "retorno", "avaliacao", "procedimento", "exame",
  "que", "quando", "onde", "como", "sim", "nao", "obrigado", "obrigada",
  "favor", "possivel", "valor", "preco", "cartao", "dinheiro", "pix",
]);

export function extractRequestedStaffName(remainder: string): string | null {
  const words = tokenize(remainder);
  // `tokenize` descarta "com", então a busca é no texto cru normalizado.
  const match = /\b(?:com|pelo|pela|c\/)\s+(?:o|a|os|as|@)?\s*([a-z]{3,})\b/.exec(remainder);
  const candidate = match?.[1];
  if (!candidate || notNames.has(candidate) || !words.includes(candidate)) return null;
  return candidate.charAt(0).toUpperCase() + candidate.slice(1);
}
