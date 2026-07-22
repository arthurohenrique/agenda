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
    or p_customer_phone !~ '^[+][1-9][0-9]{7,14}$'
    or p_customer_email is not null and p_customer_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
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
