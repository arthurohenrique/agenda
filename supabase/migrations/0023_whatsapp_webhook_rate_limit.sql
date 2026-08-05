begin;

create table app_private.whatsapp_webhook_rate_limits (
  action text not null check (action in ('receive', 'verify')),
  rate_key text not null check (rate_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  primary key (action, rate_key, window_started_at)
);

create index whatsapp_webhook_rate_limits_expires_idx
on app_private.whatsapp_webhook_rate_limits (expires_at);

revoke all on table app_private.whatsapp_webhook_rate_limits
from public, anon, authenticated, service_role;

create or replace function public.consume_whatsapp_webhook_rate_limit(
  p_action text,
  p_rate_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_window_seconds integer;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_count integer;
begin
  if p_action is null
    or p_action not in ('receive', 'verify')
    or p_rate_key is null
    or p_rate_key !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_webhook_rate_limit_input';
  end if;

  if p_action = 'verify' then
    v_limit := 20;
    v_window_seconds := 600;
  else
    -- Meta agrupa eventos e repete entregas. O burst é amplo, mas impede custo ilimitado
    -- de leitura/HMAC por uma única origem antes da autenticação do payload.
    v_limit := 600;
    v_window_seconds := 60;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from statement_timestamp()) / v_window_seconds) * v_window_seconds
  );
  v_window_end := v_window_start + make_interval(secs => v_window_seconds);

  perform pg_advisory_xact_lock(
    hashtextextended('whatsapp-webhook:' || p_action || ':' || p_rate_key, 0)
  );

  -- Limpeza global e limitada: cada nova origem também remove lixo de chaves one-shot.
  -- O índice por expires_at evita varredura integral no caminho quente.
  delete from app_private.whatsapp_webhook_rate_limits
  where ctid in (
    select ctid
    from app_private.whatsapp_webhook_rate_limits
    where expires_at <= statement_timestamp()
    order by expires_at
    limit 100
  );

  select request_count
    into v_count
  from app_private.whatsapp_webhook_rate_limits
  where action = p_action
    and rate_key = p_rate_key
    and window_started_at = v_window_start;

  if coalesce(v_count, 0) >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (v_window_end - statement_timestamp())))::integer
      )
    );
  end if;

  insert into app_private.whatsapp_webhook_rate_limits (
    action,
    rate_key,
    window_started_at,
    request_count,
    expires_at
  ) values (
    p_action,
    p_rate_key,
    v_window_start,
    1,
    v_window_end + make_interval(secs => v_window_seconds)
  )
  on conflict (action, rate_key, window_started_at)
  do update set request_count = app_private.whatsapp_webhook_rate_limits.request_count + 1;

  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.consume_whatsapp_webhook_rate_limit(text, text)
from public, anon, authenticated;
grant execute on function public.consume_whatsapp_webhook_rate_limit(text, text)
to service_role;

commit;
