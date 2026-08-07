# AGENTS.md

Instruções para agentes de IA que alteram este repositório.

## Objetivo do produto

Agenda é um SaaS multiestabelecimento para negócios de atendimento. O núcleo ativo
é: autenticação, isolamento por tenant, catálogo, equipe, disponibilidade, agenda,
clientes, reserva pública, cancelamento, reagendamento, publicação e relatórios.

Não reintroduza módulos antecipados sem um fluxo real na interface ou API. O schema
foi reduzido deliberadamente na migration `0016_simplify_schema.sql`.

## Stack

- Next.js 16 App Router, React 19 e TypeScript strict.
- Supabase Auth, Postgres, RLS, Storage e Realtime.
- Tailwind CSS 4.
- Zod na validação de fronteiras.
- Vitest, Playwright e pgTAP.

## Mapa do repositório

- `src/app/`: rotas, Server Actions e handlers HTTP.
- `src/components/`: componentes visuais e fluxos interativos.
- `src/features/`: consultas e regras agrupadas por domínio.
- `src/lib/supabase/`: clientes browser, server e proxy.
- `src/lib/auth/`: identidade e sessão.
- `supabase/migrations/`: histórico imutável do schema.
- `supabase/seed.sql`: dados fictícios e contas de demonstração.
- `tests/`: testes unitários, integração e E2E.
- `docs/`: arquitetura, banco, operação e manual.

## Antes de editar

1. Leia `docs/TECHNICAL.md`, `docs/ARCHITECTURE.md` e `docs/DATABASE.md`.
   Para o canal WhatsApp, leia também `docs/whatsapp-validation-report.md`.
2. Verifique `git status --short` e preserve alterações não relacionadas.
3. Localize consumidores com `rg` antes de renomear tabelas, RPCs ou campos.
4. Nunca coloque `sb_secret`, `service_role` ou senhas reais em código, logs ou docs.

## Regras arquiteturais

- Slug localiza um tenant; nunca autoriza acesso.
- Toda consulta administrativa deve ser limitada pelo usuário e pelo tenant.
- RLS é obrigatória e deve ser testada; filtros no TypeScript não substituem RLS.
- Use o cliente de `src/lib/supabase/server.ts` em Server Components e Actions.
- Use o cliente browser apenas para Realtime e interações que realmente o exigem.
- Datas persistem em UTC; formatação usa o timezone IANA do tenant.
- Valores monetários persistem em centavos inteiros.
- Telefones persistem em E.164.
- Reserva e bloqueio continuam transacionais no Postgres.
- Não calcule disponibilidade definitiva somente no cliente.

## Banco de dados

- Crie uma nova migration para cada mudança; não reescreva migrations já aplicadas.
- Uma nova tabela exige fluxo ativo, integridade própria e justificativa no PR.
- Para metadados opcionais pequenos, prefira colunas `jsonb` já existentes.
- Funções `security definer` devem usar `set search_path = ''` e nomes qualificados.
- PL/pgSQL rejeita variável `%rowtype`/`record` dentro de lista `INTO` com vários
  itens (`record or row variable cannot be part of multiple-item INTO list`). O erro
  aparece no `CREATE FUNCTION`, então derruba a migration inteira. Selecione a linha
  como coluna nomeada para um `record` intermediário e destrinche depois do `if found`.
- Revise grants, policies, índices e comportamento de cascade em toda mudança.
- Atualize `docs/DATABASE.md` quando o schema lógico mudar.
- Seeds devem ser idempotentes e usar apenas identidades fictícias.

## Autenticação e autorização

- Valide identidade com `getClaims()` no servidor.
- Use `requireUser()` para exigir sessão.
- Use `requireTenantAccess(slug)` para contexto e papel no estabelecimento.
- Nunca confie em `tenant_id`, papel ou preço enviados pelo navegador.
- A chave publicável pode ir ao bundle; chaves secretas ficam somente no servidor.

## Segurança obrigatória — Vibe Check

Regras incorporadas de `benavlabs/vibe-check`, commit
`8894f172c24224a7aaf87e723fc0b88c319f8963`:

- Nunca versione credenciais ou coloque segredo em variável `NEXT_PUBLIC_*`.
- Toda rota privada autentica antes de ler entrada e valida acesso ao tenant/recurso.
- Toda tabela exposta mantém RLS habilitada e forçada; nenhuma policy irrestrita.
- Toda entrada externa recebe validação no servidor; SQL permanece parametrizado.
- Mutações HTTP validam origem ou usam autenticação não baseada em cookie.
- APIs retornam erros genéricos; detalhes ficam somente em logs do servidor.
- Não busque URL fornecida por usuário sem proteção completa contra SSRF.
- Upload futuro valida magic bytes, tamanho e nome UUID no servidor.
- Webhook futuro valida assinatura e idempotência antes de processar.
- Dependências novas exigem verificação no registro oficial e versão exata.
- Execute a auditoria em `security/` depois de alterar fronteiras de confiança.

## Canal WhatsApp

Módulo em `src/features/whatsapp/` e migrations `0020`–`0024`. Auditado item a item em
[`docs/whatsapp-validation-report.md`](docs/whatsapp-validation-report.md) (commit
`33a7ad4`, 707 itens). **Leia esse relatório antes de alterar o módulo.**

### O que já existe — não reimplemente

- O canal **reusa** o núcleo transacional: `get_available_slots` (mesma RPC do site),
  `create_public_booking` e `reschedule_public_booking`. Não crie um segundo motor de
  agendamento nem calcule disponibilidade no adaptador.
- Inbox (`whatsapp_webhook_events`) e outbox (`whatsapp_outbox`) com claim por
  `for update ... skip locked`, lease de 5 min, backoff exponencial com jitter, teto de
  8 tentativas e dead letter. Não adicione fila paralela.
- Ordenação causal por `ordering_keys` (SHA-256) com `not exists (predecessor)`;
  status fora de ordem cai em `whatsapp_pending_message_statuses` e é reaplicado.
- Conversa com lock próprio (`lock_whatsapp_conversation`, lease de 2 min) e versão
  otimista. Transições passam por `commit_whatsapp_conversation_transition`.
- Máquina de estados com 27 estados em `domain/conversation.ts`, um handler por estado.
- Lembretes reusam `public.outbox_events` com `appointment.reminder_due`, quiet hours e
  índice único de idempotência. Não crie agendador novo.
- Política de envio central em `application/messaging-policy.ts` (janela de 24 h,
  opt-in por categoria, template aprovado). Nenhum envio deve contorná-la.

### Armadilhas conhecidas

- **`npm run validate` quebra em árvore limpa.** `typedRoutes: true` só gera o manifesto
  de rotas durante `next build`, mas o script roda `typecheck` antes do `build`. Se o
  typecheck falhar com `TS2769 ... is not assignable to type 'UrlObject | RouteImpl<...>'`,
  rode `npm run build` primeiro. Não "conserte" o erro trocando `Link` por `<a>`.
- Rodar `npm install` antes de auditar: o `package.json` pode estar à frente do
  `node_modules` local (já ocorreu com `qrcode`).
- As migrations `0020`–`0024` nasceram sem nunca terem sido aplicadas: o job
  `database-and-e2e` falhava em `npx supabase start` desde `33a7ad4` por causa da regra
  de lista `INTO` do PL/pgSQL. Ao adicionar função nova, confirme que a migration aplica
  de fato; typecheck e teste unitário não cobrem nada disso.
- Docker costuma estar ausente no ambiente local. `supabase test db`, integração e E2E
  não rodam aqui — declare explicitamente o que não foi executado (o CI cobre).
- `secret_reference`, `payload` de webhook e `flow_token_hash` ficam **fora** dos
  `grant select` colunares para `authenticated`. Ao adicionar coluna sensível, revise o
  grant colunar, não só a policy.

### Pendências abertas — contexto antes de "corrigir"

- Dead letter é observável mas **não reprocessável**: não há rota nem RPC de requeue.
- **Não há camada de métricas**, só logs estruturados com allowlist de chaves em
  `src/lib/observability/logger.ts`. Alertas seguem por configurar.
- `cancel_whatsapp_booking` **duplica** a política de `cancel_public_booking` em vez de
  reusá-la como o reagendamento faz. Ao mexer em política de cancelamento, altere os dois.
- Embedded Signup: rotas respondem `501`; `signedState` existe só como tipo, sem
  assinatura implementada.
- WhatsApp Flows: tabela, hash de token e provider mock existem; sem serviço de
  aplicação que abra sessão ou valide troca de dados.
- Simulador não injeta falha permanente e não lista inbox/outbox.
- `emergency_notice` não tem texto padrão: tenant vazio = nenhum aviso enviado.
- Handoff não grava em `public.audit_logs`.
- Anonimização LGPD global em `customers` continua pendente.

### Ao alterar o módulo

1. Atualize a linha correspondente em `docs/whatsapp-validation-report.md` no mesmo PR.
2. Rode a suíte de banco se tocar migrations, RLS ou concorrência.
3. Nenhuma credencial Meta é necessária: `WHATSAPP_PROVIDER=mock` cobre o fluxo inteiro.

## Convenções de implementação

- Server Components por padrão; adicione `"use client"` apenas quando necessário.
- Valide entrada externa com Zod.
- Retorne mensagens públicas genéricas para falhas de autenticação.
- Preserve idempotência em endpoints de reserva.
- Não duplique regras críticas entre UI e banco; a RPC é a autoridade transacional.
- Mantenha componentes acessíveis por teclado, labels e estados semânticos.

## Validação obrigatória

Para mudanças comuns:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Para mudanças de banco ou concorrência:

```bash
RUN_DB_TESTS=1 npm run test:integration
npm run test:db
```

Para mudanças de fluxo:

```bash
RUN_E2E_DB=1 npm run test:e2e
```

Se a stack local do Supabase não estiver disponível, declare explicitamente quais
testes dependentes do banco não foram executados.

## Documentação

- Atualize o README apenas com capacidades realmente disponíveis.
- Screenshots ficam em `docs/images/` e não devem mostrar secrets ou dados reais.
- O manual do proprietário é gerado por `scripts/generate_owner_manual.py`.
- Após alterar o manual, gere e inspecione o PDF renderizado antes de entregar.

## Critério de conclusão

Uma tarefa só está concluída quando código, schema, documentação e testes descrevem
o mesmo comportamento, sem secrets versionados e sem regressão de isolamento entre
tenants.
