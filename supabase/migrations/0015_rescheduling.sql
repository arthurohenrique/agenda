begin;

create or replace function public.get_reschedule_slots(
  p_token text,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_staff_id uuid default null,
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
  v_appointment public.appointments%rowtype;
  v_slug text;
  v_service_ids uuid[];
  v_allowed boolean;
begin
  select a.*
    into v_appointment
  from public.booking_tokens bt
  join public.appointments a
    on a.tenant_id = bt.tenant_id and a.id = bt.appointment_id
  where bt.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and bt.purpose = 'manage'
    and bt.revoked_at is null
    and bt.expires_at > statement_timestamp();

  if v_appointment.id is not null then
    select t.slug::text, bs.allow_customer_reschedule
      into v_slug, v_allowed
    from public.tenants t
    join public.business_settings bs on bs.tenant_id = t.id
    where t.id = v_appointment.tenant_id;
  end if;

  if v_appointment.id is null or not v_allowed or not v_appointment.occupies_slot then
    raise exception using errcode = 'P0002', message = 'reschedule_not_allowed';
  end if;

  select array_agg(service_id order by sort_order) into v_service_ids
  from public.appointment_services
  where tenant_id = v_appointment.tenant_id and appointment_id = v_appointment.id;

  return query
  select slots.starts_at, slots.ends_at, slots.staff_id, slots.staff_name
  from public.get_available_slots(
    v_slug,
    v_appointment.location_id,
    v_service_ids,
    p_staff_id,
    p_range_start,
    p_range_end,
    v_appointment.timezone,
    p_limit
  ) slots;
end;
$$;

create or replace function public.reschedule_public_booking(
  p_token text,
  p_starts_at timestamptz,
  p_staff_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.appointments%rowtype;
  v_slug text;
  v_customer_name text;
  v_customer_phone text;
  v_customer_email text;
  v_allowed boolean;
  v_window integer;
  v_service_ids uuid[];
  v_result jsonb;
  v_new_id uuid;
  v_existing record;
begin
  select a.*
  into v_old
  from public.booking_tokens bt
  join public.appointments a
    on a.tenant_id = bt.tenant_id and a.id = bt.appointment_id
  where bt.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and bt.purpose = 'manage'
    and bt.revoked_at is null
    and bt.expires_at > statement_timestamp()
  for update of bt, a;

  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'booking_token_not_found';
  end if;

  select
    t.slug::text,
    coalesce(ct.display_name, c.full_name),
    c.phone_e164,
    c.email::text,
    bs.allow_customer_reschedule,
    bs.cancellation_window_minutes
  into
    v_slug,
    v_customer_name,
    v_customer_phone,
    v_customer_email,
    v_allowed,
    v_window
  from public.tenants t
  join public.business_settings bs on bs.tenant_id = t.id
  join public.customer_tenants ct
    on ct.tenant_id = t.id and ct.id = v_old.customer_tenant_id
  join public.customers c on c.id = ct.customer_id
  where t.id = v_old.tenant_id;

  if not v_old.occupies_slot and v_old.rescheduled_to_id is not null then
    select a.id, a.status, a.starts_at, a.ends_at, st.name as staff_name
      into v_existing
    from public.appointments a
    left join public.staff st on st.tenant_id = a.tenant_id and st.id = a.staff_id
    where a.tenant_id = v_old.tenant_id
      and a.id = v_old.rescheduled_to_id
      and a.idempotency_key = p_idempotency_key;

    if v_existing.id is not null then
      return jsonb_build_object(
        'appointmentId', v_existing.id,
        'managementToken', encode(
          extensions.digest(
            convert_to(v_old.tenant_id::text || ':' || p_idempotency_key::text || ':manage', 'UTF8'),
            'sha256'
          ),
          'hex'
        ),
        'status', v_existing.status,
        'startsAt', v_existing.starts_at,
        'endsAt', v_existing.ends_at,
        'staffName', v_existing.staff_name,
        'previousAppointmentId', v_old.id
      );
    end if;

    raise exception using errcode = '22023', message = 'booking_already_rescheduled';
  end if;

  if not v_allowed
    or not v_old.occupies_slot
    or v_old.starts_at <= statement_timestamp() + make_interval(mins => v_window) then
    raise exception using errcode = '22023', message = 'reschedule_not_allowed';
  end if;

  select array_agg(service_id order by sort_order) into v_service_ids
  from public.appointment_services
  where tenant_id = v_old.tenant_id and appointment_id = v_old.id;

  v_result := public.create_public_booking(
    v_slug,
    v_old.location_id,
    v_service_ids,
    p_staff_id,
    p_starts_at,
    v_old.timezone,
    v_customer_name,
    v_customer_phone,
    v_customer_email,
    v_old.customer_notes,
    p_idempotency_key,
    encode(extensions.gen_random_bytes(32), 'hex')
  );

  v_new_id := (v_result ->> 'appointmentId')::uuid;

  update public.appointments
    set origin = v_old.origin,
        rescheduled_from_id = v_old.id
    where tenant_id = v_old.tenant_id and id = v_new_id;

  update public.appointments
    set status = 'cancelled_by_customer',
        cancellation_reason = 'Reagendado pelo cliente',
        rescheduled_to_id = v_new_id
    where tenant_id = v_old.tenant_id and id = v_old.id;

  insert into public.appointment_status_history (
    tenant_id, appointment_id, from_status, to_status, reason
  ) values (
    v_old.tenant_id,
    v_old.id,
    v_old.status,
    'cancelled_by_customer',
    'Reagendado pelo cliente'
  );

  insert into public.outbox_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    v_old.tenant_id,
    'appointment',
    v_old.id,
    'appointment.rescheduled',
    jsonb_build_object(
      'previous_appointment_id', v_old.id,
      'new_appointment_id', v_new_id,
      'previous_starts_at', v_old.starts_at,
      'new_starts_at', p_starts_at
    )
  );

  return v_result || jsonb_build_object('previousAppointmentId', v_old.id);
end;
$$;

grant execute on function public.get_reschedule_slots(
  text, timestamptz, timestamptz, uuid, integer
) to anon, authenticated;
grant execute on function public.reschedule_public_booking(
  text, timestamptz, uuid, uuid
) to anon, authenticated;

commit;
