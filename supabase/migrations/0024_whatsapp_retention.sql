begin;

-- Política operacional única. `legal_hold` interrompe toda remoção/redação sem
-- depender do scheduler. O banco mantém IDs, estados e timestamps para auditoria,
-- mas elimina conteúdo pessoal e payloads de transporte depois dos TTLs.
create table app_private.whatsapp_retention_policy (
  singleton boolean primary key default true check (singleton),
  policy_version text not null check (policy_version ~ '^[A-Za-z0-9._-]{1,80}$'),
  webhook_payload_days smallint not null check (webhook_payload_days between 1 and 365),
  operational_payload_days smallint not null check (
    operational_payload_days between 7 and 730
  ),
  conversation_content_days smallint not null check (
    conversation_content_days between 30 and 3650
  ),
  legal_hold boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into app_private.whatsapp_retention_policy (
  singleton,
  policy_version,
  webhook_payload_days,
  operational_payload_days,
  conversation_content_days,
  legal_hold
) values (true, '2026-07-31.v1', 30, 90, 180, false);

revoke all on table app_private.whatsapp_retention_policy
from public, anon, authenticated, service_role;

-- O marcador de retenção não pode morar apenas dentro de JSON controlável pelo
-- provedor/usuário. Colunas internas impedem que uma chave `_retention` forjada
-- contorne a redação.
alter table public.whatsapp_webhook_events
  add column payload_redacted_at timestamptz;
alter table public.whatsapp_messages
  add column content_redacted_at timestamptz;
alter table public.whatsapp_conversations
  add column context_redacted_at timestamptz;
alter table public.whatsapp_handoffs
  add column content_redacted_at timestamptz;
alter table public.whatsapp_flow_sessions
  add column context_redacted_at timestamptz;
alter table public.whatsapp_opt_ins
  add column evidence_redacted_at timestamptz;
alter table public.whatsapp_contacts
  add column retention_redacted_at timestamptz;
alter table public.whatsapp_contacts
  add constraint whatsapp_contacts_retained_identity_check check (
    (
      retention_redacted_at is null
      and normalized_phone !~ '^\+999'
      and whatsapp_user_id !~ '^retained:'
    ) or (
      retention_redacted_at is not null
      and normalized_phone ~ '^\+999[0-9]{12}$'
      and whatsapp_user_id = 'retained:' || id::text
      and profile_name is null
      and customer_id is null
      and blocked_at is not null
    )
  );
alter table public.whatsapp_outbox
  add constraint whatsapp_outbox_retained_recipient_check check (
    recipient !~ '^\+999'
  );

create sequence app_private.whatsapp_retained_phone_seq
  as bigint
  minvalue 1
  maxvalue 999999999999
  no cycle;
revoke all on sequence app_private.whatsapp_retained_phone_seq
from public, anon, authenticated, service_role;

create index whatsapp_webhook_events_retention_idx
on public.whatsapp_webhook_events (updated_at, id)
where processing_status in ('processed', 'ignored', 'failed', 'dead_letter')
  and payload_redacted_at is null;

create index whatsapp_outbox_retention_idx
on public.whatsapp_outbox (coalesce(processed_at, updated_at), id)
where status in ('sent', 'failed', 'cancelled', 'dead_letter');

create index whatsapp_messages_retention_idx
on public.whatsapp_messages (created_at, id)
where content_redacted_at is null;

create index whatsapp_conversations_retention_idx
on public.whatsapp_conversations (closed_at, id)
where status in ('completed', 'expired', 'closed', 'failed')
  and context_redacted_at is null;

create index whatsapp_pending_message_statuses_retention_idx
on public.whatsapp_pending_message_statuses (created_at);

create index whatsapp_handoffs_retention_idx
on public.whatsapp_handoffs (updated_at, id)
where status in ('resolved', 'cancelled') and content_redacted_at is null;

create index whatsapp_flow_sessions_retention_idx
on public.whatsapp_flow_sessions (expires_at, id)
where status in ('completed', 'expired', 'cancelled', 'failed')
  and context_redacted_at is null;

create index whatsapp_opt_ins_retention_idx
on public.whatsapp_opt_ins (
  coalesce(superseded_at, revoked_at, updated_at),
  id
)
where evidence_redacted_at is null
  and (superseded_at is not null or status = 'revoked');

create index whatsapp_contacts_retention_idx
on public.whatsapp_contacts (last_seen_at, id)
where retention_redacted_at is null;

create or replace function public.configure_whatsapp_retention_policy(
  p_policy_version text,
  p_webhook_payload_days integer,
  p_operational_payload_days integer,
  p_conversation_content_days integer,
  p_legal_hold boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_policy_version is null
    or p_policy_version !~ '^[A-Za-z0-9._-]{1,80}$'
    or p_webhook_payload_days is null
    or p_webhook_payload_days not between 1 and 365
    or p_operational_payload_days is null
    or p_operational_payload_days not between 7 and 730
    or p_conversation_content_days is null
    or p_conversation_content_days not between 30 and 3650
    or p_legal_hold is null then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_retention_policy';
  end if;

  update app_private.whatsapp_retention_policy
  set policy_version = p_policy_version,
      webhook_payload_days = p_webhook_payload_days,
      operational_payload_days = p_operational_payload_days,
      conversation_content_days = p_conversation_content_days,
      legal_hold = p_legal_hold,
      updated_at = statement_timestamp()
  where singleton;

  return jsonb_build_object(
    'policyVersion', p_policy_version,
    'webhookPayloadDays', p_webhook_payload_days,
    'operationalPayloadDays', p_operational_payload_days,
    'conversationContentDays', p_conversation_content_days,
    'legalHold', p_legal_hold
  );
end;
$$;

create or replace function public.apply_whatsapp_retention(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy app_private.whatsapp_retention_policy%rowtype;
  v_webhooks integer := 0;
  v_outbox integer := 0;
  v_messages integer := 0;
  v_conversations integer := 0;
  v_pending_statuses integer := 0;
  v_handoffs integer := 0;
  v_flow_sessions integer := 0;
  v_opt_in_evidence integer := 0;
  v_rate_limits integer := 0;
  v_sessions_expired integer := 0;
  v_stale_handoffs integer := 0;
  v_contacts_anonymized integer := 0;
  v_expired_conversation_ids uuid[] := '{}'::uuid[];
  v_stale_handoff_ids uuid[] := '{}'::uuid[];
  v_stale_handoff_conversation_ids uuid[] := '{}'::uuid[];
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_retention_limit';
  end if;

  select * into strict v_policy
  from app_private.whatsapp_retention_policy
  where singleton
  for share;

  if v_policy.legal_hold then
    return jsonb_build_object(
      'status', 'legal_hold',
      'policyVersion', v_policy.policy_version
    );
  end if;

  -- Sessões automatizadas abandonadas não dependem de um novo inbound para
  -- chegar ao estado terminal. O timestamp de expiração original vira closed_at,
  -- permitindo aplicar o TTL real sem reiniciar o relógio de retenção.
  select coalesce(array_agg(candidate.id), '{}'::uuid[])
    into v_expired_conversation_ids
  from (
    select conversation.id
    from public.whatsapp_conversations conversation
    where conversation.status in ('open', 'waiting_customer', 'processing')
      and conversation.session_expires_at is not null
      and conversation.session_expires_at <= statement_timestamp()
      and not exists (
        select 1
        from public.whatsapp_handoffs handoff
        where handoff.conversation_id = conversation.id
          and handoff.status in ('requested', 'accepted')
      )
      and not exists (
        select 1
        from public.whatsapp_conversations successor
        where successor.context ->> 'previousConversationId' = conversation.id::text
          and successor.context ->> 'restartReason' = 'session_expired'
      )
      and (
        conversation.processing_locked_until is null or
        conversation.processing_locked_until <= statement_timestamp()
      )
    order by conversation.session_expires_at, conversation.id
    limit p_limit
    for update skip locked
  ) candidate;

  if cardinality(v_expired_conversation_ids) > 0 then
    update public.whatsapp_conversations conversation
    set status = 'expired',
        current_state = 'EXPIRED',
        closed_at = conversation.session_expires_at,
        assigned_user_id = null,
        handoff_requested_at = null,
        processing_locked_at = null,
        processing_locked_until = null,
        processing_locked_by = null,
        version = conversation.version + 1
    where conversation.id = any(v_expired_conversation_ids);
    get diagnostics v_sessions_expired = row_count;

    with cancelled as (
      update public.whatsapp_outbox item
      set status = 'cancelled',
          processed_at = coalesce(
            item.processed_at,
            (
              select conversation.closed_at
              from public.whatsapp_conversations conversation
              where conversation.id = item.conversation_id
            )
          ),
          locked_at = null,
          locked_until = null,
          locked_by = null,
          last_error = 'conversation_session_expired'
      where item.conversation_id = any(v_expired_conversation_ids)
        and item.status in ('pending', 'retry')
      returning item.message_id
    )
    update public.whatsapp_messages message
    set status = 'ignored',
        processed_at = coalesce(message.processed_at, statement_timestamp()),
        error_code = 'conversation_session_expired',
        error_message = null
    where message.id in (select cancelled.message_id from cancelled);
  end if;

  -- Handoffs esquecidos também precisam de saída terminal. Somente conversas
  -- ainda em human_handoff entram neste sweep; trabalho recente/aceito fica intacto.
  select
    coalesce(array_agg(candidate.handoff_id), '{}'::uuid[]),
    coalesce(array_agg(distinct candidate.conversation_id), '{}'::uuid[])
  into v_stale_handoff_ids, v_stale_handoff_conversation_ids
  from (
    select handoff.id as handoff_id, handoff.conversation_id
    from public.whatsapp_handoffs handoff
    join public.whatsapp_conversations conversation
      on conversation.id = handoff.conversation_id
    where handoff.status in ('requested', 'accepted')
      and conversation.status = 'human_handoff'
      and greatest(
        handoff.updated_at,
        conversation.updated_at,
        coalesce(conversation.last_inbound_at, '-infinity'::timestamptz),
        coalesce(conversation.last_outbound_at, '-infinity'::timestamptz)
      ) < statement_timestamp()
        - make_interval(days => v_policy.conversation_content_days)
      and (
        conversation.processing_locked_until is null or
        conversation.processing_locked_until <= statement_timestamp()
      )
    order by handoff.updated_at, handoff.id
    limit p_limit
    for update of handoff, conversation skip locked
  ) candidate;

  if cardinality(v_stale_handoff_ids) > 0 then
    update public.whatsapp_conversations conversation
    set status = 'expired',
        current_state = 'HUMAN_HANDOFF_TIMEOUT',
        closed_at = coalesce(
          (
            select max(coalesce(handoff.accepted_at, handoff.requested_at))
            from public.whatsapp_handoffs handoff
            where handoff.id = any(v_stale_handoff_ids)
              and handoff.conversation_id = conversation.id
          ),
          conversation.session_expires_at,
          statement_timestamp()
        ),
        assigned_user_id = null,
        handoff_requested_at = null,
        processing_locked_at = null,
        processing_locked_until = null,
        processing_locked_by = null,
        version = conversation.version + 1
    where conversation.id = any(v_stale_handoff_conversation_ids)
      and conversation.status = 'human_handoff';

    with cancelled as (
      update public.whatsapp_outbox item
      set status = 'cancelled',
          processed_at = coalesce(
            item.processed_at,
            (
              select conversation.closed_at
              from public.whatsapp_conversations conversation
              where conversation.id = item.conversation_id
            )
          ),
          locked_at = null,
          locked_until = null,
          locked_by = null,
          last_error = 'stale_handoff_expired'
      where item.conversation_id = any(v_stale_handoff_conversation_ids)
        and item.status in ('pending', 'retry')
      returning item.message_id
    )
    update public.whatsapp_messages message
    set status = 'ignored',
        processed_at = coalesce(message.processed_at, statement_timestamp()),
        error_code = 'stale_handoff_expired',
        error_message = null
    where message.id in (select cancelled.message_id from cancelled);

    update public.whatsapp_handoffs handoff
    set status = 'cancelled',
        assigned_user_id = null,
        resolved_at = coalesce(
          handoff.resolved_at,
          handoff.accepted_at,
          handoff.requested_at
        ),
        reason = null,
        resolution_notes = null,
        content_redacted_at = statement_timestamp()
    where handoff.id = any(v_stale_handoff_ids);
    get diagnostics v_stale_handoffs = row_count;
  end if;

  with candidates as (
    select event.id
    from public.whatsapp_webhook_events event
    where event.processing_status in ('processed', 'ignored', 'failed', 'dead_letter')
      and event.updated_at < statement_timestamp()
        - make_interval(days => v_policy.webhook_payload_days)
      and event.payload_redacted_at is null
    order by event.updated_at, event.id
    limit p_limit
    for update skip locked
  ), retained as (
    update public.whatsapp_webhook_events event
    set payload = jsonb_build_object(
          '_retention', jsonb_build_object(
            'redacted', true,
            'policyVersion', v_policy.policy_version,
            'redactedAt', statement_timestamp()
          )
        ),
        last_error = null,
        payload_redacted_at = statement_timestamp()
    from candidates
    where event.id = candidates.id
    returning 1
  )
  select count(*)::integer into v_webhooks from retained;

  -- A mensagem conserva o ledger de entrega. A outbox terminal, que contém o
  -- destinatário e o payload pronto para transporte, pode ser removida por inteiro.
  with candidates as (
    select item.id
    from public.whatsapp_outbox item
    where item.status in ('sent', 'failed', 'cancelled', 'dead_letter')
      and coalesce(item.processed_at, item.updated_at) < statement_timestamp()
        - make_interval(days => v_policy.operational_payload_days)
    order by coalesce(item.processed_at, item.updated_at), item.id
    limit p_limit
    for update skip locked
  ), removed as (
    delete from public.whatsapp_outbox item
    using candidates
    where item.id = candidates.id
    returning 1
  )
  select count(*)::integer into v_outbox from removed;

  with candidates as (
    select message.id
    from public.whatsapp_messages message
    join public.whatsapp_conversations conversation
      on conversation.id = message.conversation_id
    where conversation.status in ('completed', 'expired', 'closed', 'failed')
      and conversation.closed_at < statement_timestamp()
        - make_interval(days => v_policy.conversation_content_days)
      and message.created_at < statement_timestamp()
        - make_interval(days => v_policy.conversation_content_days)
      and message.content_redacted_at is null
    order by message.created_at, message.id
    limit p_limit
    for update of message skip locked
  ), retained as (
    update public.whatsapp_messages message
    set content = jsonb_build_object(
          '_retention', jsonb_build_object(
            'redacted', true,
            'policyVersion', v_policy.policy_version,
            'redactedAt', statement_timestamp()
          )
        ),
        normalized_content = jsonb_build_object(
          '_retention', jsonb_build_object('redacted', true)
        ),
        provider_payload = null,
        error_message = null,
        content_redacted_at = statement_timestamp()
    from candidates
    where message.id = candidates.id
    returning 1
  )
  select count(*)::integer into v_messages from retained;

  with candidates as (
    select conversation.id
    from public.whatsapp_conversations conversation
    where conversation.status in ('completed', 'expired', 'closed', 'failed')
      and conversation.closed_at < statement_timestamp()
        - make_interval(days => v_policy.conversation_content_days)
      and conversation.context_redacted_at is null
    order by conversation.closed_at, conversation.id
    limit p_limit
    for update skip locked
  ), retained as (
    update public.whatsapp_conversations conversation
    set context = jsonb_build_object(
          '_retention', jsonb_build_object(
            'redacted', true,
            'policyVersion', v_policy.policy_version,
            'redactedAt', statement_timestamp()
          )
        ),
        context_redacted_at = statement_timestamp()
    from candidates
    where conversation.id = candidates.id
    returning 1
  )
  select count(*)::integer into v_conversations from retained;

  with candidates as (
    select pending.provider, pending.provider_message_id, pending.status
    from public.whatsapp_pending_message_statuses pending
    where pending.created_at < statement_timestamp()
      - make_interval(days => v_policy.webhook_payload_days)
    order by pending.created_at
    limit p_limit
    for update skip locked
  ), removed as (
    delete from public.whatsapp_pending_message_statuses pending
    using candidates
    where pending.provider = candidates.provider
      and pending.provider_message_id = candidates.provider_message_id
      and pending.status = candidates.status
    returning 1
  )
  select count(*)::integer into v_pending_statuses from removed;

  with candidates as (
    select handoff.id
    from public.whatsapp_handoffs handoff
    where handoff.status in ('resolved', 'cancelled')
      and handoff.updated_at < statement_timestamp()
        - make_interval(days => v_policy.conversation_content_days)
      and handoff.content_redacted_at is null
      and (handoff.reason is not null or handoff.resolution_notes is not null)
    order by handoff.updated_at, handoff.id
    limit p_limit
    for update skip locked
  ), retained as (
    update public.whatsapp_handoffs handoff
    set reason = null,
        resolution_notes = null,
        content_redacted_at = statement_timestamp()
    from candidates
    where handoff.id = candidates.id
    returning 1
  )
  select count(*)::integer into v_handoffs from retained;

  with candidates as (
    select session.id
    from public.whatsapp_flow_sessions session
    where session.status in ('completed', 'expired', 'cancelled', 'failed')
      and session.expires_at < statement_timestamp()
        - make_interval(days => v_policy.conversation_content_days)
      and session.context_redacted_at is null
    order by session.expires_at, session.id
    limit p_limit
    for update skip locked
  ), retained as (
    update public.whatsapp_flow_sessions session
    set context = jsonb_build_object(
          '_retention', jsonb_build_object(
            'redacted', true,
            'policyVersion', v_policy.policy_version,
            'redactedAt', statement_timestamp()
          )
        ),
        context_redacted_at = statement_timestamp()
    from candidates
    where session.id = candidates.id
    returning 1
  )
  select count(*)::integer into v_flow_sessions from retained;

  -- Status, origem, versão da política e timestamps preservam a prova técnica.
  -- Evidência livre (IP, user-agent e campos do formulário) é redigida quando o
  -- consentimento já foi revogado ou substituído e ultrapassou o TTL de conteúdo.
  with candidates as (
    select opt_in.id
    from public.whatsapp_opt_ins opt_in
    where opt_in.evidence_redacted_at is null
      and (opt_in.superseded_at is not null or opt_in.status = 'revoked')
      and coalesce(opt_in.superseded_at, opt_in.revoked_at, opt_in.updated_at)
        < statement_timestamp()
          - make_interval(days => v_policy.conversation_content_days)
    order by coalesce(opt_in.superseded_at, opt_in.revoked_at, opt_in.updated_at),
      opt_in.id
    limit p_limit
    for update skip locked
  ), retained as (
    update public.whatsapp_opt_ins opt_in
    set evidence = jsonb_build_object(
          '_retention', jsonb_build_object(
            'redacted', true,
            'policyVersion', v_policy.policy_version,
            'redactedAt', statement_timestamp()
          )
        ),
        evidence_redacted_at = statement_timestamp()
    from candidates
    where opt_in.id = candidates.id
    returning 1
  )
  select count(*)::integer into v_opt_in_evidence from retained;

  -- A identidade técnica global só é anonimizada depois que todo o histórico
  -- relacionado está terminal, antigo e redigido, sem consentimento ou trabalho
  -- ativo. O ID permanece para integridade referencial; telefone/user_id reais são
  -- liberados para uma futura identidade do mesmo cliente.
  with candidates as (
    select contact.id
    from public.whatsapp_contacts contact
    where contact.retention_redacted_at is null
      and contact.customer_id is null
      and contact.last_seen_at < statement_timestamp()
        - make_interval(days => v_policy.conversation_content_days)
      and exists (
        select 1
        from public.whatsapp_conversations conversation
        where conversation.contact_id = contact.id
      )
      and not exists (
        select 1
        from public.whatsapp_conversations conversation
        where conversation.contact_id = contact.id
          and (
            conversation.status not in ('completed', 'expired', 'closed', 'failed') or
            conversation.closed_at is null or
            conversation.closed_at >= statement_timestamp()
              - make_interval(days => v_policy.conversation_content_days) or
            conversation.context_redacted_at is null
          )
      )
      and not exists (
        select 1
        from public.whatsapp_opt_ins opt_in
        where opt_in.contact_id = contact.id
          and opt_in.superseded_at is null
          and opt_in.status in ('granted', 'pending')
      )
      and not exists (
        select 1
        from public.whatsapp_opt_ins opt_in
        where opt_in.contact_id = contact.id
          and opt_in.evidence_redacted_at is null
      )
      and not exists (
        select 1
        from public.whatsapp_handoffs handoff
        join public.whatsapp_conversations conversation
          on conversation.id = handoff.conversation_id
        where conversation.contact_id = contact.id
          and handoff.status in ('requested', 'accepted')
      )
      and not exists (
        select 1
        from public.whatsapp_handoffs handoff
        join public.whatsapp_conversations conversation
          on conversation.id = handoff.conversation_id
        where conversation.contact_id = contact.id
          and handoff.content_redacted_at is null
          and (handoff.reason is not null or handoff.resolution_notes is not null)
      )
      and not exists (
        select 1
        from public.whatsapp_flow_sessions session
        join public.whatsapp_conversations conversation
          on conversation.id = session.conversation_id
        where conversation.contact_id = contact.id
          and session.status in ('created', 'active')
      )
      and not exists (
        select 1
        from public.whatsapp_flow_sessions session
        join public.whatsapp_conversations conversation
          on conversation.id = session.conversation_id
        where conversation.contact_id = contact.id
          and session.context_redacted_at is null
      )
      and not exists (
        select 1
        from public.whatsapp_messages message
        join public.whatsapp_conversations conversation
          on conversation.id = message.conversation_id
        where conversation.contact_id = contact.id
          and message.content_redacted_at is null
      )
      and not exists (
        select 1
        from public.whatsapp_outbox item
        join public.whatsapp_conversations conversation
          on conversation.id = item.conversation_id
        where conversation.contact_id = contact.id
      )
    order by contact.last_seen_at, contact.id
    limit p_limit
    for update skip locked
  ), retained as (
    update public.whatsapp_contacts contact
    set normalized_phone = '+999' || lpad(
          nextval('app_private.whatsapp_retained_phone_seq'::regclass)::text,
          12,
          '0'
        ),
        whatsapp_user_id = 'retained:' || contact.id::text,
        profile_name = null,
        customer_id = null,
        first_seen_at = statement_timestamp(),
        last_seen_at = statement_timestamp(),
        blocked_at = statement_timestamp(),
        metadata = jsonb_build_object(
          '_retention', jsonb_build_object(
            'redacted', true,
            'namespaceVersion', 'v1',
            'policyVersion', v_policy.policy_version,
            'redactedAt', statement_timestamp()
          )
        ),
        created_at = statement_timestamp(),
        retention_redacted_at = statement_timestamp()
    from candidates
    where contact.id = candidates.id
    returning 1
  )
  select count(*)::integer into v_contacts_anonymized from retained;

  with removed as (
    delete from app_private.whatsapp_webhook_rate_limits item
    where item.ctid in (
      select expired.ctid
      from app_private.whatsapp_webhook_rate_limits expired
      where expired.expires_at <= statement_timestamp()
      order by expired.expires_at
      limit p_limit
      for update skip locked
    )
    returning 1
  )
  select count(*)::integer into v_rate_limits from removed;

  return jsonb_build_object(
    'status', 'applied',
    'policyVersion', v_policy.policy_version,
    'webhookPayloadsRedacted', v_webhooks,
    'outboxRowsDeleted', v_outbox,
    'messageBodiesRedacted', v_messages,
    'conversationContextsRedacted', v_conversations,
    'pendingStatusesDeleted', v_pending_statuses,
    'handoffsRedacted', v_handoffs,
    'flowContextsRedacted', v_flow_sessions,
    'optInEvidenceRedacted', v_opt_in_evidence,
    'rateLimitRowsDeleted', v_rate_limits,
    'automatedSessionsExpired', v_sessions_expired,
    'staleHandoffsExpired', v_stale_handoffs,
    'contactsAnonymized', v_contacts_anonymized
  );
end;
$$;

revoke all on function public.configure_whatsapp_retention_policy(
  text, integer, integer, integer, boolean
) from public, anon, authenticated;
grant execute on function public.configure_whatsapp_retention_policy(
  text, integer, integer, integer, boolean
) to service_role;

revoke all on function public.apply_whatsapp_retention(integer)
from public, anon, authenticated;
grant execute on function public.apply_whatsapp_retention(integer)
to service_role;

commit;
