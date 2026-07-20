begin;

create or replace function app_private.consume_public_rate_limit(
  p_tenant_id uuid,
  p_rate_key text,
  p_limit integer default 8,
  p_window_seconds integer default 600
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_rate_key is null or char_length(p_rate_key) < 32 then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_rate_key, 0));
  v_window_start := to_timestamp(
    floor(extract(epoch from statement_timestamp()) / p_window_seconds) * p_window_seconds
  );

  select request_count into v_count
  from public.public_rate_limits
  where tenant_id = p_tenant_id
    and rate_key = p_rate_key
    and window_started_at = v_window_start;

  if coalesce(v_count, 0) >= p_limit then
    raise exception using errcode = 'P0001', message = 'rate_limit_exceeded';
  end if;

  insert into public.public_rate_limits (
    tenant_id, rate_key, window_started_at, request_count, expires_at
  ) values (
    p_tenant_id,
    p_rate_key,
    v_window_start,
    1,
    v_window_start + make_interval(secs => p_window_seconds * 2)
  )
  on conflict (tenant_id, rate_key, window_started_at)
  do update set request_count = public.public_rate_limits.request_count + 1;
end;
$$;

create or replace function public.consume_public_api_rate_limit(
  p_tenant_slug text,
  p_rate_key text,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_limit integer;
begin
  select id into v_tenant_id
  from public.tenants
  where slug = public.normalize_slug(p_tenant_slug)
    and (state = 'published' or app_private.is_tenant_member(id));

  if v_tenant_id is null then
    raise exception using errcode = 'P0002', message = 'tenant_not_found';
  end if;

  v_limit := case p_action
    when 'availability' then 60
    else 10
  end;
  perform app_private.consume_public_rate_limit(v_tenant_id, p_rate_key, v_limit, 600);
end;
$$;

create or replace function public.get_available_slots(
  p_tenant_slug text,
  p_location_id uuid,
  p_service_ids uuid[],
  p_staff_id uuid default null,
  p_range_start timestamptz default now(),
  p_range_end timestamptz default (now() + interval '7 days'),
  p_timezone text default 'America/Sao_Paulo',
  p_limit integer default 80
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  staff_id uuid,
  staff_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_tenant_state public.tenant_state;
  v_tenant_timezone text;
  v_default_slot integer;
  v_default_notice integer;
  v_default_max_days integer;
  v_service_count integer;
begin
  if p_range_end <= p_range_start
    or p_range_end - p_range_start > interval '31 days'
    or cardinality(p_service_ids) < 1
    or cardinality(p_service_ids) > 5
    or p_limit < 1
    or p_limit > 200 then
    raise exception using errcode = '22023', message = 'invalid_availability_request';
  end if;

  select t.id, t.state, coalesce(l.timezone, t.timezone)
    into v_tenant_id, v_tenant_state, v_tenant_timezone
  from public.tenants t
  join public.locations l on l.tenant_id = t.id and l.id = p_location_id and l.is_active
  where t.slug = public.normalize_slug(p_tenant_slug);

  if v_tenant_id is null or (
    v_tenant_state <> 'published' and not app_private.is_tenant_member(v_tenant_id)
  ) then
    raise exception using errcode = 'P0002', message = 'tenant_not_found';
  end if;

  if p_timezone <> v_tenant_timezone then
    raise exception using errcode = '22023', message = 'timezone_mismatch';
  end if;

  select default_slot_minutes, default_min_notice_minutes, default_max_booking_days
    into v_default_slot, v_default_notice, v_default_max_days
  from public.business_settings
  where tenant_id = v_tenant_id;

  select count(*) into v_service_count
  from public.services s
  where s.tenant_id = v_tenant_id
    and s.id = any (p_service_ids)
    and s.is_active
    and (v_tenant_state <> 'published' or s.is_public)
    and (
      not exists (
        select 1 from public.service_locations sl0
        where sl0.tenant_id = s.tenant_id and sl0.service_id = s.id
      ) or exists (
        select 1 from public.service_locations sl
        where sl.tenant_id = s.tenant_id
          and sl.service_id = s.id
          and sl.location_id = p_location_id
          and sl.is_active
      )
    );

  if v_service_count <> cardinality(p_service_ids) then
    raise exception using errcode = '22023', message = 'invalid_service';
  end if;

  return query
  with eligible_staff as (
    select st.id, st.name, st.sort_order, st.inherits_tenant_hours
    from public.staff st
    where st.tenant_id = v_tenant_id
      and st.is_active
      and (v_tenant_state <> 'published' or st.is_public)
      and (p_staff_id is null or st.id = p_staff_id)
      and (
        not exists (
          select 1 from public.staff_locations sl0
          where sl0.tenant_id = st.tenant_id and sl0.staff_id = st.id
        ) or exists (
          select 1 from public.staff_locations sl
          where sl.tenant_id = st.tenant_id
            and sl.staff_id = st.id
            and sl.location_id = p_location_id
            and sl.is_active
        )
      )
      and not exists (
        select 1
        from unnest(p_service_ids) requested(service_id)
        where not exists (
          select 1 from public.staff_services ss
          where ss.tenant_id = v_tenant_id
            and ss.staff_id = st.id
            and ss.service_id = requested.service_id
            and ss.is_active
        )
      )
  ),
  staff_requirements as (
    select
      es.id as staff_id,
      es.name as staff_name,
      es.sort_order,
      es.inherits_tenant_hours,
      sum(coalesce(ss.custom_duration_minutes, s.duration_minutes))::integer as duration_minutes,
      max(s.buffer_before_minutes)::integer as buffer_before_minutes,
      max(s.buffer_after_minutes)::integer as buffer_after_minutes,
      max(coalesce(s.min_notice_minutes, v_default_notice))::integer as min_notice_minutes,
      min(coalesce(s.max_booking_days, v_default_max_days))::integer as max_booking_days
    from eligible_staff es
    join public.staff_services ss
      on ss.tenant_id = v_tenant_id
     and ss.staff_id = es.id
     and ss.service_id = any (p_service_ids)
     and ss.is_active
    join public.services s
      on s.tenant_id = ss.tenant_id and s.id = ss.service_id
    group by es.id, es.name, es.sort_order, es.inherits_tenant_hours
  ),
  local_days as (
    select generated::date as local_date
    from generate_series(
      (p_range_start at time zone p_timezone)::date,
      ((p_range_end - interval '1 microsecond') at time zone p_timezone)::date,
      interval '1 day'
    ) generated
  ),
  regular_windows as (
    select
      sr.*,
      d.local_date,
      (d.local_date + wh.opens_at) at time zone p_timezone as opens_at,
      (d.local_date + wh.closes_at) at time zone p_timezone as closes_at,
      case when wh.break_starts_at is null then null
        else (d.local_date + wh.break_starts_at) at time zone p_timezone end as break_starts_at,
      case when wh.break_ends_at is null then null
        else (d.local_date + wh.break_ends_at) at time zone p_timezone end as break_ends_at
    from staff_requirements sr
    cross join local_days d
    join lateral (
      select wh0.opens_at, wh0.closes_at, wh0.break_starts_at, wh0.break_ends_at
      from public.working_hours wh0
      where sr.inherits_tenant_hours
        and wh0.tenant_id = v_tenant_id
        and wh0.location_id = p_location_id
        and wh0.day_of_week = extract(isodow from d.local_date)::smallint
        and wh0.is_open
        and (wh0.valid_from is null or wh0.valid_from <= d.local_date)
        and (wh0.valid_until is null or wh0.valid_until >= d.local_date)
      union all
      select swh.starts_at, swh.ends_at, swh.break_starts_at, swh.break_ends_at
      from public.staff_working_hours swh
      where not sr.inherits_tenant_hours
        and swh.tenant_id = v_tenant_id
        and swh.staff_id = sr.staff_id
        and swh.location_id = p_location_id
        and swh.day_of_week = extract(isodow from d.local_date)::smallint
        and swh.is_working
        and (swh.valid_from is null or swh.valid_from <= d.local_date)
        and (swh.valid_until is null or swh.valid_until >= d.local_date)
    ) wh on true
    where not exists (
      select 1 from public.availability_exceptions special
      where special.tenant_id = v_tenant_id
        and special.kind = 'special_hours'
        and special.is_active
        and special.resource_id is null
        and (special.location_id is null or special.location_id = p_location_id)
        and (special.staff_id is null or special.staff_id = sr.staff_id)
        and (special.starts_at at time zone p_timezone)::date = d.local_date
    )
  ),
  special_windows as (
    select
      sr.*,
      (special.starts_at at time zone p_timezone)::date as local_date,
      special.starts_at as opens_at,
      special.ends_at as closes_at,
      null::timestamptz as break_starts_at,
      null::timestamptz as break_ends_at
    from staff_requirements sr
    join public.availability_exceptions special
      on special.tenant_id = v_tenant_id
     and special.kind = 'special_hours'
     and special.is_active
     and special.resource_id is null
     and (special.location_id is null or special.location_id = p_location_id)
     and (special.staff_id is null or special.staff_id = sr.staff_id)
    where special.starts_at < p_range_end and special.ends_at > p_range_start
  ),
  base_windows as (
    select * from regular_windows
    union all
    select * from special_windows
  ),
  candidates as (
    select
      bw.*,
      candidate as candidate_start,
      candidate + make_interval(mins => bw.duration_minutes) as candidate_end,
      tstzrange(
        candidate - make_interval(mins => bw.buffer_before_minutes),
        candidate + make_interval(mins => bw.duration_minutes + bw.buffer_after_minutes),
        '[)'
      ) as blocked_range
    from base_windows bw
    cross join lateral generate_series(
      bw.opens_at + make_interval(mins => bw.buffer_before_minutes),
      bw.closes_at - make_interval(mins => bw.duration_minutes + bw.buffer_after_minutes),
      make_interval(mins => v_default_slot)
    ) candidate
  ),
  available as (
    select c.*
    from candidates c
    where c.candidate_start >= p_range_start
      and c.candidate_end <= p_range_end
      and c.candidate_start >= statement_timestamp() + make_interval(mins => c.min_notice_minutes)
      and c.candidate_start <= statement_timestamp() + make_interval(days => c.max_booking_days)
      and (
        c.break_starts_at is null or
        not c.blocked_range && tstzrange(c.break_starts_at, c.break_ends_at, '[)')
      )
      and not exists (
        select 1 from public.time_off tmo
        where tmo.tenant_id = v_tenant_id
          and tmo.staff_id = c.staff_id
          and tstzrange(tmo.starts_at, tmo.ends_at, '[)') && c.blocked_range
      )
      and not exists (
        select 1 from public.availability_exceptions closed
        where closed.tenant_id = v_tenant_id
          and closed.kind = 'closed'
          and closed.is_active
          and closed.resource_id is null
          and (closed.location_id is null or closed.location_id = p_location_id)
          and (closed.staff_id is null or closed.staff_id = c.staff_id)
          and tstzrange(closed.starts_at, closed.ends_at, '[)') && c.blocked_range
      )
      and not exists (
        select 1 from public.calendar_blocks cb
        where cb.tenant_id = v_tenant_id
          and cb.staff_id = c.staff_id
          and tstzrange(cb.starts_at, cb.ends_at, '[)') && c.blocked_range
      )
      and not exists (
        select 1 from public.booking_allocations ba
        where ba.tenant_id = v_tenant_id
          and ba.allocatable_type = 'staff'
          and ba.allocatable_id = c.staff_id
          and ba.active
          and ba.time_range && c.blocked_range
      )
      and not exists (
        select 1
        from unnest(p_service_ids) requested(service_id)
        join public.services svc
          on svc.tenant_id = v_tenant_id and svc.id = requested.service_id
        where not exists (
          select 1 from generate_series(1, svc.capacity) cap(slot)
          where not exists (
            select 1 from public.booking_allocations ba
            where ba.tenant_id = v_tenant_id
              and ba.allocatable_type = 'service_capacity'
              and ba.allocatable_id = svc.id
              and ba.capacity_slot = cap.slot
              and ba.active
              and ba.time_range && c.blocked_range
          )
        )
      )
      and not exists (
        select 1
        from unnest(p_service_ids) requested(service_id)
        where exists (
          select 1 from public.resource_services required
          where required.tenant_id = v_tenant_id
            and required.service_id = requested.service_id
            and required.is_required
        ) and not exists (
          select 1
          from public.resource_services rs
          join public.resources r
            on r.tenant_id = rs.tenant_id
           and r.id = rs.resource_id
           and r.location_id = p_location_id
           and r.is_active
          cross join lateral generate_series(1, r.capacity) cap(slot)
          where rs.tenant_id = v_tenant_id
            and rs.service_id = requested.service_id
            and rs.is_required
            and not exists (
              select 1 from public.booking_allocations ba
              where ba.tenant_id = v_tenant_id
                and ba.allocatable_type = 'resource'
                and ba.allocatable_id = r.id
                and ba.capacity_slot = cap.slot
                and ba.active
                and ba.time_range && c.blocked_range
            )
            and not exists (
              select 1 from public.calendar_blocks cb
              where cb.tenant_id = v_tenant_id
                and cb.resource_id = r.id
                and tstzrange(cb.starts_at, cb.ends_at, '[)') && c.blocked_range
            )
        )
      )
  ),
  ranked as (
    select
      a.*,
      row_number() over (
        partition by a.candidate_start
        order by a.sort_order, a.staff_name, a.staff_id
      ) as staff_rank
    from available a
  )
  select r.candidate_start, r.candidate_end, r.staff_id, r.staff_name
  from ranked r
  where p_staff_id is not null or r.staff_rank = 1
  order by r.candidate_start, r.sort_order, r.staff_name
  limit p_limit;
end;
$$;

create or replace function public.create_public_booking(
  p_tenant_slug text,
  p_location_id uuid,
  p_service_ids uuid[],
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_timezone text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_customer_notes text,
  p_idempotency_key uuid,
  p_rate_limit_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_currency char(3);
  v_status public.appointment_status;
  v_staff_id uuid;
  v_staff_name text;
  v_ends_at timestamptz;
  v_duration integer;
  v_buffer_before integer;
  v_buffer_after integer;
  v_original_price integer;
  v_customer_id uuid;
  v_customer_tenant_id uuid;
  v_appointment_id uuid;
  v_raw_token text;
  v_blocked_range tstzrange;
  v_existing record;
  v_service record;
  v_resource_id uuid;
  v_capacity_slot integer;
  v_approval_mode text;
begin
  if p_idempotency_key is null
    or cardinality(p_service_ids) < 1
    or cardinality(p_service_ids) > 5
    or char_length(trim(p_customer_name)) not between 2 and 120
    or p_customer_phone !~ '^\\+[1-9][0-9]{7,14}$'
    or p_customer_email is not null and p_customer_email !~* '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'
    or char_length(coalesce(p_customer_notes, '')) > 2000 then
    raise exception using errcode = '22023', message = 'invalid_booking_request';
  end if;

  select t.id, t.currency, bs.approval_mode
    into v_tenant_id, v_currency, v_approval_mode
  from public.tenants t
  join public.business_settings bs on bs.tenant_id = t.id
  join public.locations l on l.tenant_id = t.id and l.id = p_location_id and l.is_active
  where t.slug = public.normalize_slug(p_tenant_slug)
    and (t.state = 'published' or app_private.is_tenant_member(t.id))
    and coalesce(l.timezone, t.timezone) = p_timezone;

  if v_tenant_id is null then
    raise exception using errcode = 'P0002', message = 'tenant_not_found';
  end if;

  perform app_private.consume_public_rate_limit(v_tenant_id, p_rate_limit_key);
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant_id::text || ':' || p_starts_at::text, 0)
  );

  select
    a.id,
    a.status,
    a.starts_at,
    a.ends_at,
    st.name as staff_name
  into v_existing
  from public.appointments a
  left join public.staff st on st.tenant_id = a.tenant_id and st.id = a.staff_id
  where a.tenant_id = v_tenant_id and a.idempotency_key = p_idempotency_key;

  v_raw_token := encode(
    extensions.digest(
      convert_to(v_tenant_id::text || ':' || p_idempotency_key::text || ':manage', 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if v_existing.id is not null then
    return jsonb_build_object(
      'appointmentId', v_existing.id,
      'managementToken', v_raw_token,
      'status', v_existing.status,
      'startsAt', v_existing.starts_at,
      'endsAt', v_existing.ends_at,
      'staffName', v_existing.staff_name
    );
  end if;

  select slot.staff_id, slot.staff_name, slot.ends_at
    into v_staff_id, v_staff_name, v_ends_at
  from public.get_available_slots(
    p_tenant_slug,
    p_location_id,
    p_service_ids,
    p_staff_id,
    p_starts_at,
    p_starts_at + interval '1 day',
    p_timezone,
    200
  ) slot
  where slot.starts_at = p_starts_at
  order by slot.staff_id
  limit 1;

  if v_staff_id is null then
    raise exception using errcode = '23P01', message = 'slot_unavailable';
  end if;

  select
    sum(coalesce(ss.custom_duration_minutes, s.duration_minutes))::integer,
    max(s.buffer_before_minutes)::integer,
    max(s.buffer_after_minutes)::integer,
    sum(coalesce(ss.custom_price_cents, s.promotional_price_cents, s.price_cents))::integer,
    case
      when v_approval_mode = 'manual' or bool_or(s.requires_manual_approval)
        then 'awaiting_approval'::public.appointment_status
      else 'confirmed'::public.appointment_status
    end
  into v_duration, v_buffer_before, v_buffer_after, v_original_price, v_status
  from public.services s
  join public.staff_services ss
    on ss.tenant_id = s.tenant_id
   and ss.service_id = s.id
   and ss.staff_id = v_staff_id
   and ss.is_active
  where s.tenant_id = v_tenant_id and s.id = any (p_service_ids);

  if v_duration is null or v_ends_at <> p_starts_at + make_interval(mins => v_duration) then
    raise exception using errcode = '23P01', message = 'slot_unavailable';
  end if;

  v_blocked_range := tstzrange(
    p_starts_at - make_interval(mins => v_buffer_before),
    v_ends_at + make_interval(mins => v_buffer_after),
    '[)'
  );

  select c.id into v_customer_id
  from public.customers c
  where c.phone_e164 = p_customer_phone and c.deleted_at is null
  for update;

  if v_customer_id is null then
    insert into public.customers (full_name, phone_e164, email)
    values (trim(p_customer_name), p_customer_phone, nullif(lower(trim(p_customer_email)), ''))
    returning id into v_customer_id;
  end if;

  insert into public.customer_tenants (
    tenant_id, customer_id, display_name, source
  ) values (
    v_tenant_id, v_customer_id, trim(p_customer_name), 'public_web'
  )
  on conflict (tenant_id, customer_id)
  do update set
    display_name = excluded.display_name,
    updated_at = statement_timestamp()
  returning id into v_customer_tenant_id;

  insert into public.appointments (
    tenant_id,
    location_id,
    customer_tenant_id,
    staff_id,
    starts_at,
    ends_at,
    blocked_starts_at,
    blocked_ends_at,
    timezone,
    original_price_cents,
    discount_cents,
    total_cents,
    currency,
    origin,
    status,
    customer_notes,
    idempotency_key
  ) values (
    v_tenant_id,
    p_location_id,
    v_customer_tenant_id,
    v_staff_id,
    p_starts_at,
    v_ends_at,
    lower(v_blocked_range),
    upper(v_blocked_range),
    p_timezone,
    v_original_price,
    0,
    v_original_price,
    v_currency,
    'public_web',
    v_status,
    nullif(trim(p_customer_notes), ''),
    p_idempotency_key
  ) returning id into v_appointment_id;

  update public.customer_tenants
    set appointments_count = appointments_count + 1,
        next_appointment_at = case
          when next_appointment_at is null then p_starts_at
          else least(next_appointment_at, p_starts_at)
        end
    where tenant_id = v_tenant_id and id = v_customer_tenant_id;

  insert into public.booking_allocations (
    tenant_id, appointment_id, allocatable_type, allocatable_id, capacity_slot, time_range
  ) values (
    v_tenant_id, v_appointment_id, 'staff', v_staff_id, 1, v_blocked_range
  );

  for v_service in
    select
      s.id,
      s.name,
      coalesce(ss.custom_duration_minutes, s.duration_minutes) as duration_minutes,
      s.buffer_before_minutes,
      s.buffer_after_minutes,
      coalesce(ss.custom_price_cents, s.promotional_price_cents, s.price_cents) as price_cents,
      s.capacity,
      row_number() over (order by array_position(p_service_ids, s.id)) - 1 as sort_order
    from public.services s
    join public.staff_services ss
      on ss.tenant_id = s.tenant_id
     and ss.service_id = s.id
     and ss.staff_id = v_staff_id
     and ss.is_active
    where s.tenant_id = v_tenant_id and s.id = any (p_service_ids)
    order by array_position(p_service_ids, s.id)
  loop
    insert into public.appointment_services (
      tenant_id,
      appointment_id,
      service_id,
      staff_id,
      name_snapshot,
      duration_minutes,
      buffer_before_minutes,
      buffer_after_minutes,
      price_cents,
      sort_order
    ) values (
      v_tenant_id,
      v_appointment_id,
      v_service.id,
      v_staff_id,
      v_service.name,
      v_service.duration_minutes,
      v_service.buffer_before_minutes,
      v_service.buffer_after_minutes,
      v_service.price_cents,
      v_service.sort_order
    );

    select cap.slot into v_capacity_slot
    from generate_series(1, v_service.capacity) cap(slot)
    where not exists (
      select 1 from public.booking_allocations ba
      where ba.tenant_id = v_tenant_id
        and ba.allocatable_type = 'service_capacity'
        and ba.allocatable_id = v_service.id
        and ba.capacity_slot = cap.slot
        and ba.active
        and ba.time_range && v_blocked_range
    )
    order by cap.slot
    limit 1;

    if v_capacity_slot is null then
      raise exception using errcode = '23P01', message = 'slot_unavailable';
    end if;

    insert into public.booking_allocations (
      tenant_id, appointment_id, allocatable_type, allocatable_id, capacity_slot, time_range
    ) values (
      v_tenant_id,
      v_appointment_id,
      'service_capacity',
      v_service.id,
      v_capacity_slot,
      v_blocked_range
    );

    if exists (
      select 1 from public.resource_services rs
      where rs.tenant_id = v_tenant_id
        and rs.service_id = v_service.id
        and rs.is_required
    ) and not exists (
      select 1
      from public.appointment_resources ar
      join public.resource_services rs
        on rs.tenant_id = ar.tenant_id
       and rs.resource_id = ar.resource_id
       and rs.service_id = v_service.id
       and rs.is_required
      where ar.tenant_id = v_tenant_id and ar.appointment_id = v_appointment_id
    ) then
      select r.id, cap.slot into v_resource_id, v_capacity_slot
      from public.resource_services rs
      join public.resources r
        on r.tenant_id = rs.tenant_id
       and r.id = rs.resource_id
       and r.location_id = p_location_id
       and r.is_active
      cross join lateral generate_series(1, r.capacity) cap(slot)
      where rs.tenant_id = v_tenant_id
        and rs.service_id = v_service.id
        and rs.is_required
        and not exists (
          select 1 from public.booking_allocations ba
          where ba.tenant_id = v_tenant_id
            and ba.allocatable_type = 'resource'
            and ba.allocatable_id = r.id
            and ba.capacity_slot = cap.slot
            and ba.active
            and ba.time_range && v_blocked_range
        )
        and not exists (
          select 1 from public.calendar_blocks cb
          where cb.tenant_id = v_tenant_id
            and cb.resource_id = r.id
            and tstzrange(cb.starts_at, cb.ends_at, '[)') && v_blocked_range
        )
      order by rs.priority desc, r.name, cap.slot
      limit 1;

      if v_resource_id is null then
        raise exception using errcode = '23P01', message = 'slot_unavailable';
      end if;

      insert into public.appointment_resources (
        tenant_id, appointment_id, resource_id, capacity_slot
      ) values (
        v_tenant_id, v_appointment_id, v_resource_id, v_capacity_slot
      );

      insert into public.booking_allocations (
        tenant_id, appointment_id, allocatable_type, allocatable_id, capacity_slot, time_range
      ) values (
        v_tenant_id,
        v_appointment_id,
        'resource',
        v_resource_id,
        v_capacity_slot,
        v_blocked_range
      );
    end if;

    v_resource_id := null;
    v_capacity_slot := null;
  end loop;

  insert into public.appointment_status_history (
    tenant_id, appointment_id, from_status, to_status, reason, changed_by
  ) values (
    v_tenant_id, v_appointment_id, null, v_status, 'Agendamento criado', null
  );

  insert into public.outbox_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    v_tenant_id,
    'appointment',
    v_appointment_id,
    'appointment.created',
    jsonb_build_object(
      'appointment_id', v_appointment_id,
      'origin', 'public_web',
      'status', v_status,
      'starts_at', p_starts_at
    )
  );

  if v_status = 'confirmed' then
    insert into public.outbox_events (
      tenant_id, aggregate_type, aggregate_id, event_type, payload
    ) values (
      v_tenant_id,
      'appointment',
      v_appointment_id,
      'appointment.confirmed',
      jsonb_build_object('appointment_id', v_appointment_id, 'starts_at', p_starts_at)
    );
  end if;

  insert into public.booking_tokens (
    tenant_id, appointment_id, purpose, token_hash, expires_at, max_uses
  ) values (
    v_tenant_id,
    v_appointment_id,
    'manage',
    extensions.digest(convert_to(v_raw_token, 'UTF8'), 'sha256'),
    greatest(v_ends_at + interval '30 days', statement_timestamp() + interval '90 days'),
    null
  );

  return jsonb_build_object(
    'appointmentId', v_appointment_id,
    'managementToken', v_raw_token,
    'status', v_status,
    'startsAt', p_starts_at,
    'endsAt', v_ends_at,
    'staffName', v_staff_name
  );
exception
  when exclusion_violation or unique_violation then
    raise exception using errcode = '23P01', message = 'slot_unavailable';
end;
$$;

create or replace function public.change_appointment_status(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_status public.appointment_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_allowed boolean;
begin
  select * into v_appointment
  from public.appointments
  where tenant_id = p_tenant_id and id = p_appointment_id
  for update;

  if v_appointment.id is null then
    raise exception using errcode = 'P0002', message = 'appointment_not_found';
  end if;

  if not (
    app_private.has_tenant_role(
      p_tenant_id,
      array['owner', 'admin', 'receptionist']::public.tenant_role[]
    ) or app_private.is_own_staff(p_tenant_id, v_appointment.staff_id)
  ) then
    raise exception using errcode = '42501', message = 'insufficient_permission';
  end if;

  v_allowed := case v_appointment.status
    when 'pending' then p_status in ('confirmed', 'cancelled_by_business')
    when 'awaiting_approval' then p_status in ('confirmed', 'cancelled_by_business')
    when 'confirmed' then p_status in ('checked_in', 'cancelled_by_business', 'no_show')
    when 'checked_in' then p_status in ('in_service', 'cancelled_by_business')
    when 'in_service' then p_status in ('completed', 'cancelled_by_business')
    when 'no_show' then p_status = 'confirmed'
    else false
  end;

  if not v_allowed then
    raise exception using errcode = '22023', message = 'invalid_status_transition';
  end if;

  update public.appointments
    set status = p_status,
        cancellation_reason = case
          when p_status = 'cancelled_by_business' then nullif(trim(p_reason), '')
          else cancellation_reason
        end
    where tenant_id = p_tenant_id and id = p_appointment_id;

  if p_status = 'completed' then
    update public.customer_tenants
      set completed_count = completed_count + 1,
          first_visit_at = coalesce(first_visit_at, statement_timestamp()),
          last_visit_at = statement_timestamp(),
          next_appointment_at = null
      where tenant_id = p_tenant_id
        and id = v_appointment.customer_tenant_id;
  elsif p_status = 'no_show' then
    update public.customer_tenants
      set no_show_count = no_show_count + 1,
          next_appointment_at = null
      where tenant_id = p_tenant_id
        and id = v_appointment.customer_tenant_id;
  elsif p_status in ('cancelled_by_business', 'cancelled_by_customer') then
    update public.customer_tenants
      set cancellation_count = cancellation_count + 1,
          next_appointment_at = null
      where tenant_id = p_tenant_id
        and id = v_appointment.customer_tenant_id;
  end if;

  insert into public.appointment_status_history (
    tenant_id, appointment_id, from_status, to_status, reason, changed_by
  ) values (
    p_tenant_id,
    p_appointment_id,
    v_appointment.status,
    p_status,
    nullif(trim(p_reason), ''),
    (select auth.uid())
  );

  insert into public.outbox_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    p_tenant_id,
    'appointment',
    p_appointment_id,
    case
      when p_status = 'confirmed' then 'appointment.confirmed'
      when p_status in ('cancelled_by_business', 'cancelled_by_customer') then 'appointment.cancelled'
      else 'appointment.status_changed'
    end,
    jsonb_build_object(
      'appointment_id', p_appointment_id,
      'from_status', v_appointment.status,
      'to_status', p_status
    )
  );

  insert into public.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, changes
  ) values (
    p_tenant_id,
    (select auth.uid()),
    'appointment.status_changed',
    'appointment',
    p_appointment_id,
    jsonb_build_object('from_status', v_appointment.status, 'to_status', p_status)
  );
end;
$$;

create or replace function public.get_public_booking_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_token is null or char_length(p_token) <> 64 then
    return null;
  end if;

  select jsonb_build_object(
    'appointmentId', a.id,
    'tenantSlug', t.slug,
    'tenantName', t.name,
    'status', a.status,
    'startsAt', a.starts_at,
    'endsAt', a.ends_at,
    'timezone', a.timezone,
    'staffName', st.name,
    'serviceNames', coalesce((
      select jsonb_agg(aps.name_snapshot order by aps.sort_order)
      from public.appointment_services aps
      where aps.tenant_id = a.tenant_id and aps.appointment_id = a.id
    ), '[]'::jsonb),
    'locationName', l.name,
    'address', concat_ws(', ', l.address_line_1, l.district, l.city, l.region),
    'canCancel', bs.allow_customer_cancellation
      and a.occupies_slot
      and a.starts_at > statement_timestamp() + make_interval(mins => bs.cancellation_window_minutes),
    'canReschedule', bs.allow_customer_reschedule and a.occupies_slot
  ) into v_result
  from public.booking_tokens bt
  join public.appointments a
    on a.tenant_id = bt.tenant_id and a.id = bt.appointment_id
  join public.tenants t on t.id = a.tenant_id
  join public.locations l on l.tenant_id = a.tenant_id and l.id = a.location_id
  join public.business_settings bs on bs.tenant_id = a.tenant_id
  left join public.staff st on st.tenant_id = a.tenant_id and st.id = a.staff_id
  where bt.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and bt.purpose = 'manage'
    and bt.revoked_at is null
    and bt.expires_at > statement_timestamp()
    and (bt.max_uses is null or bt.use_count < bt.max_uses);

  return v_result;
end;
$$;

create or replace function public.cancel_public_booking(
  p_token text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.booking_tokens%rowtype;
  v_appointment public.appointments%rowtype;
  v_cancellation_window integer;
begin
  select * into v_token
  from public.booking_tokens
  where token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and purpose = 'manage'
    and revoked_at is null
    and expires_at > statement_timestamp()
    and (max_uses is null or use_count < max_uses)
  for update;

  if v_token.id is null then
    raise exception using errcode = 'P0002', message = 'booking_token_not_found';
  end if;

  select a.* into v_appointment
  from public.appointments a
  where a.tenant_id = v_token.tenant_id and a.id = v_token.appointment_id
  for update;

  select cancellation_window_minutes into v_cancellation_window
  from public.business_settings
  where tenant_id = v_token.tenant_id and allow_customer_cancellation;

  if v_cancellation_window is null
    or not v_appointment.occupies_slot
    or v_appointment.starts_at <= statement_timestamp() + make_interval(mins => v_cancellation_window) then
    raise exception using errcode = '22023', message = 'cancellation_not_allowed';
  end if;

  update public.appointments
    set status = 'cancelled_by_customer',
        cancellation_reason = left(nullif(trim(p_reason), ''), 500)
    where tenant_id = v_token.tenant_id and id = v_token.appointment_id;

  update public.customer_tenants
    set cancellation_count = cancellation_count + 1,
        next_appointment_at = null
    where tenant_id = v_token.tenant_id
      and id = v_appointment.customer_tenant_id;

  update public.booking_tokens
    set use_count = use_count + 1,
        last_used_at = statement_timestamp()
    where id = v_token.id;

  insert into public.appointment_status_history (
    tenant_id, appointment_id, from_status, to_status, reason
  ) values (
    v_token.tenant_id,
    v_token.appointment_id,
    v_appointment.status,
    'cancelled_by_customer',
    left(nullif(trim(p_reason), ''), 500)
  );

  insert into public.outbox_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    v_token.tenant_id,
    'appointment',
    v_token.appointment_id,
    'appointment.cancelled',
    jsonb_build_object(
      'appointment_id', v_token.appointment_id,
      'cancelled_by', 'customer',
      'previous_status', v_appointment.status
    )
  );

  return jsonb_build_object(
    'appointmentId', v_token.appointment_id,
    'status', 'cancelled_by_customer'
  );
end;
$$;

grant execute on function public.get_available_slots(
  text, uuid, uuid[], uuid, timestamptz, timestamptz, text, integer
) to anon, authenticated;
grant execute on function public.consume_public_api_rate_limit(text, text, text)
to anon, authenticated;

grant execute on function public.create_public_booking(
  text, uuid, uuid[], uuid, timestamptz, text, text, text, text, text, uuid, text
) to anon, authenticated;

grant execute on function public.get_public_booking_by_token(text) to anon, authenticated;
grant execute on function public.cancel_public_booking(text, text) to anon, authenticated;
grant execute on function public.change_appointment_status(
  uuid, uuid, public.appointment_status, text
) to authenticated;

commit;
