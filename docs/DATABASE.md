# Banco de dados

O schema operacional é dividido pelas áreas abaixo. Tabelas sem fluxo na aplicação
não fazem parte do banco ativo.

## Organização e acesso

- `tenants`, `tenant_profiles`, `tenant_members`, `locations`
- `business_settings`, `theme_settings`, `audit_logs`

## Catálogo e equipe

- `service_categories`, `services`, `service_locations`
- `staff`, `staff_services`, `staff_locations`
- `resources`, `resource_services`

## Disponibilidade

- `working_hours`, `staff_working_hours`, `availability_exceptions`
- `time_off`, `calendar_blocks`

## Clientes

- `customers`, `customer_tenants`

`customers` mantém a identidade global por telefone E.164. `customer_tenants`
isola histórico, bloqueio, origem e `last_interaction_at` por estabelecimento.

## Agenda

- `appointments`, `appointment_services`, `appointment_resources`
- `appointment_status_history`, `booking_tokens`, `booking_allocations`

## Infraestrutura operacional

- `outbox_events`, `public_rate_limits`

Eventos são reclamados por `claim_outbox_events` com `FOR UPDATE SKIP LOCKED` e
lease de cinco minutos. `complete_outbox_event` conclui; `defer_outbox_event`
reagenda com backoff. As três RPCs aceitam somente `service_role`.

## WhatsApp Business Platform

- Contas e números: `whatsapp_business_accounts`, `whatsapp_phone_numbers`,
  `whatsapp_phone_number_tenants`
- Configuração e roteamento: `tenant_whatsapp_settings`,
  `whatsapp_routing_codes`, `whatsapp_routing_code_uses`
- Identidade e conversa: `whatsapp_contacts`, `whatsapp_conversations`,
  `whatsapp_messages`
- Filas: `whatsapp_webhook_events`, `whatsapp_outbox`,
  `whatsapp_pending_message_statuses`
- Templates e consentimento: `whatsapp_template_definitions`,
  `tenant_whatsapp_templates`, `whatsapp_opt_ins`
- Atendimento e evolução: `whatsapp_handoffs`, `whatsapp_flow_sessions`

Contas podem pertencer à plataforma ou a um tenant. Números compartilhados aceitam
vários vínculos `shared`; números exclusivos ou próprios aceitam um vínculo ativo
`direct`. O vínculo possui unidade e finalidade opcionais. A configuração preferida
usa foreign key composta e não pode apontar para número de outro tenant.

Conversas começam com `tenant_id` nulo. Somente `platform_owner` e processos
internos leem esse estado. Depois da resolução, o tenant não pode ser trocado;
`commit_whatsapp_conversation_restart` fecha a conversa, cria a sucessora, consome
o inbound e grava respostas em uma transação. `version` protege transições
otimistas. `service_window_expires_at` representa a janela do provedor;
`session_expires_at` representa a expiração do fluxo local.

`whatsapp_webhook_events` é a inbox idempotente por
`(provider, external_event_key)`. `whatsapp_outbox` materializa cada envio e referencia
uma mensagem única e carrega seu `provider`. Claims exigem o provider do adapter,
usam lease de cinco minutos, ownership por worker, oito tentativas, backoff
exponencial com jitter e dead letter. A ingestão persiste de 1 a 256
`ordering_keys` SHA-256, sem PII, e a inbox mantém head of line somente entre
envelopes do mesmo provider cujas chaves se sobrepõem. Streams independentes podem
avançar em paralelo. Quando um envelope excede o limite, o adapter grava uma chave
conservadora e `ordering_global_fallback`; essa flag atua como wildcard e serializa
o envelope contra todos os streams daquele provider, sem descartar o webhook.
A outbox mantém head of line por conversa.
No provider mock o retry fica imediatamente disponível; no provider Meta o backoff
permanece ativo. Status que chega antes da resposta HTTP fica em
`whatsapp_pending_message_statuses` e é aplicado ao concluir a outbox. As RPCs de
worker aceitam somente `service_role`. Antes de cada claim, a outbox encerra em
`dead_letter` a oitava tentativa cuja lease venceu e marca a mensagem como falha;
isso libera o head of line mesmo se o worker caiu após reclamar o item final.
O rate limit do webhook usa contador persistente em `app_private`: 20 verificações
por chave a cada dez minutos e 600 recebimentos por minuto. A chave é SHA-256 com
pepper; somente a RPC `consume_whatsapp_webhook_rate_limit` é concedida ao
`service_role`, sem acesso direto à tabela.

`whatsapp_contacts` guarda uma identidade global para deduplicar o mesmo número,
mas `authenticated` recebe somente `id`, telefone normalizado e nome de perfil,
sempre filtrados pela RLS através de uma conversa autorizada. `customer_id`, IDs
externos, timestamps e `metadata` continuam exclusivos de processos internos; uma
exportação de tenant deve partir das conversas daquele tenant, nunca consultar o
cadastro global por `customer_id`.

`find_whatsapp_inbound_message` faz o preflight de replay antes de criar uma sessão;
`record_whatsapp_inbound_message` deduplica a mensagem e atualiza atividade/janela
monotonicamente. `commit_whatsapp_conversation_transition` marca esse inbound como
processado, atualiza estado e versão, cria handoff quando solicitado, insere respostas
e grava a outbox na mesma transação. Em uma troca de estabelecimento, apenas o inbound
atual acompanha a conversa sucessora com `tenant_id` nulo; o tenant anterior deixa de
ver imediatamente o código e o contexto pendente. Somente o inbound de confirmação
recebe o novo `tenant_id`. Mensagens anteriores continuam na conversa e no tenant de
origem. A RLS exige igualdade entre o tenant da mensagem e o tenant da conversa,
inclusive após troca de estabelecimento. Reinício e expiração cancelam o backlog
`pending/retry` da conversa antiga. O payload de entrega usa `recipient`,
`response`, `idempotencyKey` e `purpose`. Notificações também carregam
`appointmentId` e `eventType`; cancelamento/reagendamento invalida jobs pendentes e
o worker revalida o appointment antes do envio.

O watermark `last_inbound_at` acompanha o inbound decisor até a conversa sucessora.
Eventos anteriores que chegam atrasados são persistidos com `tenant_id` nulo e
ignorados pelo worker, sem expor o corpo ao tenant atualmente associado à conversa.
Ao entrar em `human_handoff`, a transição cancela respostas `pending/retry`, insere
no máximo um `handoff_acknowledgement` e a validação de entrega invalida
`conversation_reply` já reclamada. A validação e a entrada no handoff compartilham
um lock de conversa: se o dispatch venceu, o handoff tenta novamente após a lease;
se o handoff venceu, a resposta antiga é cancelada antes do envio.
`accept_whatsapp_handoff` atribui handoff e
conversa sob lock; replay do mesmo responsável é idempotente e outro responsável
recebe conflito. A resolução exige handoff previamente aceito.

`create_whatsapp_booking` reutiliza `create_public_booking` e corrige, na mesma
transação, `appointments.origin`, `customer_tenants.source` e a outbox de domínio
para `whatsapp`. No commit, ela bloqueia as configurações e revalida os allowlists
atuais de serviço e unidade; a chave de rate limit é estável por tenant/contato e não
depende da idempotency key. Eventos proativos da mesma operação WhatsApp são
suprimidos para não duplicar a resposta conversacional, mas reminders futuros são
mantidos. `list_whatsapp_customer_bookings`,
`get_whatsapp_reschedule_slots`, `cancel_whatsapp_booking` e
`reschedule_whatsapp_booking` validam tenant, cliente e políticas. Todas aceitam
somente `service_role`; APIs públicas existentes permanecem inalteradas.

`resolve_whatsapp_customer_tenant` exige a conversa e o contato exatos, valida o
vínculo ativo do número receptor, serializa a criação pelo telefone, reutiliza
`customers`, liga `whatsapp_contacts.customer_id` e cria a relação tenant-cliente.
`consume_whatsapp_routing_code` valida número, vínculo, expiração e limite de uso de
forma atômica. `whatsapp_routing_code_uses` impede novo consumo no replay do mesmo
inbound. Código publicado mantém `tenant_id`, número, valor e tipo imutáveis. Owners
e admins podem alterar metadados operacionais ou desativá-lo; estados
`disabled`/`expired` não voltam a `active`. Hard delete é bloqueado, FKs dos pais
usam `ON DELETE RESTRICT` e a restrição única inclui tombstones. Assim, outro tenant
não reaproveita um link antigo no mesmo número. Código de roteamento identifica
contexto; nunca autoriza acesso.
`record_web_whatsapp_opt_in` registra consentimento por tenant e categoria. A RPC é
restrita a `service_role`; a rota pública valida origem, rate limit e evidência antes
de chamá-la. Contato criado antes do primeiro webhook recebe marca provisória e é
reconciliado pelo telefone quando o identificador oficial chegar.

Templates aceitam os estados `local_draft`, `submitted`, `approved`, `rejected`,
`paused`, `disabled` e `unknown`. O vínculo tenant-template exige uma WABA ligada a
um número ativo do tenant. Fora da janela de serviço, somente template `approved`
— ou `local_draft` no provider mock — é usado; `variable_mapping` aceita apenas
campos operacionais enumerados e vira componentes do provider no servidor.

`platform_owner` lê somente colunas operacionais da inbox/outbox; `payload`,
`recipient`, `whatsapp_messages.provider_payload` e referências de segredo não são
concedidos ao papel autenticado. Sessões de Flow seguem a mesma regra: o tenant vê
o ledger operacional, mas não recebe `flow_token_hash` nem o `context` interno.

A policy privada de retenção mantém TTLs versionados de 30 dias para payloads de
webhook, 90 dias para filas operacionais e 180 dias para conteúdo de conversas. O
job `apply_whatsapp_retention` respeita `legal_hold`, fecha sessões automatizadas e
handoffs abandonados, redige conteúdo antigo — inclusive evidência livre de opt-in
revogado ou substituído — e remove outbox terminal em lotes. Somente contatos órfãos
(`customer_id is null`), sem consentimento ou trabalho ativo, são anonimizados após
todo o histórico relacionado estar terminal e redigido. A identidade técnica
remanescente usa o namespace interno versionado `+999…`/`retained:<uuid>`;
constraints impedem entrada ou envio nesse namespace. Contatos ligados à identidade
global `customers` permanecem preservados: sua anonimização/exclusão exige um fluxo
LGPD global que considere todos os tenants e reservas, ainda fora deste job. O job
deve ser agendado e repetido enquanto houver contadores maiores que zero.

Referências de segredo ficam em `secret_reference`; tokens reais não entram no
banco operacional, seed, logs ou payloads destinados a usuários. A coluna não é
concedida a `authenticated`.

## Regra de manutenção

Uma nova tabela só deve ser criada quando houver um fluxo ativo que precise de
integridade relacional própria. Preferências pequenas e metadados opcionais devem
usar as colunas `jsonb` já existentes nas entidades principais.

## Histórico atual

- `0016_simplify_schema.sql`: remove módulos sem fluxo ativo.
- `0017_outbox_worker.sql`: adiciona consumo transacional sem criar tabela.
- `0018_fix_public_booking_contact_validation.sql`: corrige a validação de telefone
  E.164 e e-mail na RPC transacional de reserva pública.
- `0019_ensure_agenda_realtime.sql`: garante publicação Realtime e identidade de
  réplica para agendamentos e bloqueios.
- `0020_whatsapp_foundation.sql`: cria modelo, constraints, índices, RLS e grants do
  canal oficial; também reserva slugs internos da plataforma.
- `0021_whatsapp_workers.sql`: cria workers transacionais, leases, retries, dead
  letter, lock e versão de conversa.
- `0022_whatsapp_booking_gateway.sql`: integra contato, roteamento e agenda pelas
  RPCs centrais sem duplicar disponibilidade ou concorrência.
- `0023_whatsapp_webhook_rate_limit.sql`: persiste limites de verificação e
  recebimento antes do processamento do webhook.
- `0024_whatsapp_retention.sql`: adiciona policy privada versionada, `legal_hold`,
  encerramento de sessões abandonadas e redação/exclusão em lotes.
- `0025_service_role_core_reads.sql`: concede `select` ao `service_role` nas tabelas do
  núcleo lidas pelo cliente admin do servidor, inclusive as que entram por embed do
  PostgREST. Sem isso o gateway do WhatsApp e o worker de notificações falham com
  `permission denied`.
