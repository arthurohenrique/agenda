begin;

create or replace function public.create_admin_booking(
  p_tenant_id uuid,
  p_location_id uuid,
  p_service_ids uuid[],
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_timezone text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_customer_notes text,
  p_internal_notes text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_result jsonb;
  v_appointment_id uuid;
begin
  if not app_private.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'receptionist']::public.tenant_role[]
  ) then
    raise exception using errcode = '42501', message = 'insufficient_permission';
  end if;

  select slug::text into v_slug from public.tenants where id = p_tenant_id;
  if v_slug is null then
    raise exception using errcode = 'P0002', message = 'tenant_not_found';
  end if;

  v_result := public.create_public_booking(
    v_slug,
    p_location_id,
    p_service_ids,
    p_staff_id,
    p_starts_at,
    p_timezone,
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_customer_notes,
    p_idempotency_key,
    encode(extensions.gen_random_bytes(32), 'hex')
  );

  v_appointment_id := (v_result ->> 'appointmentId')::uuid;

  update public.appointments
    set origin = 'admin',
        created_by = (select auth.uid()),
        internal_summary = left(nullif(trim(p_internal_notes), ''), 2000)
    where tenant_id = p_tenant_id and id = v_appointment_id;

  update public.outbox_events
    set payload = payload || jsonb_build_object('origin', 'admin')
    where tenant_id = p_tenant_id
      and aggregate_id = v_appointment_id
      and event_type = 'appointment.created';

  insert into public.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id
  ) values (
    p_tenant_id,
    (select auth.uid()),
    'appointment.created',
    'appointment',
    v_appointment_id
  );

  return v_result || jsonb_build_object('origin', 'admin');
end;
$$;

grant execute on function public.create_admin_booking(
  uuid, uuid, uuid[], uuid, timestamptz, text, text, text, text, text, text, uuid
) to authenticated;

commit;
