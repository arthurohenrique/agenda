begin;

create or replace function public.claim_outbox_events(p_limit integer default 10)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023', message = 'invalid_outbox_limit';
  end if;

  return query
  with claimed as (
    select event.id
    from public.outbox_events event
    where event.processed_at is null
      and event.available_at <= statement_timestamp()
      and event.attempts < 8
    order by event.available_at, event.occurred_at
    for update skip locked
    limit p_limit
  )
  update public.outbox_events event
  set attempts = event.attempts + 1,
      available_at = statement_timestamp() + interval '5 minutes',
      last_error_code = null
  from claimed
  where event.id = claimed.id
  returning event.*;
end;
$$;

create or replace function public.complete_outbox_event(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with completed as (
    update public.outbox_events
    set processed_at = statement_timestamp(), last_error_code = null
    where id = p_event_id and processed_at is null
    returning id
  )
  select exists(select 1 from completed);
$$;

create or replace function public.defer_outbox_event(
  p_event_id uuid,
  p_error_code text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with deferred as (
    update public.outbox_events
    set last_error_code = left(coalesce(nullif(trim(p_error_code), ''), 'unknown_error'), 120),
        available_at = statement_timestamp() + make_interval(
          secs => least(3600, (30 * power(2, least(attempts, 6)))::integer)
        )
    where id = p_event_id and processed_at is null
    returning id
  )
  select exists(select 1 from deferred);
$$;

revoke all on function public.claim_outbox_events(integer) from public, anon, authenticated;
revoke all on function public.complete_outbox_event(uuid) from public, anon, authenticated;
revoke all on function public.defer_outbox_event(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_outbox_events(integer) to service_role;
grant execute on function public.complete_outbox_event(uuid) to service_role;
grant execute on function public.defer_outbox_event(uuid, text) to service_role;

commit;
