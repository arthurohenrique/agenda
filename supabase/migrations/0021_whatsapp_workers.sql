begin;

-- Recupera uma oitava tentativa cujo worker caiu antes de concluir/deferir. Sem
-- este sweep, o item expirado deixa de ser reclamável e bloqueia o HoL da conversa.
create or replace function app_private.exhaust_whatsapp_outbox_attempts(
  p_provider public.whatsapp_provider,
  p_conversation_id uuid default null
)
returns integer
language sql
security definer
set search_path = ''
as $$
  with exhausted as (
    update public.whatsapp_outbox item
    set status = 'dead_letter',
        processed_at = statement_timestamp(),
        locked_at = null,
        locked_until = null,
        locked_by = null,
        last_error = 'attempts_exhausted'
    where item.provider = p_provider
      and (p_conversation_id is null or item.conversation_id = p_conversation_id)
      and item.status = 'processing'
      and item.attempt_count >= 8
      and (item.locked_until is null or item.locked_until <= statement_timestamp())
    returning item.message_id
  ), marked as (
    update public.whatsapp_messages message
    set status = 'failed',
        error_code = 'attempts_exhausted',
        error_message = null,
        failed_at = coalesce(message.failed_at, statement_timestamp())
    where message.id in (select exhausted.message_id from exhausted)
    returning message.id
  )
  select count(*)::integer from marked;
$$;

create or replace function public.claim_whatsapp_webhook_events(
  p_limit integer,
  p_worker_id text,
  p_provider text
)
returns setof public.whatsapp_webhook_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.whatsapp_provider;
begin
  if p_limit < 1 or p_limit > 50
    or char_length(trim(coalesce(p_worker_id, ''))) not between 1 and 120
    or char_length(trim(coalesce(p_provider, ''))) < 1 then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_worker_claim';
  end if;

  begin
    v_provider := p_provider::public.whatsapp_provider;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_provider';
  end;

  -- Uma queda na oitava tentativa não pode deixar um stream bloqueado para sempre.
  update public.whatsapp_webhook_events event
  set processing_status = 'dead_letter',
      processed_at = statement_timestamp(),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      last_error = coalesce(event.last_error, 'attempts_exhausted')
  where event.provider = v_provider
    and event.processing_status in ('received', 'queued', 'processing')
    and event.attempts >= 8
    and (
      event.processing_status <> 'processing' or
      event.locked_until is null or
      event.locked_until <= statement_timestamp()
    );

  return query
  with claimable as (
    select event.id
    from public.whatsapp_webhook_events event
    where event.provider = v_provider
      and event.attempts < 8
      and event.next_attempt_at <= statement_timestamp()
      and event.processing_status in ('received', 'queued', 'processing')
      and (
        event.processing_status in ('received', 'queued') or
        event.locked_until is null or
        event.locked_until <= statement_timestamp()
      )
      and not exists (
        select 1
        from public.whatsapp_webhook_events predecessor
        where predecessor.provider = event.provider
          and predecessor.processing_status in ('received', 'queued', 'processing')
          and (predecessor.received_at, predecessor.id) < (event.received_at, event.id)
          and (
            predecessor.ordering_global_fallback or
            event.ordering_global_fallback or
            predecessor.ordering_keys && event.ordering_keys
          )
      )
    order by event.received_at, event.id
    for update of event skip locked
    limit p_limit
  )
  update public.whatsapp_webhook_events event
  set processing_status = 'processing',
      attempts = event.attempts + 1,
      locked_at = statement_timestamp(),
      locked_until = statement_timestamp() + interval '5 minutes',
      locked_by = trim(p_worker_id),
      last_error = null
  from claimable
  where event.id = claimable.id
  returning event.*;
end;
$$;

create or replace function public.complete_whatsapp_webhook_event(
  p_event_id uuid,
  p_worker_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with completed as (
    update public.whatsapp_webhook_events
    set processing_status = 'processed',
        processed_at = statement_timestamp(),
        locked_at = null,
        locked_until = null,
        locked_by = null,
        last_error = null
    where id = p_event_id
      and processing_status = 'processing'
      and locked_by = trim(p_worker_id)
      and locked_until > statement_timestamp()
    returning id
  )
  select exists(select 1 from completed);
$$;

-- Uso exclusivo do simulador: nunca captura eventos reais ou de outra correlação.
create or replace function public.claim_whatsapp_webhook_events_scoped(
  p_limit integer,
  p_worker_id text,
  p_provider text,
  p_correlation_id uuid
)
returns setof public.whatsapp_webhook_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.whatsapp_provider;
begin
  if p_limit < 1 or p_limit > 50
    or char_length(trim(coalesce(p_worker_id, ''))) not between 1 and 120
    or char_length(trim(coalesce(p_provider, ''))) < 1
    or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_worker_claim';
  end if;

  begin
    v_provider := p_provider::public.whatsapp_provider;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_provider';
  end;

  update public.whatsapp_webhook_events event
  set processing_status = 'dead_letter',
      processed_at = statement_timestamp(),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      last_error = coalesce(event.last_error, 'attempts_exhausted')
  where event.provider = v_provider
    and event.processing_status in ('received', 'queued', 'processing')
    and event.attempts >= 8
    and (
      event.processing_status <> 'processing' or
      event.locked_until is null or
      event.locked_until <= statement_timestamp()
    );

  return query
  with claimable as (
    select event.id
    from public.whatsapp_webhook_events event
    where event.provider = v_provider
      and event.correlation_id = p_correlation_id
      and event.attempts < 8
      and event.next_attempt_at <= statement_timestamp()
      and event.processing_status in ('received', 'queued', 'processing')
      and (
        event.processing_status in ('received', 'queued') or
        event.locked_until is null or
        event.locked_until <= statement_timestamp()
      )
      and not exists (
        select 1
        from public.whatsapp_webhook_events predecessor
        where predecessor.provider = event.provider
          and predecessor.processing_status in ('received', 'queued', 'processing')
          and (predecessor.received_at, predecessor.id) < (event.received_at, event.id)
          and (
            predecessor.ordering_global_fallback or
            event.ordering_global_fallback or
            predecessor.ordering_keys && event.ordering_keys
          )
      )
    order by event.received_at, event.id
    for update of event skip locked
    limit p_limit
  )
  update public.whatsapp_webhook_events event
  set processing_status = 'processing',
      attempts = event.attempts + 1,
      locked_at = statement_timestamp(),
      locked_until = statement_timestamp() + interval '5 minutes',
      locked_by = trim(p_worker_id),
      last_error = null
  from claimable
  where event.id = claimable.id
  returning event.*;
end;
$$;

create or replace function public.defer_whatsapp_webhook_event(
  p_event_id uuid,
  p_worker_id text,
  p_error text,
  p_retry boolean
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with deferred as (
    update public.whatsapp_webhook_events
    set processing_status = case
          when not p_retry then 'failed'::public.whatsapp_webhook_processing_status
          when attempts >= 8 then 'dead_letter'::public.whatsapp_webhook_processing_status
          else 'queued'::public.whatsapp_webhook_processing_status
        end,
        next_attempt_at = case
          when p_retry and attempts < 8 then
            statement_timestamp() + make_interval(
              secs => least(
                3600,
                (15 * power(2, least(attempts, 7)))::integer +
                floor(pg_catalog.random() * 16)::integer
              )
            )
          else next_attempt_at
        end,
        processed_at = case when p_retry and attempts < 8 then null else statement_timestamp() end,
        last_error = left(coalesce(nullif(trim(p_error), ''), 'unknown_error'), 500),
        locked_at = null,
        locked_until = null,
        locked_by = null
    where id = p_event_id
      and processing_status = 'processing'
      and locked_by = trim(p_worker_id)
    returning id
  )
  select exists(select 1 from deferred);
$$;

create or replace function public.claim_whatsapp_outbox(
  p_limit integer,
  p_worker_id text,
  p_provider text
)
returns setof public.whatsapp_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.whatsapp_provider;
begin
  if p_limit < 1 or p_limit > 50
    or char_length(trim(coalesce(p_worker_id, ''))) not between 1 and 120
    or char_length(trim(coalesce(p_provider, ''))) < 1 then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_worker_claim';
  end if;

  begin
    v_provider := p_provider::public.whatsapp_provider;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_provider';
  end;

  perform app_private.exhaust_whatsapp_outbox_attempts(v_provider, null);

  return query
  with claimable as (
    select item.id
    from public.whatsapp_outbox item
    where item.provider = v_provider
      and item.attempt_count < 8
      and item.scheduled_for <= statement_timestamp()
      and item.next_attempt_at <= statement_timestamp()
      and not exists (
        select 1
        from public.whatsapp_outbox predecessor
        where predecessor.provider = item.provider
          and predecessor.conversation_id = item.conversation_id
          and predecessor.status in ('pending', 'retry', 'processing')
          and (
            predecessor.scheduled_for,
            predecessor.created_at,
            predecessor.id
          ) < (
            item.scheduled_for,
            item.created_at,
            item.id
          )
      )
      and (
        item.status in ('pending', 'retry') or
        (
          item.status = 'processing'
          and (item.locked_until is null or item.locked_until <= statement_timestamp())
        )
      )
    order by item.next_attempt_at, item.scheduled_for, item.created_at, item.id
    for update skip locked
    limit p_limit
  )
  update public.whatsapp_outbox item
  set status = 'processing',
      attempt_count = item.attempt_count + 1,
      locked_at = statement_timestamp(),
      locked_until = statement_timestamp() + interval '5 minutes',
      locked_by = trim(p_worker_id),
      last_error = null
  from claimable
  where item.id = claimable.id
  returning item.*;
end;
$$;

create or replace function public.complete_whatsapp_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
  v_provider public.whatsapp_provider;
  v_pending public.whatsapp_pending_message_statuses%rowtype;
begin
  if char_length(trim(coalesce(p_provider_message_id, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'invalid_provider_message_id';
  end if;

  update public.whatsapp_outbox
  set status = 'sent',
      provider_message_id = trim(p_provider_message_id),
      processed_at = statement_timestamp(),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      last_error = null
  where id = p_outbox_id
    and status = 'processing'
    and locked_by = trim(p_worker_id)
  returning message_id, provider into v_message_id, v_provider;

  if v_message_id is null then
    return false;
  end if;

  update public.whatsapp_messages
  set provider_message_id = trim(p_provider_message_id),
      status = 'accepted',
      sent_at = coalesce(sent_at, statement_timestamp())
  where id = v_message_id;

  for v_pending in
    select pending.*
    from public.whatsapp_pending_message_statuses pending
    where pending.provider = v_provider
      and pending.provider_message_id = trim(p_provider_message_id)
    order by case pending.status
      when 'sent' then 1
      when 'delivered' then 2
      when 'read' then 3
      when 'failed' then 4
      else 5
    end, pending.event_timestamp
  loop
    perform public.apply_whatsapp_message_status(
      v_pending.provider::text,
      v_pending.provider_message_id,
      v_pending.status::text,
      v_pending.event_timestamp,
      v_pending.error_code
    );
  end loop;

  delete from public.whatsapp_pending_message_statuses
  where provider = v_provider
    and provider_message_id = trim(p_provider_message_id);

  return true;
end;
$$;

create or replace function public.mark_whatsapp_outbox_delivery_ambiguous(
  p_outbox_id uuid,
  p_worker_id text,
  p_provider_message_id text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
  v_provider public.whatsapp_provider;
  v_pending public.whatsapp_pending_message_statuses%rowtype;
  v_provider_message_id text := nullif(trim(p_provider_message_id), '');
begin
  if char_length(coalesce(v_provider_message_id, '')) > 300 then
    raise exception using errcode = '22023', message = 'invalid_provider_message_id';
  end if;

  update public.whatsapp_outbox
  set status = 'dead_letter',
      provider_message_id = v_provider_message_id,
      processed_at = statement_timestamp(),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      last_error = left(
        'delivery_unknown:' || coalesce(nullif(trim(p_error), ''), 'persistence_failure'),
        500
      )
  where id = p_outbox_id
    and status = 'processing'
    and locked_by = trim(p_worker_id)
  returning message_id, provider into v_message_id, v_provider;

  if v_message_id is null then
    return false;
  end if;

  update public.whatsapp_messages
  set provider_message_id = v_provider_message_id,
      status = 'accepted',
      sent_at = coalesce(sent_at, statement_timestamp()),
      error_code = 'delivery_unknown',
      error_message = left(coalesce(nullif(trim(p_error), ''), 'persistence_failure'), 500)
  where id = v_message_id;

  if v_provider_message_id is not null then
    for v_pending in
      select pending.*
      from public.whatsapp_pending_message_statuses pending
      where pending.provider = v_provider
        and pending.provider_message_id = v_provider_message_id
      order by pending.event_timestamp
    loop
      perform public.apply_whatsapp_message_status(
        v_pending.provider::text,
        v_pending.provider_message_id,
        v_pending.status::text,
        v_pending.event_timestamp,
        v_pending.error_code
      );
    end loop;

    delete from public.whatsapp_pending_message_statuses
    where provider = v_provider
      and provider_message_id = v_provider_message_id;
  end if;

  return true;
end;
$$;

-- Uso exclusivo do simulador: restringe o claim ao provider e à conversa criada no teste.
create or replace function public.claim_whatsapp_outbox_scoped(
  p_limit integer,
  p_worker_id text,
  p_provider text,
  p_conversation_id uuid
)
returns setof public.whatsapp_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.whatsapp_provider;
begin
  if p_limit < 1 or p_limit > 50
    or char_length(trim(coalesce(p_worker_id, ''))) not between 1 and 120
    or char_length(trim(coalesce(p_provider, ''))) < 1
    or p_conversation_id is null then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_worker_claim';
  end if;

  begin
    v_provider := p_provider::public.whatsapp_provider;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_provider';
  end;

  perform app_private.exhaust_whatsapp_outbox_attempts(
    v_provider,
    p_conversation_id
  );

  return query
  with claimable as (
    select item.id
    from public.whatsapp_outbox item
    where item.provider = v_provider
      and item.conversation_id = p_conversation_id
      and item.attempt_count < 8
      and item.scheduled_for <= statement_timestamp()
      and item.next_attempt_at <= statement_timestamp()
      and not exists (
        select 1
        from public.whatsapp_outbox predecessor
        where predecessor.provider = item.provider
          and predecessor.conversation_id = item.conversation_id
          and predecessor.status in ('pending', 'retry', 'processing')
          and (
            predecessor.scheduled_for,
            predecessor.created_at,
            predecessor.id
          ) < (
            item.scheduled_for,
            item.created_at,
            item.id
          )
      )
      and (
        item.status in ('pending', 'retry') or
        (
          item.status = 'processing'
          and (item.locked_until is null or item.locked_until <= statement_timestamp())
        )
      )
    order by item.next_attempt_at, item.scheduled_for, item.created_at, item.id
    for update of item skip locked
    limit p_limit
  )
  update public.whatsapp_outbox item
  set status = 'processing',
      attempt_count = item.attempt_count + 1,
      locked_at = statement_timestamp(),
      locked_until = statement_timestamp() + interval '5 minutes',
      locked_by = trim(p_worker_id),
      last_error = null
  from claimable
  where item.id = claimable.id
  returning item.*;
end;
$$;

create or replace function public.validate_whatsapp_outbox_delivery(
  p_outbox_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.whatsapp_outbox%rowtype;
  v_appointment public.appointments%rowtype;
  v_appointment_id uuid;
  v_conversation_id uuid;
  v_purpose text;
  v_event_type text;
  v_valid boolean;
  v_conversation_status public.whatsapp_conversation_status;
begin
  -- A conversa é o fence entre a validação imediatamente anterior ao envio e a
  -- entrada em handoff. A ordem do lock deve ser conversa -> outbox, igual à
  -- transição conversacional, para não abrir janela nem criar deadlock.
  select item.conversation_id into v_conversation_id
  from public.whatsapp_outbox item
  where item.id = p_outbox_id
    and item.status = 'processing'
    and item.locked_by = trim(p_worker_id)
    and item.locked_until > statement_timestamp();

  if v_conversation_id is null then
    return false;
  end if;

  select conversation.status into v_conversation_status
  from public.whatsapp_conversations conversation
  where conversation.id = v_conversation_id
  for update;

  select * into v_item
  from public.whatsapp_outbox item
  where item.id = p_outbox_id
    and item.status = 'processing'
    and item.locked_by = trim(p_worker_id)
    and item.locked_until > statement_timestamp()
  for update;

  if v_item.id is null then
    return false;
  end if;

  v_purpose := v_item.payload ->> 'purpose';
  if v_purpose in ('conversation_reply', 'handoff_acknowledgement') then
    v_valid := case v_purpose
      when 'handoff_acknowledgement' then v_conversation_status = 'human_handoff'
      else v_conversation_status in ('open', 'waiting_customer', 'processing')
        and v_item.last_error is distinct from 'conversation_handoff_requested'
    end;

    if v_valid then
      return true;
    end if;

    update public.whatsapp_outbox
    set status = 'cancelled',
        processed_at = statement_timestamp(),
        locked_at = null,
        locked_until = null,
        locked_by = null,
        last_error = 'conversation_delivery_invalidated'
    where id = v_item.id;

    update public.whatsapp_messages
    set status = 'ignored',
        processed_at = coalesce(processed_at, statement_timestamp()),
        error_code = 'conversation_delivery_invalidated',
        error_message = null
    where id = v_item.message_id;

    return false;
  end if;

  if v_purpose not in (
    'appointment_created', 'appointment_confirmed', 'appointment_reminder',
    'appointment_rescheduled', 'appointment_cancelled',
    'appointment_confirmation_request'
  ) then
    return true;
  end if;

  begin
    v_appointment_id := (v_item.payload ->> 'appointmentId')::uuid;
  exception when invalid_text_representation then
    v_appointment_id := null;
  end;
  v_event_type := v_item.payload ->> 'eventType';

  if v_appointment_id is not null then
    select * into v_appointment
    from public.appointments appointment
    where appointment.id = v_appointment_id
      and appointment.tenant_id is not distinct from v_item.tenant_id
    for key share;
  end if;

  v_valid := v_appointment.id is not null and case v_purpose
    when 'appointment_cancelled' then
      v_event_type = 'appointment.cancelled'
      and v_appointment.status in ('cancelled_by_customer', 'cancelled_by_business')
    when 'appointment_rescheduled' then
      v_event_type = 'appointment.rescheduled'
      and v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    when 'appointment_reminder' then
      v_event_type = 'appointment.reminder_due'
      and v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    when 'appointment_confirmed' then
      v_event_type = 'appointment.confirmed'
      and v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    when 'appointment_created' then
      v_event_type = 'appointment.created'
      and v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    when 'appointment_confirmation_request' then
      v_appointment.occupies_slot
      and v_appointment.starts_at > statement_timestamp()
    else false
  end;

  if v_valid then
    return true;
  end if;

  update public.whatsapp_outbox
  set status = 'cancelled',
      processed_at = statement_timestamp(),
      locked_at = null,
      locked_until = null,
      locked_by = null,
      last_error = 'appointment_delivery_invalidated'
  where id = v_item.id;

  update public.whatsapp_messages
  set status = 'ignored',
      error_code = 'appointment_delivery_invalidated'
  where id = v_item.message_id;

  return false;
end;
$$;

create or replace function public.defer_whatsapp_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_error text,
  p_retry boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
  v_terminal boolean;
begin
  update public.whatsapp_outbox
  set status = case
        when not p_retry then 'failed'::public.whatsapp_outbox_status
        when attempt_count >= 8 then 'dead_letter'::public.whatsapp_outbox_status
        else 'retry'::public.whatsapp_outbox_status
      end,
      next_attempt_at = case
        when p_retry and attempt_count < 8 and provider = 'mock'
          then statement_timestamp()
        when p_retry and attempt_count < 8 then
          statement_timestamp() + make_interval(
            secs => least(
              3600,
              (15 * power(2, least(attempt_count, 7)))::integer +
              floor(pg_catalog.random() * 16)::integer
            )
          )
        else next_attempt_at
      end,
      processed_at = case when p_retry and attempt_count < 8 then null else statement_timestamp() end,
      last_error = left(coalesce(nullif(trim(p_error), ''), 'unknown_error'), 500),
      locked_at = null,
      locked_until = null,
      locked_by = null
  where id = p_outbox_id
    and status = 'processing'
    and locked_by = trim(p_worker_id)
  returning message_id, (status in ('failed', 'dead_letter'))
    into v_message_id, v_terminal;

  if v_message_id is null then
    return false;
  end if;

  if v_terminal then
    update public.whatsapp_messages
    set status = 'failed',
        error_code = left(coalesce(nullif(trim(p_error), ''), 'unknown_error'), 120),
        error_message = left(coalesce(nullif(trim(p_error), ''), 'unknown_error'), 500),
        failed_at = statement_timestamp()
    where id = v_message_id;
  end if;

  return true;
end;
$$;

create or replace function public.find_whatsapp_inbound_message(
  p_provider text,
  p_provider_message_id text
)
returns table (
  message_id uuid,
  conversation_id uuid,
  tenant_id uuid,
  conversation_status public.whatsapp_conversation_status,
  current_state text,
  processed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider public.whatsapp_provider;
begin
  begin
    v_provider := p_provider::public.whatsapp_provider;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_provider';
  end;

  if char_length(trim(coalesce(p_provider_message_id, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'invalid_provider_message_id';
  end if;

  return query
  select
    message.id,
    conversation.id,
    conversation.tenant_id,
    conversation.status,
    conversation.current_state,
    message.processed_at is not null
  from public.whatsapp_messages message
  join public.whatsapp_conversations conversation on conversation.id = message.conversation_id
  where message.provider = v_provider
    and message.provider_message_id = trim(p_provider_message_id)
    and message.direction = 'inbound'
  limit 1;
end;
$$;

create or replace function public.record_whatsapp_inbound_message(
  p_provider text,
  p_provider_message_id text,
  p_conversation_id uuid,
  p_message_type text,
  p_text text,
  p_provider_reply_to_id text,
  p_received_at timestamptz
)
returns table (
  message_id uuid,
  duplicate boolean,
  processed boolean,
  stale boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.whatsapp_provider;
  v_message_type public.whatsapp_message_type;
  v_conversation public.whatsapp_conversations%rowtype;
  v_phone_provider public.whatsapp_provider;
  v_existing public.whatsapp_messages%rowtype;
  v_message_id uuid;
  v_stale boolean;
  -- plpgsql proíbe variável de linha em lista INTO com vários itens; o registro
  -- intermediário mantém a consulta única e o lock original.
  v_row record;
begin
  begin
    v_provider := p_provider::public.whatsapp_provider;
    v_message_type := p_message_type::public.whatsapp_message_type;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_inbound_message';
  end;

  if char_length(trim(coalesce(p_provider_message_id, ''))) not between 1 and 300
    or v_message_type not in ('text', 'button', 'list', 'unsupported')
    or char_length(coalesce(p_text, '')) > 4096
    or char_length(coalesce(p_provider_reply_to_id, '')) > 300
    or p_received_at is null then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_inbound_message';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_provider::text || ':' || trim(p_provider_message_id), 0
  ));

  select conversation as conversation_row, phone.provider as phone_provider
    into v_row
  from public.whatsapp_conversations conversation
  join public.whatsapp_phone_numbers phone on phone.id = conversation.phone_number_id
  where conversation.id = p_conversation_id
  for update of conversation;

  if found then
    v_conversation := v_row.conversation_row;
    v_phone_provider := v_row.phone_provider;
  end if;

  if v_conversation.id is null
    or v_conversation.status in ('completed', 'expired', 'closed', 'failed') then
    raise exception using errcode = 'P0002', message = 'whatsapp_conversation_not_found';
  end if;

  if v_phone_provider <> v_provider then
    raise exception using errcode = '22023', message = 'whatsapp_provider_mismatch';
  end if;

  v_stale := v_conversation.last_inbound_at is not null
    and p_received_at < v_conversation.last_inbound_at;

  select * into v_existing
  from public.whatsapp_messages message
  where message.provider = v_provider
    and message.provider_message_id = trim(p_provider_message_id)
    and message.direction = 'inbound'
  for update;

  if v_existing.id is not null then
    return query select
      v_existing.id,
      true,
      v_existing.processed_at is not null,
      v_stale;
    return;
  end if;

  insert into public.whatsapp_messages (
    conversation_id,
    tenant_id,
    provider,
    direction,
    message_type,
    provider_message_id,
    provider_reply_to_id,
    status,
    content,
    normalized_content,
    provider_payload,
    sent_at
  ) values (
    p_conversation_id,
    case when v_stale then null else v_conversation.tenant_id end,
    v_provider,
    'inbound',
    v_message_type,
    trim(p_provider_message_id),
    nullif(trim(p_provider_reply_to_id), ''),
    'received',
    jsonb_build_object('text', coalesce(p_text, '')),
    jsonb_build_object('text', coalesce(p_text, '')),
    '{}'::jsonb,
    p_received_at
  ) returning id into v_message_id;

  update public.whatsapp_conversations
  set last_inbound_at = case
        when last_inbound_at is null then p_received_at
        else greatest(last_inbound_at, p_received_at)
      end,
      service_window_expires_at = case
        when service_window_expires_at is null then p_received_at + interval '24 hours'
        else greatest(service_window_expires_at, p_received_at + interval '24 hours')
      end
  where id = p_conversation_id;

  update public.whatsapp_contacts
  set last_seen_at = greatest(last_seen_at, p_received_at)
  where id = v_conversation.contact_id;

  return query select v_message_id, false, false, v_stale;
end;
$$;

create or replace function public.lock_whatsapp_conversation(
  p_conversation_id uuid,
  p_expected_version bigint,
  p_worker_id text
)
returns public.whatsapp_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
begin
  if p_expected_version < 1 or char_length(trim(coalesce(p_worker_id, ''))) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'invalid_conversation_lock';
  end if;

  select * into v_conversation
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if v_conversation.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_conversation_not_found';
  end if;

  if v_conversation.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'whatsapp_conversation_version_conflict';
  end if;

  if v_conversation.status in ('completed', 'expired', 'closed', 'failed') then
    raise exception using errcode = '22023', message = 'whatsapp_conversation_terminal';
  end if;

  if v_conversation.processing_locked_until > statement_timestamp()
    and v_conversation.processing_locked_by <> trim(p_worker_id) then
    raise exception using errcode = '55P03', message = 'whatsapp_conversation_locked';
  end if;

  update public.whatsapp_conversations
  set processing_locked_at = statement_timestamp(),
      processing_locked_until = statement_timestamp() + interval '2 minutes',
      processing_locked_by = trim(p_worker_id)
  where id = p_conversation_id
  returning * into v_conversation;

  return v_conversation;
end;
$$;

-- p_responses: array de objetos com idempotency_key, message_type, content e payload opcionais.
create or replace function public.commit_whatsapp_conversation_transition(
  p_conversation_id uuid,
  p_inbound_message_id uuid,
  p_expected_version bigint,
  p_state text,
  p_status text,
  p_tenant_id uuid,
  p_context jsonb,
  p_responses jsonb,
  p_recipient text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_inbound_message public.whatsapp_messages%rowtype;
  v_status public.whatsapp_conversation_status;
  v_provider public.whatsapp_provider;
  v_contact_phone text;
  v_timeout integer;
  v_response jsonb;
  v_message_id uuid;
  v_message_type public.whatsapp_message_type;
  v_idempotency_key text;
  v_handoff_requested_by public.whatsapp_handoff_requester;
  v_handoff_reason text;
  -- plpgsql proíbe variável de linha em lista INTO com vários itens.
  v_row record;
begin
  if p_expected_version < 1
    or char_length(trim(coalesce(p_state, ''))) not between 1 and 100
    or jsonb_typeof(coalesce(p_context, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_responses, 'null'::jsonb)) <> 'array'
    or p_recipient !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'invalid_conversation_transition';
  end if;

  begin
    v_status := p_status::public.whatsapp_conversation_status;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_conversation_status';
  end;

  if v_status = 'human_handoff' and jsonb_array_length(p_responses) > 1 then
    raise exception using errcode = '22023', message = 'invalid_handoff_acknowledgement';
  end if;

  select conversation as conversation_row,
         phone.provider as phone_provider,
         contact.normalized_phone as contact_phone
    into v_row
  from public.whatsapp_conversations conversation
  join public.whatsapp_phone_numbers phone on phone.id = conversation.phone_number_id
  join public.whatsapp_contacts contact on contact.id = conversation.contact_id
  where conversation.id = p_conversation_id
  for update of conversation;

  if found then
    v_conversation := v_row.conversation_row;
    v_provider := v_row.phone_provider;
    v_contact_phone := v_row.contact_phone;
  end if;

  if v_conversation.id is null or v_conversation.version <> p_expected_version then
    return false;
  end if;

  if v_conversation.status in ('completed', 'expired', 'closed', 'failed') then
    return false;
  end if;

  -- Se a validação de uma resposta já começou sob uma lease válida, a entrada em
  -- handoff precisa ser tentada novamente depois do dispatch. Se o handoff obteve
  -- o lock primeiro, validate_whatsapp_outbox_delivery espera e cancela a resposta.
  if v_status = 'human_handoff'
    and v_conversation.status <> 'human_handoff'
    and exists (
      select 1
      from public.whatsapp_outbox item
      where item.conversation_id = p_conversation_id
        and item.status = 'processing'
        and item.locked_until > statement_timestamp()
        and item.payload ->> 'purpose' = 'conversation_reply'
    ) then
    raise exception using
      errcode = '55P03',
      message = 'whatsapp_outbox_dispatch_in_progress';
  end if;

  select * into v_inbound_message
  from public.whatsapp_messages message
  where message.id = p_inbound_message_id
    and message.direction = 'inbound'
    and (
      message.conversation_id = p_conversation_id or (
        message.conversation_id::text = v_conversation.context ->> 'previousConversationId'
        and v_conversation.context ->> 'restartReason' in ('tenant_change', 'session_expired')
      )
    )
  for update;

  if v_inbound_message.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_inbound_message_not_found';
  end if;

  if v_inbound_message.processed_at is not null then
    return false;
  end if;

  if v_contact_phone <> p_recipient then
    raise exception using errcode = '22023', message = 'whatsapp_recipient_mismatch';
  end if;

  if v_conversation.tenant_id is not null
    and p_tenant_id is not null
    and v_conversation.tenant_id <> p_tenant_id then
    raise exception using errcode = '22023', message = 'tenant_switch_requires_new_conversation';
  end if;

  if v_conversation.tenant_id is null and p_tenant_id is not null and not exists (
    select 1 from public.whatsapp_phone_number_tenants link
    where link.phone_number_id = v_conversation.phone_number_id
      and link.tenant_id = p_tenant_id
      and link.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'whatsapp_tenant_not_linked';
  end if;

  select coalesce(settings.session_timeout_minutes, 30)
    into v_timeout
  from (select 1) seed
  left join public.tenant_whatsapp_settings settings
    on settings.tenant_id = coalesce(v_conversation.tenant_id, p_tenant_id);

  update public.whatsapp_conversations
  set tenant_id = coalesce(v_conversation.tenant_id, p_tenant_id),
      current_state = trim(p_state),
      status = v_status,
      context = p_context,
      version = version + 1,
      session_expires_at = statement_timestamp() + make_interval(mins => coalesce(v_timeout, 30)),
      last_inbound_at = case
        when last_inbound_at is null then v_inbound_message.sent_at
        else greatest(last_inbound_at, v_inbound_message.sent_at)
      end,
      last_outbound_at = case
        when jsonb_array_length(p_responses) > 0 then statement_timestamp()
        else last_outbound_at
      end,
      closed_at = case
        when v_status in ('completed', 'expired', 'closed', 'failed')
          then coalesce(closed_at, statement_timestamp())
        else null
      end,
      handoff_requested_at = case
        when v_status = 'human_handoff' then coalesce(handoff_requested_at, statement_timestamp())
        else handoff_requested_at
      end,
      processing_locked_at = null,
      processing_locked_until = null,
      processing_locked_by = null
  where id = p_conversation_id;

  if v_status = 'human_handoff' and not exists (
    select 1 from public.whatsapp_handoffs handoff
    where handoff.conversation_id = p_conversation_id
      and handoff.status in ('requested', 'accepted')
  ) then
    begin
      v_handoff_requested_by := coalesce(
        nullif(p_context #>> '{handoff,requestedBy}', ''),
        'automation'
      )::public.whatsapp_handoff_requester;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid_handoff_requester';
    end;
    v_handoff_reason := coalesce(
      nullif(trim(p_context #>> '{handoff,reason}'), ''),
      'conversation_transition'
    );
    if char_length(v_handoff_reason) > 1000 then
      raise exception using errcode = '22023', message = 'invalid_handoff_reason';
    end if;

    insert into public.whatsapp_handoffs (
      conversation_id, tenant_id, requested_by, reason, status
    ) values (
      p_conversation_id,
      coalesce(v_conversation.tenant_id, p_tenant_id),
      v_handoff_requested_by,
      v_handoff_reason,
      'requested'
    );
  end if;

  if v_status = 'human_handoff' then
    with cancelled as (
      update public.whatsapp_outbox item
      set status = 'cancelled',
          processed_at = statement_timestamp(),
          locked_at = null,
          locked_until = null,
          locked_by = null,
          last_error = 'conversation_handoff_requested'
      where item.conversation_id = p_conversation_id
        and item.status in ('pending', 'retry')
      returning item.message_id
    )
    update public.whatsapp_messages message
    set status = 'ignored',
        processed_at = coalesce(message.processed_at, statement_timestamp()),
        error_code = 'conversation_handoff_requested',
        error_message = null
    where message.id in (select cancelled.message_id from cancelled);

    -- Mantém ownership do item já reclamado, mas grava uma barreira durável para
    -- que ele continue inválido mesmo se o handoff for resolvido antes do validate.
    update public.whatsapp_outbox item
    set last_error = 'conversation_handoff_requested'
    where item.conversation_id = p_conversation_id
      and item.status = 'processing'
      and item.payload ->> 'purpose' = 'conversation_reply';
  end if;

  for v_response in select value from jsonb_array_elements(p_responses)
  loop
    if jsonb_typeof(v_response) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid_whatsapp_response';
    end if;

    v_idempotency_key := nullif(trim(v_response ->> 'idempotency_key'), '');
    if char_length(coalesce(v_idempotency_key, '')) not between 1 and 200 then
      raise exception using errcode = '22023', message = 'invalid_whatsapp_response_idempotency';
    end if;

    begin
      v_message_type := coalesce(v_response ->> 'message_type', 'text')::public.whatsapp_message_type;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid_whatsapp_message_type';
    end;

    insert into public.whatsapp_messages (
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
      p_conversation_id,
      coalesce(v_conversation.tenant_id, p_tenant_id),
      v_provider,
      'outbound',
      v_message_type,
      v_idempotency_key,
      'queued',
      coalesce(v_response -> 'content', '{}'::jsonb),
      coalesce(v_response -> 'normalized_content', v_response -> 'content', '{}'::jsonb)
    )
    returning id into v_message_id;

    insert into public.whatsapp_outbox (
      tenant_id,
      phone_number_id,
      provider,
      conversation_id,
      message_id,
      recipient,
      message_kind,
      payload,
      scheduled_for
    ) values (
      coalesce(v_conversation.tenant_id, p_tenant_id),
      v_conversation.phone_number_id,
      v_provider,
      p_conversation_id,
      v_message_id,
      p_recipient,
      v_message_type,
      jsonb_build_object(
        'recipient', p_recipient,
        'response', coalesce(v_response -> 'payload', v_response -> 'content', '{}'::jsonb),
        'idempotencyKey', v_idempotency_key,
        'purpose', case
          when v_status = 'human_handoff' then 'handoff_acknowledgement'
          else 'conversation_reply'
        end
      ),
      case
        when v_status = 'human_handoff' then statement_timestamp()
        else coalesce((v_response ->> 'scheduled_for')::timestamptz, statement_timestamp())
      end
    );
  end loop;

  -- Somente o inbound que decidiu esta transição acompanha a conversa sucessora.
  -- Em tenant_change ele vira platform-owned (tenant nulo) até a confirmação;
  -- o restante do histórico continua ligado ao tenant de origem.
  update public.whatsapp_messages
  set conversation_id = p_conversation_id,
      tenant_id = coalesce(v_conversation.tenant_id, p_tenant_id),
      processed_at = statement_timestamp()
  where id = v_inbound_message.id;

  return true;
end;
$$;

create or replace function public.enqueue_whatsapp_response(
  p_conversation_id uuid,
  p_response jsonb,
  p_recipient text,
  p_idempotency_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_provider public.whatsapp_provider;
  v_contact_phone text;
  v_payload jsonb;
  v_content jsonb;
  v_kind text;
  v_message_type public.whatsapp_message_type;
  v_message_id uuid;
  -- plpgsql proíbe variável de linha em lista INTO com vários itens.
  v_row record;
begin
  if jsonb_typeof(coalesce(p_response, 'null'::jsonb)) <> 'object'
    or p_recipient !~ '^\+[1-9][0-9]{7,14}$'
    or char_length(trim(coalesce(p_idempotency_key, ''))) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_response';
  end if;

  v_payload := case
    when jsonb_typeof(p_response -> 'payload') = 'object' then p_response -> 'payload'
    else p_response
  end;
  v_kind := nullif(trim(v_payload ->> 'kind'), '');

  if v_kind not in ('text', 'reply_buttons', 'list', 'template', 'flow') then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_response_kind';
  end if;

  begin
    v_message_type := coalesce(
      nullif(p_response ->> 'message_type', ''),
      case when v_kind = 'reply_buttons' then 'button' else v_kind end
    )::public.whatsapp_message_type;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_message_type';
  end;

  if (v_kind in ('text', 'reply_buttons', 'list', 'flow')
      and char_length(trim(coalesce(v_payload ->> 'body', ''))) not between 1 and 4096)
    or (v_kind = 'template' and (
      char_length(trim(coalesce(v_payload ->> 'name', ''))) not between 1 and 512
      or char_length(trim(coalesce(v_payload ->> 'language', ''))) not between 2 and 20
      or jsonb_typeof(coalesce(v_payload -> 'components', 'null'::jsonb)) <> 'array'
    )) then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_response_payload';
  end if;

  select conversation as conversation_row,
         phone.provider as phone_provider,
         contact.normalized_phone as contact_phone
    into v_row
  from public.whatsapp_conversations conversation
  join public.whatsapp_phone_numbers phone on phone.id = conversation.phone_number_id
  join public.whatsapp_contacts contact on contact.id = conversation.contact_id
  where conversation.id = p_conversation_id
  for update of conversation;

  if found then
    v_conversation := v_row.conversation_row;
    v_provider := v_row.phone_provider;
    v_contact_phone := v_row.contact_phone;
  end if;

  if v_conversation.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_conversation_not_found';
  end if;

  if v_conversation.status in ('completed', 'expired', 'closed', 'failed') then
    return false;
  end if;

  if v_contact_phone <> p_recipient then
    raise exception using errcode = '22023', message = 'whatsapp_recipient_mismatch';
  end if;

  if exists (
    select 1 from public.whatsapp_messages message
    where message.conversation_id = p_conversation_id
      and message.idempotency_key = trim(p_idempotency_key)
  ) then
    return true;
  end if;

  v_content := coalesce(
    p_response -> 'content',
    case
      when v_kind in ('text', 'reply_buttons', 'list', 'flow')
        then jsonb_build_object('text', v_payload ->> 'body')
      else jsonb_build_object(
        'templateName', v_payload ->> 'name',
        'language', v_payload ->> 'language'
      )
    end
  );

  insert into public.whatsapp_messages (
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
    p_conversation_id,
    v_conversation.tenant_id,
    v_provider,
    'outbound',
    v_message_type,
    trim(p_idempotency_key),
    'queued',
    v_content,
    coalesce(p_response -> 'normalized_content', v_content)
  ) returning id into v_message_id;

  insert into public.whatsapp_outbox (
    tenant_id,
    phone_number_id,
    provider,
    conversation_id,
    message_id,
    recipient,
    message_kind,
    payload
  ) values (
    v_conversation.tenant_id,
    v_conversation.phone_number_id,
    v_provider,
    p_conversation_id,
    v_message_id,
    p_recipient,
    v_message_type,
    jsonb_build_object(
      'recipient', p_recipient,
      'response', v_payload,
      'idempotencyKey', trim(p_idempotency_key),
      'purpose', 'conversation_reply'
    )
  );

  update public.whatsapp_conversations
  set last_outbound_at = statement_timestamp()
  where id = p_conversation_id;

  return true;
end;
$$;

create or replace function public.apply_whatsapp_message_status(
  p_provider text,
  p_provider_message_id text,
  p_status text,
  p_timestamp timestamptz,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.whatsapp_provider;
  v_message public.whatsapp_messages%rowtype;
  v_timestamp timestamptz := coalesce(p_timestamp, statement_timestamp());
begin
  if p_provider is null then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_provider';
  end if;

  begin
    v_provider := p_provider::public.whatsapp_provider;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_provider';
  end;

  if char_length(trim(coalesce(p_provider_message_id, ''))) not between 1 and 300
    or coalesce(p_status, '') not in ('sent', 'delivered', 'read', 'failed')
    or char_length(coalesce(p_error_code, '')) > 120 then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_message_status';
  end if;

  select * into v_message
  from public.whatsapp_messages message
  where message.provider = v_provider
    and message.provider_message_id = trim(p_provider_message_id)
    and message.direction = 'outbound'
  for update;

  if v_message.id is null then
    insert into public.whatsapp_pending_message_statuses (
      provider, provider_message_id, status, event_timestamp, error_code
    ) values (
      v_provider,
      trim(p_provider_message_id),
      p_status::public.whatsapp_message_status,
      v_timestamp,
      nullif(trim(p_error_code), '')
    )
    on conflict (provider, provider_message_id, status)
    do update set
      event_timestamp = least(
        public.whatsapp_pending_message_statuses.event_timestamp,
        excluded.event_timestamp
      ),
      error_code = coalesce(excluded.error_code, public.whatsapp_pending_message_statuses.error_code),
      updated_at = statement_timestamp();
    return true;
  end if;

  update public.whatsapp_messages
  set status = case p_status
        when 'read' then 'read'::public.whatsapp_message_status
        when 'delivered' then case
          when v_message.status = 'read' then 'read'::public.whatsapp_message_status
          else 'delivered'::public.whatsapp_message_status
        end
        when 'sent' then case
          when v_message.status in ('delivered', 'read', 'failed') then v_message.status
          else 'sent'::public.whatsapp_message_status
        end
        when 'failed' then case
          when v_message.status in ('delivered', 'read') then v_message.status
          else 'failed'::public.whatsapp_message_status
        end
      end,
      sent_at = case
        when p_status in ('sent', 'delivered', 'read') then coalesce(sent_at, v_timestamp)
        else sent_at
      end,
      delivered_at = case
        when p_status in ('delivered', 'read') then coalesce(delivered_at, v_timestamp)
        else delivered_at
      end,
      read_at = case when p_status = 'read' then coalesce(read_at, v_timestamp) else read_at end,
      failed_at = case
        when p_status = 'failed' and v_message.status not in ('delivered', 'read')
          then coalesce(failed_at, v_timestamp)
        else failed_at
      end,
      error_code = case
        when p_status = 'failed' and v_message.status not in ('delivered', 'read')
          then nullif(trim(p_error_code), '')
        when p_status in ('delivered', 'read') then null
        else error_code
      end,
      error_message = case when p_status in ('delivered', 'read') then null else error_message end
  where id = v_message.id;

  delete from public.whatsapp_pending_message_statuses
  where provider = v_provider
    and provider_message_id = trim(p_provider_message_id)
    and status = p_status::public.whatsapp_message_status;

  return true;
end;
$$;

create or replace function app_private.cancel_whatsapp_conversation_backlog(
  p_conversation_id uuid,
  p_reason text
)
returns integer
language sql
security definer
set search_path = ''
as $$
  with cancelled as (
    update public.whatsapp_outbox item
    set status = 'cancelled',
        processed_at = statement_timestamp(),
        locked_at = null,
        locked_until = null,
        locked_by = null,
        last_error = left(coalesce(nullif(trim(p_reason), ''), 'conversation_closed'), 500)
    where item.conversation_id = p_conversation_id
      and item.status in ('pending', 'retry')
    returning item.message_id
  ), marked as (
    update public.whatsapp_messages message
    set status = 'ignored',
        error_code = left(coalesce(nullif(trim(p_reason), ''), 'conversation_closed'), 120)
    where message.id in (select cancelled.message_id from cancelled)
    returning message.id
  )
  select count(*)::integer from marked;
$$;

create or replace function public.restart_whatsapp_conversation(p_conversation_id uuid)
returns public.whatsapp_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.whatsapp_conversations%rowtype;
  v_created public.whatsapp_conversations%rowtype;
  v_timeout integer;
begin
  select * into v_previous
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if v_previous.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_conversation_not_found';
  end if;

  select coalesce(settings.session_timeout_minutes, 30)
    into v_timeout
  from (select 1) seed
  left join public.tenant_whatsapp_settings settings on settings.tenant_id = v_previous.tenant_id;

  perform app_private.cancel_whatsapp_conversation_backlog(
    v_previous.id,
    'conversation_restarted'
  );

  update public.whatsapp_conversations
  set status = 'closed',
      closed_at = statement_timestamp(),
      version = version + 1,
      processing_locked_at = null,
      processing_locked_until = null,
      processing_locked_by = null
  where id = v_previous.id;

  insert into public.whatsapp_conversations (
    phone_number_id,
    contact_id,
    tenant_id,
    status,
    current_state,
    service_window_expires_at,
    session_expires_at,
    context,
    version
  ) values (
    v_previous.phone_number_id,
    v_previous.contact_id,
    null,
    'open',
    'TENANT_SEARCH',
    v_previous.service_window_expires_at,
    statement_timestamp() + make_interval(mins => coalesce(v_timeout, 30)),
    jsonb_build_object(
      'entryState', 'START',
      'previousConversationId', v_previous.id,
      'restartReason', 'tenant_change'
    ),
    1
  ) returning * into v_created;

  return v_created;
end;
$$;

create or replace function public.expire_whatsapp_conversation(p_conversation_id uuid)
returns public.whatsapp_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.whatsapp_conversations%rowtype;
  v_created public.whatsapp_conversations%rowtype;
  v_timeout integer;
begin
  select * into v_previous
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if v_previous.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_conversation_not_found';
  end if;

  if v_previous.status = 'expired' then
    select * into v_created
    from public.whatsapp_conversations conversation
    where conversation.phone_number_id = v_previous.phone_number_id
      and conversation.contact_id = v_previous.contact_id
      and conversation.context ->> 'previousConversationId' = v_previous.id::text
      and conversation.context ->> 'restartReason' = 'session_expired'
    order by conversation.created_at desc
    limit 1;

    if v_created.id is not null then
      return v_created;
    end if;
    return v_previous;
  end if;

  if v_previous.status in ('completed', 'closed', 'failed')
    or v_previous.session_expires_at is null
    or v_previous.session_expires_at > statement_timestamp() then
    return v_previous;
  end if;

  select coalesce(settings.session_timeout_minutes, 30)
    into v_timeout
  from (select 1) seed
  left join public.tenant_whatsapp_settings settings on settings.tenant_id = v_previous.tenant_id;

  perform app_private.cancel_whatsapp_conversation_backlog(
    v_previous.id,
    'conversation_session_expired'
  );

  update public.whatsapp_conversations
  set status = 'expired',
      current_state = 'EXPIRED',
      closed_at = statement_timestamp(),
      version = version + 1,
      processing_locked_at = null,
      processing_locked_until = null,
      processing_locked_by = null
  where id = v_previous.id;

  insert into public.whatsapp_conversations (
    phone_number_id,
    contact_id,
    tenant_id,
    status,
    current_state,
    service_window_expires_at,
    session_expires_at,
    context,
    version
  ) values (
    v_previous.phone_number_id,
    v_previous.contact_id,
    null,
    'open',
    'START',
    v_previous.service_window_expires_at,
    statement_timestamp() + make_interval(mins => coalesce(v_timeout, 30)),
    jsonb_build_object(
      'previousConversationId', v_previous.id,
      'restartReason', 'session_expired'
    ),
    1
  ) returning * into v_created;

  return v_created;
end;
$$;

create or replace function public.commit_whatsapp_conversation_restart(
  p_conversation_id uuid,
  p_inbound_message_id uuid,
  p_expected_version bigint,
  p_restart_reason text,
  p_state text,
  p_status text,
  p_tenant_id uuid,
  p_context jsonb,
  p_responses jsonb,
  p_recipient text
)
returns public.whatsapp_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.whatsapp_conversations%rowtype;
  v_created public.whatsapp_conversations%rowtype;
  v_existing public.whatsapp_conversations%rowtype;
  v_inbound_processed_at timestamptz;
  v_context jsonb;
  v_committed boolean;
begin
  if p_restart_reason not in ('tenant_change', 'session_expired')
    or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'invalid_conversation_restart';
  end if;

  select * into v_previous
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if v_previous.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_conversation_not_found';
  end if;

  select message.processed_at into v_inbound_processed_at
  from public.whatsapp_messages message
  where message.id = p_inbound_message_id
    and message.direction = 'inbound'
    and (
      message.conversation_id = p_conversation_id or exists (
        select 1
        from public.whatsapp_conversations successor
        where successor.id = message.conversation_id
          and successor.context ->> 'previousConversationId' = p_conversation_id::text
          and successor.context ->> 'restartReason' = p_restart_reason
      )
    )
  for update of message;

  if not found then
    raise exception using errcode = 'P0002', message = 'whatsapp_inbound_message_not_found';
  end if;

  if v_inbound_processed_at is not null then
    select * into v_existing
    from public.whatsapp_conversations conversation
    where conversation.phone_number_id = v_previous.phone_number_id
      and conversation.contact_id = v_previous.contact_id
      and conversation.context ->> 'previousConversationId' = v_previous.id::text
      and conversation.context ->> 'restartReason' = p_restart_reason
    order by conversation.created_at desc
    limit 1;

    if v_existing.id is not null then
      return v_existing;
    end if;
    raise exception using errcode = '40001', message = 'conversation_restart_replay_incomplete';
  end if;

  if v_previous.version <> p_expected_version
    or v_previous.status in ('completed', 'expired', 'closed', 'failed') then
    raise exception using errcode = '40001', message = 'whatsapp_conversation_version_conflict';
  end if;

  if p_restart_reason = 'session_expired' then
    select * into v_created
    from public.expire_whatsapp_conversation(p_conversation_id);
    if v_created.id = p_conversation_id then
      raise exception using errcode = '22023', message = 'whatsapp_conversation_not_expired';
    end if;
  else
    select * into v_created
    from public.restart_whatsapp_conversation(p_conversation_id);
  end if;

  v_context := p_context || jsonb_build_object(
    'previousConversationId', p_conversation_id,
    'restartReason', p_restart_reason
  );

  v_committed := public.commit_whatsapp_conversation_transition(
    v_created.id,
    p_inbound_message_id,
    v_created.version,
    p_state,
    p_status,
    p_tenant_id,
    v_context,
    p_responses,
    p_recipient
  );

  if not v_committed then
    raise exception using errcode = '40001', message = 'whatsapp_conversation_version_conflict';
  end if;

  select * into v_created
  from public.whatsapp_conversations
  where id = v_created.id;

  return v_created;
end;
$$;

create or replace function public.accept_whatsapp_handoff(p_handoff_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff public.whatsapp_handoffs%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_actor uuid := (select auth.uid());
begin
  if p_handoff_id is null then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_handoff';
  end if;

  -- service_role não pode assumir atendimento sem uma identidade humana no JWT.
  if v_actor is null then
    raise exception using errcode = '22023', message = 'whatsapp_handoff_actor_required';
  end if;

  select * into v_handoff
  from public.whatsapp_handoffs handoff
  where handoff.id = p_handoff_id
  for update;

  if v_handoff.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_handoff_not_found';
  end if;

  if not (
    (select auth.role()) = 'service_role' or
    app_private.is_platform_owner() or
    (
      v_handoff.tenant_id is not null and (
        app_private.has_tenant_role(
          v_handoff.tenant_id,
          array['owner', 'admin', 'receptionist']::public.tenant_role[]
        ) or app_private.has_permission(v_handoff.tenant_id, 'whatsapp_handoff')
      )
    )
  ) then
    raise exception using errcode = '42501', message = 'insufficient_permission';
  end if;

  if v_handoff.status = 'accepted' then
    if v_handoff.assigned_user_id = v_actor then
      return true;
    end if;
    raise exception using errcode = '40001', message = 'whatsapp_handoff_already_assigned';
  end if;

  if v_handoff.status <> 'requested' then
    raise exception using errcode = '22023', message = 'whatsapp_handoff_not_active';
  end if;

  select * into v_conversation
  from public.whatsapp_conversations conversation
  where conversation.id = v_handoff.conversation_id
    and conversation.tenant_id is not distinct from v_handoff.tenant_id
  for update;

  if v_conversation.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_conversation_not_found';
  end if;
  if v_conversation.status <> 'human_handoff' then
    raise exception using errcode = '22023', message = 'whatsapp_handoff_not_active';
  end if;

  update public.whatsapp_handoffs handoff
  set status = 'accepted',
      assigned_user_id = v_actor,
      accepted_at = statement_timestamp()
  where handoff.id = p_handoff_id
  returning * into v_handoff;

  update public.whatsapp_conversations conversation
  set assigned_user_id = v_actor,
      version = conversation.version + 1
  where conversation.id = v_conversation.id;

  if v_handoff.tenant_id is not null then
    insert into public.audit_logs (
      tenant_id, actor_user_id, action, entity_type, entity_id, changes
    ) values (
      v_handoff.tenant_id,
      v_actor,
      'whatsapp.handoff.accepted',
      'whatsapp_handoff',
      v_handoff.id,
      jsonb_build_object(
        'from_status', 'requested',
        'to_status', 'accepted',
        'assigned_user_id', v_actor
      )
    );
  end if;

  return true;
end;
$$;

create or replace function public.resolve_whatsapp_handoff(
  p_handoff_id uuid,
  p_resolution_notes text,
  p_return_to_bot boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff public.whatsapp_handoffs%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_timeout integer;
  v_actor uuid;
begin
  if char_length(coalesce(p_resolution_notes, '')) > 3000 then
    raise exception using errcode = '22023', message = 'invalid_handoff_resolution';
  end if;

  v_actor := (select auth.uid());

  select * into v_handoff
  from public.whatsapp_handoffs
  where id = p_handoff_id
  for update;

  if v_handoff.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_handoff_not_found';
  end if;

  if not (
    (select auth.role()) = 'service_role' or
    app_private.is_platform_owner() or
    (
      v_handoff.tenant_id is not null and (
        app_private.has_tenant_role(
          v_handoff.tenant_id,
          array['owner', 'admin', 'receptionist']::public.tenant_role[]
        ) or (
          v_handoff.assigned_user_id = v_actor and
          app_private.has_permission(v_handoff.tenant_id, 'whatsapp_handoff')
        )
      )
    )
  ) then
    raise exception using errcode = '42501', message = 'insufficient_permission';
  end if;

  if v_handoff.status = 'resolved' then
    return true;
  end if;

  if v_handoff.status = 'cancelled' then
    raise exception using errcode = '22023', message = 'whatsapp_handoff_not_active';
  end if;

  if v_handoff.status <> 'accepted' then
    raise exception using errcode = '22023', message = 'whatsapp_handoff_not_accepted';
  end if;

  select * into v_conversation
  from public.whatsapp_conversations
  where id = v_handoff.conversation_id
    and tenant_id is not distinct from v_handoff.tenant_id
  for update;

  if v_conversation.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_conversation_not_found';
  end if;

  select coalesce(settings.session_timeout_minutes, 30) into v_timeout
  from (select 1) seed
  left join public.tenant_whatsapp_settings settings
    on settings.tenant_id = v_handoff.tenant_id;

  update public.whatsapp_handoffs
  set status = 'resolved',
      assigned_user_id = coalesce(assigned_user_id, v_actor),
      accepted_at = coalesce(accepted_at, statement_timestamp()),
      resolved_at = statement_timestamp(),
      resolution_notes = nullif(trim(p_resolution_notes), '')
  where id = p_handoff_id;

  update public.whatsapp_conversations
  set status = case
        when p_return_to_bot then 'waiting_customer'::public.whatsapp_conversation_status
        else 'closed'::public.whatsapp_conversation_status
      end,
      current_state = case
        when p_return_to_bot and tenant_id is null then 'TENANT_SEARCH'
        when p_return_to_bot then 'MAIN_MENU'
        else 'HUMAN_HANDOFF'
      end,
      assigned_user_id = case when p_return_to_bot then null else assigned_user_id end,
      handoff_requested_at = null,
      session_expires_at = case
        when p_return_to_bot then statement_timestamp() + make_interval(mins => coalesce(v_timeout, 30))
        else session_expires_at
      end,
      closed_at = case when p_return_to_bot then null else statement_timestamp() end,
      context = context || jsonb_build_object(
        'handoffResolvedAt', statement_timestamp(),
        'handoffResolvedBy', v_actor,
        'returnToBot', p_return_to_bot
      ),
      version = version + 1,
      processing_locked_at = null,
      processing_locked_until = null,
      processing_locked_by = null
  where id = v_conversation.id;

  if v_handoff.tenant_id is not null then
    insert into public.audit_logs (
      tenant_id, actor_user_id, action, entity_type, entity_id, changes
    ) values (
      v_handoff.tenant_id,
      v_actor,
      'whatsapp.handoff.resolved',
      'whatsapp_handoff',
      v_handoff.id,
      jsonb_build_object(
        'from_status', v_handoff.status,
        'to_status', 'resolved',
        'return_to_bot', p_return_to_bot
      )
    );
  end if;

  return true;
end;
$$;

revoke all on function public.claim_whatsapp_webhook_events(integer, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_whatsapp_webhook_events_scoped(integer, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_whatsapp_webhook_event(uuid, text)
  from public, anon, authenticated;
revoke all on function public.defer_whatsapp_webhook_event(uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.claim_whatsapp_outbox(integer, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_whatsapp_outbox_scoped(integer, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.validate_whatsapp_outbox_delivery(uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_whatsapp_outbox(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.mark_whatsapp_outbox_delivery_ambiguous(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.defer_whatsapp_outbox(uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.find_whatsapp_inbound_message(text, text)
  from public, anon, authenticated;
revoke all on function public.record_whatsapp_inbound_message(
  text, text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.lock_whatsapp_conversation(uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.commit_whatsapp_conversation_transition(
  uuid, uuid, bigint, text, text, uuid, jsonb, jsonb, text
) from public, anon, authenticated;
revoke all on function public.enqueue_whatsapp_response(uuid, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.apply_whatsapp_message_status(text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.restart_whatsapp_conversation(uuid)
  from public, anon, authenticated;
revoke all on function public.expire_whatsapp_conversation(uuid)
  from public, anon, authenticated;
revoke all on function public.commit_whatsapp_conversation_restart(
  uuid, uuid, bigint, text, text, text, uuid, jsonb, jsonb, text
) from public, anon, authenticated;
revoke all on function public.accept_whatsapp_handoff(uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_whatsapp_handoff(uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function app_private.cancel_whatsapp_conversation_backlog(uuid, text)
  from public, anon, authenticated;
revoke all on function app_private.exhaust_whatsapp_outbox_attempts(
  public.whatsapp_provider, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.claim_whatsapp_webhook_events(integer, text, text)
  to service_role;
grant execute on function public.claim_whatsapp_webhook_events_scoped(integer, text, text, uuid)
  to service_role;
grant execute on function public.complete_whatsapp_webhook_event(uuid, text) to service_role;
grant execute on function public.defer_whatsapp_webhook_event(uuid, text, text, boolean) to service_role;
grant execute on function public.claim_whatsapp_outbox(integer, text, text) to service_role;
grant execute on function public.claim_whatsapp_outbox_scoped(integer, text, text, uuid)
  to service_role;
grant execute on function public.validate_whatsapp_outbox_delivery(uuid, text)
  to service_role;
grant execute on function public.complete_whatsapp_outbox(uuid, text, text) to service_role;
grant execute on function public.mark_whatsapp_outbox_delivery_ambiguous(uuid, text, text, text)
  to service_role;
grant execute on function public.defer_whatsapp_outbox(uuid, text, text, boolean) to service_role;
grant execute on function public.find_whatsapp_inbound_message(text, text) to service_role;
grant execute on function public.record_whatsapp_inbound_message(
  text, text, uuid, text, text, text, timestamptz
) to service_role;
grant execute on function public.lock_whatsapp_conversation(uuid, bigint, text) to service_role;
grant execute on function public.commit_whatsapp_conversation_transition(
  uuid, uuid, bigint, text, text, uuid, jsonb, jsonb, text
) to service_role;
grant execute on function public.enqueue_whatsapp_response(uuid, jsonb, text, text)
  to service_role;
grant execute on function public.apply_whatsapp_message_status(text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.restart_whatsapp_conversation(uuid) to service_role;
grant execute on function public.expire_whatsapp_conversation(uuid) to service_role;
grant execute on function public.commit_whatsapp_conversation_restart(
  uuid, uuid, bigint, text, text, text, uuid, jsonb, jsonb, text
) to service_role;
grant execute on function public.accept_whatsapp_handoff(uuid)
  to authenticated, service_role;
grant execute on function public.resolve_whatsapp_handoff(uuid, text, boolean)
  to authenticated, service_role;

commit;
