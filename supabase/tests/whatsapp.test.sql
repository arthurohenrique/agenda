begin;

create extension if not exists pgtap with schema extensions;
select plan(172);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any (array[
        'whatsapp_business_accounts', 'whatsapp_phone_numbers',
        'whatsapp_phone_number_tenants', 'tenant_whatsapp_settings',
        'whatsapp_routing_codes', 'whatsapp_routing_code_uses',
        'whatsapp_contacts', 'whatsapp_conversations',
        'whatsapp_webhook_events', 'whatsapp_messages', 'whatsapp_outbox',
        'whatsapp_pending_message_statuses',
        'whatsapp_template_definitions', 'tenant_whatsapp_templates',
        'whatsapp_opt_ins', 'whatsapp_handoffs', 'whatsapp_flow_sessions'
      ])
      and not relation.relrowsecurity
  ),
  'Todas as tabelas WhatsApp possuem RLS'
);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any (array[
        'whatsapp_business_accounts', 'whatsapp_phone_numbers',
        'whatsapp_phone_number_tenants', 'tenant_whatsapp_settings',
        'whatsapp_routing_codes', 'whatsapp_routing_code_uses',
        'whatsapp_contacts', 'whatsapp_conversations',
        'whatsapp_webhook_events', 'whatsapp_messages', 'whatsapp_outbox',
        'whatsapp_pending_message_statuses',
        'whatsapp_template_definitions', 'tenant_whatsapp_templates',
        'whatsapp_opt_ins', 'whatsapp_handoffs', 'whatsapp_flow_sessions'
      ])
      and not relation.relforcerowsecurity
  ),
  'Todas as tabelas WhatsApp forçam RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_webhook_events', 'SELECT'),
  'Usuário autenticado não lê payload bruto de webhook'
);
select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_outbox', 'SELECT'),
  'Usuário autenticado não lê outbox interna'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.whatsapp_routing_codes', 'DELETE'
  )
  and not has_table_privilege(
    'service_role', 'public.whatsapp_routing_codes', 'DELETE'
  )
  and not has_column_privilege(
    'authenticated', 'public.whatsapp_routing_codes', 'tenant_id', 'UPDATE'
  )
  and not has_column_privilege(
    'authenticated', 'public.whatsapp_routing_codes', 'phone_number_id', 'UPDATE'
  )
  and not has_column_privilege(
    'authenticated', 'public.whatsapp_routing_codes', 'code', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.whatsapp_routing_codes', 'status', 'UPDATE'
  ),
  'Routing code permite tombstone, mas nega delete e mutação de identidade'
);
select ok(
  (
    select count(*) = 3 and bool_and(constraint_definition.confdeltype = 'r')
    from pg_constraint constraint_definition
    where constraint_definition.conrelid =
      'public.whatsapp_routing_codes'::regclass
      and constraint_definition.contype = 'f'
  ),
  'Pais de routing code usam ON DELETE RESTRICT e preservam tombstones'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.whatsapp_messages',
    'provider_payload',
    'SELECT'
  ),
  'Usuário autenticado não lê payload bruto persistido na mensagem'
);
select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_contacts', 'SELECT')
  and has_column_privilege(
    'authenticated', 'public.whatsapp_contacts', 'id', 'SELECT'
  )
  and has_column_privilege(
    'authenticated', 'public.whatsapp_contacts', 'normalized_phone', 'SELECT'
  ),
  'Usuário autenticado recebe somente colunas operacionais mínimas do contato'
);
select ok(
  not has_column_privilege(
    'authenticated', 'public.whatsapp_contacts', 'customer_id', 'SELECT'
  )
  and not has_column_privilege(
    'authenticated', 'public.whatsapp_contacts', 'whatsapp_user_id', 'SELECT'
  )
  and not has_column_privilege(
    'authenticated', 'public.whatsapp_contacts', 'metadata', 'SELECT'
  )
  and not has_column_privilege(
    'authenticated', 'public.whatsapp_contacts', 'last_seen_at', 'SELECT'
  ),
  'Tenant não lê identidade global, vínculo de customer ou telemetria do contato'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.whatsapp_flow_sessions', 'SELECT'
  )
  and not has_column_privilege(
    'authenticated', 'public.whatsapp_flow_sessions', 'flow_token_hash', 'SELECT'
  )
  and not has_column_privilege(
    'authenticated', 'public.whatsapp_flow_sessions', 'context', 'SELECT'
  )
  and has_column_privilege(
    'authenticated', 'public.whatsapp_flow_sessions', 'status', 'SELECT'
  ),
  'Tenant lê ledger do Flow sem token hash ou contexto interno'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.accept_whatsapp_handoff(uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.accept_whatsapp_handoff(uuid)', 'EXECUTE'
  ),
  'Assunção de handoff exige usuário autenticado ou service role com ator'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_whatsapp_webhook_events(integer,text,text)',
    'EXECUTE'
  ),
  'Usuário autenticado não reclama inbox'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_whatsapp_webhook_events(integer,text,text)',
    'EXECUTE'
  ),
  'Service role reclama inbox'
);
select ok(
  not has_table_privilege(
    'authenticated', 'app_private.whatsapp_webhook_rate_limits', 'SELECT'
  )
  and not has_table_privilege(
    'service_role', 'app_private.whatsapp_webhook_rate_limits', 'SELECT'
  )
  and not has_function_privilege(
    'authenticated',
    'public.consume_whatsapp_webhook_rate_limit(text,text)',
    'EXECUTE'
  ),
  'Contador de rate limit fica privado e tenant não executa a RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.consume_whatsapp_webhook_rate_limit(text,text)',
    'EXECUTE'
  ),
  'Service role consome rate limit persistente do webhook'
);
select ok(
  not has_table_privilege(
    'authenticated', 'app_private.whatsapp_retention_policy', 'SELECT'
  )
  and not has_table_privilege(
    'service_role', 'app_private.whatsapp_retention_policy', 'SELECT'
  )
  and not has_sequence_privilege(
    'service_role', 'app_private.whatsapp_retained_phone_seq', 'USAGE'
  )
  and not has_function_privilege(
    'anon', 'public.apply_whatsapp_retention(integer)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.configure_whatsapp_retention_policy(text,integer,integer,integer,boolean)',
    'EXECUTE'
  ),
  'Política, sequência e RPCs de retenção ficam fora de anon/tenant'
);
select ok(
  has_function_privilege(
    'service_role', 'public.apply_whatsapp_retention(integer)', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.configure_whatsapp_retention_policy(text,integer,integer,integer,boolean)',
    'EXECUTE'
  ),
  'Service role executa configuração e lote de retenção'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_whatsapp_booking(uuid,uuid,uuid[],uuid,timestamptz,text,text,text,text,text,uuid,uuid,text)',
    'EXECUTE'
  ),
  'Usuário autenticado não cria reserva pelo gateway interno'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_whatsapp_booking(uuid,uuid,uuid[],uuid,timestamptz,text,text,text,text,text,uuid,uuid,text)',
    'EXECUTE'
  ),
  'Service role executa gateway de reserva'
);

-- Profissionais de outro tenant exercitam a permissão customizada de handoff.
insert into public.tenant_members (
  tenant_id, user_id, role, permissions, is_active, accepted_at
) values
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'professional', '{}', true, statement_timestamp()
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000003',
    'professional', '{"whatsapp_handoff":true}', true, statement_timestamp()
  )
on conflict (tenant_id, user_id) do update set
  role = excluded.role,
  permissions = excluded.permissions,
  is_active = excluded.is_active,
  accepted_at = excluded.accepted_at;

-- Defesa em profundidade: MATCH SIMPLE aceitaria tenant nulo no filho, mas a RLS
-- não pode projetar o acesso da conversa para uma linha com escopo divergente.
insert into public.whatsapp_handoffs (
  id, conversation_id, tenant_id, requested_by, reason, status,
  requested_at, accepted_at, resolved_at
) values (
  '99350000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000002',
  null,
  'automation',
  'fixture de tenant divergente',
  'resolved',
  '2026-07-31 10:00:00+00',
  '2026-07-31 10:01:00+00',
  '2026-07-31 10:02:00+00'
);

set local role service_role;
select ok(
  (
    select bool_and((rate_call.result ->> 'allowed')::boolean)
    from (
      select public.consume_whatsapp_webhook_rate_limit(
        'verify', repeat('8', 64) || left(item::text, 0)
      ) as result
      from generate_series(1, 20) item
    ) rate_call
  ),
  'Rate limit permite vinte verificações por chave em dez minutos'
);
select is(
  (
    public.consume_whatsapp_webhook_rate_limit('verify', repeat('8', 64))
      ->> 'allowed'
  )::boolean,
  false,
  'Rate limit bloqueia a vigésima primeira verificação'
);
select ok(
  (
    select bool_and((rate_call.result ->> 'allowed')::boolean)
    from (
      select public.consume_whatsapp_webhook_rate_limit(
        'receive', repeat('9', 64) || left(item::text, 0)
      ) as result
      from generate_series(1, 600) item
    ) rate_call
  ),
  'Rate limit permite o burst de seiscentos recebimentos por minuto'
);
select is(
  (
    public.consume_whatsapp_webhook_rate_limit('receive', repeat('9', 64))
      ->> 'allowed'
  )::boolean,
  false,
  'Rate limit bloqueia o recebimento seiscentos e um'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',
  true
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_phone_number_tenants
    where tenant_id = '20000000-0000-0000-0000-000000000001'
  ),
  1,
  'Owner vê vínculo de número do próprio tenant'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_phone_number_tenants
    where tenant_id = '20000000-0000-0000-0000-000000000002'
  ),
  0,
  'Owner não vê vínculo de outro tenant no número compartilhado'
);
select is(
  (select count(*)::integer from public.whatsapp_conversations where tenant_id is null),
  0,
  'Owner não vê conversa ainda sem tenant'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_conversations
    where tenant_id = '20000000-0000-0000-0000-000000000002'
  ),
  0,
  'Owner não vê conversa de outro tenant'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_messages
    where id in (
      '96000000-0000-4000-8000-000000000003',
      '96000000-0000-4000-8000-000000000004'
    )
  ),
  0,
  'Owner não vê mensagens sem tenant ou de outro tenant'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_handoffs
    where id = '99300000-0000-4000-8000-000000000001'
  ),
  0,
  'Owner não vê handoff de outro tenant'
);
select is(
  (select count(*)::integer from public.whatsapp_webhook_events),
  0,
  'Tenant owner não vê métricas operacionais globais do webhook'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{}}',
  true
);
select ok(
  exists (
    select 1 from public.whatsapp_handoffs
    where id = '99300000-0000-4000-8000-000000000001'
      and status = 'requested'
  ) and exists (
    select 1 from public.whatsapp_conversations
    where id = '95000000-0000-4000-8000-000000000002'
      and status = 'human_handoff'
  ) and not exists (
    select 1 from public.whatsapp_handoffs
    where id = '99350000-0000-4000-8000-000000000001'
  ),
  'Profissional com permissão customizada vê fila de handoff ainda não atribuída'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"platform_owner":true}}',
  true
);
select is(
  (select count(*)::integer from public.whatsapp_conversations where tenant_id is null),
  1,
  'Platform owner vê conversa sem tenant'
);
select is(
  (select count(*)::integer from public.whatsapp_webhook_events),
  3,
  'Platform owner lê colunas operacionais do webhook sem acesso ao payload'
);
reset role;

select is(
  (
    select count(*)::integer
    from public.whatsapp_phone_number_tenants
    where phone_number_id = '91000000-0000-4000-8000-000000000001'
      and routing_mode = 'shared'
      and status = 'active'
  ),
  3,
  'Número central compartilhado possui vários tenants'
);

select throws_ok(
  $$
    insert into public.whatsapp_phone_number_tenants (
      id, phone_number_id, tenant_id, routing_mode, status
    ) values (
      '99500000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      'direct',
      'active'
    )
  $$,
  '23505',
  null,
  'Número direto rejeita segundo tenant ativo'
);

insert into public.whatsapp_template_definitions (
  id, business_account_id, name, language, category, status, components
) values (
  '99530000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002',
  'cross_tenant_template_pgtap',
  'pt_BR',
  'utility',
  'local_draft',
  '[]'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',
  true
);
select throws_ok(
  $$
    insert into public.tenant_whatsapp_templates (
      id, tenant_id, template_definition_id, purpose, enabled
    ) values (
      '99530000-0000-4000-8000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      '99530000-0000-4000-8000-000000000001',
      'appointment_confirmed',
      true
    )
  $$,
  '23514',
  'invalid_whatsapp_template_business_account',
  'Tenant não associa template de WABA sem número vinculado'
);
reset role;

select throws_ok(
  $$
    insert into public.whatsapp_messages (
      id, conversation_id, tenant_id, provider, direction, message_type,
      provider_message_id, status
    ) values (
      '99500000-0000-4000-8000-000000000002',
      '95000000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'mock',
      'inbound',
      'text',
      'mock-inbound-001',
      'received'
    )
  $$,
  '23505',
  null,
  'Provider message ID duplicado é rejeitado'
);

select throws_ok(
  $$
    insert into public.whatsapp_webhook_events (
      id, provider, external_event_key, event_type, ordering_keys,
      signature_valid, payload
    ) values (
      '99500000-0000-4000-8000-000000000003',
      'mock',
      'mock-envelope-processed-001',
      'messages',
      array[repeat('d', 64)],
      true,
      '{}'
    )
  $$,
  '23505',
  null,
  'Envelope duplicado é rejeitado'
);

select throws_ok(
  $$
    insert into public.whatsapp_webhook_events (
      provider, external_event_key, event_type, ordering_keys,
      signature_valid, payload
    ) values (
      'mock', 'mock-invalid-ordering-key', 'messages',
      array['+5511999999999'], true, '{}'
    )
  $$,
  '23514',
  null,
  'Inbox rejeita chave de ordenação que exponha PII em claro'
);

select throws_ok(
  $$
    insert into public.whatsapp_webhook_events (
      provider, external_event_key, event_type, ordering_keys,
      signature_valid, payload
    )
    select
      'mock',
      'mock-too-many-ordering-keys',
      'messages',
      array_agg(encode(extensions.digest(convert_to(item::text, 'UTF8'), 'sha256'), 'hex')),
      true,
      '{}'
    from generate_series(1, 257) item
  $$,
  '23514',
  null,
  'Inbox limita cada envelope a 256 chaves opacas'
);

set local role service_role;
select is(
  (
    select tenant_id::text
    from public.consume_whatsapp_routing_code(
      '91000000-0000-4000-8000-000000000001',
      'BARB01',
      'mock:route-pgtap-001'
    )
  ),
  '20000000-0000-0000-0000-000000000001',
  'Código válido resolve tenant vinculado ao número'
);
select is(
  (
    select tenant_id::text
    from public.consume_whatsapp_routing_code(
      '91000000-0000-4000-8000-000000000001',
      'BARB01',
      'mock:route-pgtap-001'
    )
  ),
  '20000000-0000-0000-0000-000000000001',
  'Replay do mesmo inbound resolve o mesmo código'
);
select is(
  (
    select uses_count
    from public.whatsapp_routing_codes
    where id = '93000000-0000-4000-8000-000000000001'
  ),
  1,
  'Replay do código não incrementa uses_count novamente'
);
reset role;

insert into public.whatsapp_routing_codes (
  id, tenant_id, phone_number_id, code, type, source, status
) values (
  '99570000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'LOCK01',
  'campaign_code',
  'pgtap-routing-tombstone',
  'active'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',
  true
);
select lives_ok(
  $$
    update public.whatsapp_routing_codes
    set status = 'disabled'
    where id = '99570000-0000-4000-8000-000000000001'
  $$,
  'Owner desativa routing code por soft delete'
);
select throws_ok(
  $$
    update public.whatsapp_routing_codes
    set code = 'LOCK02'
    where id = '99570000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'Owner não altera código publicado'
);
select throws_ok(
  $$
    delete from public.whatsapp_routing_codes
    where id = '99570000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'Owner não remove tombstone de routing code'
);
select throws_ok(
  $$
    update public.whatsapp_routing_codes
    set status = 'active'
    where id = '99570000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'whatsapp_routing_code_reactivation_forbidden',
  'Owner não reativa routing code tombstonado'
);
reset role;

select throws_ok(
  $$
    update public.whatsapp_routing_codes
    set tenant_id = '20000000-0000-0000-0000-000000000002'
    where id = '99570000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'whatsapp_routing_code_identity_immutable',
  'Trigger impede troca privilegiada do tenant de routing code'
);
select throws_ok(
  $$
    delete from public.whatsapp_routing_codes
    where id = '99570000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'whatsapp_routing_code_delete_forbidden',
  'Trigger impede hard delete privilegiado de routing code'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{}}',
  true
);
select throws_ok(
  $$
    insert into public.whatsapp_routing_codes (
      id, tenant_id, phone_number_id, code, type, source, status
    ) values (
      '99570000-0000-4000-8000-000000000002',
      '20000000-0000-0000-0000-000000000002',
      '91000000-0000-4000-8000-000000000001',
      'LOCK01',
      'campaign_code',
      'pgtap-routing-reuse',
      'active'
    )
  $$,
  '23505',
  null,
  'Outro tenant não reaproveita código tombstonado no número compartilhado'
);
reset role;

select ok(
  (
    select tenant_id = '20000000-0000-0000-0000-000000000001'
      and phone_number_id = '91000000-0000-4000-8000-000000000001'
      and code = 'LOCK01'
      and status = 'disabled'
    from public.whatsapp_routing_codes
    where id = '99570000-0000-4000-8000-000000000001'
  ),
  'Tombstone conserva identidade e estado terminal do routing code'
);

insert into public.whatsapp_webhook_events (
  id, provider, external_event_key, event_type, correlation_id, ordering_keys,
  signature_valid, payload, received_at, next_attempt_at
) values
  (
    '99500000-0000-4000-8000-000000000004',
    'mock',
    'mock-pgtap-stream-a-head',
    'messages',
    '99510000-0000-4000-8000-000000000010',
    array[repeat('a', 64)],
    true,
    '{"fixture":"stream-a-head"}',
    '2000-01-01 00:00:00+00',
    '2000-01-01 00:00:00+00'
  ),
  (
    '99500000-0000-4000-8000-000000000005',
    'mock',
    'mock-pgtap-stream-b-head',
    'messages',
    '99510000-0000-4000-8000-000000000011',
    array[repeat('b', 64)],
    true,
    '{"fixture":"stream-b-head"}',
    '2001-01-01 00:00:00+00',
    '2001-01-01 00:00:00+00'
  ),
  (
    '99500000-0000-4000-8000-000000000006',
    'mock',
    'mock-pgtap-stream-a-next',
    'messages',
    '99510000-0000-4000-8000-000000000010',
    array[repeat('a', 64)],
    true,
    '{"fixture":"stream-a-next"}',
    '2002-01-01 00:00:00+00',
    '2002-01-01 00:00:00+00'
  );

set local role service_role;
select is(
  (
    select id::text
    from public.claim_whatsapp_webhook_events(1, 'pgtap-worker-a', 'mock')
  ),
  '99500000-0000-4000-8000-000000000004',
  'Worker reclama o head mais antigo'
);
select is(
  (
    select id::text
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-worker-b',
      'mock',
      '99510000-0000-4000-8000-000000000011'
    )
  ),
  '99500000-0000-4000-8000-000000000005',
  'Stream B avança enquanto stream A está em processamento'
);
select is(
  public.complete_whatsapp_webhook_event(
    '99500000-0000-4000-8000-000000000005',
    'pgtap-worker-b'
  ),
  true,
  'Worker de B conclui seu stream independente'
);
select is(
  (
    select count(*)::integer
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-worker-a-next',
      'mock',
      '99510000-0000-4000-8000-000000000010'
    )
  ),
  0,
  'Segundo envelope de A não ultrapassa o head em processamento'
);
select is(
  public.complete_whatsapp_webhook_event(
    '99500000-0000-4000-8000-000000000004',
    'pgtap-worker-b'
  ),
  false,
  'Worker diferente não conclui evento'
);
select is(
  public.defer_whatsapp_webhook_event(
    '99500000-0000-4000-8000-000000000004',
    'pgtap-worker-a',
    'mock_transient_error',
    true
  ),
  true,
  'Worker dono reagenda o envelope com backoff'
);
select is(
  (
    select count(*)::integer
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-worker-a-next',
      'mock',
      '99510000-0000-4000-8000-000000000010'
    )
  ),
  0,
  'Backoff do head bloqueia somente o mesmo stream'
);
update public.whatsapp_webhook_events
set next_attempt_at = '2000-01-01 00:00:00+00'
where id = '99500000-0000-4000-8000-000000000004';
select is(
  (
    select id::text
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-worker-a',
      'mock',
      '99510000-0000-4000-8000-000000000010'
    )
  ),
  '99500000-0000-4000-8000-000000000004',
  'Head volta a ser reclamado quando o backoff vence'
);
select is(
  public.complete_whatsapp_webhook_event(
    '99500000-0000-4000-8000-000000000004',
    'pgtap-worker-a'
  ),
  true,
  'Worker dono conclui evento'
);
select is(
  (
    select id::text
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-worker-a-next',
      'mock',
      '99510000-0000-4000-8000-000000000010'
    )
  ),
  '99500000-0000-4000-8000-000000000006',
  'Próximo envelope de A avança após concluir o head'
);
select is(
  public.complete_whatsapp_webhook_event(
    '99500000-0000-4000-8000-000000000006',
    'pgtap-worker-a-next'
  ),
  true,
  'Worker conclui o segundo envelope de A'
);
reset role;

insert into public.whatsapp_webhook_events (
  id, provider, external_event_key, event_type, correlation_id,
  ordering_keys, signature_valid, payload, received_at, next_attempt_at
) values
  (
    '99500000-0000-4000-8000-000000000007',
    'mock',
    'mock-pgtap-scoped-001',
    'messages',
    '99510000-0000-4000-8000-000000000001',
    array[repeat('4', 64)],
    true,
    '{"fixture":"scoped-a"}',
    '1990-01-01 00:00:00+00',
    '1990-01-01 00:00:00+00'
  ),
  (
    '99500000-0000-4000-8000-000000000008',
    'mock',
    'mock-pgtap-scoped-002',
    'messages',
    '99510000-0000-4000-8000-000000000002',
    array[repeat('5', 64)],
    true,
    '{"fixture":"scoped-b"}',
    '2001-01-01 00:00:00+00',
    '2001-01-01 00:00:00+00'
  );

set local role service_role;
select is(
  (
    select id::text
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-simulator-webhook',
      'mock',
      '99510000-0000-4000-8000-000000000001'
    )
  ),
  '99500000-0000-4000-8000-000000000007',
  'Claim do simulador captura somente a correlação informada'
);
select is(
  (
    select id::text
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-simulator-webhook-other',
      'mock',
      '99510000-0000-4000-8000-000000000002'
    )
  ),
  '99500000-0000-4000-8000-000000000008',
  'Outra correlação com stream independente avança em paralelo'
);
select ok(
  public.complete_whatsapp_webhook_event(
    '99500000-0000-4000-8000-000000000007',
    'pgtap-simulator-webhook'
  ) and public.complete_whatsapp_webhook_event(
    '99500000-0000-4000-8000-000000000008',
    'pgtap-simulator-webhook-other'
  ),
  'Workers concluem as duas correlações independentes'
);
reset role;

insert into public.whatsapp_webhook_events (
  id, provider, external_event_key, event_type, correlation_id, ordering_keys,
  ordering_global_fallback, signature_valid, payload, received_at, next_attempt_at
) values
  (
    '99500000-0000-4000-8000-000000000009',
    'mock',
    'mock-pgtap-global-fallback',
    'messages',
    '99510000-0000-4000-8000-000000000003',
    array[repeat('6', 64)],
    true,
    true,
    '{"fixture":"global-fallback"}',
    '1980-01-01 00:00:00+00',
    '1980-01-01 00:00:00+00'
  ),
  (
    '99500000-0000-4000-8000-000000000010',
    'mock',
    'mock-pgtap-after-global-fallback',
    'messages',
    '99510000-0000-4000-8000-000000000004',
    array[repeat('7', 64)],
    false,
    true,
    '{"fixture":"after-global-fallback"}',
    '1981-01-01 00:00:00+00',
    '1981-01-01 00:00:00+00'
  );

set local role service_role;
select is(
  (
    select id::text
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-fallback-worker',
      'mock',
      '99510000-0000-4000-8000-000000000003'
    )
  ),
  '99500000-0000-4000-8000-000000000009',
  'Worker reclama envelope com fallback global'
);
select is(
  (
    select count(*)::integer
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-after-fallback-worker',
      'mock',
      '99510000-0000-4000-8000-000000000004'
    )
  ),
  0,
  'Fallback global bloqueia outro stream do mesmo provider'
);
select ok(
  public.complete_whatsapp_webhook_event(
    '99500000-0000-4000-8000-000000000009',
    'pgtap-fallback-worker'
  ),
  'Worker conclui envelope com fallback global'
);
select is(
  (
    select id::text
    from public.claim_whatsapp_webhook_events_scoped(
      1,
      'pgtap-after-fallback-worker',
      'mock',
      '99510000-0000-4000-8000-000000000004'
    )
  ),
  '99500000-0000-4000-8000-000000000010',
  'Outro stream avança depois do fallback global'
);
select ok(
  public.complete_whatsapp_webhook_event(
    '99500000-0000-4000-8000-000000000010',
    'pgtap-after-fallback-worker'
  ),
  'Worker conclui stream liberado pelo fallback'
);
reset role;

insert into public.whatsapp_messages (
  id,
  conversation_id,
  tenant_id,
  provider,
  direction,
  message_type,
  idempotency_key,
  status,
  content,
  normalized_content
) values (
  '99500000-0000-4000-8000-000000000005',
  '95000000-0000-4000-8000-000000000003',
  null,
  'mock',
  'outbound',
  'text',
  'pgtap-outbox-message-001',
  'queued',
  '{"text":"Teste"}',
  '{"text":"Teste"}'
);
insert into public.whatsapp_outbox (
  id,
  tenant_id,
  phone_number_id,
  provider,
  conversation_id,
  message_id,
  recipient,
  message_kind,
  payload,
  scheduled_for,
  next_attempt_at
) values (
  '99500000-0000-4000-8000-000000000006',
  null,
  '91000000-0000-4000-8000-000000000001',
  'mock',
  '95000000-0000-4000-8000-000000000003',
  '99500000-0000-4000-8000-000000000005',
  '+551199990004',
  'text',
  '{"recipient":"+551199990004","response":{"kind":"text","body":"Teste"},"idempotencyKey":"pgtap-outbox-message-001","purpose":"conversation_reply"}',
  '2000-01-01 00:00:00+00',
  '2000-01-01 00:00:00+00'
);

set local role service_role;
select is(
  (select id::text from public.claim_whatsapp_outbox(1, 'pgtap-worker-a', 'mock')),
  '99500000-0000-4000-8000-000000000006',
  'Worker reclama item mais antigo da outbox'
);
select is(
  public.complete_whatsapp_outbox(
    '99500000-0000-4000-8000-000000000006',
    'pgtap-worker-b',
    'mock-pgtap-outbound-001'
  ),
  false,
  'Worker diferente não conclui outbox'
);
select is(
  public.apply_whatsapp_message_status(
    'mock', 'mock-pgtap-outbound-001', 'read', '2026-07-31 12:00:00+00', null
  ),
  true,
  'Status órfão é bufferizado antes da resposta HTTP do provider ser persistida'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_pending_message_statuses
    where provider = 'mock'
      and provider_message_id = 'mock-pgtap-outbound-001'
  ),
  1,
  'Buffer técnico deduplica status órfão por provider/message/status'
);
select is(
  public.complete_whatsapp_outbox(
    '99500000-0000-4000-8000-000000000006',
    'pgtap-worker-a',
    'mock-pgtap-outbound-001'
  ),
  true,
  'Worker dono conclui outbox'
);

select ok(
  public.apply_whatsapp_message_status(
    'mock', 'mock-pgtap-outbound-001', 'read', '2026-07-31 12:00:00+00', null
  ) and public.apply_whatsapp_message_status(
    'mock', 'mock-pgtap-outbound-001', 'delivered', '2026-07-31 11:59:00+00', null
  ) and public.apply_whatsapp_message_status(
    'mock', 'mock-pgtap-outbound-001', 'failed', '2026-07-31 12:01:00+00', 'late_failure'
  ) and public.apply_whatsapp_message_status(
    'mock', 'mock-pgtap-outbound-001', 'sent', '2026-07-31 11:58:00+00', null
  ),
  'Status webhook fora de ordem é aceito idempotentemente'
);
select ok(
  (
    select status = 'read'
      and sent_at is not null
      and delivered_at is not null
      and read_at is not null
      and failed_at is null
    from public.whatsapp_messages
    where id = '99500000-0000-4000-8000-000000000005'
  ),
  'Read não sofre downgrade por delivered, sent ou failed tardios'
);

insert into public.whatsapp_messages (
  id, conversation_id, tenant_id, provider, direction, message_type,
  idempotency_key, status, content, normalized_content
) values
  (
    '99500000-0000-4000-8000-000000000009',
    '95000000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'mock', 'outbound', 'text', 'pgtap-scoped-outbox-other', 'queued',
    '{"text":"Outro"}', '{"text":"Outro"}'
  ),
  (
    '99500000-0000-4000-8000-000000000010',
    '95000000-0000-4000-8000-000000000003',
    null,
    'mock', 'outbound', 'text', 'pgtap-scoped-outbox-target', 'queued',
    '{"text":"Alvo"}', '{"text":"Alvo"}'
  );

insert into public.whatsapp_outbox (
  id, tenant_id, phone_number_id, provider, conversation_id, message_id, recipient,
  message_kind, payload, scheduled_for, next_attempt_at
) values
  (
    '99500000-0000-4000-8000-000000000011',
    '20000000-0000-0000-0000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'mock',
    '95000000-0000-4000-8000-000000000001',
    '99500000-0000-4000-8000-000000000009',
    '+551199990001',
    'text',
    '{"recipient":"+551199990001","response":{"kind":"text","body":"Outro"},"idempotencyKey":"pgtap-scoped-outbox-other","purpose":"conversation_reply"}',
    '1970-01-01 00:00:00+00',
    '1970-01-01 00:00:00+00'
  ),
  (
    '99500000-0000-4000-8000-000000000012',
    null,
    '91000000-0000-4000-8000-000000000001',
    'mock',
    '95000000-0000-4000-8000-000000000003',
    '99500000-0000-4000-8000-000000000010',
    '+551199990004',
    'text',
    '{"recipient":"+551199990004","response":{"kind":"text","body":"Alvo"},"idempotencyKey":"pgtap-scoped-outbox-target","purpose":"conversation_reply"}',
    '1980-01-01 00:00:00+00',
    '1980-01-01 00:00:00+00'
  );

select is(
  (
    select id::text
    from public.claim_whatsapp_outbox_scoped(
      1,
      'pgtap-simulator-outbox',
      'mock',
      '95000000-0000-4000-8000-000000000003'
    )
  ),
  '99500000-0000-4000-8000-000000000012',
  'Claim de outbox do simulador captura somente a conversa informada'
);
select is(
  (
    select count(*)::integer
    from public.claim_whatsapp_outbox_scoped(
      1,
      'pgtap-simulator-outbox-second',
      'mock',
      '95000000-0000-4000-8000-000000000003'
    )
  ),
  0,
  'Segundo worker não ultrapassa o head da mesma conversa'
);
select is(
  (
    select status::text
    from public.whatsapp_outbox
    where id = '99500000-0000-4000-8000-000000000011'
  ),
  'pending',
  'Claim de outbox do simulador ignora item mais antigo de outra conversa'
);
-- Mutação e verificação ficam em statements separados: `ok()` sobre um `and` de
-- chamada + subconsulta não informa qual lado falhou, e a ordem de avaliação da
-- subconsulta em relação à função não é garantida.
select is(
  public.defer_whatsapp_outbox(
    '99500000-0000-4000-8000-000000000012',
    'pgtap-simulator-outbox',
    'mock_transient_error',
    true
  ),
  true,
  'Defer aceita o item reclamado pelo worker dono da lease'
);
select is(
  (
    select status::text || ':' || (next_attempt_at <= statement_timestamp())::text
    from public.whatsapp_outbox
    where id = '99500000-0000-4000-8000-000000000012'
  ),
  'retry:true',
  'Retry do provider mock volta a ficar due imediatamente'
);
select is(
  (
    select id::text
    from public.claim_whatsapp_outbox_scoped(
      1,
      'pgtap-simulator-outbox-ambiguous',
      'mock',
      '95000000-0000-4000-8000-000000000003'
    )
  ),
  '99500000-0000-4000-8000-000000000012',
  'Item em retry é reclamado de novo pelo worker do simulador'
);
select is(
  public.mark_whatsapp_outbox_delivery_ambiguous(
    '99500000-0000-4000-8000-000000000012',
    'pgtap-simulator-outbox-ambiguous',
    null,
    'network_timeout_after_post'
  ),
  true,
  'Entrega ambígua é registrada pelo worker dono da lease'
);
select is(
  (
    select status::text || ':' || coalesce(provider_message_id, 'null')
    from public.whatsapp_outbox
    where id = '99500000-0000-4000-8000-000000000012'
  ),
  'dead_letter:null',
  'Entrega ambígua sem ID externo vai para reconciliação sem reenvio'
);

insert into public.whatsapp_messages (
  id, conversation_id, tenant_id, provider, direction, message_type,
  idempotency_key, status, content, normalized_content
) values
  (
    '99500000-0000-4000-8000-000000000013',
    '95000000-0000-4000-8000-000000000003', null,
    'mock', 'outbound', 'text', 'pgtap-exhausted-outbox-message', 'queued',
    '{"text":"Oitava tentativa"}', '{"text":"Oitava tentativa"}'
  ),
  (
    '99500000-0000-4000-8000-000000000014',
    '95000000-0000-4000-8000-000000000003', null,
    'mock', 'outbound', 'text', 'pgtap-after-exhausted-message', 'queued',
    '{"text":"Depois da oitava"}', '{"text":"Depois da oitava"}'
  );
insert into public.whatsapp_outbox (
  id, tenant_id, phone_number_id, provider, conversation_id, message_id,
  recipient, message_kind, payload, scheduled_for, status, attempt_count,
  next_attempt_at, locked_at, locked_until, locked_by
) values
  (
    '99500000-0000-4000-8000-000000000015', null,
    '91000000-0000-4000-8000-000000000001', 'mock',
    '95000000-0000-4000-8000-000000000003',
    '99500000-0000-4000-8000-000000000013', '+551199990004', 'text',
    '{"recipient":"+551199990004","response":{"kind":"text","body":"Oitava"},"idempotencyKey":"pgtap-exhausted-outbox-message","purpose":"conversation_reply"}',
    '1989-01-01', 'processing', 8, '1989-01-01',
    '1989-01-01', '1989-01-02', 'pgtap-worker-crashed'
  ),
  (
    '99500000-0000-4000-8000-000000000016', null,
    '91000000-0000-4000-8000-000000000001', 'mock',
    '95000000-0000-4000-8000-000000000003',
    '99500000-0000-4000-8000-000000000014', '+551199990004', 'text',
    '{"recipient":"+551199990004","response":{"kind":"text","body":"Depois"},"idempotencyKey":"pgtap-after-exhausted-message","purpose":"conversation_reply"}',
    '1990-01-01', 'pending', 0, '1990-01-01', null, null, null
  );

select is(
  (
    select id::text
    from public.claim_whatsapp_outbox_scoped(
      1, 'pgtap-after-exhausted-worker', 'mock',
      '95000000-0000-4000-8000-000000000003'
    )
  ),
  '99500000-0000-4000-8000-000000000016',
  'Claim libera o HoL depois de exaurir lease vencida da oitava tentativa'
);
select ok(
  (
    select status = 'dead_letter'
      and locked_by is null
      and last_error = 'attempts_exhausted'
    from public.whatsapp_outbox
    where id = '99500000-0000-4000-8000-000000000015'
  ) and (
    select status = 'failed'
      and error_code = 'attempts_exhausted'
      and failed_at is not null
    from public.whatsapp_messages
    where id = '99500000-0000-4000-8000-000000000013'
  ),
  'Sweep atômico marca outbox e mensagem quando a oitava tentativa expira'
);
select ok(
  public.defer_whatsapp_outbox(
    '99500000-0000-4000-8000-000000000016',
    'pgtap-after-exhausted-worker',
    'fixture_complete',
    false
  ),
  'Fixture sucessora é encerrada sem bloquear testes seguintes'
);

select is(
  public.commit_whatsapp_conversation_transition(
    '95000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001',
    2,
    'STAFF_SELECTION',
    'waiting_customer',
    '20000000-0000-0000-0000-000000000001',
    '{"selectedServiceId":"41000000-0000-0000-0000-000000000001"}',
    '[{"idempotency_key":"pgtap-transition-response-001","message_type":"text","content":{"text":"Escolha o profissional"},"payload":{"kind":"text","body":"Escolha o profissional"}}]',
    '+551199990001'
  ),
  true,
  'Transição otimista é concluída'
);
select is(
  (
    select version::integer
    from public.whatsapp_conversations
    where id = '95000000-0000-4000-8000-000000000001'
  ),
  3,
  'Transição incrementa versão'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_messages message
    join public.whatsapp_outbox item on item.message_id = message.id
    where message.conversation_id = '95000000-0000-4000-8000-000000000001'
      and message.idempotency_key = 'pgtap-transition-response-001'
      and item.payload ->> 'purpose' = 'conversation_reply'
  ),
  1,
  'Transição grava mensagem e outbox atomicamente'
);
select is(
  (
    select (processed_at is not null)::text
    from public.whatsapp_messages
    where id = '96000000-0000-4000-8000-000000000001'
  ),
  'true',
  'Commit marca o inbound como processado na mesma transação'
);
select is(
  public.commit_whatsapp_conversation_transition(
    '95000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001',
    3,
    'STAFF_SELECTION',
    'waiting_customer',
    '20000000-0000-0000-0000-000000000001',
    '{}',
    '[]',
    '+551199990001'
  ),
  false,
  'Replay do mesmo inbound não repete transição mesmo com versão atual'
);

insert into public.whatsapp_messages (
  id, conversation_id, tenant_id, provider, direction, message_type,
  idempotency_key, status, content, normalized_content
) values
  (
    '99500000-0000-4000-8000-000000000017',
    '95000000-0000-4000-8000-000000000003', null,
    'mock', 'outbound', 'text', 'pgtap-handoff-old-pending', 'queued',
    '{"text":"Resposta antiga pendente"}', '{"text":"Resposta antiga pendente"}'
  ),
  (
    '99500000-0000-4000-8000-000000000018',
    '95000000-0000-4000-8000-000000000003', null,
    'mock', 'outbound', 'text', 'pgtap-handoff-old-processing', 'queued',
    '{"text":"Resposta antiga reclamada"}', '{"text":"Resposta antiga reclamada"}'
  );
insert into public.whatsapp_outbox (
  id, tenant_id, phone_number_id, provider, conversation_id, message_id,
  recipient, message_kind, payload, scheduled_for, status, attempt_count,
  next_attempt_at, locked_at, locked_until, locked_by
) values
  (
    '99500000-0000-4000-8000-000000000019', null,
    '91000000-0000-4000-8000-000000000001', 'mock',
    '95000000-0000-4000-8000-000000000003',
    '99500000-0000-4000-8000-000000000017', '+551199990004', 'text',
    '{"recipient":"+551199990004","response":{"kind":"text","body":"Pendente"},"idempotencyKey":"pgtap-handoff-old-pending","purpose":"conversation_reply"}',
    '1991-01-01', 'pending', 0, '1991-01-01', null, null, null
  ),
  (
    '99500000-0000-4000-8000-000000000020', null,
    '91000000-0000-4000-8000-000000000001', 'mock',
    '95000000-0000-4000-8000-000000000003',
    '99500000-0000-4000-8000-000000000018', '+551199990004', 'text',
    '{"recipient":"+551199990004","response":{"kind":"text","body":"Reclamada"},"idempotencyKey":"pgtap-handoff-old-processing","purpose":"conversation_reply"}',
    '1992-01-01', 'processing', 1, '1992-01-01',
    statement_timestamp(), statement_timestamp() + interval '5 minutes',
    'pgtap-handoff-race-worker'
  );

select ok(
  (
    select not inbound.duplicate and not inbound.processed and not inbound.stale
    from public.record_whatsapp_inbound_message(
      'mock',
      'mock-pgtap-handoff-inbound-001',
      '95000000-0000-4000-8000-000000000003',
      'text',
      'Quero falar com uma pessoa',
      null,
      statement_timestamp()
    ) inbound
  ),
  'RPC inbound persiste mensagem e janela de serviço atomicamente'
);

select throws_ok(
  $$
    select public.commit_whatsapp_conversation_transition(
      '95000000-0000-4000-8000-000000000003',
      (
        select id from public.whatsapp_messages
        where provider = 'mock'
          and provider_message_id = 'mock-pgtap-handoff-inbound-001'
      ),
      1,
      'HUMAN_HANDOFF',
      'human_handoff',
      null,
      '{"handoff":{"requestedBy":"customer","reason":"customer_request"}}',
      '[{"idempotency_key":"pgtap-handoff-response-fenced","message_type":"text","content":{"text":"Vou chamar o suporte"},"payload":{"kind":"text","body":"Vou chamar o suporte"}}]',
      '+551199990004'
    )
  $$,
  '55P03',
  'whatsapp_outbox_dispatch_in_progress',
  'Handoff aguarda resposta já reclamada sob lease válida'
);
-- Expira a lease sem violar whatsapp_outbox_lock_check, que exige
-- locked_until > locked_at: as duas pontas recuam juntas.
update public.whatsapp_outbox
set locked_at = statement_timestamp() - interval '10 minutes',
    locked_until = statement_timestamp() - interval '1 second'
where id = '99500000-0000-4000-8000-000000000020';
select is(
  public.commit_whatsapp_conversation_transition(
    '95000000-0000-4000-8000-000000000003',
    (
      select id from public.whatsapp_messages
      where provider = 'mock'
        and provider_message_id = 'mock-pgtap-handoff-inbound-001'
    ),
    1,
    'HUMAN_HANDOFF',
    'human_handoff',
    null,
    '{"handoff":{"requestedBy":"customer","reason":"customer_request"}}',
    '[{"idempotency_key":"pgtap-handoff-response-001","message_type":"text","content":{"text":"Vou chamar o suporte"},"payload":{"kind":"text","body":"Vou chamar o suporte"}}]',
    '+551199990004'
  ),
  true,
  'Commit de handoff não perde o inbound nem conflita a própria versão'
);
select ok(
  (
    select status = 'cancelled'
      and last_error = 'conversation_handoff_requested'
    from public.whatsapp_outbox
    where id = '99500000-0000-4000-8000-000000000019'
  ) and (
    select status = 'ignored'
      and error_code = 'conversation_handoff_requested'
    from public.whatsapp_messages
    where id = '99500000-0000-4000-8000-000000000017'
  ) and (
    select count(*) = 1
    from public.whatsapp_outbox item
    join public.whatsapp_messages message on message.id = item.message_id
    where item.conversation_id = '95000000-0000-4000-8000-000000000003'
      and item.status = 'pending'
      and item.payload ->> 'purpose' = 'handoff_acknowledgement'
      and message.idempotency_key = 'pgtap-handoff-response-001'
  ),
  'Entrada em handoff cancela backlog pendente e cria somente o ACK allowlisted'
);
update public.whatsapp_outbox
set locked_until = statement_timestamp() + interval '5 minutes'
where id = '99500000-0000-4000-8000-000000000020';
select is(
  public.validate_whatsapp_outbox_delivery(
    '99500000-0000-4000-8000-000000000020',
    'pgtap-handoff-race-worker'
  ),
  false,
  'Validação cancela conversation_reply já reclamada após entrada em handoff'
);
select ok(
  (
    select status = 'cancelled'
    from public.whatsapp_outbox
    where id = '99500000-0000-4000-8000-000000000020'
  ) and (
    select status = 'ignored'
      and error_code = 'conversation_delivery_invalidated'
    from public.whatsapp_messages
    where id = '99500000-0000-4000-8000-000000000018'
  ),
  'Corrida de handoff não deixa resposta conversacional antiga enviável'
);
select is(
  (
    select message.idempotency_key
    from public.claim_whatsapp_outbox_scoped(
      1,
      'pgtap-handoff-ack-worker',
      'mock',
      '95000000-0000-4000-8000-000000000003'
    ) item
    join public.whatsapp_messages message on message.id = item.message_id
  ),
  'pgtap-handoff-response-001',
  'Depois da limpeza, somente o ACK do handoff é reclamável'
);
select is(
  (
    select public.validate_whatsapp_outbox_delivery(item.id, 'pgtap-handoff-ack-worker')
    from public.whatsapp_outbox item
    join public.whatsapp_messages message on message.id = item.message_id
    where message.idempotency_key = 'pgtap-handoff-response-001'
  ),
  true,
  'ACK allowlisted continua válido durante human_handoff'
);
select ok(
  (
    select public.complete_whatsapp_outbox(
      item.id,
      'pgtap-handoff-ack-worker',
      'mock-pgtap-handoff-ack-001'
    )
    from public.whatsapp_outbox item
    join public.whatsapp_messages message on message.id = item.message_id
    where message.idempotency_key = 'pgtap-handoff-response-001'
  ),
  'ACK é concluído e não interfere no teste de assunção'
);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role","app_metadata":{}}',
  true
);
select throws_ok(
  $$
    select public.accept_whatsapp_handoff(
      (
        select id from public.whatsapp_handoffs
        where conversation_id = '95000000-0000-4000-8000-000000000003'
      )
    )
  $$,
  '22023',
  'whatsapp_handoff_actor_required',
  'Service role sem identidade humana não assume handoff'
);
select throws_ok(
  $$
    select public.resolve_whatsapp_handoff(
      (
        select id from public.whatsapp_handoffs
        where conversation_id = '95000000-0000-4000-8000-000000000003'
      ),
      'Não pode pular assunção',
      true
    )
  $$,
  '22023',
  'whatsapp_handoff_not_accepted',
  'Resolução não pula a etapa auditável de assunção'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',
  true
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_handoffs
    where conversation_id = '95000000-0000-4000-8000-000000000003'
  ),
  0,
  'Tenant owner não vê handoff de plataforma sem tenant'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"platform_owner":true}}',
  true
);
select public.accept_whatsapp_handoff(
  (
    select id from public.whatsapp_handoffs
    where conversation_id = '95000000-0000-4000-8000-000000000003'
  )
);
select ok(
  public.accept_whatsapp_handoff(
    (
      select id from public.whatsapp_handoffs
      where conversation_id = '95000000-0000-4000-8000-000000000003'
    )
  ) and (
    select status = 'accepted'
      and assigned_user_id = '10000000-0000-0000-0000-000000000001'
    from public.whatsapp_handoffs
    where conversation_id = '95000000-0000-4000-8000-000000000003'
  ) and (
    select assigned_user_id = '10000000-0000-0000-0000-000000000001'
    from public.whatsapp_conversations
    where id = '95000000-0000-4000-8000-000000000003'
  ),
  'Platform owner assume handoff de plataforma e atribui a conversa atomicamente'
);
-- Mutação e verificação em statements separados: dentro de um único `and`, a
-- subconsulta não-correlacionada é planejada como InitPlan e pode ler o estado
-- anterior à chamada da função.
select is(
  (
    select count(*)::integer
    from public.whatsapp_handoffs
    where conversation_id = '95000000-0000-4000-8000-000000000003'
  ),
  1,
  'Conversa sem tenant tem exatamente um handoff aberto'
);
select is(
  public.resolve_whatsapp_handoff(
    (
      select id from public.whatsapp_handoffs
      where conversation_id = '95000000-0000-4000-8000-000000000003'
    ),
    'Resolvido pela plataforma',
    true
  ),
  true,
  'Platform owner resolve handoff sem tenant'
);
select is(
  (
    select current_state || ':' || status::text
    from public.whatsapp_conversations
    where id = '95000000-0000-4000-8000-000000000003'
  ),
  'TENANT_SEARCH:waiting_customer',
  'Somente platform owner lê e resolve handoff sem tenant'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',
  true
);
select throws_ok(
  $$select public.accept_whatsapp_handoff('99300000-0000-4000-8000-000000000001')$$,
  '42501',
  'insufficient_permission',
  'Profissional sem permissão não assume handoff de outro tenant'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{}}',
  true
);
select public.accept_whatsapp_handoff(
  '99300000-0000-4000-8000-000000000001'
);
select ok(
  public.accept_whatsapp_handoff('99300000-0000-4000-8000-000000000001')
  and (
    select status = 'accepted'
      and assigned_user_id = '10000000-0000-0000-0000-000000000003'
      and accepted_at is not null
    from public.whatsapp_handoffs
    where id = '99300000-0000-4000-8000-000000000001'
  ) and (
    select assigned_user_id = '10000000-0000-0000-0000-000000000003'
    from public.whatsapp_conversations
    where id = '95000000-0000-4000-8000-000000000002'
  ),
  'Profissional autorizado assume uma vez; replay do mesmo responsável é idempotente'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{}}',
  true
);
select throws_ok(
  $$select public.accept_whatsapp_handoff('99300000-0000-4000-8000-000000000001')$$,
  '40001',
  'whatsapp_handoff_already_assigned',
  'Lock impede segundo responsável de vencer a corrida de assunção'
);
reset role;

set local role service_role;
select * from public.record_whatsapp_inbound_message(
  'mock',
  'mock-pgtap-switch-inbound-001',
  '95000000-0000-4000-8000-000000000001',
  'text',
  'Quero o código SALA01',
  null,
  statement_timestamp()
);
select is(
  (
    select restarted.tenant_id is null
      and restarted.current_state = 'TENANT_CONFIRMATION'
      and restarted.context ->> 'restartReason' = 'tenant_change'
    from public.commit_whatsapp_conversation_restart(
      '95000000-0000-4000-8000-000000000001',
      (
        select id from public.whatsapp_messages
        where provider = 'mock'
          and provider_message_id = 'mock-pgtap-switch-inbound-001'
      ),
      3,
      'tenant_change',
      'TENANT_CONFIRMATION',
      'waiting_customer',
      null,
      '{"pendingTenantId":"20000000-0000-0000-0000-000000000002","routingCode":"SALA01"}',
      '[{"idempotency_key":"pgtap-switch-response-001","message_type":"text","content":{"text":"Encontramos o Salão da Ana. Digite 1 para confirmar."},"payload":{"kind":"text","body":"Encontramos o Salão da Ana. Digite 1 para confirmar."}}]',
      '+551199990001'
    ) restarted
  ),
  true,
  'Restart por código de outro tenant devolve conversa de plataforma'
);
select is(
  (
    select status::text
    from public.whatsapp_conversations
    where id = '95000000-0000-4000-8000-000000000001'
  ),
  'closed',
  'Código de outro tenant reinicia em conversa de plataforma antes da confirmação'
);
select ok(
  not exists (
    select 1
    from public.whatsapp_outbox
    where conversation_id = '95000000-0000-4000-8000-000000000001'
      and status in ('pending', 'retry')
  ) and exists (
    select 1
    from public.whatsapp_messages
    where conversation_id = '95000000-0000-4000-8000-000000000001'
      and status = 'ignored'
      and error_code = 'conversation_restarted'
  ),
  'Troca cancela somente o backlog ainda não reclamado da conversa antiga'
);

select ok(
  (
    select message.tenant_id is null
      and conversation.tenant_id is null
      and message.conversation_id = conversation.id
      and conversation.context ->> 'pendingTenantId' =
        '20000000-0000-0000-0000-000000000002'
    from public.whatsapp_messages message
    join public.whatsapp_conversations conversation
      on conversation.id = message.conversation_id
    where message.provider = 'mock'
      and message.provider_message_id = 'mock-pgtap-switch-inbound-001'
  ) and exists (
    select 1
    from public.whatsapp_messages
    where provider = 'mock'
      and provider_message_id = 'mock-inbound-001'
      and tenant_id = '20000000-0000-0000-0000-000000000001'
      and conversation_id = '95000000-0000-4000-8000-000000000001'
  ),
  'Somente o inbound com código migra para plataforma; histórico de A permanece em A'
);
select is(
  (
    select stale::text
    from public.record_whatsapp_inbound_message(
      'mock',
      'mock-pgtap-stale-after-restart-001',
      (
        select id from public.whatsapp_conversations
        where context ->> 'previousConversationId' =
          '95000000-0000-4000-8000-000000000001'
          and context ->> 'restartReason' = 'tenant_change'
        order by created_at desc
        limit 1
      ),
      'text',
      'Evento antigo ainda de A',
      null,
      '2000-01-01'
    )
  ),
  'true',
  'Sucessora herda watermark do inbound decisor e reconhece atraso logo após restart'
);
select ok(
  (
    select conversation.tenant_id is null
      and conversation.current_state = 'TENANT_CONFIRMATION'
      and conversation.last_inbound_at >= decision.sent_at
    from public.whatsapp_conversations conversation
    join public.whatsapp_messages decision
      on decision.provider_message_id = 'mock-pgtap-switch-inbound-001'
    where conversation.context ->> 'previousConversationId' =
      '95000000-0000-4000-8000-000000000001'
      and conversation.context ->> 'restartReason' = 'tenant_change'
  ) and (
    select tenant_id is null and content ->> 'text' = 'Evento antigo ainda de A'
    from public.whatsapp_messages
    where provider_message_id = 'mock-pgtap-stale-after-restart-001'
  ),
  'Evento atrasado permanece no ledger interno e não altera tenant ou fluxo'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',
  true
);
select ok(
  not exists (
    select 1 from public.whatsapp_messages
    where provider_message_id = 'mock-pgtap-switch-inbound-001'
  ) and not exists (
    select 1 from public.whatsapp_conversations
    where context ->> 'pendingTenantId' =
      '20000000-0000-0000-0000-000000000002'
  ),
  'Tenant A não vê código nem contexto de B antes da confirmação'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated","app_metadata":{"platform_owner":true}}',
  true
);
select ok(
  exists (
    select 1 from public.whatsapp_messages
    where provider_message_id = 'mock-pgtap-switch-inbound-001'
      and tenant_id is null
  ) and exists (
    select 1 from public.whatsapp_conversations
    where tenant_id is null
      and context ->> 'pendingTenantId' =
        '20000000-0000-0000-0000-000000000002'
  ),
  'Platform owner acompanha a confirmação enquanto o tenant está pendente'
);
reset role;

set local role service_role;

select * from public.record_whatsapp_inbound_message(
  'mock',
  'mock-pgtap-select-tenant-002',
  (
    select id
    from public.whatsapp_conversations
    where context ->> 'previousConversationId' = '95000000-0000-4000-8000-000000000001'
      and context ->> 'restartReason' = 'tenant_change'
    order by created_at desc
    limit 1
  ),
  'text',
  'Salão da Ana',
  null,
  statement_timestamp()
);
select is(
  public.commit_whatsapp_conversation_transition(
    (
      select id
      from public.whatsapp_conversations
      where context ->> 'previousConversationId' = '95000000-0000-4000-8000-000000000001'
        and context ->> 'restartReason' = 'tenant_change'
      order by created_at desc
      limit 1
    ),
    (
      select id
      from public.whatsapp_messages
      where provider = 'mock'
        and provider_message_id = 'mock-pgtap-select-tenant-002'
    ),
    (
      select version
      from public.whatsapp_conversations
      where context ->> 'previousConversationId' = '95000000-0000-4000-8000-000000000001'
        and context ->> 'restartReason' = 'tenant_change'
      order by created_at desc
      limit 1
    ),
    'SERVICE_SELECTION',
    'waiting_customer',
    '20000000-0000-0000-0000-000000000002',
    '{"selectedTenantSource":"tenant_search"}',
    '[{"idempotency_key":"pgtap-tenant-selected-response-002","message_type":"text","content":{"text":"Qual serviço você deseja?"},"payload":{"kind":"text","body":"Qual serviço você deseja?"}}]',
    '+551199990001'
  ),
  true,
  'Transição atribui tenant à conversa reiniciada'
);
select ok(
  (
    select message.tenant_id = '20000000-0000-0000-0000-000000000002'
      and message.conversation_id = conversation.id
    from public.whatsapp_messages message
    join public.whatsapp_conversations conversation
      on conversation.id = message.conversation_id
    where message.provider = 'mock'
      and message.provider_message_id = 'mock-pgtap-select-tenant-002'
      and conversation.tenant_id = '20000000-0000-0000-0000-000000000002'
  ) and (
    select message.tenant_id is null
      and conversation.tenant_id = '20000000-0000-0000-0000-000000000002'
    from public.whatsapp_messages message
    join public.whatsapp_conversations conversation
      on conversation.id = message.conversation_id
    where message.provider = 'mock'
      and message.provider_message_id = 'mock-pgtap-switch-inbound-001'
  ) and exists (
    select 1
    from public.whatsapp_messages
    where provider = 'mock'
      and provider_message_id = 'mock-inbound-001'
      and tenant_id = '20000000-0000-0000-0000-000000000001'
      and conversation_id = '95000000-0000-4000-8000-000000000001'
  ),
  'Confirmação atribui B só ao inbound atual e preserva isolamento do código/histórico'
);
select is(
  (
    select stale::text
    from public.record_whatsapp_inbound_message(
      'mock',
      'mock-pgtap-delayed-from-tenant-a-001',
      -- A transição de confirmação substitui o contexto inteiro, então a linhagem
      -- do restart já não está lá. A sucessora é localizada pela identidade estável
      -- de telefone receptor e contato, que o restart preserva.
      (
        select successor.id
        from public.whatsapp_conversations successor
        join public.whatsapp_conversations origin
          on origin.phone_number_id = successor.phone_number_id
         and origin.contact_id = successor.contact_id
        where origin.id = '95000000-0000-4000-8000-000000000001'
          and successor.id <> origin.id
        order by successor.created_at desc
        limit 1
      ),
      'text',
      'Conteúdo tardio pertencente ao tenant A',
      null,
      '2000-01-02'
    )
  ),
  'true',
  'Inbound anterior ao watermark continua stale depois da atribuição ao tenant B'
);
select ok(
  (
    select message.tenant_id is null
      and conversation.tenant_id = '20000000-0000-0000-0000-000000000002'
      and conversation.current_state = 'SERVICE_SELECTION'
    from public.whatsapp_messages message
    join public.whatsapp_conversations conversation
      on conversation.id = message.conversation_id
    where message.provider_message_id = 'mock-pgtap-delayed-from-tenant-a-001'
  ),
  'Stale cross-tenant fica sem tenant e não modifica o estado de B'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',
  true
);
select ok(
  exists (
    select 1 from public.whatsapp_messages
    where provider_message_id = 'mock-inbound-001'
  ) and not exists (
    select 1 from public.whatsapp_messages
    where provider_message_id = 'mock-pgtap-switch-inbound-001'
  ) and not exists (
    select 1 from public.whatsapp_messages
    where provider_message_id = 'mock-pgtap-select-tenant-002'
  ) and not exists (
    select 1 from public.whatsapp_conversations
    where tenant_id = '20000000-0000-0000-0000-000000000002'
  ),
  'Tenant A não vê código, confirmação ou contexto de B depois da troca'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{}}',
  true
);
select ok(
  not exists (
    select 1 from public.whatsapp_messages
    where provider_message_id = 'mock-pgtap-switch-inbound-001'
  ) and exists (
    select 1 from public.whatsapp_messages
    where provider_message_id = 'mock-pgtap-select-tenant-002'
  ) and not exists (
    select 1 from public.whatsapp_messages
    where idempotency_key = 'pgtap-switch-response-001'
  ) and not exists (
    select 1 from public.whatsapp_messages
    where provider_message_id in (
      'mock-pgtap-stale-after-restart-001',
      'mock-pgtap-delayed-from-tenant-a-001'
    )
  ),
  'Tenant B não vê código, resposta nem conteúdo stale pertencente ao tenant A'
);
reset role;

set local role service_role;
update public.whatsapp_conversations
set session_expires_at = statement_timestamp() - interval '1 minute'
where phone_number_id = '91000000-0000-4000-8000-000000000001'
  and contact_id = '94000000-0000-4000-8000-000000000001'
  and status in ('open', 'waiting_customer', 'processing', 'human_handoff');
select ok(
  (
    select expired.tenant_id is null
      and expired.current_state = 'START'
      and expired.context ->> 'restartReason' = 'session_expired'
      and (select count(*) from jsonb_object_keys(expired.context)) = 2
    from public.expire_whatsapp_conversation(
      (
        select id
        from public.whatsapp_conversations
        where phone_number_id = '91000000-0000-4000-8000-000000000001'
          and contact_id = '94000000-0000-4000-8000-000000000001'
          and status in ('open', 'waiting_customer', 'processing', 'human_handoff')
      )
    ) expired
  ),
  'Sessão expirada cria contexto START limpo sem tenant'
);
select ok(
  not exists (
    select 1
    from public.whatsapp_outbox item
    join public.whatsapp_conversations conversation on conversation.id = item.conversation_id
    where conversation.phone_number_id = '91000000-0000-4000-8000-000000000001'
      and conversation.contact_id = '94000000-0000-4000-8000-000000000001'
      and conversation.status = 'expired'
      and item.status in ('pending', 'retry')
  ) and exists (
    select 1
    from public.whatsapp_messages message
    join public.whatsapp_conversations conversation on conversation.id = message.conversation_id
    where conversation.phone_number_id = '91000000-0000-4000-8000-000000000001'
      and conversation.contact_id = '94000000-0000-4000-8000-000000000001'
      and conversation.status = 'expired'
      and message.status = 'ignored'
      and message.error_code = 'conversation_session_expired'
  ),
  'Expiração invalida respostas pendentes sem tocar envios já reclamados'
);
select ok(
  (
    select duplicate.conversation_id = '95000000-0000-4000-8000-000000000001'
      and duplicate.conversation_status = 'closed'
      and duplicate.processed
    from public.find_whatsapp_inbound_message('mock', 'mock-inbound-001') duplicate
  ),
  'Preflight de replay encontra a conversa original concluída antes de criar sessão'
);
reset role;

-- Este bloco manipula e inspeciona tabelas do núcleo como fixture: escreve em
-- appointments e lê outbox_events, coisas que produção nunca faz por service_role,
-- já que toda escrita passa por função security definer e a outbox só é lida via
-- claim_outbox_events. Roda no papel da sessão; a cobertura de autorização do canal
-- está nas seções `authenticated` e `anon`.
update public.tenant_whatsapp_settings
set preferred_phone_number_id = null
where tenant_id = '20000000-0000-0000-0000-000000000001';

select ok(
  public.record_web_whatsapp_opt_in(
    '20000000-0000-0000-0000-000000000001',
    '+551199990002',
    'transactional',
    'pgtap-v1',
    '{"source":"pgtap-tenant-1"}'
  ) and public.record_web_whatsapp_opt_in(
    '20000000-0000-0000-0000-000000000002',
    '+551199990002',
    'transactional',
    'pgtap-v1',
    '{"source":"pgtap-tenant-2"}'
  ),
  'Opt-in usa fallback de número ativo e pode ser concedido por tenant'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_opt_ins
    where contact_id = '94000000-0000-4000-8000-000000000002'
      and category = 'transactional'
      and status = 'granted'
      and superseded_at is null
  ),
  2,
  'Consentimento atual permanece isolado por tenant'
);
select is(
  public.record_whatsapp_opt_out(
    '94000000-0000-4000-8000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'mock-optout-pgtap-001'
  ),
  true,
  'Opt-out é registrado pelo tenant correto'
);
select ok(
  (
    select status = 'granted'
    from public.whatsapp_opt_ins
    where contact_id = '94000000-0000-4000-8000-000000000002'
      and tenant_id = '20000000-0000-0000-0000-000000000001'
      and category = 'transactional'
      and superseded_at is null
  ) and (
    select status = 'revoked'
    from public.whatsapp_opt_ins
    where contact_id = '94000000-0000-4000-8000-000000000002'
      and tenant_id = '20000000-0000-0000-0000-000000000002'
      and category = 'transactional'
      and superseded_at is null
  ) and (
    select count(*) = 2
    from public.whatsapp_opt_ins
    where contact_id = '94000000-0000-4000-8000-000000000002'
      and tenant_id = '20000000-0000-0000-0000-000000000002'
      and category = 'transactional'
  ),
  'Opt-out preserva o grant histórico e não revoga outro tenant'
);

select ok(
  (
    select contact.customer_id = '70000000-0000-0000-0000-000000000002'
    from public.upsert_whatsapp_contact(
      'mock', '551199990002', '+551199990002', 'Luiza Atualizada'
    ) contact
  ),
  'Upsert de contato associa customer existente pelo telefone E.164'
);
select throws_ok(
  $$
    select *
    from public.resolve_whatsapp_customer_tenant(
      '95000000-0000-4000-8000-000000000002',
      '94000000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      'Contato incorreto'
    )
  $$,
  'P0002',
  'whatsapp_tenant_context_not_found',
  'Resolução rejeita contato que não pertence à conversa informada'
);
select ok(
  (
    select resolved.customer_id = '70000000-0000-0000-0000-000000000002'
      and resolved.customer_tenant_id is not null
    from public.resolve_whatsapp_customer_tenant(
      '95000000-0000-4000-8000-000000000002',
      '94000000-0000-4000-8000-000000000002',
      '20000000-0000-0000-0000-000000000002',
      'Luiza Atualizada'
    ) resolved
  ),
  'Resolução válida usa conversa, contato, tenant e número receptor exatos'
);

update public.whatsapp_conversations
set status = 'waiting_customer',
    current_state = 'BOOKING_CONFIRMATION',
    assigned_user_id = null,
    handoff_requested_at = null
where id = '95000000-0000-4000-8000-000000000002';
update public.tenant_whatsapp_settings
set metadata = metadata || jsonb_build_object(
  'allowed_service_ids', jsonb_build_array('42000000-0000-0000-0000-000000000001'),
  'allowed_location_ids', jsonb_build_array('30000000-0000-0000-0000-000000000002')
)
where tenant_id = '20000000-0000-0000-0000-000000000002';

-- Os dois candidatos precisam ser reserváveis de forma independente. Slots
-- consecutivos do mesmo dia se sobrepõem quando a duração do serviço excede o
-- intervalo da grade, então reservar o primeiro invalidaria o segundo. Pega-se o
-- primeiro horário de cada um de dois dias distintos.
create temporary table pgtap_whatsapp_booking_slots on commit drop as
select row_number() over (order by chosen.starts_at, chosen.staff_id) as position,
       chosen.starts_at,
       chosen.staff_id
from (
  select first_of_day.starts_at, first_of_day.staff_id
  from (
    select distinct on ((slot.starts_at at time zone 'America/Sao_Paulo')::date)
           slot.starts_at,
           slot.staff_id
    from public.get_available_slots(
      'salao-da-ana',
      '30000000-0000-0000-0000-000000000002',
      array['42000000-0000-0000-0000-000000000001']::uuid[],
      null,
      statement_timestamp() + interval '1 day',
      statement_timestamp() + interval '30 days',
      'America/Sao_Paulo',
      200
    ) slot
    order by (slot.starts_at at time zone 'America/Sao_Paulo')::date,
             slot.starts_at,
             slot.staff_id
  ) first_of_day
  order by first_of_day.starts_at, first_of_day.staff_id
  limit 2
) chosen;
select is(
  (select count(*)::integer from pgtap_whatsapp_booking_slots),
  2,
  'Fixture encontra dois slots para criação transacional WhatsApp'
);

update public.tenant_whatsapp_settings
set metadata = jsonb_set(metadata, '{allowed_service_ids}', '[]'::jsonb)
where tenant_id = '20000000-0000-0000-0000-000000000002';
select throws_ok(
  $$
    select public.create_whatsapp_booking(
      '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000002',
      array['42000000-0000-0000-0000-000000000001']::uuid[],
      (select staff_id from pgtap_whatsapp_booking_slots where position = 1),
      (select starts_at from pgtap_whatsapp_booking_slots where position = 1),
      'America/Sao_Paulo',
      'Luiza Atualizada',
      '+551199990002',
      'luiza@cliente.local',
      null,
      '99540000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000002',
      '551199990002'
    )
  $$,
  '42501',
  'whatsapp_service_not_allowed',
  'Confirmação revalida allowlist atual e rejeita seleção removida'
);
update public.tenant_whatsapp_settings
set metadata = jsonb_set(
  metadata,
  '{allowed_service_ids}',
  jsonb_build_array('42000000-0000-0000-0000-000000000001')
)
where tenant_id = '20000000-0000-0000-0000-000000000002';

create temporary table pgtap_whatsapp_booking_result on commit drop as
select public.create_whatsapp_booking(
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002',
  array['42000000-0000-0000-0000-000000000001']::uuid[],
  (select staff_id from pgtap_whatsapp_booking_slots where position = 1),
  (select starts_at from pgtap_whatsapp_booking_slots where position = 1),
  'America/Sao_Paulo',
  'Luiza Atualizada',
  '+551199990002',
  'luiza@cliente.local',
  null,
  '99540000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000002',
  '551199990002'
) as result;
select ok(
  (
    select appointment.origin = 'whatsapp'
      and appointment.metadata ->> 'whatsapp_conversation_id' =
        '95000000-0000-4000-8000-000000000002'
    from pgtap_whatsapp_booking_result stored
    join public.appointments appointment
      on appointment.id = (stored.result ->> 'appointmentId')::uuid
  ),
  'Gateway cria appointment real pelo núcleo transacional e grava origem WhatsApp'
);
select is(
  (
    select public.create_whatsapp_booking(
      '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000002',
      array['42000000-0000-0000-0000-000000000001']::uuid[],
      (select staff_id from pgtap_whatsapp_booking_slots where position = 1),
      (select starts_at from pgtap_whatsapp_booking_slots where position = 1),
      'America/Sao_Paulo',
      'Luiza Atualizada',
      '+551199990002',
      'luiza@cliente.local',
      null,
      '99540000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000002',
      '551199990002'
    ) ->> 'appointmentId'
  ),
  (select result ->> 'appointmentId' from pgtap_whatsapp_booking_result),
  'Replay da confirmação retorna o mesmo appointment'
);
select throws_ok(
  $$
    select public.create_whatsapp_booking(
      '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000002',
      array['42000000-0000-0000-0000-000000000001']::uuid[],
      (select staff_id from pgtap_whatsapp_booking_slots where position = 1),
      (select starts_at from pgtap_whatsapp_booking_slots where position = 1),
      'America/Sao_Paulo',
      'Luiza Atualizada',
      '+551199990002',
      'luiza@cliente.local',
      null,
      '99540000-0000-4000-8000-000000000002',
      '95000000-0000-4000-8000-000000000002',
      '551199990002'
    )
  $$,
  '23P01',
  'slot_unavailable',
  'Nova idempotency key não contorna conflito com slot já ocupado'
);
select is(
  (
    select bool_and(
      public.enqueue_whatsapp_appointment_notification(event.id) ->> 'reason' =
        'whatsapp_originated_operation'
    )
    from public.outbox_events event
    join pgtap_whatsapp_booking_result stored
      on event.aggregate_id = (stored.result ->> 'appointmentId')::uuid
    where event.event_type in ('appointment.created', 'appointment.confirmed')
  ),
  true,
  'Operação já respondida suprime created/confirmed duplicados'
);
select is(
  (
    select count(*)::integer
    from public.outbox_events reminder
    join pgtap_whatsapp_booking_result stored
      on reminder.aggregate_id = (stored.result ->> 'appointmentId')::uuid
    where reminder.event_type = 'appointment.reminder_due'
      and reminder.processed_at is null
  ) > 0,
  true,
  'Operação já respondida mantém reminders pendentes'
);

select lives_ok(
  $$
    select public.create_whatsapp_booking(
      '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000002',
      array['42000000-0000-0000-0000-000000000001']::uuid[],
      (select staff_id from pgtap_whatsapp_booking_slots where position = 2),
      (select starts_at from pgtap_whatsapp_booking_slots where position = 2),
      'America/Sao_Paulo',
      'Luiza Atualizada',
      '+551199990002',
      'luiza@cliente.local',
      null,
      '99540000-0000-4000-8000-000000000003',
      '95000000-0000-4000-8000-000000000002',
      '551199990002'
    )
  $$,
  'Chave idempotente distinta cria reserva em outro slot disponível'
);
-- A asserção de limite é isolada em vez de calibrada: contar quantas confirmações
-- anteriores deste arquivo já entraram no bucket é frágil, porque o consumo acontece
-- antes da checagem de slot, vale também para replay idempotente, e é desfeito quando
-- a chamada falha. Zerando a janela, o laço a satura com exatamente o limite (8, o
-- padrão de app_private.consume_public_rate_limit) e a chamada seguinte tem de estourar.
delete from public.public_rate_limits
where tenant_id = '20000000-0000-0000-0000-000000000002';

do $$
declare counter integer;
begin
  for counter in 1..8 loop
    perform public.create_whatsapp_booking(
      '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000002',
      array['42000000-0000-0000-0000-000000000001']::uuid[],
      (select staff_id from pgtap_whatsapp_booking_slots where position = 1),
      (select starts_at from pgtap_whatsapp_booking_slots where position = 1),
      'America/Sao_Paulo',
      'Luiza Atualizada',
      '+551199990002',
      'luiza@cliente.local',
      null,
      '99540000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000002',
      '551199990002'
    );
  end loop;
end;
$$;
select throws_ok(
  $$
    select public.create_whatsapp_booking(
      '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000002',
      array['42000000-0000-0000-0000-000000000001']::uuid[],
      (select staff_id from pgtap_whatsapp_booking_slots where position = 1),
      (select starts_at from pgtap_whatsapp_booking_slots where position = 1),
      'America/Sao_Paulo',
      'Luiza Atualizada',
      '+551199990002',
      'luiza@cliente.local',
      null,
      '99540000-0000-4000-8000-000000000099',
      '95000000-0000-4000-8000-000000000002',
      '551199990002'
    )
  $$,
  'P0001',
  'rate_limit_exceeded',
  'Bucket estável por tenant/contato limita confirmações com várias idempotency keys'
);
-- Devolve a janela zerada para o restante do arquivo não herdar o bucket saturado.
delete from public.public_rate_limits
where tenant_id = '20000000-0000-0000-0000-000000000002';

select public.cancel_whatsapp_booking(
  '20000000-0000-0000-0000-000000000002',
  '70000000-0000-0000-0000-000000000002',
  (
    select id from public.appointments
    where idempotency_key = '99540000-0000-4000-8000-000000000003'
  ),
  'Liberar slot para reagendamento pgTAP',
  '99540000-0000-4000-8000-000000000004',
  '95000000-0000-4000-8000-000000000002'
);
create temporary table pgtap_whatsapp_reschedule_result on commit drop as
select public.reschedule_whatsapp_booking(
  '20000000-0000-0000-0000-000000000002',
  '70000000-0000-0000-0000-000000000002',
  (select (result ->> 'appointmentId')::uuid from pgtap_whatsapp_booking_result),
  (select starts_at from pgtap_whatsapp_booking_slots where position = 2),
  (select staff_id from pgtap_whatsapp_booking_slots where position = 2),
  '99540000-0000-4000-8000-000000000005',
  '95000000-0000-4000-8000-000000000002'
) as result;
select is(
  (select result ->> 'rescheduledVia' from pgtap_whatsapp_reschedule_result),
  'whatsapp',
  'Gateway reagenda appointment real e marca a operação WhatsApp'
);
select ok(
  (
    select count(*) = 3 and bool_and(
      public.enqueue_whatsapp_appointment_notification(event.id) ->> 'reason' =
        'whatsapp_originated_operation'
    )
    from public.outbox_events event
    join pgtap_whatsapp_booking_result original on true
    join pgtap_whatsapp_reschedule_result moved on true
    where (
      event.aggregate_id = (moved.result ->> 'appointmentId')::uuid
      and event.event_type in ('appointment.created', 'appointment.confirmed')
    ) or (
      event.aggregate_id = (original.result ->> 'appointmentId')::uuid
      and event.event_type = 'appointment.rescheduled'
    )
  ),
  'Reagendamento suprime created, confirmed e rescheduled da resposta conversacional'
);
reset role;

create temporary table pgtap_whatsapp_slot on commit drop as
select slot.starts_at, slot.staff_id
from public.get_available_slots(
  'barbearia-central',
  '30000000-0000-0000-0000-000000000001',
  array['41000000-0000-0000-0000-000000000001']::uuid[],
  null,
  statement_timestamp() + interval '1 day',
  statement_timestamp() + interval '21 days',
  'America/Sao_Paulo',
  1
) slot;

select ok(
  exists (select 1 from pgtap_whatsapp_slot),
  'Fixture encontra slot futuro para testar consentimento atômico'
);

set local role anon;
select is(
  public.get_public_whatsapp_consent_availability('barbearia-central'),
  true,
  'API pública expõe somente a disponibilidade booleana do consentimento'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_public_booking_with_whatsapp_consent(text,uuid,uuid[],uuid,timestamptz,text,text,text,text,text,uuid,text,boolean,jsonb)',
    'EXECUTE'
  ),
  'Wrapper atômico com consentimento não é chamável diretamente por anon'
);
select throws_ok(
  $$
    select public.create_public_booking_with_whatsapp_consent(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      (select staff_id from pgtap_whatsapp_slot),
      (select starts_at from pgtap_whatsapp_slot),
      'America/Sao_Paulo',
      'Cliente Sem Consentimento',
      '+551199990097',
      null,
      null,
      '99520000-0000-4000-8000-000000000004',
      'pgtap-consent-null',
      null,
      null
    )
  $$,
  '42501',
  null,
  'Anon não contorna a rota server-side passando consentimento NULL'
);
reset role;
select is(
  (
    select count(*)::integer
    from public.whatsapp_opt_ins opt_in
    join public.whatsapp_contacts contact on contact.id = opt_in.contact_id
    where contact.normalized_phone = '+551199990097'
  ),
  0,
  'Tentativa anon com consentimento NULL não grava opt-in'
);

set local role service_role;
select throws_ok(
  $$
    select public.create_public_booking_with_whatsapp_consent(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      (select staff_id from pgtap_whatsapp_slot),
      (select starts_at from pgtap_whatsapp_slot),
      'America/Sao_Paulo',
      'Cliente Evidence',
      '+551199990098',
      null,
      null,
      '99520000-0000-4000-8000-000000000000',
      'pgtap-consent-invalid',
      true,
      '{"policyId":"booking_transactional_updates","policyVersion":"2026-07-31","unexpected":"x"}'
    )
  $$,
  '22023',
  'invalid_whatsapp_consent_evidence',
  'Wrapper público rejeita evidence com chave arbitrária'
);
select lives_ok(
  $$
    select public.create_public_booking_with_whatsapp_consent(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      (select staff_id from pgtap_whatsapp_slot),
      (select starts_at from pgtap_whatsapp_slot),
      'America/Sao_Paulo',
      'Cliente Consentimento',
      '+551199990099',
      null,
      null,
      '99520000-0000-4000-8000-000000000001',
      'pgtap-consent-valid',
      true,
      '{"policyId":"booking_transactional_updates","policyVersion":"2026-07-31","tenantSlug":"forjado","textTemplate":"forjado"}'
    )
  $$,
  'Reserva e consentimento são persistidos pela RPC pública atômica'
);
reset role;

select ok(
  (
    select bool_and(
      evidence ->> 'tenantSlug' = 'barbearia-central'
      and evidence ->> 'tenantName' = 'Barbearia Central'
      and evidence ->> 'textTemplate' <> 'forjado'
      and evidence ->> 'policyVersion' = '2026-07-31'
    )
    from public.whatsapp_opt_ins opt_in
    join public.whatsapp_contacts contact on contact.id = opt_in.contact_id
    where contact.normalized_phone = '+551199990099'
      and opt_in.superseded_at is null
  ),
  'Evidence é reconstruída no servidor com tenant e texto canônicos'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_opt_ins opt_in
    join public.whatsapp_contacts contact on contact.id = opt_in.contact_id
    where contact.normalized_phone = '+551199990099'
      and opt_in.status = 'granted'
      and opt_in.superseded_at is null
      and opt_in.category in ('transactional', 'reminders', 'service_updates')
  ),
  3,
  'Wrapper grava as três categorias operacionais de consentimento'
);
select throws_ok(
  $$
    select app_private.build_whatsapp_template_components(
      '{"1":"request.url"}',
      (
        select id from public.appointments
        where idempotency_key = '99520000-0000-4000-8000-000000000001'
      )
    )
  $$,
  '22023',
  'template_mapping_invalid',
  'Template rejeita variable_mapping fora da lista segura'
);

-- Mesmo caso do bloco anterior: fixture sobre appointments e leitura de
-- outbox_events, fora do que service_role faz em produção.
select is(
  (
    select public.enqueue_whatsapp_appointment_notification(
      (
        select event.id
        from public.outbox_events event
        join public.appointments appointment on appointment.id = event.aggregate_id
        where appointment.idempotency_key = '99520000-0000-4000-8000-000000000001'
          and event.event_type = 'appointment.created'
        limit 1
      )
    ) ->> 'status'
  ),
  'queued',
  'Notificação de booking com opt-in entra na outbox WhatsApp'
);
select is(
  (
    select public.enqueue_whatsapp_appointment_notification(
      (
        select event.id
        from public.outbox_events event
        join public.appointments appointment on appointment.id = event.aggregate_id
        where appointment.idempotency_key = '99520000-0000-4000-8000-000000000001'
          and event.event_type = 'appointment.created'
        limit 1
      )
    ) ->> 'reason'
  ),
  'already_enqueued',
  'Reprocessar evento não duplica mensagem nem outbox WhatsApp'
);
select ok(
  (
    select count(*) > 0
    from public.outbox_events reminder
    join public.appointments appointment on appointment.id = reminder.aggregate_id
    where appointment.idempotency_key = '99520000-0000-4000-8000-000000000001'
      and reminder.event_type = 'appointment.reminder_due'
      and reminder.processed_at is null
  ),
  'Evento criado agenda lembretes configurados de forma idempotente'
);
update public.appointments
set status = case
  when status = 'confirmed' then 'pending'::public.appointment_status
  else 'confirmed'::public.appointment_status
end
where idempotency_key = '99520000-0000-4000-8000-000000000001';
select ok(
  exists (
    select 1
    from public.outbox_events reminder
    join public.appointments appointment on appointment.id = reminder.aggregate_id
    where appointment.idempotency_key = '99520000-0000-4000-8000-000000000001'
      and reminder.event_type = 'appointment.reminder_due'
      and reminder.processed_at is null
  ),
  'Transição entre status que ocupam slot preserva reminders pendentes'
);

select is(
  (
    select public.cancel_whatsapp_booking(
      appointment.tenant_id,
      contact.customer_id,
      appointment.id,
      'Cancelamento pgTAP',
      '99520000-0000-4000-8000-000000000002',
      conversation.id
    ) ->> 'status'
    from public.appointments appointment
    join public.customer_tenants relation
      on relation.tenant_id = appointment.tenant_id
     and relation.id = appointment.customer_tenant_id
    join public.whatsapp_contacts contact on contact.customer_id = relation.customer_id
    join public.whatsapp_conversations conversation
      on conversation.contact_id = contact.id
     and conversation.tenant_id = appointment.tenant_id
    where appointment.idempotency_key = '99520000-0000-4000-8000-000000000001'
  ),
  'cancelled_by_customer',
  'Cancelamento WhatsApp valida ator e persiste idempotency key'
);
select is(
  (
    select public.cancel_whatsapp_booking(
      appointment.tenant_id,
      contact.customer_id,
      appointment.id,
      'Cancelamento pgTAP',
      '99520000-0000-4000-8000-000000000002',
      conversation.id
    ) ->> 'idempotent'
    from public.appointments appointment
    join public.customer_tenants relation
      on relation.tenant_id = appointment.tenant_id
     and relation.id = appointment.customer_tenant_id
    join public.whatsapp_contacts contact on contact.customer_id = relation.customer_id
    join public.whatsapp_conversations conversation
      on conversation.contact_id = contact.id
     and conversation.tenant_id = appointment.tenant_id
    where appointment.idempotency_key = '99520000-0000-4000-8000-000000000001'
  ),
  'true',
  'Replay do cancelamento não repete efeitos laterais'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_outbox item
    where item.payload ->> 'appointmentId' = (
      select id::text from public.appointments
      where idempotency_key = '99520000-0000-4000-8000-000000000001'
    )
      and item.payload ->> 'purpose' = 'appointment_created'
      and item.status = 'cancelled'
  ),
  1,
  'Cancelamento invalida notificação WhatsApp já enfileirada'
);

select throws_ok(
  $$
    select public.reschedule_whatsapp_booking(
      '20000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      statement_timestamp() + interval '3 days',
      '50000000-0000-0000-0000-000000000001',
      '99520000-0000-4000-8000-000000000003',
      '95000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'whatsapp_channel_actor_mismatch',
  'Reagendamento rejeita conversa de outro tenant/customer'
);

select is(
  (
    select count(*)::integer
    from public.outbox_events reminder
    join public.appointments appointment on appointment.id = reminder.aggregate_id
    where appointment.idempotency_key = '99520000-0000-4000-8000-000000000001'
      and reminder.event_type = 'appointment.reminder_due'
      and reminder.processed_at is null
  ),
  0,
  'Cancelar appointment encerra reminders pendentes na mesma transação'
);
select is(
  (
    select public.enqueue_whatsapp_appointment_notification(
      (
        select reminder.id
        from public.outbox_events reminder
        join public.appointments appointment on appointment.id = reminder.aggregate_id
        where appointment.idempotency_key = '99520000-0000-4000-8000-000000000001'
          and reminder.event_type = 'appointment.reminder_due'
        limit 1
      )
    ) ->> 'reason'
  ),
  'event_already_processed',
  'Reminder cancelado não volta à outbox WhatsApp'
);
reset role;

-- Retenção: terminal antigo, ativo antigo, sessão automatizada abandonada e
-- handoff abandonado. Todos os identificadores são exclusivamente de pgTAP.
insert into public.whatsapp_contacts (
  id, provider, normalized_phone, whatsapp_user_id, profile_name,
  first_seen_at, last_seen_at, metadata, created_at, updated_at
) values
  (
    '99600000-0000-4000-8000-000000000001', 'mock', '+551188880001',
    '551188880001', 'Contato terminal', '2020-01-01', '2020-01-02',
    '{"private":"terminal"}', '2020-01-01', '2020-01-02'
  ),
  (
    '99600000-0000-4000-8000-000000000002', 'mock', '+551188880002',
    '551188880002', 'Contato ativo', '2020-01-01', '2020-01-02',
    '{"private":"active"}', '2020-01-01', '2020-01-02'
  ),
  (
    '99600000-0000-4000-8000-000000000003', 'mock', '+551188880003',
    '551188880003', 'Contato expirado', '2020-01-01', '2020-01-02',
    '{"private":"expired"}', '2020-01-01', '2020-01-02'
  ),
  (
    '99600000-0000-4000-8000-000000000004', 'mock', '+551188880004',
    '551188880004', 'Contato handoff', '2020-01-01', '2020-01-02',
    '{"private":"handoff"}', '2020-01-01', '2020-01-02'
  ),
  (
    '99600000-0000-4000-8000-000000000005', 'mock', '+551188880005',
    '551188880005', 'Contato ligado a customer', '2020-01-01', '2020-01-02',
    '{"private":"linked-customer"}', '2020-01-01', '2020-01-02'
  );

update public.whatsapp_contacts
set customer_id = '70000000-0000-0000-0000-000000000001'
where id = '99600000-0000-4000-8000-000000000005';

insert into public.whatsapp_conversations (
  id, phone_number_id, contact_id, tenant_id, status, current_state,
  session_expires_at, started_at, closed_at, context, version,
  created_at, updated_at
) values
  (
    '99610000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'closed', 'MAIN_MENU', '2020-01-02', '2020-01-01', '2020-01-02',
    '{"_retention":"forged","private":"terminal-context"}', 1,
    '2020-01-01', '2020-01-02'
  ),
  (
    '99610000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'open', 'MAIN_MENU', statement_timestamp() + interval '1 day',
    '2020-01-01', null, '{"private":"active-context"}', 1,
    '2020-01-01', '2020-01-02'
  ),
  (
    '99610000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    'waiting_customer', 'SERVICE_SELECTION', '2020-01-02',
    '2020-01-01', null, '{"private":"expired-context"}', 1,
    '2020-01-01', '2020-01-02'
  ),
  (
    '99610000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    'human_handoff', 'HUMAN_HANDOFF', statement_timestamp() + interval '1 day',
    '2020-01-01', null, '{"private":"handoff-context"}', 1,
    '2020-01-01', '2020-01-02'
  ),
  (
    '99610000-0000-4000-8000-000000000005',
    '91000000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000005',
    '20000000-0000-0000-0000-000000000001',
    'closed', 'MAIN_MENU', '2020-01-02', '2020-01-01', '2020-01-02',
    '{"private":"linked-customer-context"}', 1,
    '2020-01-01', '2020-01-02'
  );

insert into public.whatsapp_messages (
  id, conversation_id, tenant_id, provider, direction, message_type,
  provider_message_id, idempotency_key, status, content, normalized_content,
  provider_payload, sent_at, created_at, updated_at
) values
  (
    '99620000-0000-4000-8000-000000000001',
    '99610000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'mock', 'outbound', 'text',
    'retention-provider-message-terminal', 'retention-message-terminal', 'sent',
    '{"_retention":"forged","text":"terminal-secret"}',
    '{"text":"terminal-secret"}', '{"transport":"terminal-secret"}',
    '2020-01-02', '2020-01-01', '2020-01-02'
  ),
  (
    '99620000-0000-4000-8000-000000000002',
    '99610000-0000-4000-8000-000000000002',
    '20000000-0000-0000-0000-000000000001', 'mock', 'outbound', 'text',
    null, 'retention-message-active', 'queued', '{"text":"active-secret"}',
    '{"text":"active-secret"}', '{"transport":"active-secret"}',
    null, '2020-01-01', '2020-01-02'
  ),
  (
    '99620000-0000-4000-8000-000000000003',
    '99610000-0000-4000-8000-000000000003',
    '20000000-0000-0000-0000-000000000001', 'mock', 'outbound', 'text',
    null, 'retention-message-expired', 'queued', '{"text":"expired-secret"}',
    '{"text":"expired-secret"}', '{"transport":"expired-secret"}',
    null, '2020-01-01', '2020-01-02'
  ),
  (
    '99620000-0000-4000-8000-000000000004',
    '99610000-0000-4000-8000-000000000004',
    '20000000-0000-0000-0000-000000000001', 'mock', 'outbound', 'text',
    null, 'retention-message-handoff', 'queued', '{"text":"handoff-secret"}',
    '{"text":"handoff-secret"}', '{"transport":"handoff-secret"}',
    null, '2020-01-01', '2020-01-02'
  ),
  (
    '99620000-0000-4000-8000-000000000005',
    '99610000-0000-4000-8000-000000000005',
    '20000000-0000-0000-0000-000000000001', 'mock', 'outbound', 'text',
    'retention-provider-message-linked', 'retention-message-linked', 'sent',
    '{"text":"linked-secret"}', '{"text":"linked-secret"}',
    '{"transport":"linked-secret"}', '2020-01-02', '2020-01-01', '2020-01-02'
  );

insert into public.whatsapp_outbox (
  id, tenant_id, phone_number_id, provider, conversation_id, message_id,
  recipient, message_kind, payload, scheduled_for, status, attempt_count,
  next_attempt_at, provider_message_id, processed_at, created_at, updated_at
) values
  (
    '99630000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '91000000-0000-4000-8000-000000000001', 'mock',
    '99610000-0000-4000-8000-000000000001',
    '99620000-0000-4000-8000-000000000001', '+551188880001', 'text',
    '{"recipient":"+551188880001","secret":"terminal"}', '2020-01-01',
    'sent', 1, '2020-01-02', 'retention-provider-message-terminal',
    '2020-01-02', '2020-01-01', '2020-01-02'
  ),
  (
    '99630000-0000-4000-8000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '91000000-0000-4000-8000-000000000001', 'mock',
    '99610000-0000-4000-8000-000000000002',
    '99620000-0000-4000-8000-000000000002', '+551188880002', 'text',
    '{"recipient":"+551188880002","secret":"active"}', '2020-01-01',
    'pending', 0, statement_timestamp() + interval '1 day', null,
    null, '2020-01-01', '2020-01-02'
  ),
  (
    '99630000-0000-4000-8000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    '91000000-0000-4000-8000-000000000001', 'mock',
    '99610000-0000-4000-8000-000000000003',
    '99620000-0000-4000-8000-000000000003', '+551188880003', 'text',
    '{"recipient":"+551188880003","secret":"expired"}', '2020-01-01',
    'pending', 0, '2020-01-02', null, null, '2020-01-01', '2020-01-02'
  ),
  (
    '99630000-0000-4000-8000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    '91000000-0000-4000-8000-000000000001', 'mock',
    '99610000-0000-4000-8000-000000000004',
    '99620000-0000-4000-8000-000000000004', '+551188880004', 'text',
    '{"recipient":"+551188880004","secret":"handoff"}', '2020-01-01',
    'pending', 0, '2020-01-02', null, null, '2020-01-01', '2020-01-02'
  ),
  (
    '99630000-0000-4000-8000-000000000005',
    '20000000-0000-0000-0000-000000000001',
    '91000000-0000-4000-8000-000000000001', 'mock',
    '99610000-0000-4000-8000-000000000005',
    '99620000-0000-4000-8000-000000000005', '+551188880005', 'text',
    '{"recipient":"+551188880005","secret":"linked"}', '2020-01-01',
    'sent', 1, '2020-01-02', 'retention-provider-message-linked',
    '2020-01-02', '2020-01-01', '2020-01-02'
  );

insert into public.whatsapp_handoffs (
  id, conversation_id, tenant_id, requested_by, reason, status,
  requested_at, accepted_at, resolved_at, resolution_notes, created_at, updated_at
) values
  (
    '99640000-0000-4000-8000-000000000001',
    '99610000-0000-4000-8000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'customer',
    'terminal-secret', 'resolved', '2019-01-01', '2019-01-02', '2020-01-01',
    'terminal-resolution-secret', '2019-01-01', '2020-01-02'
  ),
  (
    '99640000-0000-4000-8000-000000000004',
    '99610000-0000-4000-8000-000000000004',
    '20000000-0000-0000-0000-000000000001', 'customer',
    'stale-handoff-secret', 'requested', '2020-01-01', null, null,
    null, '2020-01-01', '2020-01-02'
  );

insert into public.whatsapp_flow_sessions (
  id, conversation_id, tenant_id, flow_definition_id, flow_token_hash,
  status, context, expires_at, completed_at, created_at, updated_at
) values (
  '99650000-0000-4000-8000-000000000001',
  '99610000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'retention-flow',
  extensions.digest(convert_to('retention-flow-token', 'UTF8'), 'sha256'),
  'completed', '{"private":"flow-secret"}', '2020-01-01', '2020-01-01',
  '2019-01-01', '2020-01-02'
);

insert into public.whatsapp_opt_ins (
  id, contact_id, tenant_id, category, status, source, policy_version,
  evidence, granted_at, revoked_at, superseded_at, created_at, updated_at
) values (
  '99655000-0000-4000-8000-000000000001',
  '99600000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'marketing', 'revoked', 'retention_fixture', 'pgtap-v1',
  '{"ip":"192.0.2.10","private":"opt-in-secret"}',
  '2019-01-01', '2019-01-02', '2020-01-01', '2019-01-01', '2020-01-02'
);

insert into public.whatsapp_webhook_events (
  id, provider, external_event_key, event_type, correlation_id, ordering_keys,
  signature_valid, payload, processing_status, attempts, next_attempt_at,
  received_at, processed_at, created_at, updated_at
) values
  (
    '99660000-0000-4000-8000-000000000001', 'mock',
    'retention-webhook-terminal', 'messages',
    '99670000-0000-4000-8000-000000000001', array[repeat('e', 64)], true,
    '{"_retention":"forged","private":"webhook-terminal"}', 'processed', 1,
    '2020-01-02', '2020-01-01', '2020-01-02', '2020-01-01', '2020-01-02'
  ),
  (
    '99660000-0000-4000-8000-000000000002', 'mock',
    'retention-webhook-active', 'messages',
    '99670000-0000-4000-8000-000000000002', array[repeat('f', 64)], true,
    '{"private":"webhook-active"}', 'received', 0,
    statement_timestamp() + interval '1 day', '2020-01-01', null,
    '2020-01-01', '2020-01-02'
  );

insert into public.whatsapp_pending_message_statuses (
  provider, provider_message_id, status, event_timestamp, created_at, updated_at
) values (
  'mock', 'retention-pending-status', 'delivered',
  '2020-01-01', '2020-01-01', '2020-01-02'
);

insert into app_private.whatsapp_webhook_rate_limits (
  action, rate_key, window_started_at, request_count, expires_at
) values
  ('receive', repeat('c', 64), '2020-01-01', 1, '2020-01-02'),
  ('receive', repeat('d', 64), date_trunc('minute', statement_timestamp()), 1,
    statement_timestamp() + interval '1 day');

set local role service_role;
select public.configure_whatsapp_retention_policy(
  'pgtap-hold', 1, 7, 30, true
);
select ok(
  (
    select result ->> 'status' = 'legal_hold'
    from (select public.apply_whatsapp_retention(500) result) held
  ) and (
    select payload ->> 'private' = 'webhook-terminal'
    from public.whatsapp_webhook_events
    where id = '99660000-0000-4000-8000-000000000001'
  ) and exists (
    select 1 from public.whatsapp_outbox
    where id = '99630000-0000-4000-8000-000000000001'
  ) and (
    select status = 'waiting_customer'
    from public.whatsapp_conversations
    where id = '99610000-0000-4000-8000-000000000003'
  ) and (
    select evidence ->> 'private' = 'opt-in-secret'
      and evidence_redacted_at is null
    from public.whatsapp_opt_ins
    where id = '99655000-0000-4000-8000-000000000001'
  ),
  'Legal hold impede redação, remoção, evidência e sweep de sessão'
);

select public.configure_whatsapp_retention_policy(
  'pgtap-apply', 1, 7, 30, false
);
create temporary table pgtap_whatsapp_retention_result on commit drop as
select public.apply_whatsapp_retention(500) as result;
reset role;

select ok(
  (
    select (result ->> 'webhookPayloadsRedacted')::integer >= 1
      and (result ->> 'outboxRowsDeleted')::integer >= 3
      and (result ->> 'messageBodiesRedacted')::integer >= 3
      and (result ->> 'conversationContextsRedacted')::integer >= 3
      and (result ->> 'pendingStatusesDeleted')::integer >= 1
      and (result ->> 'handoffsRedacted')::integer >= 1
      and (result ->> 'flowContextsRedacted')::integer >= 1
      and (result ->> 'optInEvidenceRedacted')::integer >= 1
      and (result ->> 'rateLimitRowsDeleted')::integer >= 1
    from pgtap_whatsapp_retention_result
  ) and (
    select payload #>> '{_retention,redacted}' = 'true'
      and payload_redacted_at is not null
    from public.whatsapp_webhook_events
    where id = '99660000-0000-4000-8000-000000000001'
  ) and (
    select content #>> '{_retention,redacted}' = 'true'
      and normalized_content #>> '{_retention,redacted}' = 'true'
      and provider_payload is null
      and content_redacted_at is not null
    from public.whatsapp_messages
    where id = '99620000-0000-4000-8000-000000000001'
  ) and (
    select context #>> '{_retention,redacted}' = 'true'
      and context_redacted_at is not null
    from public.whatsapp_conversations
    where id = '99610000-0000-4000-8000-000000000001'
  ) and not exists (
    select 1 from public.whatsapp_outbox
    where id = '99630000-0000-4000-8000-000000000001'
  ) and not exists (
    select 1 from public.whatsapp_pending_message_statuses
    where provider_message_id = 'retention-pending-status'
  ) and not exists (
    select 1 from app_private.whatsapp_webhook_rate_limits
    where rate_key = repeat('c', 64)
  ) and (
    select reason is null and resolution_notes is null
      and content_redacted_at is not null
    from public.whatsapp_handoffs
    where id = '99640000-0000-4000-8000-000000000001'
  ) and (
    select context #>> '{_retention,redacted}' = 'true'
      and context_redacted_at is not null
    from public.whatsapp_flow_sessions
    where id = '99650000-0000-4000-8000-000000000001'
  ) and (
    select evidence #>> '{_retention,redacted}' = 'true'
      and evidence_redacted_at is not null
      and status = 'revoked'
      and policy_version = 'pgtap-v1'
    from public.whatsapp_opt_ins
    where id = '99655000-0000-4000-8000-000000000001'
  ),
  'Lote redige JSON/evidência e remove payloads operacionais expirados'
);

select ok(
  (
    select (result ->> 'automatedSessionsExpired')::integer >= 1
      and (result ->> 'staleHandoffsExpired')::integer >= 1
    from pgtap_whatsapp_retention_result
  ) and (
    select status = 'expired' and closed_at = '2020-01-02'::timestamptz
      and context_redacted_at is not null
    from public.whatsapp_conversations
    where id = '99610000-0000-4000-8000-000000000003'
  ) and (
    select status = 'expired' and context_redacted_at is not null
    from public.whatsapp_conversations
    where id = '99610000-0000-4000-8000-000000000004'
  ) and (
    select status = 'cancelled' and reason is null
      and content_redacted_at is not null
    from public.whatsapp_handoffs
    where id = '99640000-0000-4000-8000-000000000004'
  ) and not exists (
    select 1 from public.whatsapp_outbox
    where id in (
      '99630000-0000-4000-8000-000000000003',
      '99630000-0000-4000-8000-000000000004'
    )
  ),
  'Sweep expira automação/handoff antigos e cancela backlog sem sucessora'
);

select ok(
  (
    select (result ->> 'contactsAnonymized')::integer >= 3
    from pgtap_whatsapp_retention_result
  ) and not exists (
    select 1 from public.whatsapp_contacts
    where normalized_phone in (
      '+551188880001', '+551188880003', '+551188880004'
    )
  ) and (
    select count(*) = 3 and bool_and(
        contact.normalized_phone ~ '^\+999[0-9]{12}$'
        and contact.whatsapp_user_id = 'retained:' || contact.id::text
        and contact.profile_name is null
        and contact.customer_id is null
        and contact.blocked_at is not null
        and contact.retention_redacted_at is not null
        and contact.metadata #>> '{_retention,redacted}' = 'true'
      )
    from public.whatsapp_contacts contact
    where contact.id in (
      '99600000-0000-4000-8000-000000000001',
      '99600000-0000-4000-8000-000000000003',
      '99600000-0000-4000-8000-000000000004'
    )
  ),
  'Contato órfão perde telefone/user/customer e conserva somente identidade sintética'
);

select ok(
  (
    select processing_status = 'received'
      and payload ->> 'private' = 'webhook-active'
      and payload_redacted_at is null
    from public.whatsapp_webhook_events
    where id = '99660000-0000-4000-8000-000000000002'
  ) and (
    select status = 'open'
      and context ->> 'private' = 'active-context'
      and context_redacted_at is null
    from public.whatsapp_conversations
    where id = '99610000-0000-4000-8000-000000000002'
  ) and (
    select content ->> 'text' = 'active-secret'
      and content_redacted_at is null
    from public.whatsapp_messages
    where id = '99620000-0000-4000-8000-000000000002'
  ) and exists (
    select 1 from public.whatsapp_outbox
    where id = '99630000-0000-4000-8000-000000000002'
      and status = 'pending'
  ) and (
    select normalized_phone = '+551188880002'
      and retention_redacted_at is null
    from public.whatsapp_contacts
    where id = '99600000-0000-4000-8000-000000000002'
  ) and (
    select normalized_phone = '+551188880005'
      and customer_id = '70000000-0000-0000-0000-000000000001'
      and retention_redacted_at is null
    from public.whatsapp_contacts
    where id = '99600000-0000-4000-8000-000000000005'
  ) and exists (
    select 1 from app_private.whatsapp_webhook_rate_limits
    where rate_key = repeat('d', 64)
  ),
  'TTL preserva dados ativos e contato ainda ligado à identidade global'
);

select * from finish();
rollback;
