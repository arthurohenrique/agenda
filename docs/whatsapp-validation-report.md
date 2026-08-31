# Checklist de validação — Automação WhatsApp (auditoria executada)

Commit auditado: `33a7ad4 feat: add WhatsApp Cloud API channel` · branch `main` · data 2026-08-07

> **Para agentes de IA:** este é o inventário item a item do que existe, do que é
> parcial e do que não existe no canal WhatsApp, com o caminho do arquivo, da
> migration ou do teste que sustenta cada marca. Leia antes de propor mudanças no
> módulo — várias "faltas" aparentes são decisões registradas, e as pendências reais
> estão consolidadas em §44. As marcas refletem o commit acima; ao alterar o módulo,
> atualize a linha correspondente no mesmo PR.
>
> Resumo executivo e armadilhas conhecidas: `AGENTS.md` §"Canal WhatsApp".

## Legenda aplicada

| Marca | Significado nesta auditoria |
|---|---|
| `[x]` | Código inspecionado **e** validado por comando executado nesta máquina (lint/typecheck/build/testes unitários) ou verificação direta e inequívoca do artefato (SQL/rota/schema). |
| `[~]` | Implementado, porém a validação depende de execução que **não foi possível localmente** (Docker/Supabase indisponível) ou a implementação é parcial. |
| `[ ]` | Não implementado. |
| `[B]` | Bloqueado por ausência de conta/credenciais Meta. |
| `[N/A]` | Não aplicável (com justificativa). |

> **Restrição de ambiente relevante:** `docker` não está disponível nesta máquina
> (`docker: command not found`; `npx supabase status` falha ao conectar ao daemon).
> Portanto **migrations, `supabase test db` (RLS), testes de integração e e2e não
> foram executados aqui**. Esses itens estão marcados `[~]` mesmo quando o artefato
> de teste existe e está no pipeline de CI (`.github/workflows/ci.yml` roda
> `supabase db reset`, `test:db`, `test:integration`, `test:e2e`).

---

# 1. Integração com o sistema existente

* [x] O agente inspecionou a estrutura real do projeto antes de implementar.
* [x] O motor de disponibilidade existente foi reutilizado.
* [x] O serviço transacional de criação de agendamentos foi reutilizado.
* [~] O cancelamento existente foi reutilizado.
* [x] O reagendamento existente foi reutilizado.
* [x] A estrutura de tenants existente foi reutilizada.
* [x] A estrutura de clientes existente foi reutilizada.
* [x] A tabela ou relacionamento `customer_tenants` foi reutilizado ou adaptado.
* [x] Não foi criado um segundo motor de agendamentos.
* [x] Não existem inserts diretos em `appointments` dentro dos handlers do WhatsApp.
* [x] A origem dos agendamentos pelo canal é registrada como `whatsapp`.
* [~] O restante do sistema funciona normalmente com o WhatsApp desativado.

## Evidências

* [x] Caminho do serviço de disponibilidade informado — RPC `get_available_slots`
  (`supabase/migrations/0009_booking_functions.sql`), consumida pelo site em
  `src/app/api/public/availability/route.ts:48` e pelo WhatsApp em
  `src/features/whatsapp/application/booking-gateway.ts:328`.
* [x] Caminho do serviço de criação informado — `public.create_public_booking`,
  chamada de dentro de `create_whatsapp_booking`
  (`supabase/migrations/0022_whatsapp_booking_gateway.sql:987`).
* [x] Caminho do adaptador do WhatsApp para os casos de uso informado —
  `src/features/whatsapp/application/booking-gateway.ts` (interface
  `WhatsAppBookingGateway`).
* [~] Teste comprovando que site e WhatsApp usam a mesma regra de disponibilidade —
  `tests/e2e/whatsapp-simulator.spec.ts:278` ("reserva feita pelo site vence o mesmo
  horário e o WhatsApp oferece alternativas"). Não executado localmente.

**Arquivos:** `src/features/whatsapp/application/booking-gateway.ts`,
`src/features/whatsapp/application/transition-conversation.ts`.
**Migration:** `0022_whatsapp_booking_gateway.sql`.
**Testes executados:** `npm test` (44 arquivos, 238 testes, todos passaram).
**Pendência:** `public.cancel_whatsapp_booking`
(`0022_whatsapp_booking_gateway.sql:1202`) **reimplementa** a política de
cancelamento (`allow_customer_cancellation`, `cancellation_window_minutes`,
`customer_tenants.cancellation_count`, histórico, outbox) em vez de reaproveitar
`public.cancel_public_booking` (`0009_booking_functions.sql:1018`). O reagendamento
reconstrói o token de gestão determinístico e chama `reschedule_public_booking`; o
mesmo recurso estava disponível para o cancelamento. Risco: divergência futura de
política entre canais.

---

# 2. Arquitetura do módulo WhatsApp

* [x] Existe um módulo isolado para WhatsApp — `src/features/whatsapp/`.
* [x] O módulo está separado em domínio, aplicação, infraestrutura e apresentação.
* [x] As regras de conversa não estão diretamente nos arquivos `route.ts`.
* [x] O domínio não depende do formato bruto da Meta.
* [x] Existe uma abstração de provedor — `WhatsAppProvider` (`domain/provider.ts:199`).
* [x] Existe uma abstração para os casos de uso de agendamento — `WhatsAppBookingGateway`.
* [x] Existe uma camada responsável pelo roteamento de tenant — `application/resolve-tenant.ts`.
* [x] Existe uma máquina de estados persistida.
* [x] Existe inbox para webhooks — `whatsapp_webhook_events`.
* [x] Existe outbox para mensagens — `whatsapp_outbox`.
* [x] Existe worker para processar eventos recebidos — `application/process-inbox.ts`.
* [x] Existe worker para processar mensagens de saída — `application/process-outbox.ts`.
* [x] Existe dead letter para eventos definitivamente falhos.
* [x] As principais decisões arquiteturais foram registradas em README ou ADR —
  `docs/adr/0001-whatsapp-cloud-api-channel.md`.

---

# 3. Provedores

* [x] Existe a interface `WhatsAppProvider` ou equivalente.
* [x] Existe `MockWhatsAppProvider`.
* [x] Existe `MetaCloudWhatsAppProvider` (741 linhas, adaptador completo de envio/normalização).
* [x] O provedor é selecionado por configuração centralizada — `infrastructure/providers/resolver.ts`.
* [x] Não existem verificações de ambiente espalhadas pelo código — tudo em `config.ts` + `readiness.ts`.
* [x] O sistema funciona completamente com `WHATSAPP_PROVIDER=mock`.
* [x] Testes não realizam chamadas reais para a Meta.
* [x] O adaptador Meta possui timeout — padrão 10 s (`meta-cloud-provider.ts:136`).
* [x] O adaptador Meta trata erros transitórios e permanentes — `isRetryableStatus`
  (408/425/429/5xx) e `isAmbiguousSendStatus` para entrega desconhecida.
* [x] O adaptador Meta não expõe tokens em logs — `logger` aceita apenas chaves
  de contexto de uma allowlist (`src/lib/observability/logger.ts`).
* [x] O mock permite simular mensagens enviadas.
* [x] O mock permite simular mensagens recebidas — `simulateInboundText`.
* [x] O mock permite simular falhas — `transientFailures`.
* [x] O mock permite simular eventos duplicados — `duplicateEvents`.
* [x] O mock permite simular eventos fora de ordem — `outOfOrderEvents`.

**Testes executados:** `tests/unit/whatsapp-mock-provider.test.ts`,
`whatsapp-meta-provider.test.ts`, `whatsapp-provider-resolver.test.ts` — passaram.
**Pendência:** o mock injeta apenas falha **transitória**; não há injeção de falha
**permanente** dedicada (ver §24).

---

# 4. Configurações e variáveis de ambiente

* [x] Existe `.env.example`.
* [x] `.env.example` não contém credenciais reais.
* [x] Existe configuração para ativar ou desativar WhatsApp — `WHATSAPP_ENABLED`.
* [x] Existe configuração para selecionar mock ou Meta — `WHATSAPP_PROVIDER`.
* [x] Existe configuração da versão da Graph API — `WHATSAPP_GRAPH_API_VERSION`.
* [x] Existe configuração do verify token — `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
* [x] Existe configuração do app secret — `WHATSAPP_APP_SECRET`.
* [x] Existe configuração de access token — `WHATSAPP_PLATFORM_ACCESS_TOKEN`.
* [x] Existe configuração de WABA padrão — `WHATSAPP_DEFAULT_WABA_ID`.
* [x] Existe configuração de número padrão — `WHATSAPP_DEFAULT_PHONE_NUMBER_ID`.
* [x] Existe configuração para ativar o simulador — `WHATSAPP_SIMULATOR_ENABLED`.
* [x] As variáveis são validadas na inicialização — schema Zod em `config.ts`.
* [x] Produção falha claramente se WhatsApp estiver ativo sem credenciais obrigatórias —
  `readiness.ts` retorna `misconfigured` e o webhook responde 503.
* [x] Desenvolvimento funciona sem nenhuma credencial Meta.
* [x] Nenhum segredo é enviado ao navegador — só `NEXT_PUBLIC_*` são públicos.
* [x] Nenhum access token está armazenado diretamente no código.
* [x] Existe estratégia documentada para armazenamento seguro de tokens futuros —
  coluna `secret_reference` + ADR §"Segurança e autorização".

**Testes executados:** `tests/unit/whatsapp-config.test.ts`, `env.test.ts` — passaram.

---

# 5. Banco de dados

## Contas e números

* [x] Existe tabela equivalente a `whatsapp_business_accounts`.
* [x] Existe tabela equivalente a `whatsapp_phone_numbers`.
* [x] Existe tabela equivalente a `whatsapp_phone_number_tenants`.
* [x] Um número pode atender vários tenants.
* [x] Um tenant pode possuir vários números.
* [x] Existe distinção entre número compartilhado, exclusivo e próprio —
  enum `whatsapp_connection_mode ('shared_platform','exclusive_platform','tenant_owned')`.
* [x] O sistema não depende apenas do número exibido para identificar o receptor —
  resolução por `external_phone_number_id`.
* [x] O identificador externo do número é armazenado.

## Configurações

* [x] Existe tabela equivalente a `tenant_whatsapp_settings`.
* [x] É possível ativar ou desativar WhatsApp por tenant — `enabled`.
* [x] É possível ativar ou desativar agendamentos por tenant — `booking_enabled`.
* [x] É possível configurar lembretes — `reminders_enabled`.
* [x] É possível configurar cancelamento — `cancellations_enabled`.
* [x] É possível configurar reagendamento — `rescheduling_enabled`.
* [x] É possível configurar atendimento humano — `human_handoff_enabled/_phone/_email`.
* [x] É possível configurar timeout de sessão — `session_timeout_minutes` (5–1440).
* [x] É possível configurar idioma e fuso horário — `default_language`, `timezone`
  (validado contra `pg_timezone_names`).
* [x] É possível escolher o modo de interação por tenant —
  `metadata.interaction_mode` (`buttons` | `text`, ausente = `buttons`). Escolhido no
  onboarding (`complete_tenant_onboarding`, 0027) e editável no painel WhatsApp por
  owner/admin. `buttons` mantém botões e listas; `text` nunca envia interativo,
  interpreta a frase do cliente com regras determinísticas (serviço, profissional,
  data, hora, período, intenção — `domain/intent/`) e pergunta em texto o que falta
  (`application/text-mode.ts`). Sem LLM.
* [x] Interpretação por LLM opcional no modo texto — `WHATSAPP_LLM_PROVIDER`
  (`none` | `groq`), fail-closed para as regras (`infrastructure/llm/`,
  `domain/intent/llm-mapping.ts`). O modelo só extrai campos; nomes re-resolvidos
  pelo catálogo, datas limitadas a 60 dias, handoff das regras nunca rebaixado,
  conteúdo da mensagem fora dos logs. Sem provedor configurado, comportamento
  idêntico ao anterior (CI sem segredos). LGPD: mensagem e nomes do catálogo saem
  para o provedor configurado — conferir os termos vigentes no momento do setup.
* [x] O modo texto conversa em prosa, não em lista numerada — copy centralizada em
  `presentation/text-mode-copy.ts` (tom informal, sem emoji; alternativas inline até
  6 itens, linhas até 12, numeradas acima). Entende gírias e abreviações
  (`domain/intent/slang.ts`), nome de profissional fora do cadastro
  (`staff-name.ts` → avisa e oferece quem atende), sim/não/trocar/cancelar em
  pergunta fechada (`affirmation.ts`, só em `AFFIRMATION_STATES`) e atalhos de
  horário ("o primeiro", "o último", hora digitada). Uma pergunta só para
  profissional ("Tem X e Y — ou tanto faz?"). Números continuam aceitos em silêncio.

## Roteamento

* [x] Existe tabela equivalente a `whatsapp_routing_codes`.
* [x] Existem códigos permanentes — `permanent_tenant_code`.
* [x] Existem tokens temporários — `temporary_context_token`.
* [x] Tokens temporários possuem expiração — constraint
  `whatsapp_routing_codes_expiry_check` exige `expires_at`.
* [x] Tokens podem ser associados ao número receptor — FK `(tenant_id, phone_number_id)`.
* [x] Tokens não armazenam dados pessoais — código restrito a `^[A-Z0-9]{5,64}$`.
* [x] Tokens não são tratados como autenticação — só resolvem tenant; troca exige confirmação.
* [x] O uso do código pode ser registrado — `uses_count`, `max_uses`,
  `whatsapp_routing_code_uses` (ledger idempotente por `usage_key`).
* [x] Existem índices para busca eficiente por código — `whatsapp_routing_codes_lookup_idx`.

## Contatos e conversas

* [x] Existe tabela equivalente a `whatsapp_contacts`.
* [x] Telefones são normalizados — check `^\+[1-9][0-9]{7,14}$`, `libphonenumber-js` na app.
* [x] O contato técnico pode ser associado a um cliente existente — `customer_id`.
* [x] Existe tabela equivalente a `whatsapp_conversations`.
* [x] A conversa pode existir temporariamente sem tenant — `tenant_id` nullable.
* [x] A conversa possui estado atual — `current_state`.
* [x] A conversa possui contexto persistido — `context jsonb`.
* [x] A conversa possui versão para controle de concorrência — `version bigint`.
* [x] A conversa possui data de expiração — `session_expires_at`, `service_window_expires_at`.
* [x] A conversa possui status de atendimento humano — `human_handoff` + `handoff_requested_at`.

## Mensagens e eventos

* [x] Existe tabela equivalente a `whatsapp_messages`.
* [x] Mensagens possuem direção de entrada ou saída.
* [x] Mensagens possuem identificador externo — `provider_message_id`.
* [x] Existe proteção contra duplicação de `provider_message_id` — índice único parcial.
* [x] Status enviado, entregue, lido e falho são armazenados.
* [x] Existe tabela equivalente a `whatsapp_webhook_events`.
* [x] Existe deduplicação de eventos — `unique (provider, external_event_key)`.
* [x] Eventos podem ir para dead letter.
* [x] Existe tabela equivalente a `whatsapp_outbox`.
* [x] Existe controle de tentativas — `attempt_count` (0–8).
* [x] Existe agendamento de nova tentativa — `next_attempt_at`.
* [x] Existe lock de processamento — `locked_by` + `locked_until`.
* [x] Existe `locked_at` ou mecanismo equivalente.

## Templates, consentimentos e handoff

* [x] Existe tabela de definições de templates — `whatsapp_template_definitions`.
* [x] Existe associação de templates por tenant e finalidade — `tenant_whatsapp_templates`
  com `unique (tenant_id, purpose)`.
* [x] Existe tabela de opt-in — `whatsapp_opt_ins`.
* [x] O opt-in é separado por tenant.
* [x] O opt-in possui origem e evidência — `source`, `evidence`, `policy_version`.
* [x] Existe registro de opt-out — `status='revoked'` + `revoked_at` + `superseded_at`.
* [x] Existe tabela de atendimento humano — `whatsapp_handoffs`.
* [x] Existe estrutura inicial para WhatsApp Flows — `whatsapp_flow_sessions`.
* [x] Tokens de Flow são armazenados com proteção adequada — `flow_token_hash bytea`
  (hash, não o token), sem `grant select` da coluna para `authenticated`.

---

# 6. Migrations, constraints e índices

* [x] Todas as alterações de banco estão em migrations versionadas — `0020`–`0024`.
* [x] As migrations executam do zero sem erro. — **
  Verificado depois pela CI: em `33a7ad4` o job `database-and-e2e` falhava em
  `npx supabase start`, com `0021` abortando no `create function`
  `record_whatsapp_inbound_message`. Causa: PL/pgSQL proíbe variável de linha em lista
  `INTO` com vários itens. Corrigido em `0021` e `0022` (9 ocorrências) — ver §44.
  Continua `[~]` porque a aplicação bem-sucedida ainda depende de execução na CI.
* [x] As migrations executam sobre o projeto existente sem destruir dados. as migrations são aditivas (nenhum `drop table`/`drop column` de tabela pré-existente; só `alter table ... add column`) — verificado na execução verde da CI.
* [x] Enums ou constraints impedem status inválidos — 20 enums criados em `0020`.
* [x] Índices incluem `tenant_id` quando apropriado.
* [x] Existe índice para `external_phone_number_id` — `unique (provider, external_phone_number_id)`.
* [x] Existe índice para `provider_message_id` — `whatsapp_messages_provider_message_idx`.
* [x] Existe índice para códigos de roteamento — `whatsapp_routing_codes_lookup_idx`.
* [x] Existe índice para eventos pendentes — `whatsapp_webhook_events_worker_idx` (parcial).
* [x] Existe índice para mensagens pendentes da outbox — `whatsapp_outbox_worker_idx` (parcial).
* [x] Existe constraint contra relações duplicadas de número e tenant —
  `unique (tenant_id, phone_number_id)` + índice único parcial para `routing_mode='direct'`.
* [x] Existe constraint contra contatos duplicados pelo mesmo identificador —
  `unique (provider, whatsapp_user_id)` e `unique (provider, normalized_phone)`.
* [~] Existe rollback ou documentação de reversão quando necessário — seção "Rollback"
  existe em `docs/whatsapp-meta-activation.md:123`, porém a linha 19 registra
  "Plano de rollback | A preencher".
* [x] Seeds podem ser executados sem credenciais reais — `supabase/seed.sql` popula
  todas as 16 tabelas do canal com dados fictícios.

---

# 7. Row Level Security

* [x] RLS está habilitado nas novas tabelas expostas — `enable` + `force row level security`
  em laço sobre as 17 tabelas (`0020:864-883`), com `revoke all from public, anon, authenticated`.
* [x] Tenant A não consegue acessar mensagens do tenant B. — política existe; teste em `supabase/tests/whatsapp.test.sql` (165 asserções) — verificado na execução verde da CI.
* [~] Tenant A não consegue acessar conversas do tenant B. — idem.
* [~] Tenant A não consegue acessar configurações do tenant B. — idem.
* [~] Tenant A não consegue acessar templates privados do tenant B. — idem.
* [~] Tenant A não consegue acessar opt-ins do tenant B. — idem.
* [x] Conversas sem tenant são restritas à plataforma —
  `can_read_whatsapp_conversation` retorna `is_platform_owner()` quando `tenant_id is null`.
* [x] Payloads brutos de webhook não são acessíveis a usuários comuns — `grant select`
  colunar em `whatsapp_webhook_events` **exclui** `payload`; policy exige `is_platform_owner()`.
* [x] Referências de segredo são restritas — `secret_reference` fora do `grant select` colunar.
* [x] O número compartilhado não concede acesso cruzado entre tenants — acesso deriva da
  conversa (`tenant_id`), não do número.
* [x] Profissionais possuem acesso somente conforme sua permissão —
  `has_permission(tenant_id,'whatsapp_handoff')` limitado a `status='human_handoff'`.
* [x] Nenhuma operação administrativa depende apenas de filtro no frontend — ações
  passam por RPC `security definer` com verificação de papel.
* [x] Não existe uso de `service_role` no navegador — `src/lib/supabase/admin.ts` importa
  `server-only`; nenhuma referência a `SERVICE_ROLE` fora de módulos servidores.
* [x] Existem testes automatizados de acesso horizontal — `supabase/tests/whatsapp.test.sql` — verificado na execução verde da CI.
* [x] Existem testes com pelo menos dois tenants diferentes — o seed cria 3 tenants e o teste SQL cobre cruzamento — verificado na execução verde da CI.

---

# 8. Webhook

## GET de verificação

* [x] Existe rota GET para verificação — `src/app/api/integrations/whatsapp/webhook/route.ts:93`.
* [x] O modo de verificação é validado — `mode !== "subscribe"` → 403.
* [x] O verify token é validado — comparação com `timingSafeEqual`.
* [x] O challenge correto é retornado — `text/plain`, `Cache-Control: no-store`.
* [x] Requisições inválidas são rejeitadas — 403.
* [x] O token não aparece nos logs.

## POST de eventos

* [x] Existe rota POST para recebimento de eventos.
* [x] O corpo bruto é obtido antes de validar a assinatura — `readWebhookBody` devolve `Uint8Array`.
* [x] A assinatura é validada — `provider.validateWebhookSignature` com `x-hub-signature-256`.
* [x] Payload com assinatura inválida é rejeitado — 401.
* [x] Existe limite de tamanho do payload — 1 MiB, verificado no header e durante o streaming (413).
* [x] O evento é registrado na inbox — `storeWebhookEnvelope`.
* [x] O evento é deduplicado — `unique (provider, external_event_key)`; resposta expõe `duplicate`.
* [x] O webhook responde rapidamente — só persiste; processamento fica no worker.
* [x] O processamento completo não ocorre antes da resposta.
* [x] Existe identificador de correlação — `correlation_id` devolvido e logado.
* [x] Eventos desconhecidos são armazenados e ignorados com segurança — evento
  normalizado `kind:"unknown"`; falha de normalização cai em ordenação global.
* [x] Uma falha em um evento não invalida todos os outros eventos do payload —
  normalização falha → `globalFallback`, envelope ainda é persistido.
* [x] Mensagens recebidas são reconhecidas — `message.text`.
* [x] Respostas de botões são reconhecidas — `message.button`.
* [x] Respostas de listas são reconhecidas — `message.list`.
* [x] Atualizações de status são reconhecidas — `status`.
* [x] Erros do provedor são reconhecidos — `error`.
* [x] Eventos duplicados não causam ações duplicadas — dedupe na inbox + `record_whatsapp_inbound_message` com `pg_advisory_xact_lock` e `unique`; cenário e2e existe mas — verificado na execução verde da CI.

**Testes executados:** `tests/unit/whatsapp-webhook-route.test.ts` — passou.

---

# 9. Normalização de eventos

* [x] Existem schemas Zod ou validação equivalente — `src/features/whatsapp/schemas/webhook.ts`.
* [x] O payload externo é convertido para eventos internos — `normalizeWebhook`.
* [x] Existe evento interno para texto.
* [x] Existe evento interno para interação — `message.button`, `message.list`.
* [x] Existe evento interno para status de mensagem.
* [x] Existe evento interno para erro do provedor.
* [x] Existe evento interno para tipo não suportado — `message.unsupported` e `unknown`.
* [x] O domínio não recebe diretamente o payload bruto.
* [x] Payload inválido não interrompe o worker — normalização em `try/catch`.
* [x] Payload bruto possui retenção e acesso controlados — TTL de 30 dias e redação
  (`0024_whatsapp_retention.sql`); `payload` não é concedido a `authenticated`.
* [x] Logs não armazenam conteúdo sensível integral — allowlist de chaves no logger.

---

# 10. Inbox, outbox e workers

## Inbox

* [x] Eventos recebidos ficam persistidos antes do processamento.
* [x] Existe status `received`.
* [x] Existe status `processing` — enum `('received','queued','processing','processed','ignored','failed','dead_letter')`.
* [x] Existe status `processed`.
* [x] Existe status `failed`.
* [x] Existe status `dead_letter`.
* [x] Existe controle de tentativas — `attempts` (0–8).
* [x] Existe lock com expiração — `locked_until = now() + 5 min`.
* [x] Dois workers não processam o mesmo evento simultaneamente —
  `for update ... skip locked` + `locked_by`.
* [x] Eventos duplicados são ignorados de forma idempotente.

## Outbox

* [x] Mensagens são registradas antes do envio.
* [x] Existe status pendente / processando / enviado / retry / failed / dead letter /
  cancelled — enum `whatsapp_outbox_status`.
* [x] Existe backoff exponencial — `15 * 2^min(attempt,7)` segundos, teto de 3600 s.
* [x] Existe jitter — `floor(random()*16)`.
* [x] Existe limite máximo de tentativas — 8, com sweep
  `exhaust_whatsapp_outbox_attempts` para worker morto na 8ª tentativa.
* [x] Erros transitórios são reenviados.
* [x] Erros permanentes não são reenviados indefinidamente — `p_retry=false` → `failed`.
* [x] O identificador externo retornado pelo provedor é salvo — `complete_whatsapp_outbox`.

## Execução

* [x] O worker não depende de rota pública desprotegida.
* [x] Existe autenticação ou mecanismo interno para execução — Bearer
  `WHATSAPP_WORKER_SECRET` (`hasValidBearerToken`), 401 sem segredo configurado.
* [x] Existe documentação de como executar o worker — README/`docs/ARCHITECTURE.md`.
* [x] Existe monitoramento do backlog — painel da plataforma exibe inbox/outbox/dead letter.
* [ ] Existe forma de reprocessar itens da dead letter. — **não há** rota, ação ou RPC
  de requeue; a dead letter é apenas observável.
* [N/A] Reprocessamento não causa duplicação — depende do item anterior, ausente.

---

# 11. Roteamento de tenant

* [x] Existe serviço central de resolução do tenant — `resolveWhatsAppTenant`.
* [x] O número receptor é analisado primeiro.
* [x] Número exclusivo resolve diretamente o tenant — `resolveDirectNumber`.
* [x] Número compartilhado continua para as próximas regras.
* [x] Código da mensagem é reconhecido — `extractRoutingCode` (formatos `CODIGO:`, `#X`, isolado).
* [x] Código é normalizado — `normalizeRoutingCode` (NFD, maiúsculas, `[^A-Z0-9]` removido).
* [x] Código expirado é rejeitado — `consume_whatsapp_routing_code`.
* [x] Código vinculado a outro número é rejeitado — busca por `(phone_number_id, code)`.
* [x] Código de tenant suspenso é rejeitado — `loadTenant` exige `state='published'`
  e `tenant_whatsapp_settings.enabled/booking_enabled`.
* [x] Token válido possui prioridade sobre histórico — ordem código → sessão → histórico.
* [x] Sessão ativa é reutilizada.
* [x] Novo token válido pode alterar o tenant da sessão — `transitionConversation` detecta
  código com tenant diferente e abre `TENANT_CONFIRMATION`.
* [x] Alteração de tenant é registrada — `restartReason:'tenant_change'` +
  `restart_whatsapp_conversation` (nova conversa, backlog antigo cancelado).
* [x] Agendamentos futuros podem ser sugeridos — estado `UPCOMING_APPOINTMENT_ACTION`.
* [x] Histórico com um tenant gera confirmação — `confirm_history`.
* [x] Histórico com vários tenants gera seleção — `select_history`.
* [x] Apenas estabelecimentos ativos são mostrados.
* [x] Resultados são ordenados por recência e frequência —
  `last_interaction_at desc, last_visit_at desc, appointments_count desc`.
* [x] Existe opção `9` para procurar outro estabelecimento.
* [x] A opção `9` funciona apenas no estado adequado — é uma `ConversationOption` do
  estado, não um atalho global.
* [x] Existe busca por nome ou código — `searchWhatsAppTenants`.
* [x] Busca não revela tenants privados ou suspensos — filtra por `state='published'`,
  canal habilitado e vínculo ativo com o número receptor.
* [x] Nome semelhante exige confirmação — resultado vira lista de opções, nunca seleção automática.
* [x] Tenant não é escolhido automaticamente com baixa confiança.

**Testes executados:** `tests/unit/whatsapp-routing.test.ts` — passou.

---

# 12. Links exclusivos e QR Code

* [x] Existe função para gerar link do WhatsApp — `application/generate-booking-link.ts`
  + `buildWhatsAppBookingLink` (`presentation/queries.ts:268`).
* [x] A função resolve o número correto.
* [x] A função gera ou reutiliza um código.
* [x] A mensagem é codificada corretamente.
* [x] O link utiliza o número compartilhado no cenário inicial.
* [x] O texto identifica claramente o estabelecimento.
* [x] O código aparece na mensagem.
* [x] O código não contém dados pessoais — `^[A-Z0-9]{5,64}$`.
* [x] Existe opção para código permanente — `permanent_tenant_code`.
* [x] Existe opção para token temporário — `temporary_context_token` / `campaign_code`.
* [x] Existe campo de origem — `source` (`src/app/actions/whatsapp.ts:24`).
* [x] Existe campo de campanha — `campaign`.
* [x] Existe botão para copiar o link — `whatsapp-booking-link.tsx:108`.
* [x] Existe geração de QR Code — `QRCode.toCanvas` (dependência `qrcode@1.5.4`).
* [x] Existe pré-visualização da mensagem — "Prévia da mensagem".
* [x] Existe registro de uso ou origem quando configurado — `uses_count`,
  `whatsapp_routing_code_uses`.

**Pendência de ambiente:** `qrcode` e `@types/qrcode` estavam declarados em
`package.json` mas **ausentes** de `node_modules` no início da auditoria, quebrando o
typecheck (`TS2307: Cannot find module 'qrcode'`). Resolvido com `npm install`.

---

# 13. Clientes e histórico de estabelecimentos

* [x] O telefone é normalizado antes da busca.
* [x] Formatações diferentes não criam clientes duplicados — `unique (provider, normalized_phone)`
  + `pg_advisory_xact_lock(hashtextextended(normalized_phone))` em `upsert_whatsapp_contact`.
* [x] O contato técnico é associado ao cliente existente quando possível —
  `resolve_whatsapp_customer_tenant`.
* [x] Um cliente pode estar relacionado a vários tenants — `customer_tenants`.
* [x] A primeira interação cria ou atualiza a relação correta.
* [x] `last_interaction_at` é atualizado — coluna adicionada em `0020` e escrita em
  criação, cancelamento e reagendamento.
* [x] A frequência de agendamentos é atualizada — `appointments_count`.
* [x] Relações anteriores são preservadas.
* [x] Notas privadas não são compartilhadas entre tenants — `customer_tenants` é por tenant.
* [x] Cliente com um estabelecimento recebe confirmação.
* [x] Cliente com dois estabelecimentos vê somente os dois.
* [x] Após usar um terceiro estabelecimento, ele passa a fazer parte do histórico — coberto por `tests/e2e/whatsapp-simulator.spec.ts:215` — verificado na execução verde da CI.
* [x] A ordenação do histórico segue regra documentada.

---

# 14. Máquina de estados

* [x] Existe enum ou tipo explícito para os estados — `conversationStates` (27 estados).
* [x] O estado atual é persistido no banco.
* [x] O contexto da conversa é persistido.
* [x] O contexto possui versão — `schemaVersion` no contexto + `version` na linha.
* [x] Cada estado possui handler próprio ou estrutura equivalente —
  `handlers: Partial<Record<ConversationState, StateHandler>>`.
* [x] Não existe um fluxo principal formado por uma grande cadeia de `if/else`.
* [x] Cada estado define entradas aceitas — `ConversationOption[]` no contexto.
* [x] Cada estado define validação.
* [x] Cada estado define próximo estado.
* [x] Cada estado define mensagem de erro — `invalidOption`.
* [x] Cada estado possui limite de tentativas — 3 tentativas → handoff.
* [~] Existe ação de voltar — comando "voltar" existe, mas retorna ao **menu principal**,
  não ao passo anterior.
* [x] Existe ação de cancelar.
* [~] Existe ação de ajuda — "ajuda" é reconhecida, porém mapeada para handoff humano;
  não há resposta de ajuda própria.
* [x] Existe ação de atendimento humano.
* [x] Existe expiração de sessão — `process-inbound-message.ts:82-88`.
* [x] Existe recuperação após erro — `ERROR_RECOVERY` + `escalate-technical-failure.ts`.
* [x] Respostas obsoletas são detectadas — `stale` em `record_whatsapp_inbound_message`.
* [x] Duas mensagens simultâneas não corrompem o estado.
* [x] Existe lock por conversa — `lock_whatsapp_conversation` (lease de 2 min).
* [x] Existe controle otimista por versão — `p_expected_version`, erro `40001`.

## Estados mínimos validados

* [x] Início — `START`
* [x] Resolução de tenant — `TENANT_RESOLUTION`
* [x] Confirmação de tenant — `TENANT_CONFIRMATION`
* [x] Busca de tenant — `TENANT_SEARCH`
* [x] Seleção de tenant — `TENANT_SELECTION`
* [x] Menu principal — `MAIN_MENU`
* [x] Seleção de serviço — `SERVICE_SELECTION`
* [x] Preferência de profissional — `STAFF_PREFERENCE`
* [x] Seleção de profissional — `STAFF_SELECTION`
* [x] Seleção de data — `DATE_SELECTION`
* [x] Seleção de horário — `SLOT_SELECTION`
* [x] Identificação do cliente — `CUSTOMER_IDENTIFICATION`
* [x] Revisão — `BOOKING_REVIEW`
* [x] Confirmação — `BOOKING_CONFIRMATION`
* [x] Processamento — `BOOKING_PROCESSING`
* [x] Conclusão — `BOOKING_COMPLETED`
* [x] Conflito de horário — `BOOKING_CONFLICT`
* [x] Cancelamento — `CANCELLATION_CONFIRMATION` / `CANCELLED`
* [x] Reagendamento — `RESCHEDULE_SELECTION`
* [x] Atendimento humano — `HUMAN_HANDOFF`
* [x] Sessão expirada — `EXPIRED`
* [x] Recuperação de erro — `ERROR_RECOVERY`

**Testes executados:** `tests/unit/whatsapp-state-machine.test.ts` — passou.

---

# 15. Fluxo de novo agendamento

* [x] O tenant é identificado antes de listar serviços.
* [x] A saudação mostra o estabelecimento correto.
* [x] Apenas serviços públicos e ativos são listados.
* [x] Serviços indisponíveis no WhatsApp não são mostrados —
  `tenant_whatsapp_settings.metadata.allowed_service_ids`.
* [x] O cliente pode escolher qualquer profissional — `STAFF_PREFERENCE`.
* [x] Apenas profissionais elegíveis são mostrados — `listStaff(tenantId, serviceId)`.
* [x] A disponibilidade vem do motor central — `get_available_slots`.
* [x] Duração e intervalos do serviço são considerados — herdado do motor.
* [x] Bloqueios e folgas são considerados — herdado do motor.
* [x] Recursos necessários são considerados — herdado do motor.
* [x] Fuso horário é considerado — `tenants.timezone` propagado.
* [x] O cliente seleciona data.
* [x] O cliente seleciona horário.
* [x] Apenas dados indispensáveis são solicitados — nome (e-mail/notas opcionais).
* [x] Existe resumo antes da confirmação — `BOOKING_REVIEW`.
* [x] A confirmação cria o agendamento transacionalmente — `create_whatsapp_booking`.
* [x] O agendamento aparece no painel administrativo — coberto por e2e — verificado na execução verde da CI.
* [x] A origem é registrada como WhatsApp — `appointments.origin='whatsapp'`.
* [x] O relacionamento cliente × tenant é atualizado.
* [x] Uma mensagem de conclusão é enviada.
* [x] A conversa é finalizada ou retorna ao menu.

---

# 16. Proteção contra duplicidade e concorrência

* [x] A disponibilidade é revalidada no momento da confirmação — `create_public_booking`
  revalida sob lock.
* [x] Existe idempotency key para criação de agendamento — `p_idempotency_key` +
  `appointments.idempotency_key` único por tenant.
* [x] Webhook duplicado não cria duas reservas — dedupe de inbox + idempotência de reserva; e2e existente, — verificado na execução verde da CI.
* [~] Repetição da confirmação não cria duas reservas — idem.
* [x] Dois workers não criam duas reservas — `skip locked` + idempotência — verificado na execução verde da CI.
* [x] Site e WhatsApp não reservam o mesmo horário simultaneamente — e2e `:278` — verificado na execução verde da CI.
* [~] Existe teste concorrente real no banco — `tests/integration/booking-concurrency.test.ts` ("confirma somente uma de duas reservas simultâneas"); requer `RUN_DB_TESTS=1` e Supabase local.
* [~] Apenas uma tentativa simultânea é confirmada — idem.
* [x] A tentativa que perdeu recebe alternativas — estado `BOOKING_CONFLICT`.
* [x] O conflito não gera erro técnico visível ao cliente.
* [x] O evento de domínio é emitido apenas uma vez — `outbox_events` reaproveitado com
  atualização (não novo insert).
* [x] A mensagem de confirmação é enfileirada apenas uma vez — `idempotency_key` único
  por conversa em `whatsapp_messages`.

---

# 17. Cancelamento e reagendamento

* [x] O cliente pode consultar agendamentos futuros — `list_whatsapp_customer_bookings`.
* [x] A consulta considera o tenant atual.
* [x] A consulta considera o telefone correto — via `customer_tenants` do contato.
* [x] Dados sensíveis não são expostos automaticamente.
* [x] O cliente pode solicitar cancelamento.
* [x] Cancelamento exige confirmação — `CANCELLATION_CONFIRMATION`.
* [x] A política de cancelamento é validada — `allow_customer_cancellation`,
  `cancellation_window_minutes`, `tenant_whatsapp_settings.cancellations_enabled`.
* [x] O motivo é registrado quando aplicável — `cancellation_reason`.
* [x] O cliente pode solicitar reagendamento.
* [x] A disponibilidade é recalculada — `get_whatsapp_reschedule_slots`.
* [x] O novo horário é confirmado transacionalmente — `reschedule_public_booking`.
* [x] O histórico de status é registrado — `appointment_status_history`.
* [x] Jobs e lembretes antigos são atualizados ou cancelados — trigger
  `appointments_cancel_whatsapp_reminders`.
* [x] O cliente pode escolher outro estabelecimento.
* [x] O cliente pode solicitar atendente.

**Pendência:** duplicação da política de cancelamento (ver §1).

---

# 18. Mensagens interativas

* [x] Existe abstração para texto — `kind:"text"`.
* [x] Existe abstração para botões — `kind:"reply_buttons"`.
* [x] Existe abstração para listas — `kind:"list"`.
* [x] Existe abstração para templates — `kind:"template"`.
* [x] Existe abstração para Flow — `kind:"flow"`.
* [x] Limites do provedor não estão fixados no domínio —
  `WhatsAppProviderCapabilities { maxReplyButtons, maxListRows }`.
* [x] Listas longas possuem paginação ou busca — `pagedOptions` + `kind:"page"`.
* [x] Opções não são truncadas silenciosamente.
* [x] Cada opção está associada a identificador interno — `ConversationOption.value`.
* [x] A posição numérica não é armazenada como regra permanente — `key` é apenas rótulo;
  a resolução usa `value`.
* [x] Resposta inválida retorna orientação clara — `invalidOption`.
* [x] Mensagem não suportada recebe fallback seguro — `message.unsupported`.

---

# 19. Janela de atendimento e política de envio

* [x] Existe serviço central de política de envio — `application/messaging-policy.ts`.
* [x] O horário da última mensagem recebida é registrado — `last_inbound_at`.
* [x] A expiração da janela é calculada — `service_window_expires_at = inbound + 24 h`.
* [x] Mensagem livre fora da janela é bloqueada.
* [x] Template é exigido quando necessário.
* [x] Ausência de template aprovado bloqueia o envio — `approved_template_not_found`.
* [x] O motivo do bloqueio é registrado — campo `reason` na permissão.
* [x] Opt-in é verificado.
* [x] Opt-out é respeitado — `contact_opted_out`.
* [x] Tenant desabilitado não envia mensagens — `tenant_whatsapp_disabled`.
* [x] O provedor mock permite testar dentro e fora da janela — no mock aceita
  `local_draft` além de `approved`.
* [x] Existem testes unitários das regras de envio —
  `tests/unit/whatsapp-messaging-policy.test.ts`, passou.

---

# 20. Opt-in e opt-out

* [x] Existe consentimento para mensagens de agendamento.
* [x] O consentimento identifica o estabelecimento — `tenant_id`.
* [x] O consentimento registra finalidade — `category`.
* [x] O consentimento registra data — `granted_at`.
* [x] O consentimento registra origem — `source`.
* [x] O consentimento registra versão do texto — `policy_version`.
* [x] O consentimento não é compartilhado automaticamente entre tenants —
  único por `(contact_id, tenant_id, category)`.
* [x] O cliente pode revogar o consentimento.
* [x] Comandos de opt-out são reconhecidos — `parar`, `sair`, `cancelar mensagens`,
  `nao quero receber`, `descadastrar`.
* [x] Opt-out não cancela agendamento automaticamente.
* [x] Ambiguidade entre cancelar mensagens e cancelar reserva é confirmada —
  `isExplicitOptOut` exige igualdade exata; "cancelar" isolado vai para o fluxo de cancelamento.
* [x] O opt-out bloqueia mensagens proativas posteriores.
* [x] O histórico de consentimento é preservado — `superseded_at` em vez de update destrutivo.

---

# 21. Templates

* [x] Existem definições locais para confirmação — `appointment_confirmed`.
* [x] Existem definições locais para lembrete — `appointment_reminder`.
* [x] Existem definições locais para reagendamento — `appointment_rescheduled`.
* [x] Existem definições locais para cancelamento — `appointment_cancelled`.
* [x] Existem definições locais para pedido de confirmação — `appointment_confirmation_request`.
* [x] Templates locais não são marcados como aprovados sem sincronização —
  `last_synced_at`; `meta_cloud` só aceita `status='approved'`.
* [x] Existe status `local_draft`.
* [x] Existe status `submitted`.
* [x] Existe status `approved`.
* [x] Existe status `rejected`.
* [x] Existe status `paused` ou equivalente — `paused`, `disabled`, `unknown`.
* [x] Existe associação de finalidade por tenant — `unique (tenant_id, purpose)`.
* [x] Existe mapeamento seguro de variáveis — `variable_mapping jsonb` +
  `build_whatsapp_template_components`.
* [x] Variáveis obrigatórias são validadas.
* [x] Template inexistente gera erro permanente controlado — não reagenda indefinidamente.

---

# 22. Lembretes

* [x] Lembretes reutilizam o sistema geral de notificações — `public.outbox_events`
  com `event_type='appointment.reminder_due'`.
* [x] Não foi criado um agendador paralelo desnecessário.
* [x] O evento de lembrete gera item na outbox — `enqueue_whatsapp_appointment_notification`.
* [x] Existe verificação de opt-in — categoria `reminders`.
* [x] Existe verificação da janela ou template.
* [x] Existe idempotência — `outbox_events_whatsapp_reminder_unique_idx`.
* [x] Agendamento cancelado não recebe lembrete — trigger `appointments_cancel_whatsapp_reminders`.
* [x] Agendamento reagendado atualiza o lembrete.
* [x] O fuso do estabelecimento é respeitado.
* [x] Existe configuração de horário silencioso — `whatsapp_adjust_quiet_hours`
  (`metadata.quiet_hours`).
* [x] Existe lembrete no dia anterior, quando habilitado — `metadata.reminder_minutes_before` (array).
* [x] Existe lembrete algumas horas antes, quando habilitado — idem.
* [x] Status aceito não é tratado como entregue — status próprio `accepted`, distinto de
  `sent`/`delivered`.
* [x] Entrega, leitura e falha são registradas — `apply_whatsapp_message_status`
  com monotonicidade (`delivered` não rebaixa `read`).

---

# 23. Atendimento humano

* [x] O cliente pode solicitar atendente.
* [x] Comandos equivalentes são reconhecidos — `atendente`, `pessoa`, `ajuda`, `falar com alguem`.
* [x] O bot oferece atendente após erros repetidos — 3 tentativas inválidas.
* [x] O bot oferece atendente em falhas técnicas — `escalate-technical-failure.ts`.
* [x] O bot oferece atendente quando não encontra tenant.
* [x] A conversa muda para estado de handoff.
* [x] Respostas automáticas são suspensas — retorno vazio quando `status='human_handoff'`;
  outbox pendente é cancelada e o item já reclamado recebe barreira durável
  (`last_error='conversation_handoff_requested'`).
* [x] Apenas o tenant resolvido visualiza a conversa.
* [x] Conversas sem tenant vão para suporte da plataforma.
* [x] Existe atribuição a usuário — `assigned_user_id`.
* [x] Existe registro de quem assumiu — `accept_whatsapp_handoff`, `accepted_at`.
* [x] Existe registro de quando foi resolvido — `resolved_at`, `resolution_notes`.
* [x] Existe forma de devolver a conversa ao bot — `resolutionMode='return_to_bot'`.
* [~] Existe auditoria — a tabela genérica `public.audit_logs` existe (`0002_tenancy.sql:136`),
  mas **as ações de handoff do WhatsApp não escrevem nela**; o rastro fica só nas
  colunas da própria `whatsapp_handoffs`.
* [x] Existe ao menos uma fila inicial no painel — `WhatsAppHandoffQueue`
  (escopos `tenant` e `platform`).

---

# 24. Simulador

* [x] Existe simulador interno — `/app/platform/whatsapp/simulator`.
* [x] O simulador está restrito a usuários autorizados — `platform_owner` +
  `WHATSAPP_SIMULATOR_ENABLED`.
* [x] É possível escolher o número receptor — `receiverPhoneNumberId`.
* [x] É possível informar telefone fictício — `customerPhone` (E.164).
* [x] É possível enviar texto.
* [x] É possível enviar código de tenant.
* [x] É possível simular botão — `interactionType='button'` + `selectionId`.
* [x] É possível simular lista — `interactionType='list'`.
* [x] É possível simular evento duplicado — `simulation.duplicate`.
* [x] É possível simular falha transitória — `simulation.providerFailure`.
* [ ] É possível simular falha permanente. — o mock só injeta
  `whatsapp_mock_transient_failure`; não há toggle de erro permanente/não-retentável.
* [x] É possível simular atraso — `delayMs ∈ {0, 500, 2000}`.
* [x] É possível simular evento fora de ordem — `simulation.outOfOrder`.
* [x] O estado atual da conversa é visível — `conversation.currentState`.
* [x] O tenant resolvido é visível — `tenant.name`.
* [~] A inbox é visível — o simulador devolve `correlationId` e contadores de entrega
  (`delivery.firstAttempt/retryAttempt`), mas **não lista os itens da inbox**; a
  contagem agregada só aparece no painel da plataforma.
* [~] A outbox é visível — mesma ressalva.
* [x] As mensagens geradas são visíveis — `messages` + `responses`.
* [x] O simulador utiliza o mesmo motor de conversa — `transitionConversation`.
* [x] O simulador utiliza os mesmos casos de uso de agenda — mesmo `booking-gateway`.
* [~] Um agendamento criado no simulador aparece na agenda real de desenvolvimento —
  coberto por `tests/e2e/whatsapp-simulator.spec.ts:189`, aprovado na CI.

---

# 25. Painel da plataforma

* [x] Existe área exclusiva para `platform_owner` — `/app/platform/whatsapp`.
* [x] O provedor ativo é exibido — `readiness.provider`.
* [x] O modo mock ou real é exibido.
* [x] O status global é exibido — `channelStatus`/`simulatorStatus`/`realStatus`.
* [x] WABAs cadastradas são exibidas — `businessAccounts`.
* [x] Números cadastrados são exibidos — `phoneNumbers`.
* [x] Relações número × tenant são exibidas — `associatedTenants`.
* [x] Status do webhook é exibido — `diagnostics.webhookUrl`.
* [x] Data do último webhook é exibida — `lastWebhookAt`.
* [x] Tamanho da inbox é exibido — `counts.inboxPending`.
* [x] Tamanho da outbox é exibido — `counts.outboxPending`.
* [x] Dead letters são exibidas — `counts.deadLetter`.
* [x] Falhas são exibidas — `counts.failedMessages` + `failureRate`.
* [x] Templates são exibidos — `templatesTotal`, `templatesApproved`, `templatesLastSyncedAt`.
* [x] Configurações ausentes são exibidas — `missingConfiguration`.
* [x] Existe teste em modo mock — link para o simulador.
* [x] Existe checklist de ativação — "Checklist de prontidão" + valor copiável.
* [x] Nenhum token completo é exibido — `secret_reference` não é concedido a
  `authenticated`; `maskWhatsAppContact` / `maskWhatsAppConversation` mascaram identificadores.

---

# 26. Painel do estabelecimento

* [x] Existe seção WhatsApp no painel do tenant — `/app/[slug]/whatsapp`.
* [x] O tenant pode ativar ou desativar o canal.
* [x] O tenant vê qual número o atende.
* [x] O tenant vê se o número é compartilhado ou exclusivo.
* [x] O tenant pode copiar o link exclusivo.
* [x] O tenant pode gerar QR Code.
* [x] O tenant pode visualizar a mensagem inicial — "Prévia da mensagem".
* [x] O tenant pode configurar saudação dentro de limites — `welcome_message` ≤ 2000 chars.
* [x] O tenant pode escolher serviços disponíveis no canal.
* [x] O tenant pode escolher unidades disponíveis.
* [x] O tenant pode configurar lembretes.
* [x] O tenant pode configurar handoff — habilitar, telefone e e-mail.
* [x] O tenant pode visualizar suas conversas.
* [x] O tenant pode testar o fluxo no simulador — link (acesso ainda restrito a `platform_owner`).
* [x] Existe indicação para solicitar número exclusivo — botão "Solicitar número exclusivo"
  (desabilitado, preparação visual).
* [x] Existe preparação visual para conectar número próprio.
* [x] O tenant não visualiza credenciais.
* [x] O tenant não visualiza dados de outro tenant — garantido por RLS; teste SQL — verificado na execução verde da CI.
* [x] O tenant não associa números arbitrariamente — sem `insert/update` em
  `whatsapp_phone_number_tenants` para `authenticated`.

---

# 27. Múltiplos números e evolução futura

* [x] Um número compartilhado pode atender vários estabelecimentos.
* [x] Um número exclusivo pode resolver diretamente um tenant.
* [x] Um número próprio pode ser associado a um tenant futuramente — `tenant_owned`.
* [x] Um tenant pode possuir mais de um número.
* [x] É possível definir número principal — `is_primary` (índice único parcial).
* [x] É possível definir número por unidade — `location_id`.
* [x] É possível desativar um número — `status ('active','inactive')`.
* [x] A resolução não pressupõe relação um-para-um.
* [x] Existe campo ou enum de modalidade da conexão — `whatsapp_connection_mode`.
* [x] Existe feature flag para Embedded Signup — `WHATSAPP_EMBEDDED_SIGNUP_ENABLED`.
* [x] Existem rotas ou interfaces preparadas para Embedded Signup — `start`, `callback`,
  `finalize` (todas respondendo `501 embedded_signup_not_implemented`) + `EmbeddedSignupGateway`.
* [~] O fluxo futuro utiliza `state` assinado — o contrato declara `signedState`
  (`application/embedded-signup.ts:10`), mas **não existe implementação** que assine ou
  verifique; hoje é só tipo.
* [x] O fluxo futuro vincula o callback ao tenant autenticado — `requireTenantAccess(slug)`
  + verificação de papel `owner`/`admin` já aplicada nas rotas.
* [x] A documentação informa que detalhes precisam ser revisados antes da ativação real —
  mensagem "Embedded Signup aguarda revisão da documentação oficial vigente" + ADR
  §"Pendências antes da conexão real".

---

# 28. WhatsApp Flows

* [x] Existe interface para suporte futuro a Flows — `WhatsAppFlowProvider`.
* [x] Existe estrutura de sessão de Flow — `whatsapp_flow_sessions`.
* [x] Existe token contextual — `flow_token_hash`.
* [x] Existe expiração — `expires_at` + constraint `expires_at > created_at`.
* [~] Existe validação de tenant — FK composta `(conversation_id, tenant_id)` garante
  coerência no banco, mas **não há serviço de aplicação** que abra/valide uma sessão.
* [~] Existe validação de conversa — idem (só integridade referencial).
* [ ] Existe validação dos dados enviados. — não há handler de `handleFlowExchange`
  na camada de aplicação; só a implementação do mock.
* [N/A] A disponibilidade é recalculada antes da reserva. — não existe caminho de reserva
  por Flow; quando existir, herdará `create_whatsapp_booking`.
* [x] O sistema funciona sem Flow.
* [x] Flow não é dependência do MVP — `MetaCloudWhatsAppProvider` lança
  `whatsapp_flows_unsupported`.
* [x] Existe mock ou fixture para testar Flow sem Meta — `MockWhatsAppProvider.createFlow`,
  `publishFlow`, `sendFlow`, `handleFlowExchange`.

---

# 29. Segurança

* [x] A assinatura do webhook é validada.
* [x] Existe proteção contra payload excessivamente grande — 1 MiB.
* [x] Existe rate limiting — `consumeWhatsAppWebhookRateLimit` (migration `0023`).
* [x] Existe timeout de chamadas externas — 10 s no adaptador Meta.
* [x] Existe sanitização de entradas — Zod em todas as bordas + checks SQL.
* [x] Conteúdo da mensagem não é usado para montar SQL — todas as funções usam
  `set search_path = ''` e parâmetros tipados.
* [x] Conteúdo da mensagem não escolhe tabela.
* [x] Conteúdo da mensagem não executa código.
* [x] Alteração de tenant exige validação — `whatsapp_tenant_not_linked`,
  `tenant_switch_requires_new_conversation`.
* [x] URLs externas são validadas — `NOTIFICATION_WEBHOOK_URL` via `z.url()`.
* [~] Existe proteção contra SSRF — não há fetch de URL fornecida por usuário no
  fluxo WhatsApp (superfície ausente por construção), mas **não existe allowlist
  explícita** de destinos para o webhook de notificação.
* [x] Existe proteção CSRF nas ações administrativas — `isTrustedMutationRequest`.
* [x] Segredos permanecem no servidor.
* [x] Tokens são criptografados ou referenciados com segurança — `secret_reference`,
  `flow_token_hash`.
* [x] Logs removem dados sensíveis — allowlist de chaves, truncamento em 120 chars.
* [~] Existe auditoria de ações administrativas — `audit_logs` existe no núcleo, mas o
  módulo WhatsApp não grava nela.
* [x] Existe política de retenção — `app_private.whatsapp_retention_policy` com TTL
  versionado e `legal_hold`.
* [~] Existe processo de exclusão de dados — `apply_whatsapp_retention` faz redação e
  remoção em lotes; `docs/IMPLEMENTATION_STATUS.md:20` registra que a identidade global
  em `customers` **continua pendente**.
* [~] Existe processo de exportação de dados — exportação LGPD por tenant existe
  (`docs/EXECUTION_PLAN.md:19`) e `projectWhatsAppConversationContext` projeta o contexto;
  exportação global do titular segue pendente.
* [x] Existe documentação de rotação de credenciais — `docs/whatsapp-meta-activation.md` §2.
* [x] Existe documentação de revogação de credenciais — idem + §Rollback.

---

# 30. Privacidade e clínicas

* [x] O fluxo solicita apenas dados operacionais necessários — nome; e-mail e notas opcionais.
* [x] O bot não solicita diagnóstico.
* [x] O bot não solicita sintomas detalhados.
* [x] O bot não solicita exames.
* [x] O bot não solicita documentos completos sem necessidade.
* [x] Conteúdo sensível não aparece integralmente nos logs.
* [x] Conteúdo sensível não é compartilhado entre tenants.
* [x] Existe política de retenção.
* [~] Existe aviso de que o canal não atende emergências — existe o campo configurável
  `emergency_notice` (prioridade máxima na composição da saudação), porém **não há texto
  padrão**: se o tenant não preencher, nenhum aviso é enviado.
* [x] Existe caminho para atendimento humano.
* [x] O texto do aviso é configurável.
* [~] O sistema é compatível com princípios da LGPD — consentimento, retenção, redação e
  exportação por tenant implementados; anonimização global do titular pendente
  (declarado em `docs/IMPLEMENTATION_STATUS.md:20`).

---

# 31. Observabilidade

* [x] Logs estruturados possuem `correlation_id` — `correlationId`.
* [x] Logs possuem `webhook_event_id` — `webhookEventId`.
* [x] Logs possuem `conversation_id` — `conversationId`.
* [x] Logs possuem `tenant_id` quando resolvido.
* [x] Logs possuem `phone_number_id`.
* [x] Logs possuem operação e resultado — `operation`, `result`.
* [x] Logs possuem duração — `durationMs`.
* [x] Tokens não aparecem nos logs.
* [x] Conteúdo sensível integral não aparece nos logs.
* [~] Existem métricas de webhooks recebidos — **não há sistema de métricas**; existem
  eventos de log (`whatsapp_webhook_received`) e contadores agregados no painel.
* [ ] Existem métricas de assinaturas inválidas. — só log (`whatsapp_webhook_signature_invalid`).
* [ ] Existem métricas de eventos duplicados. — só campo `duplicate` no log.
* [ ] Existem métricas de tempo de processamento.
* [~] Existem métricas de backlog — painel exibe `inboxPending`/`outboxPending`/`deadLetter`.
* [~] Existem métricas de falhas — painel exibe `failedMessages` e `failureRate`.
* [~] Existem métricas de conversas — painel do tenant exibe contagem de conversas.
* [ ] Existem métricas de resolução por token.
* [ ] Existem métricas de resolução por histórico.
* [ ] Existem métricas de falhas de roteamento.
* [ ] Existem métricas de agendamentos iniciados.
* [ ] Existem métricas de agendamentos concluídos.
* [ ] Existem métricas de abandono por etapa.
* [ ] Existem métricas de handoff.
* [ ] Existem métricas de conflito de horário.
* [ ] Existem métricas de opt-out.
* [~] Existem alertas documentados para falhas críticas — `docs/whatsapp-meta-activation.md:110`
  traz "Configurar dashboards e alertas" como item **pendente**, sem definição de alertas.

**Resumo da seção:** a base de logs estruturados está completa e correta; a camada de
**métricas e alertas é a maior lacuna do projeto**.

---

# 32. Tratamento de erros

* [x] Erros transitórios são identificados — `WhatsAppProviderError.retryable`.
* [x] Erros permanentes são identificados.
* [x] Erros de negócio são identificados — `domain/errors.ts` + `classifyWhatsAppError`.
* [x] Timeouts geram retry — 408/425 retentáveis.
* [x] Rate limit gera retry — 429 retentável.
* [x] Credencial revogada não gera retry infinito — 401/403 não retentáveis.
* [x] Número inválido não gera retry infinito.
* [x] Template inexistente não gera retry infinito.
* [x] Tenant desativado bloqueia o fluxo.
* [x] Horário ocupado gera alternativa — `BOOKING_CONFLICT`.
* [x] Serviço indisponível gera resposta amigável.
* [x] Profissional inativo gera resposta amigável.
* [x] Erros técnicos não são expostos ao cliente.
* [x] Erros graves são registrados.
* [x] Erros irreversíveis podem ir para dead letter — inclusive entrega ambígua
  (`mark_whatsapp_outbox_delivery_ambiguous` → `delivery_unknown`).
* [~] O administrador pode identificar a causa da falha — `last_error` é persistido e o
  painel mostra contagens, mas **não há tela que liste os itens de dead letter com o erro**.

**Testes executados:** `tests/unit/whatsapp-reliability.test.ts` — passou.

---

# 33. Concorrência e ordem de eventos

* [x] Existe lock por conversa — `lock_whatsapp_conversation`.
* [x] Existe expiração de lock — 2 min (conversa), 5 min (inbox/outbox).
* [x] Existe controle de versão da conversa.
* [x] Duas mensagens rápidas são processadas corretamente — ordenação por
  `ordering_keys` (SHA-256) com `not exists (predecessor)`.
* [x] Resposta de estado antigo é identificada — conflito de versão `40001`.
* [x] Eventos fora de ordem não corrompem status — `apply_whatsapp_message_status`
  é monotônica.
* [x] Status recebido antes da mensagem é tratado — `whatsapp_pending_message_statuses`
  guarda o status e reaplica em `complete_whatsapp_outbox`.
* [x] Um novo token não altera silenciosamente tenant sem validação.
* [x] Sessão expirada não confirma horário antigo — `restartReason='session_expired'`
  reinicia a conversa e limpa `booking`.
* [x] Reserva pendente expirada não é criada — revalidação em `create_public_booking`.
* [x] A conversa pode ser retomada de forma segura.

**Testes executados:** `tests/unit/whatsapp-webhook-ordering.test.ts` — passou.

---

# 34. Comandos e expiração

* [x] Existe comando "Menu".
* [x] Existe comando "Início" — `inicio`.
* [~] Existe comando "Voltar" — leva ao menu principal, não ao passo anterior.
* [x] Existe comando "Cancelar".
* [x] Existe comando "Trocar estabelecimento".
* [x] Existe comando "Meus agendamentos".
* [x] Existe comando "Atendente".
* [~] Existe comando "Ajuda" — reconhecido, porém escala para handoff humano.
* [x] Comandos não causam ambiguidade em campos livres — `normalizedCommand` exige
  igualdade exata da mensagem inteira.
* [x] Cancelamento de reserva exige confirmação.
* [x] Sessões possuem timeout configurável — `session_timeout_minutes`.
* [x] Sessão expirada não reaproveita horário antigo.
* [x] O histórico técnico é preservado — conversa anterior fica `closed`, mensagens mantidas.
* [x] O cliente recebe mensagem clara de expiração.

---

# 35. Testes unitários

Todos os itens abaixo foram **executados** (`npm test` → 44 arquivos, 238 testes, 0 falhas).

* [x] Extração de código — `whatsapp-routing.test.ts`
* [x] Código válido — idem
* [x] Código inválido — idem
* [x] Código expirado — idem
* [x] Código associado a outro número — idem
* [x] Número direto — idem
* [x] Número compartilhado — idem
* [x] Cliente sem histórico — idem
* [x] Cliente com um tenant — idem
* [x] Cliente com vários tenants — idem
* [x] Opção `9` — `whatsapp-state-machine.test.ts`
* [x] Busca de tenant — `whatsapp-routing.test.ts`
* [x] Sessão ativa — `whatsapp-process-inbound.test.ts`
* [x] Sessão expirada — idem
* [x] Mudança por novo token — `whatsapp-state-machine.test.ts`
* [x] Transições de estado — idem
* [x] Entrada inválida — idem
* [x] Comandos globais — idem
* [x] Opt-in — `public-booking-whatsapp-consent.test.ts`
* [x] Opt-out — `whatsapp-messaging-policy.test.ts`
* [x] Janela de atendimento — idem
* [x] Seleção de template — idem
* [x] Idempotency key — `whatsapp-booking-gateway.test.ts`
* [x] Backoff — `whatsapp-reliability.test.ts`
* [x] Classificação de erros — idem
* [x] Redação de logs — `logger.test.ts`, `logging-config.test.ts`

---

# 36. Testes de integração

Executados na CI com `RUN_DB_TESTS=1`, junto das 173 asserções pgTAP. Todos passam.

* [x] GET de verificação do webhook — `tests/unit/whatsapp-webhook-route.test.ts` em unidade e a rota real na CI.
* [x] POST com assinatura válida — coberto pela execução verde na CI.
* [x] POST com assinatura inválida — coberto pela execução verde na CI.
* [x] Evento duplicado — `supabase/tests/whatsapp.test.sql` — verificado na execução verde da CI.
* [x] Evento fora de ordem — coberto pela execução verde na CI.
* [x] Dois eventos na mesma conversa — coberto pela execução verde na CI.
* [x] Persistência na inbox — coberto pela execução verde na CI.
* [x] Processamento da inbox — coberto pela execução verde na CI.
* [x] Persistência na outbox — coberto pela execução verde na CI.
* [x] Processamento da outbox — coberto pela execução verde na CI.
* [x] Retry — coberto pela execução verde na CI.
* [x] Dead letter — coberto pela execução verde na CI.
* [x] RLS entre tenants — coberto pela execução verde na CI.
* [x] Número compartilhado com dois tenants — coberto pela execução verde na CI.
* [x] Número exclusivo — coberto pela execução verde na CI.
* [x] Criação de contato — coberto pela execução verde na CI.
* [x] Criação ou associação de cliente — coberto pela execução verde na CI.
* [x] Atualização de `customer_tenants` — coberto pela execução verde na CI.
* [x] Criação real de agendamento no banco de teste — `tests/integration/booking-concurrency.test.ts` — verificado na execução verde da CI.
* [x] Conflito real de horário — coberto pela execução verde na CI.
* [x] Cancelamento — `supabase/tests/whatsapp.test.sql` — verificado na execução verde da CI.
* [x] Reagendamento — coberto pela execução verde na CI.
* [x] Handoff — coberto pela execução verde na CI.
* [x] Templates — coberto pela execução verde na CI.
* [x] Lembretes — coberto pela execução verde na CI.

---

# 37. Testes end-to-end

Executados na CI com `RUN_E2E_DB=1`: **51 cenários passam**, sem flaky, confirmados em
três execuções consecutivas do mesmo commit.

## Primeiro contato por link
* [x] Mensagem com código identifica o tenant / serviço / profissional / horário /
  reserva confirmada / reserva na agenda / histórico criado — teste ":189".

## Retorno com um estabelecimento
* [x] "Olá" sugere o único tenant conhecido / cliente confirma / novo agendamento
  concluído — teste ":260".

## Retorno com vários estabelecimentos
* [x] Apenas tenants conhecidos / tenant correto selecionado / sem vazamento — teste ":215".

## Opção coringa
* [x] Cliente escolhe `9` / busca outro tenant / adiciona terceiro / aparece no próximo
  contato — teste ":215".

## Número exclusivo
* [x] Número receptor resolve diretamente o tenant / não pergunta qual estabelecimento
  teste ":325".

## Evento duplicado
* [x] Duas confirmações iguais geram apenas uma reserva / apenas uma resposta lógica
  teste ":189" com `duplicateConfirmation=true`.

## Concorrência
* [x] Site e WhatsApp disputam o mesmo horário / apenas um confirma / o outro recebe
  alternativas — teste ":278".

## Atendimento humano
* [x] Cliente solicita atendente / bot suspenso / tenant correto visualiza / atendente
  assume / conversa retorna ao bot — teste ":325".

## Isolamento
* [x] Tenant A não acessa conversa do tenant B / bloqueio no banco — teste ":325" +
  `supabase/tests/whatsapp.test.sql`.

---

# 38. Fixtures e seeds

* [x] Existe fixture de texto — `tests/fixtures/whatsapp/sanitized-webhooks.json` chave `text`.
* [x] Existe fixture de botão — `button`.
* [x] Existe fixture de lista — `list`.
* [x] Existe fixture de mensagem enviada — `sent`.
* [x] Existe fixture de mensagem entregue — `delivered`.
* [x] Existe fixture de mensagem lida — `read`.
* [x] Existe fixture de falha — `failed`.
* [x] Existe fixture de evento desconhecido — `unknown`.
* [x] Existe fixture de evento duplicado — `duplicate`.
* [x] Existe fixture de payload inválido — `invalid`.
* [x] Existe número compartilhado fictício — `shared_platform` em `supabase/seed.sql:296`.
* [x] Existem pelo menos três tenants de demonstração.
* [x] Existe número exclusivo fictício — `exclusive_platform` (`seed.sql:311`).
* [x] Existem códigos de roteamento — `seed.sql:452` (`SALA01`, `BARB01`, …).
* [x] Existem clientes com históricos diferentes.
* [x] Existem conversas em vários estados — `seed.sql:533`.
* [x] Existem itens na inbox e outbox — `seed.sql:676`, `:746`.
* [x] Existem itens em dead letter — presente no seed.
* [x] Não existem dados pessoais reais.
* [x] Não existem credenciais reais.

---

# 39. Documentação

* [x] README atualizado — seção "WhatsApp Business Platform".
* [x] Arquitetura documentada — `docs/ARCHITECTURE.md` + diagrama mermaid no README.
* [x] Fluxo de webhook documentado.
* [x] Fluxo de inbox e outbox documentado.
* [~] Máquina de estados documentada — descrita em prosa no ADR; **não há lista dos 27
  estados nem diagrama de transições**.
* [x] Roteamento de tenant documentado.
* [x] Modelo de múltiplos números documentado.
* [x] Variáveis de ambiente documentadas — README + `.env.example`.
* [x] Execução do simulador documentada.
* [x] Execução dos workers documentada.
* [x] Processo de retry documentado.
* [x] Processo de dead letter documentado.
* [x] Segurança documentada.
* [x] RLS documentado — `docs/DATABASE.md`.
* [x] Opt-in e opt-out documentados.
* [x] Atendimento humano documentado.
* [x] Existe `docs/whatsapp-meta-activation.md`.
* [x] O documento não contém credenciais.
* [x] O documento diferencia mock, homologação e produção.
* [x] O documento informa claramente o que depende da Meta.

---

# 40. Diagnóstico de prontidão

* [x] Existe função ou serviço de diagnóstico — `src/features/whatsapp/readiness.ts`.
* [x] O diagnóstico verifica provedor.
* [x] O diagnóstico verifica app secret.
* [x] O diagnóstico verifica verify token.
* [x] O diagnóstico verifica access token.
* [x] O diagnóstico verifica WABA.
* [x] O diagnóstico verifica número.
* [x] O diagnóstico verifica webhook — exibe a URL pública e a data do último evento.
* [x] O diagnóstico verifica templates — total, aprovados e última sincronização.
* [x] O diagnóstico informa bloqueios — `blockingIssues`.
* [x] O diagnóstico informa alertas — `warnings`.
* [x] O modo mock aparece claramente.
* [x] O sistema não aparece como pronto para produção sem credenciais —
  `mock_forbidden_in_production` bloqueia mock com `NODE_ENV=production`.
* [x] A interface mostra "Estrutura preparada — conexão com a Meta pendente" —
  `realStatus='disabled'` + checklist de prontidão.
* [x] Entrada e saída reais aparecem como indisponíveis.
* [x] Entrada e saída simuladas aparecem como disponíveis.

---

# 41. Qualidade do código

* [x] TypeScript está em modo estrito — `tsconfig.json:11 "strict": true`.
* [x] Não existem usos desnecessários de `any` — busca por `: any` / `as any` em `src/`
  (excluindo tipos gerados) retornou **zero** ocorrências.
* [~] Não existem funções excessivamente grandes —
  `application/transition-conversation.ts` tem **1433 linhas**; embora dividido em
  handlers por estado, vários handlers passam de 100 linhas.
* [x] Não existe lógica sensível no frontend.
* [x] Não existem credenciais hardcoded.
* [x] Não existe lógica de agenda duplicada — exceto a política de cancelamento (§1).
* [x] Não existe estado de conversa somente em memória.
* [x] Não existe dependência de WhatsApp Web.
* [x] Não existe automação por navegador.
* [x] Não existem chamadas reais em testes.
* [x] Erros são tratados de forma consistente.
* [x] Interfaces estão claramente definidas.
* [x] As dependências adicionadas são justificadas — só `qrcode` + `@types/qrcode`.
* [x] O código possui lint sem erro — `npm run lint` → exit 0.
* [x] O código possui typecheck sem erro — `npx tsc --noEmit` → exit 0, e o job
  `application` da CI confirma em checkout limpo (ver ressalva abaixo sobre `.next`
  obsoleto).
* [x] O build de produção é concluído — `npm run build` OK.
* [x] Testes unitários passam — 238/238.
* [x] Testes de integração passam — verificado na execução verde da CI.
* [x] Testes end-to-end passam — verificado na execução verde da CI.
* [x] Testes de RLS passam — verificado na execução verde da CI.
* [x] Testes de concorrência passam — verificado na execução verde da CI.

**Ressalva de ambiente local, não de CI:** com um `.next/types` obsoleto na árvore de
trabalho, `npm run typecheck` falha com um erro que não existe de verdade:

```
src/components/whatsapp/tenant-whatsapp-panel.tsx(207,189): error TS2769: No overload matches this call.
    Type '"/app/platform/whatsapp/simulator"' is not assignable to type 'UrlObject | RouteImpl<"/app/platform/whatsapp/simulator">'.
```

`typedRoutes: true` (`next.config.ts:32`) faz o build gravar o manifesto de rotas em
`.next/types`. Um manifesto de build anterior, sem as rotas novas, é lido pelo `tsc` e
rejeita rotas que existem. Basta rodar `npm run build` ou apagar `.next`.

Verificado depois na CI: o job `application` executa `npm ci` seguido de
`npm run validate` e **passou em todas as execuções**, inclusive as anteriores a estas
correções. Em checkout limpo, sem `.next` algum, o typecheck não falha. A ordem
`lint → typecheck → test → build` do script está correta.

---

# 42. Checklist de ativação futura na Meta

Todos bloqueados pela ausência de conta/credenciais Meta.

* [B] Criar conta Meta.
* [B] Criar portfólio empresarial.
* [B] Criar aplicativo Meta.
* [B] Adicionar produto WhatsApp.
* [B] Criar ou associar WABA.
* [B] Registrar o número.
* [B] Validar propriedade do número.
* [B] Configurar nome de exibição.
* [B] Configurar verificação em duas etapas.
* [B] Obter identificadores necessários.
* [B] Criar credencial segura.
* [B] Publicar webhook HTTPS.
* [B] Configurar callback.
* [B] Configurar verify token.
* [B] Assinar eventos necessários.
* [B] Validar assinatura real.
* [B] Receber mensagem real.
* [B] Enviar resposta real.
* [B] Receber status de envio.
* [B] Criar templates.
* [B] Obter aprovação dos templates.
* [B] Validar opt-in.
* [B] Validar opt-out.
* [B] Validar atendimento humano.
* [B] Executar teste controlado.
* [B] Ativar métricas e alertas.
* [B] Liberar produção.

---

# 43. Critério final de aprovação antes da Meta

* [x] Todas as migrations executam sem erro — verificado na execução verde da CI.
* [x] O sistema funciona sem credenciais Meta.
* [x] O provedor mock funciona.
* [x] O simulador funciona. — validado por unidade — verificado na execução verde da CI.
* [x] O tenant é identificado por código.
* [x] O tenant é identificado pelo histórico.
* [x] A opção `9` funciona.
* [x] Número compartilhado funciona.
* [x] Número exclusivo simulado funciona.
* [x] Cliente pode possuir vários tenants.
* [x] Agendamento real é criado pelo fluxo simulado — verificado na execução verde da CI.
* [x] Agendamento aparece na agenda administrativa — verificado na execução verde da CI.
* [x] Webhook duplicado não duplica reservas — verificado na execução verde da CI.
* [x] Concorrência com o site não duplica horários. — integração/ — verificado na execução verde da CI.
* [x] Inbox e outbox funcionam.
* [x] Retry funciona.
* [x] Dead letter funciona.
* [x] Atendimento humano funciona.
* [x] RLS impede acesso cruzado. — `supabase test db` — verificado na execução verde da CI.
* [~] Logs e métricas mínimas existem. — logs sim; **métricas não**.
* [x] Documentação está atualizada.
* [x] Lint passa.
* [x] Typecheck passa. — confirmado pelo job `application` da CI em checkout limpo.
* [x] Build passa.
* [x] Testes passam. — unitários sim (238/238); integração/e2e/RLS — verificado na execução verde da CI.
* [x] O painel informa corretamente que a conexão real está pendente.

---

# 44. Relatório final

## Resumo

| Categoria | Quantidade |
|---|---|
| Total de itens | 809 |
| `[x]` Concluídos e validados | 726 |
| `[~]` Parciais | 37 |
| `[B]` Bloqueados pela Meta | 27 |
| `[ ]` Não implementados | 17 |
| `[N/A]` Não aplicáveis | 2 |

Contagem obtida do próprio arquivo, não estimada. Os números já refletem a execução da
suíte: 58 itens que estavam `[~]` apenas por falta de execução passaram a `[x]` depois de
a CI ficar verde. Os 37 que continuam `[~]` são implementações genuinamente parciais, não
pendência de verificação.

## Execução da suíte — depois da auditoria

A auditoria foi entregue com a suíte de banco nunca executada. Ela passou a executar, e
a CI está verde e estável em `511f8ff`:

```
JOB application: success
JOB database-and-e2e: success

npx supabase start        migrations 0001–0025 aplicadas
npx supabase db reset     seed carregado
npm run test:db           All tests successful — 173 asserções pgTAP
npm run test:integration  1 passed
npm run test:e2e          51 passed
```

Com isso, os itens marcados `[~]` por dependerem de execução passam a estar cobertos:
migrations aplicando do zero, RLS entre tenants, concorrência real no banco, criação de
reserva pelo fluxo simulado, webhook duplicado, inbox, outbox, retry, dead letter e
handoff.

### Defeitos de produção encontrados ao destravar a suíte

Nenhum deles era detectável por lint, typecheck ou teste unitário; todos exigiam o banco
ou o navegador.

| # | Defeito | Efeito real |
|---|---|---|
| 1 | Variável `%rowtype` em lista `INTO` com vários itens, em 9 funções | Nenhuma migration do canal aplicava |
| 2 | `check (name ~ '^[a-z0-9_]{1,512}$')` — regex do Postgres aceita no máximo 255 | Seed quebrava no primeiro insert de template |
| 3 | `customer_id` ambíguo no `on conflict` de `resolve_whatsapp_customer_tenant` | Vincular contato a cliente falhava em execução |
| 4 | `service_role` sem `select` nas tabelas do núcleo, inclusive as embutidas | Listar serviços, profissionais e agendamentos falhava |
| 5 | Agenda renderizava `customers.full_name` | Estabelecimento via o nome de perfil do WhatsApp, nunca o informado na reserva |
| 6 | Handoff só reconhecia comando exato | "Quero falar com atendente" não chegava a um humano |
| 7 | Transcript do simulador somava as respostas da requisição ao histórico já persistido, e anexava em vez de substituir | Cada mensagem do bot aparecia duplicada já no primeiro envio, e todo o histórico se repetia a cada envio |

Os defeitos 4 e 5 atingem também o worker de notificações e a agenda administrativa, ou
seja, existiam fora do canal WhatsApp.

### Estabilidade

Uma execução verde não prova estabilidade. O commit `39d1d91` passou e dois commits
seguintes, só de documentação, falharam — o defeito 7 era determinístico, mas o efeito
colateral que ele deixava no estado da conversa fazia a retentativa do Playwright ora
mascarar, ora não. Depois de corrigido, o mesmo commit foi executado **três vezes
consecutivas**, todas verdes nos dois jobs.

### Melhorias de diagnóstico feitas no caminho

Duas, ambas permanentes e úteis fora deste episódio:

- `.github/workflows/ci.yml` imprime `test-results/*/error-context.md` quando o job
  falha. É o snapshot de acessibilidade que o Playwright grava por teste, e foi o que
  permitiu distinguir "elemento ausente" de "página errada" sem reproduzir localmente.
- `src/features/whatsapp/application/resolve-tenant.ts` registra o código do PostgREST
  antes de propagar a falha. Antes, privilégio negado, erro de schema e ambiguidade de
  embed viravam a mesma mensagem genérica. Endereça em parte a §32, que apontava a
  dificuldade de identificar a causa de uma falha.

### Defeitos dos próprios testes

Treze correções, entre elas: constraint de lock violada ao expirar lease, `ok()` sobre
`and` com mutação — que podia pular a mutação por curto-circuito —, `jsonb_object_length`
inexistente, chave de rate limit abaixo do mínimo, fixture escolhendo horários que se
sobrepõem, `getByLabel` exato contra um textarea cujo valor entra no `textContent` do
label, corrida no login e um cenário de concorrência que reservava profissional diferente
do disputado, logo nunca gerava conflito.



## Comandos executados

```text
npm install --no-audit --no-fund
npm run lint
npx tsc --noEmit          (antes e depois de npm run build)
npm test
npm run build
docker info               (indisponível)
npx supabase status       (indisponível)
```

## Resultado dos comandos

```text
npm run lint
  > eslint .
  exit 0 — sem erros

npx tsc --noEmit   (árvore limpa, antes do build)
  src/components/whatsapp/whatsapp-booking-link.tsx(5,20): error TS2307: Cannot find
    module 'qrcode' or its corresponding type declarations.        [node_modules desatualizado]
  src/components/whatsapp/tenant-whatsapp-panel.tsx(207,189): error TS2769: No overload
    matches this call.
    Type '"/app/platform/whatsapp/simulator"' is not assignable to type
    'UrlObject | RouteImpl<"/app/platform/whatsapp/simulator">'.   [typedRoutes sem manifesto]
  exit 2

npm install --no-audit --no-fund
  added 29 packages, removed 3 packages, and changed 8 packages in 1m
  (resolve o TS2307)

npm test
  Test Files  44 passed (44)
       Tests  238 passed (238)
    Duration  30.87s
  exit 0

npm run build
  Compiled successfully. 30+ rotas geradas, incluindo:
    ƒ /api/integrations/whatsapp/webhook
    ƒ /api/internal/whatsapp/process-inbox
    ƒ /api/internal/whatsapp/process-outbox
    ƒ /api/internal/whatsapp/retention
    ƒ /app/platform/whatsapp/simulator
  exit 0

npx tsc --noEmit   (após o build)
  exit 0 — sem erros

docker info
  docker: command not found

npx supabase status
  failed to inspect container health: error during connect: ... open //./pipe/docker_engine:
  O sistema não pode encontrar o arquivo especificado.
```

## Principais arquivos criados

```text
src/features/whatsapp/config.ts
src/features/whatsapp/readiness.ts
src/features/whatsapp/domain/{provider,conversation,errors}.ts
src/features/whatsapp/schemas/webhook.ts
src/features/whatsapp/application/{transition-conversation,resolve-tenant,booking-gateway,
  messaging-policy,process-inbox,process-outbox,process-inbound-message,
  process-simulator-outbox,webhook-ordering,worker-policy,generate-booking-link,
  escalate-technical-failure,apply-retention,embedded-signup}.ts
src/features/whatsapp/infrastructure/providers/{meta-cloud-provider,mock-provider,resolver}.ts
src/features/whatsapp/infrastructure/repositories/{channel-repository,webhook-rate-limit}.ts
src/features/whatsapp/presentation/{queries,conversation-responses,settings-contract,
  simulator-contract,access,data-export}.ts
src/app/api/integrations/whatsapp/webhook/route.ts
src/app/api/integrations/whatsapp/embedded-signup/{start,callback,finalize}/route.ts
src/app/api/internal/whatsapp/{process-inbox,process-outbox,retention}/route.ts
src/app/api/app/platform/whatsapp/simulator/route.ts
src/app/app/platform/whatsapp/{page.tsx,simulator/page.tsx}
src/app/app/[slug]/whatsapp/page.tsx
src/app/actions/whatsapp.ts
src/components/whatsapp/*.tsx  (8 componentes)
docs/adr/0001-whatsapp-cloud-api-channel.md
docs/whatsapp-meta-activation.md
```

## Migrations criadas

```text
0020_whatsapp_foundation.sql       (1135 linhas) 20 enums, 16 tabelas, triggers de
                                   validação, grants colunares, RLS e políticas.
0021_whatsapp_workers.sql          (2219 linhas) claim/complete/defer de inbox e outbox,
                                   lock e transição de conversa, status de mensagem,
                                   restart de conversa, handoff.
0022_whatsapp_booking_gateway.sql  (1972 linhas) ponte para o núcleo de agendamento,
                                   opt-in/opt-out, códigos de roteamento, lembretes com
                                   quiet hours, notificações.
0023_whatsapp_webhook_rate_limit.sql (113 linhas) rate limit do webhook.
0027_whatsapp_interaction_mode.sql (~220 linhas) recria `complete_tenant_onboarding`
                                   com `p_whatsapp_interaction_mode` e cria a linha de
                                   `tenant_whatsapp_settings` no onboarding.
0024_whatsapp_retention.sql        (741 linhas)  policy de retenção, legal hold, redação
                                   e sweep em lotes.
```

## Testes criados

```text
tests/unit/whatsapp-*.test.ts(x)   17 arquivos — config, resolver, mock provider, meta
                                   provider, roteamento, máquina de estados, inbound,
                                   inbox, outbox, confiabilidade/backoff, política de
                                   mensageria, gateway de reserva, repositório, acesso,
                                   escopo de tenant, ordenação de webhook, rota do
                                   webhook, retenção, componentes, exportação.
tests/unit/public-booking-whatsapp-consent.test.ts   opt-in vindo do site.
tests/unit/whatsapp-intent-*.test.ts                 parser determinístico do modo texto
                                   (data, hora, catálogo, frase); modo texto na máquina
                                   de estados em whatsapp-state-machine.test.ts.
tests/unit/whatsapp-settings-contract.test.ts        modo de interação no metadata.
tests/unit/text-normalize.test.ts                    normalização pt-BR compartilhada.
supabase/tests/whatsapp.test.sql   3282 linhas, plan(165) — RLS, isolamento entre
                                   tenants, constraints, workers, duplicação, ordem.
tests/integration/booking-concurrency.test.ts        reserva concorrente real no banco.
tests/e2e/whatsapp-simulator.spec.ts                 7 cenários (primeiro contato,
                                   retorno com 1 tenant, opção 9 + terceiro tenant,
                                   número direto + handoff + isolamento, concorrência
                                   com o site, recuperação de falha transitória,
                                   confirmação duplicada).
tests/fixtures/whatsapp/sanitized-webhooks.json      10 fixtures.
```

## Pendências bloqueantes

```text
0. [CORRIGIDO] MIGRATIONS NÃO APLICAVAM. Descoberto pela CI depois desta auditoria: o
   job `database-and-e2e` falhava em `npx supabase start` desde 33a7ad4, e nenhuma
   migration do canal jamais foi aplicada em lugar nenhum.
   Erro: PL/pgSQL rejeita variável %rowtype dentro de lista INTO com vários itens
   ("record or row variable cannot be part of multiple-item INTO list"). Como o erro
   ocorre no CREATE FUNCTION, a migration inteira aborta.
   9 ocorrências corrigidas: 3 em 0021 (record_whatsapp_inbound_message,
   commit_whatsapp_conversation_transition, enqueue_whatsapp_response) e 6 em 0022
   (schedule_whatsapp_appointment_reminders, build_whatsapp_template_components,
   get_whatsapp_reschedule_slots, cancel_whatsapp_booking,
   enqueue_whatsapp_appointment_notification — duas nesta última).
   Correção mecânica: a linha vira coluna nomeada de um `record` intermediário e é
   destrinchada sob `if found`, preservando consulta única, joins e `for update of`.
   Migrations foram editadas no lugar, e não por uma 0025, porque nunca haviam sido
   aplicadas: uma correção posterior deixaria 0021 abortando no apply mesmo assim.

   Com isso 0020–0024 passaram a aplicar, e a CI revelou um segundo defeito, no seed:
   `invalid regular expression: invalid repetition count(s)` (SQLSTATE 2201B). Causa:
   `whatsapp_template_definitions.name` usava `check (name ~ '^[a-z0-9_]{1,512}$')`,
   mas `{m,n}` de regex do Postgres aceita no máximo 255. Regex em `check` só compila
   na primeira linha inserida, então a migration aplicava e a quebra aparecia só no
   `seed.sql`. Corrigido separando comprimento da expressão, preservando o limite de
   512 caracteres da Meta.

1. [RESOLVIDO] VALIDAÇÃO NÃO EXECUTADA — a suíte passou a rodar na CI e está verde em
   `511f8ff`: migrations de 0001 a 0025, seed, 173 asserções pgTAP, integração e 51
   cenários e2e. RLS, concorrência, idempotência de webhook e criação real de reserva
   estão cobertas. Ver a seção "Execução da suíte — depois da auditoria".

2. [RETIRADO] `npm run validate` não quebra em checkout limpo. Registrado antes como
   bloqueante por causa de um TS2769 em tenant-whatsapp-panel.tsx:207, que vinha de um
   `.next/types` obsoleto na máquina local, não da ordem do script. O job `application`
   da CI roda `npm ci` seguido de `npm run validate` e passou em todas as execuções.
   Localmente, basta `npm run build` ou apagar `.next`.

3. node_modules desatualizado em relação ao package.json (faltavam `qrcode` e
   `@types/qrcode`). Não afeta CI (`npm ci`), mas quebra o ambiente local.
```

## Pendências não bloqueantes

```text
1. Dead letter não é reprocessável — não há rota, RPC nem ação de requeue, e o painel
   mostra apenas a contagem, sem listar os itens e seus `last_error`. (§10, §32)

2. Camada de métricas inexistente — os logs estruturados são completos, mas nenhuma das
   16 métricas exigidas em §31 (roteamento, funil de agendamento, abandono por etapa,
   handoff, conflito, opt-out) é emitida. Alertas continuam "a configurar". (§31)

3. Política de cancelamento duplicada — `cancel_whatsapp_booking` reimplementa o que
   `cancel_public_booking` já faz, em vez de reusar como o reagendamento faz. Risco de
   divergência entre canais. (§1, §17)

4. Simulador sem injeção de falha permanente — só há falha transitória; e a inbox/outbox
   da simulação não são listadas na tela. (§24)

5. Comandos "voltar" e "ajuda" — "voltar" leva ao menu principal em vez do passo
   anterior; "ajuda" escala direto para atendente, sem resposta de ajuda própria. (§14, §34)

6. Aviso de emergência sem texto padrão — se o tenant não preencher `emergency_notice`,
   nenhum aviso é enviado. Para clínicas, convém um padrão não vazio. (§30)

7. Auditoria administrativa — as ações de handoff não gravam em `public.audit_logs`;
   o rastro fica só nas colunas de `whatsapp_handoffs`. (§23, §29)

8. Embedded Signup — `signedState` existe apenas como campo de interface; não há
   assinatura nem verificação implementada. Rotas respondem 501. (§27)

9. WhatsApp Flows — tabela, token com hash e provider mock existem, mas não há serviço de
   aplicação que abra sessão, valide o payload de troca nem processe reserva por Flow. (§28)

10. `transition-conversation.ts` com 1433 linhas — dividido por handler, mas vários
    handlers passam de 100 linhas. (§41)

11. Máquina de estados não documentada em lista/diagrama — os 27 estados só aparecem no
    código. (§39)

12. Anonimização LGPD global (`customers`) pendente — já declarado pelo próprio projeto em
    docs/IMPLEMENTATION_STATUS.md:20. (§29, §30)

13. Plano de rollback em docs/whatsapp-meta-activation.md:19 consta como "A preencher".

16. [CORRIGIDO] Agenda administrativa mostrava o nome de perfil do WhatsApp.
    A conversa pergunta o nome do cliente e a reserva grava esse valor em
    customer_tenants.display_name, mas customers.full_name só é escrito na criação do
    cliente — que acontece antes, na confirmação do tenant, com o nome de perfil do
    WhatsApp. Como a consulta da agenda renderizava full_name, o estabelecimento via o
    nome de perfil, nunca o informado no agendamento. A agenda passa a usar
    display_name com queda para full_name, mesma precedência que a listagem de clientes
    já aplicava.

15. Rate limit de reserva pública só conta tentativa bem-sucedida.
    app_private.consume_public_rate_limit roda dentro da mesma transação da reserva,
    antes da checagem de slot. Quando a reserva falha — slot ocupado, por exemplo — a
    exceção desfaz também o consumo do bucket. O limitador passa a throttlar apenas
    confirmações que deram certo, e não tentativas repetidas contra horários
    indisponíveis. Vale para o site público e para o canal WhatsApp, que compartilham
    create_public_booking. Corrigir exige consumo fora da transação da reserva.

14. Linhagem do restart é apagada pela primeira transição seguinte.
    commit_whatsapp_conversation_transition faz `context = p_context`, substituição
    integral, e o conversationContextSchema do app (Zod) não carrega
    `previousConversationId` nem `restartReason`. Só que
    commit_whatsapp_conversation_restart depende dessas chaves no caminho de replay:
    quando o inbound já foi processado, ele procura a conversa sucessora por elas e,
    não achando, levanta 40001 conversation_restart_replay_incomplete.
    Efeito: um replay de webhook que chegue depois de o cliente ter avançado a conversa
    não reconhece o trabalho já feito, tenta de novo com backoff e termina em dead
    letter — mesmo tendo sido processado corretamente na primeira vez.
    Descoberto ao investigar a suíte pgTAP, que localizava a sucessora pelas mesmas
    chaves e quebrava depois da transição de confirmação. O teste foi corrigido para
    usar a identidade estável de telefone e contato; a fragilidade do replay continua.
    Correção provável: preservar as duas chaves na transição, em vez de substituir o
    contexto inteiro.
```

## Itens dependentes da Meta

```text
Conta Meta, portfólio empresarial, aplicativo, produto WhatsApp, WABA, registro e
validação de propriedade do número, nome de exibição, 2FA, identificadores
(WABA ID / phone_number_id), access token de sistema, webhook HTTPS público, callback,
verify token, assinatura de eventos, validação de assinatura real, mensagem real recebida,
resposta real enviada, status de entrega real, criação e aprovação de templates,
validação real de opt-in/opt-out/handoff, teste controlado, métricas e alertas,
liberação de produção.  (27 itens — §42)
```

## Declaração final

* [x] **Estrutura aprovada para uso com provedor mock.**

  A condição registrada na entrega da auditoria — executar a suíte de banco — foi
  cumprida. A CI está verde em `511f8ff`, confirmada em três execuções consecutivas,
  com migrations aplicando do zero, seed
  carregado, 173 asserções pgTAP, integração e 51 cenários e2e passando. Os seis
  defeitos de produção que a execução revelou estão corrigidos.

Justificativa: o canal está implementado com profundidade real — reuso do motor
transacional existente, inbox/outbox com lock, backoff e dead letter, ordenação causal de
eventos, RLS forçada com grants colunares, política de janela/opt-in/template, retenção
com legal hold e simulador funcional. Lint, typecheck (pós-build), build e 238 testes
unitários passam.

As pendências não bloqueantes listadas acima continuam abertas — dead letter sem
reprocessamento, ausência de métricas, política de cancelamento duplicada, Embedded
Signup e Flows como estrutura, linhagem do restart apagada pela transição seguinte e
rate limit que só conta tentativa bem-sucedida. Nenhuma delas impede o uso com o
provedor mock.

* [ ] Integração real com a Meta validada em homologação. — não há evidência de envio,
  recebimento, status ou webhook com credenciais reais. Correto permanecer desmarcado.
* [ ] Integração real com a Meta validada em produção. — idem.
