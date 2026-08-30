# Estado de implementação

Data de referência: 31 de julho de 2026.

## MVP

| Área | Estado |
|---|---|
| Auth SSR, recuperação e multi-tenant | Implementado |
| Onboarding e publicação | Implementado |
| Serviços, equipe e clientes | Implementado básico |
| Disponibilidade e concorrência | Implementado no Postgres |
| Reserva pública e administrativa | Implementado |
| Cancelamento e reagendamento | Implementado |
| Agenda, bloqueios e status | Implementado |
| Realtime e relatórios | Implementado básico |
| Notificações | Worker implementado; provedor externo pendente |
| WhatsApp | Pipeline mock, inbox/outbox, roteamento, agenda, handoff, simulador e retenção implementados; em produção com número real desde agosto de 2026 ([lições](whatsapp-producao-licoes.md)). Auditoria item a item: [relatório](whatsapp-validation-report.md) |
| WhatsApp — interpretação por LLM | Implementada (30 de agosto de 2026): opt-in por env (`groq`, tier gratuito), extração de campos com fallback determinístico; sem migration; setup do proprietário pendente (chave na Vercel) |
| WhatsApp — modo de interação | Implementado (30 de agosto de 2026): `buttons` (original) ou `text` por tenant, escolhido no onboarding e no painel; parser determinístico pt-BR sem LLM; migration `0027`; unit e pgTAP escritos, suíte de banco e e2e pendentes de execução na CI |
| Exportação LGPD | Implementada por tenant |
| Anonimização LGPD | Contatos técnicos órfãos do WhatsApp entram na retenção; identidade global em `customers` permanece pendente |
| Observabilidade | Logger e health check; provedor externo pendente |

## Segurança

- Vibe Check executado nas 17 categorias.
- Zero achado crítico ou alto na auditoria da aplicação.
- RLS privada validada externamente com chave publicável no Supabase real.
- API administrativa retorna `401` sem sessão e `403` sem papel/origem.
- CSP, HSTS, anti-frame, nosniff e referrer policy confirmados no build local.
- Um risco médio documentado: rate limit de Auth depende de configuração externa.
- Dependências de produção e desenvolvimento não têm vulnerabilidade conhecida no
  audit atual.

Detalhes: [auditoria](../security/AUDIT_SUMMARY.md).

## Validação executada

- ESLint: aprovado.
- TypeScript strict: aprovado.
- 44 arquivos e 238 testes unitários: aprovados.
- Build Next.js de produção: aprovado.
- Consulta anônima real: tenants publicados visíveis; quatro tabelas privadas `401`.
- Migrations atuais: 25, de `0001` a `0025`.
- Suite pgTAP do WhatsApp: 173 asserções, executadas e aprovadas na CI.
- Integração e E2E: aprovados na CI, 51 cenários e2e sem flaky.
- Lockfile e versões diretas: fixados em versões publicadas.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilidades.
- `npm audit --audit-level=high`: zero vulnerabilidades.

## Suíte completa executada

A CI está verde em `511f8ff`: `application` e `database-and-e2e` passam. Migrations de
`0001` a `0025` aplicam do zero, o seed carrega, a suíte pgTAP roda 173 asserções, a de
integração passa e os 51 cenários e2e passam, sem flaky.

Confirmada em três execuções consecutivas do mesmo commit. `39d1d91` chegou a passar
antes, mas dois commits seguintes, só de documentação, falharam — a duplicação do
transcript do simulador deixava estado residual que a retentativa do Playwright ora
mascarava, ora não.

Destravar essa execução revelou sete defeitos de produção que lint, typecheck e teste
unitário não alcançavam, dois deles fora do canal WhatsApp, no worker de notificações e
na agenda administrativa. Detalhe em [relatório](whatsapp-validation-report.md), seção
"Execução da suíte — depois da auditoria".

## Bloqueios locais

Docker e `psql` não estão instalados neste ambiente. Reset do Supabase, pgTAP,
integração com `RUN_DB_TESTS=1` e E2E com `RUN_E2E_DB=1` não foram executados
localmente. O workflow de CI está configurado para executá-los em runner com Docker.

## Auditoria do canal WhatsApp — 7 de agosto de 2026

Checklist de 809 itens aplicado ao commit `33a7ad4` e revisado depois da execução:
[relatório completo](whatsapp-validation-report.md).

| Marca | Itens |
|---|---|
| Concluídos e validados | 726 |
| Parciais | 37 |
| Bloqueados pela Meta | 27 |
| Não implementados | 17 |
| Não aplicáveis | 2 |

Contagem medida no arquivo depois da execução verde da suíte.

Declaração: **estrutura aprovada para uso com provedor mock**. A condição registrada na
entrega — executar a suíte de banco — foi cumprida. "Integração real com a Meta validada"
permanece desmarcada: não há evidência de envio, recebimento, status ou webhook com
credenciais e número reais.

### Bloqueantes registrados

0. **Corrigido.** As migrations `0020`–`0024` nunca aplicaram: o job `database-and-e2e`
   falhava em `npx supabase start` desde `33a7ad4`. PL/pgSQL rejeita variável `%rowtype`
   dentro de lista `INTO` com vários itens, e o erro ocorre no `create function`,
   abortando a migration inteira. Nove ocorrências corrigidas em `0021` e `0022`.
   Com o apply destravado, a CI expôs um segundo defeito: `whatsapp_template_definitions.name`
   usava `check (name ~ '^[a-z0-9_]{1,512}$')`, mas `{m,n}` de regex do Postgres aceita
   no máximo 255. Regex em `check` só compila na primeira linha inserida, então a migration
   aplicava e a falha surgia no `seed.sql` como `invalid regular expression` (SQLSTATE 2201B).
   As migrations foram editadas no lugar porque nunca chegaram a ser aplicadas.
1. **Resolvido.** A suíte de banco passou a executar na CI e está verde: RLS,
   concorrência e criação real de reserva estão comprovadas. Localmente segue sem rodar,
   por ausência de Docker.
2. **Retirado.** `npm run validate` não falha em checkout limpo. O TS2769 em
   `tenant-whatsapp-panel.tsx:207` vinha de um `.next/types` obsoleto na máquina local,
   não da ordem do script: `typedRoutes: true` faz o build gravar o manifesto de rotas, e
   um manifesto antigo rejeita rotas que já existem. O job `application` da CI roda
   `npm ci` e `npm run validate` e passou em todas as execuções. Localmente, rode
   `npm run build` ou apague `.next`.

### Não bloqueantes de maior impacto

- Dead letter observável, porém sem reprocessamento.
- Nenhuma métrica emitida; só logs estruturados. Alertas por configurar.
- Política de cancelamento duplicada entre `cancel_whatsapp_booking` e
  `cancel_public_booking`.
- Embedded Signup e WhatsApp Flows existem como estrutura, sem implementação ativa.

## Pendências do proprietário

1. Rotacionar segredo exposto e remover/trocar contas demo do projeto real.
2. Revisar e aplicar migrations `0017–0025` no ambiente escolhido.
3. Configurar proxy confiável, Supabase Auth rate limits, CAPTCHA e MFA.
4. Configurar webhook/e-mail, credenciais Meta e schedulers dos workers e retenção.
5. Configurar Sentry, alertas, backups/PITR, domínio e deploy.
6. Completar cadastros e regras específicas do negócio.
