begin;

create unique index outbox_events_whatsapp_reminder_unique_idx
  on public.outbox_events (
    tenant_id,
    aggregate_id,
    event_type,
    ((payload ->> 'offset_minutes'))
  )
  where event_type = 'appointment.reminder_due';

create or replace function app_private.whatsapp_adjust_quiet_hours(
  p_available_at timestamptz,
  p_timezone text,
  p_quiet_hours jsonb
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start time;
  v_end time;
  v_local timestamp;
begin
  if jsonb_typeof(coalesce(p_quiet_hours, 'null'::jsonb)) <> 'object'
    or coalesce(p_quiet_hours ->> 'start', '') !~ '^[0-2][0-9]:[0-5][0-9]$'
    or coalesce(p_quiet_hours ->> 'end', '') !~ '^[0-2][0-9]:[0-5][0-9]$' then
    return p_available_at;
  end if;

  begin
    v_start := (p_quiet_hours ->> 'start')::time;
    v_end := (p_quiet_hours ->> 'end')::time;
  exception when datetime_field_overflow then
    return p_available_at;
  end;

  if v_start = v_end then
    return p_available_at;
  end if;

  v_local := p_available_at at time zone p_timezone;

  if v_start < v_end and v_local::time >= v_start and v_local::time < v_end then
    return (v_local::date + v_end) at time zone p_timezone;
  elsif v_start > v_end and v_local::time >= v_start then
    return (v_local::date + 1 + v_end) at time zone p_timezone;
  elsif v_start > v_end and v_local::time < v_end then
    return (v_local::date + v_end) at time zone p_timezone;
  end if;

  return p_available_at;
end;
$$;

create or replace function app_private.schedule_whatsapp_appointment_reminders(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_source_event_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_metadata jsonb;
  v_offsets jsonb;
  v_quiet_hours jsonb;
  v_offset_text text;
  v_offset integer;
  v_available_at timestamptz;
  v_inserted integer := 0;
  -- plpgsql proíbe variável de linha em lista INTO com vários itens; o registro
  -- intermediário mantém a consulta única e o lock original.
  v_row record;
begin
  select appointment as appointment_row, settings.metadata as settings_metadata
    into v_row
  from public.appointments appointment
  join public.tenant_whatsapp_settings settings
    on settings.tenant_id = appointment.tenant_id
   and settings.enabled
   and settings.reminders_enabled
  where appointment.tenant_id = p_tenant_id
    and appointment.id = p_appointment_id
    and appointment.occupies_slot;

  if found then
    v_appointment := v_row.appointment_row;
    v_metadata := v_row.settings_metadata;
  end if;

  if v_appointment.id is null then
    return 0;
  end if;

  v_offsets := case
    when jsonb_typeof(v_metadata -> 'reminder_minutes_before') = 'array'
      then v_metadata -> 'reminder_minutes_before'
    else '[1440,120]'::jsonb
  end;
  v_quiet_hours := v_metadata -> 'quiet_hours';

  for v_offset_text in select value from jsonb_array_elements_text(v_offsets)
  loop
    if v_offset_text !~ '^[0-9]{1,6}$' then
      continue;
    end if;
    v_offset := v_offset_text::integer;
    if v_offset < 5 or v_offset > 43200 then
      continue;
    end if;

    v_available_at := app_private.whatsapp_adjust_quiet_hours(
      v_appointment.starts_at - make_interval(mins => v_offset),
      v_appointment.timezone,
      v_quiet_hours
    );

    if v_available_at >= v_appointment.starts_at then
      continue;
    end if;

    insert into public.outbox_events (
      tenant_id,
      aggregate_type,
      aggregate_id,
      event_type,
      payload,
      occurred_at,
      available_at
    ) values (
      p_tenant_id,
      'appointment',
      p_appointment_id,
      'appointment.reminder_due',
      jsonb_build_object(
        'appointment_id', p_appointment_id,
        'starts_at', v_appointment.starts_at,
        'offset_minutes', v_offset,
        'source_event_id', p_source_event_id
      ),
      statement_timestamp(),
      greatest(v_available_at, statement_timestamp())
    )
    on conflict do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

create or replace function app_private.build_whatsapp_template_components(
  p_variable_mapping jsonb,
  p_appointment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_tenant_name text;
  v_customer_name text;
  v_location_name text;
  v_staff_name text;
  v_service_names text;
  v_count integer;
  v_item record;
  -- plpgsql proíbe variável de linha em lista INTO com vários itens.
  v_row record;
  v_value text;
  v_parameters jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_variable_mapping, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'template_mapping_invalid';
  end if;

  select count(*) into v_count from jsonb_object_keys(p_variable_mapping);
  if v_count = 0 then
    return '[]'::jsonb;
  end if;

  if v_count > 10 or exists (
    select 1
    from jsonb_each_text(p_variable_mapping) mapping
    where mapping.key !~ '^[1-9][0-9]?$'
      or mapping.value not in (
        'tenant.name', 'appointment.starts_at', 'appointment.date',
        'appointment.time', 'appointment.id', 'customer.name',
        'staff.name', 'location.name', 'services.names'
      )
  ) or (
    select max(mapping.key::integer) <> count(*)
    from jsonb_each_text(p_variable_mapping) mapping
  ) then
    raise exception using errcode = '22023', message = 'template_mapping_invalid';
  end if;

  select appointment as appointment_row,
         tenant.name as tenant_name,
         customer.full_name as customer_name,
         location.name as location_name,
         staff.name as staff_name,
         coalesce(string_agg(service.name_snapshot, ', ' order by service.sort_order), '')
           as service_names
    into v_row
  from public.appointments appointment
  join public.tenants tenant on tenant.id = appointment.tenant_id
  join public.customer_tenants relation
    on relation.tenant_id = appointment.tenant_id
   and relation.id = appointment.customer_tenant_id
  join public.customers customer on customer.id = relation.customer_id
  join public.locations location
    on location.tenant_id = appointment.tenant_id
   and location.id = appointment.location_id
  left join public.staff staff
    on staff.tenant_id = appointment.tenant_id
   and staff.id = appointment.staff_id
  left join public.appointment_services service
    on service.tenant_id = appointment.tenant_id
   and service.appointment_id = appointment.id
  where appointment.id = p_appointment_id
  group by appointment.id, tenant.name, customer.full_name, location.name, staff.name;

  if found then
    v_appointment := v_row.appointment_row;
    v_tenant_name := v_row.tenant_name;
    v_customer_name := v_row.customer_name;
    v_location_name := v_row.location_name;
    v_staff_name := v_row.staff_name;
    v_service_names := v_row.service_names;
  end if;

  if v_appointment.id is null then
    raise exception using errcode = 'P0002', message = 'template_appointment_not_found';
  end if;

  for v_item in
    select mapping.key::integer as position, mapping.value as source
    from jsonb_each_text(p_variable_mapping) mapping
    order by mapping.key::integer
  loop
    v_value := case v_item.source
      when 'tenant.name' then v_tenant_name
      when 'appointment.starts_at' then to_char(
        v_appointment.starts_at at time zone v_appointment.timezone,
        'DD/MM/YYYY HH24:MI'
      )
      when 'appointment.date' then to_char(
        v_appointment.starts_at at time zone v_appointment.timezone,
        'DD/MM/YYYY'
      )
      when 'appointment.time' then to_char(
        v_appointment.starts_at at time zone v_appointment.timezone,
        'HH24:MI'
      )
      when 'appointment.id' then v_appointment.id::text
      when 'customer.name' then v_customer_name
      when 'staff.name' then coalesce(v_staff_name, 'Profissional a definir')
      when 'location.name' then v_location_name
      when 'services.names' then v_service_names
      else null
    end;

    if char_length(trim(coalesce(v_value, ''))) not between 1 and 1024 then
      raise exception using errcode = '22023', message = 'template_mapping_invalid';
    end if;

    v_parameters := v_parameters || jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', v_value)
    );
  end loop;

  return jsonb_build_array(
    jsonb_build_object('type', 'body', 'parameters', v_parameters)
  );
end;
$$;

create or replace function app_private.cancel_whatsapp_appointment_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.starts_at is distinct from new.starts_at
    or old.tenant_id is distinct from new.tenant_id
    or (old.occupies_slot and not new.occupies_slot) then
    update public.outbox_events
    set processed_at = statement_timestamp(),
        last_error_code = case
          when not new.occupies_slot then 'appointment_no_longer_active'
          else 'appointment_schedule_changed'
        end
    where tenant_id = new.tenant_id
      and aggregate_type = 'appointment'
      and aggregate_id = new.id
      and event_type = 'appointment.reminder_due'
      and processed_at is null;

    with cancelled as (
      update public.whatsapp_outbox item
      set status = 'cancelled',
          processed_at = statement_timestamp(),
          locked_at = null,
          locked_until = null,
          locked_by = null,
          last_error = case
            when not new.occupies_slot then 'appointment_no_longer_active'
            else 'appointment_schedule_changed'
          end
      where item.status in ('pending', 'retry')
        and item.payload ->> 'appointmentId' = new.id::text
        and item.payload ->> 'purpose' in (
          'appointment_created', 'appointment_confirmed',
          'appointment_reminder', 'appointment_rescheduled'
        )
      returning item.message_id
    )
    update public.whatsapp_messages message
    set status = 'ignored',
        error_code = case
          when not new.occupies_slot then 'appointment_no_longer_active'
          else 'appointment_schedule_changed'
        end
    where message.id in (select cancelled.message_id from cancelled);
  end if;

  return new;
end;
$$;

create trigger appointments_cancel_whatsapp_reminders
after update of tenant_id, starts_at, status, occupies_slot on public.appointments
for each row execute function app_private.cancel_whatsapp_appointment_reminders();

create or replace function public.upsert_whatsapp_contact(
  p_provider text,
  p_whatsapp_user_id text,
  p_normalized_phone text,
  p_profile_name text
)
returns public.whatsapp_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.whatsapp_provider;
  v_contact public.whatsapp_contacts%rowtype;
  v_customer_id uuid;
begin
  begin
    v_provider := p_provider::public.whatsapp_provider;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_provider';
  end;

  if char_length(trim(coalesce(p_whatsapp_user_id, ''))) not between 1 and 200
    or p_normalized_phone !~ '^\+[1-9][0-9]{7,14}$'
    or char_length(coalesce(p_profile_name, '')) > 200 then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_contact';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_provider::text || ':' || trim(p_whatsapp_user_id), 0
  ));

  select customer.id into v_customer_id
  from public.customers customer
  where customer.phone_e164 = p_normalized_phone
    and customer.deleted_at is null
  for update;

  select * into v_contact
  from public.whatsapp_contacts
  where provider = v_provider
    and (
      whatsapp_user_id = trim(p_whatsapp_user_id) or
      normalized_phone = p_normalized_phone
    )
  order by (whatsapp_user_id = trim(p_whatsapp_user_id)) desc
  limit 1
  for update;

  if v_contact.id is null then
    insert into public.whatsapp_contacts (
      provider, normalized_phone, whatsapp_user_id, profile_name, customer_id,
      first_seen_at, last_seen_at
    ) values (
      v_provider,
      p_normalized_phone,
      trim(p_whatsapp_user_id),
      nullif(trim(p_profile_name), ''),
      v_customer_id,
      statement_timestamp(),
      statement_timestamp()
    ) returning * into v_contact;
  else
    update public.whatsapp_contacts
    set normalized_phone = p_normalized_phone,
        whatsapp_user_id = trim(p_whatsapp_user_id),
        profile_name = coalesce(nullif(trim(p_profile_name), ''), profile_name),
        customer_id = coalesce(customer_id, v_customer_id),
        last_seen_at = statement_timestamp(),
        metadata = metadata - 'provisional_web_opt_in'
    where id = v_contact.id
    returning * into v_contact;
  end if;

  return v_contact;
end;
$$;

create or replace function public.record_web_whatsapp_opt_in(
  p_tenant_id uuid,
  p_customer_phone text,
  p_category text,
  p_policy_version text,
  p_evidence jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.whatsapp_provider;
  v_category public.whatsapp_opt_in_category;
  v_contact_id uuid;
  v_customer_id uuid;
  v_wa_id text;
begin
  if p_customer_phone !~ '^\+[1-9][0-9]{7,14}$'
    or char_length(trim(coalesce(p_policy_version, ''))) not between 1 and 80
    or jsonb_typeof(coalesce(p_evidence, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_opt_in';
  end if;

  begin
    v_category := p_category::public.whatsapp_opt_in_category;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_opt_in_category';
  end;

  select phone.provider into v_provider
  from public.tenant_whatsapp_settings settings
  join public.tenants tenant on tenant.id = settings.tenant_id and tenant.state = 'published'
  join lateral (
    select link.phone_number_id
    from public.whatsapp_phone_number_tenants link
    where link.tenant_id = settings.tenant_id
      and link.status = 'active'
    order by
      (link.phone_number_id = settings.preferred_phone_number_id) desc,
      link.is_primary desc,
      link.created_at
    limit 1
  ) selected_phone on true
  join public.whatsapp_phone_numbers phone
    on phone.id = selected_phone.phone_number_id
   and phone.status = 'connected'
  where settings.tenant_id = p_tenant_id
    and settings.enabled
    and settings.booking_enabled;

  if v_provider is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_tenant_not_available';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_provider::text || ':' || p_customer_phone, 0
  ));
  v_wa_id := regexp_replace(p_customer_phone, '[^0-9]', '', 'g');

  select id into v_customer_id
  from public.customers
  where phone_e164 = p_customer_phone and deleted_at is null
  for update;

  if v_customer_id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_opt_in_customer_not_found';
  end if;

  select id into v_contact_id
  from public.whatsapp_contacts
  where provider = v_provider and normalized_phone = p_customer_phone
  for update;

  if v_contact_id is null then
    insert into public.whatsapp_contacts (
      provider, normalized_phone, whatsapp_user_id, customer_id, metadata
    ) values (
      v_provider,
      p_customer_phone,
      v_wa_id,
      v_customer_id,
      jsonb_build_object('provisional_web_opt_in', true)
    ) returning id into v_contact_id;
  else
    update public.whatsapp_contacts
    set customer_id = coalesce(customer_id, v_customer_id)
    where id = v_contact_id;
  end if;

  if exists (
    select 1 from public.whatsapp_opt_ins opt_in
    where opt_in.contact_id = v_contact_id
      and opt_in.tenant_id = p_tenant_id
      and opt_in.category = v_category
      and opt_in.superseded_at is null
      and opt_in.status = 'granted'
      and opt_in.policy_version = trim(p_policy_version)
      and opt_in.evidence = p_evidence
  ) then
    return true;
  end if;

  update public.whatsapp_opt_ins
  set superseded_at = statement_timestamp()
  where contact_id = v_contact_id
    and tenant_id = p_tenant_id
    and category = v_category
    and superseded_at is null;

  insert into public.whatsapp_opt_ins (
    contact_id,
    tenant_id,
    category,
    status,
    source,
    policy_version,
    evidence,
    granted_at,
    revoked_at
  ) values (
    v_contact_id,
    p_tenant_id,
    v_category,
    'granted',
    'public_booking',
    trim(p_policy_version),
    p_evidence,
    statement_timestamp(),
    null
  );

  return true;
end;
$$;

create or replace function public.get_public_whatsapp_consent_availability(
  p_tenant_slug text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenants tenant
    join public.tenant_whatsapp_settings settings
      on settings.tenant_id = tenant.id
     and settings.enabled
     and settings.booking_enabled
    join public.whatsapp_phone_number_tenants link
      on link.tenant_id = tenant.id
     and link.status = 'active'
    join public.whatsapp_phone_numbers phone
      on phone.id = link.phone_number_id
     and phone.status = 'connected'
    where tenant.slug = trim(coalesce(p_tenant_slug, ''))
      and tenant.state = 'published'
  );
$$;

create or replace function public.create_public_booking_with_whatsapp_consent(
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
  p_rate_limit_key text,
  p_whatsapp_consent boolean,
  p_whatsapp_consent_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_appointment_id uuid;
  v_tenant_id uuid;
  v_tenant_slug text;
  v_tenant_name text;
  v_policy_version text;
  v_category public.whatsapp_opt_in_category;
  v_evidence jsonb;
begin
  if p_whatsapp_consent is true and (
    jsonb_typeof(coalesce(p_whatsapp_consent_evidence, 'null'::jsonb)) <> 'object'
    or pg_column_size(p_whatsapp_consent_evidence) > 2048
  ) then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_consent_evidence';
  end if;

  if p_whatsapp_consent is true and (
    (select count(*) from jsonb_object_keys(p_whatsapp_consent_evidence)) > 4 or
    exists (
      select 1
      from jsonb_object_keys(p_whatsapp_consent_evidence) supplied(key)
      where supplied.key not in ('policyId', 'policyVersion', 'tenantSlug', 'textTemplate')
    ) or
    coalesce(p_whatsapp_consent_evidence ->> 'policyId', '') <> 'booking_transactional_updates' or
    coalesce(p_whatsapp_consent_evidence ->> 'policyVersion', '') <> '2026-07-31'
  ) then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_consent_evidence';
  end if;

  v_result := public.create_public_booking(
    p_tenant_slug,
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
    p_rate_limit_key
  );

  if p_whatsapp_consent is distinct from true then
    return v_result;
  end if;

  v_appointment_id := (v_result ->> 'appointmentId')::uuid;
  select appointment.tenant_id, tenant.slug::text, tenant.name
    into v_tenant_id, v_tenant_slug, v_tenant_name
  from public.appointments appointment
  join public.tenants tenant on tenant.id = appointment.tenant_id
  join public.customer_tenants relation
    on relation.tenant_id = appointment.tenant_id
   and relation.id = appointment.customer_tenant_id
  join public.customers customer
    on customer.id = relation.customer_id
   and customer.phone_e164 = p_customer_phone
   and customer.deleted_at is null
  where appointment.id = v_appointment_id
    and appointment.idempotency_key = p_idempotency_key;

  if v_tenant_id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_consent_booking_not_found';
  end if;

  v_policy_version := '2026-07-31';
  v_evidence := jsonb_build_object(
    'policyId', 'booking_transactional_updates',
    'policyVersion', v_policy_version,
    'tenantSlug', v_tenant_slug,
    'tenantName', v_tenant_name,
    'textTemplate', 'Quero receber pelo WhatsApp confirmações, lembretes e atualizações relacionadas aos meus agendamentos enviados por {estabelecimento}. Posso revogar essa autorização a qualquer momento.',
    'appointmentId', v_appointment_id,
    'capturedVia', 'public_booking'
  );

  foreach v_category in array array[
    'transactional'::public.whatsapp_opt_in_category,
    'reminders'::public.whatsapp_opt_in_category,
    'service_updates'::public.whatsapp_opt_in_category
  ] loop
    perform public.record_web_whatsapp_opt_in(
      v_tenant_id,
      p_customer_phone,
      v_category::text,
      v_policy_version,
      v_evidence
    );
  end loop;

  return v_result;
end;
$$;

create or replace function public.consume_whatsapp_routing_code(
  p_phone_number_id uuid,
  p_code text,
  p_usage_key text
)
returns table (
  tenant_id uuid,
  routing_code_id uuid,
  code_type public.whatsapp_routing_code_type
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.whatsapp_routing_codes%rowtype;
begin
  if trim(coalesce(p_code, '')) !~ '^[A-Za-z0-9]{5,64}$'
    or char_length(trim(coalesce(p_usage_key, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_routing_code';
  end if;

  select routing.* into v_code
  from public.whatsapp_routing_codes routing
  join public.whatsapp_phone_number_tenants link
    on link.phone_number_id = routing.phone_number_id
   and link.tenant_id = routing.tenant_id
   and link.status = 'active'
  join public.tenant_whatsapp_settings settings
    on settings.tenant_id = routing.tenant_id
   and settings.enabled
  where routing.phone_number_id = p_phone_number_id
    and routing.code = upper(trim(p_code))
  for update of routing;

  if v_code.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_routing_code_not_found';
  end if;

  if exists (
    select 1 from public.whatsapp_routing_code_uses usage
    where usage.routing_code_id = v_code.id
      and usage.usage_key = trim(p_usage_key)
  ) then
    return query select v_code.tenant_id, v_code.id, v_code.type;
    return;
  end if;

  if v_code.status <> 'active'
    or (v_code.expires_at is not null and v_code.expires_at <= statement_timestamp())
    or (v_code.max_uses is not null and v_code.uses_count >= v_code.max_uses) then
    raise exception using errcode = 'P0002', message = 'whatsapp_routing_code_not_found';
  end if;

  insert into public.whatsapp_routing_code_uses (routing_code_id, usage_key)
  values (v_code.id, trim(p_usage_key));

  update public.whatsapp_routing_codes
  set uses_count = uses_count + 1
  where id = v_code.id;

  return query select v_code.tenant_id, v_code.id, v_code.type;
end;
$$;

create or replace function public.resolve_whatsapp_customer_tenant(
  p_conversation_id uuid,
  p_contact_id uuid,
  p_tenant_id uuid,
  p_profile_name text
)
returns table (customer_id uuid, customer_tenant_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.whatsapp_contacts%rowtype;
  v_customer_id uuid;
  v_customer_tenant_id uuid;
  v_name text;
  v_context_conversation_id uuid;
begin
  v_name := coalesce(nullif(trim(p_profile_name), ''), 'Cliente WhatsApp');
  if char_length(v_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'invalid_customer_name';
  end if;

  select * into v_contact
  from public.whatsapp_contacts
  where id = p_contact_id and blocked_at is null
  for update;

  if v_contact.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_contact_not_found';
  end if;

  select conversation.id into v_context_conversation_id
    from public.whatsapp_conversations conversation
    join public.whatsapp_phone_number_tenants link
      on link.phone_number_id = conversation.phone_number_id
     and link.tenant_id = p_tenant_id
     and link.status = 'active'
    join public.tenant_whatsapp_settings settings
      on settings.tenant_id = p_tenant_id and settings.enabled
    join public.tenants tenant on tenant.id = p_tenant_id and tenant.state = 'published'
    where conversation.id = p_conversation_id
      and conversation.contact_id = p_contact_id
      and (conversation.tenant_id is null or conversation.tenant_id = p_tenant_id)
      and conversation.status in ('open', 'waiting_customer', 'processing', 'human_handoff')
    for share of conversation, link, settings, tenant;

  if v_context_conversation_id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_tenant_context_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_contact.normalized_phone, 0));

  select customer.id into v_customer_id
  from public.customers customer
  where customer.phone_e164 = v_contact.normalized_phone
    and customer.deleted_at is null
  for update;

  if v_customer_id is null then
    insert into public.customers (full_name, phone_e164)
    values (v_name, v_contact.normalized_phone)
    returning id into v_customer_id;
  end if;

  update public.whatsapp_contacts
  set customer_id = v_customer_id,
      profile_name = coalesce(nullif(trim(p_profile_name), ''), profile_name),
      last_seen_at = statement_timestamp()
  where id = p_contact_id;

  insert into public.customer_tenants (
    tenant_id,
    customer_id,
    display_name,
    source,
    last_interaction_at
  ) values (
    p_tenant_id,
    v_customer_id,
    v_name,
    'whatsapp',
    statement_timestamp()
  )
  on conflict (tenant_id, customer_id)
  do update set
    display_name = coalesce(public.customer_tenants.display_name, excluded.display_name),
    last_interaction_at = statement_timestamp(),
    updated_at = statement_timestamp()
  returning id into v_customer_tenant_id;

  return query select v_customer_id, v_customer_tenant_id;
end;
$$;

create or replace function public.create_whatsapp_booking(
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
  p_idempotency_key uuid,
  p_conversation_id uuid,
  p_external_contact_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_contact_id uuid;
  v_customer_id uuid;
  v_customer_tenant_id uuid;
  v_existing_origin public.appointment_origin;
  v_result jsonb;
  v_appointment_id uuid;
  v_settings_metadata jsonb;
begin
  if p_idempotency_key is null
    or coalesce(cardinality(p_service_ids), 0) < 1
    or p_customer_phone !~ '^\+[1-9][0-9]{7,14}$'
    or char_length(trim(coalesce(p_external_contact_id, ''))) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_booking_request';
  end if;

  select tenant.slug::text, conversation.contact_id, settings.metadata
    into v_slug, v_contact_id, v_settings_metadata
  from public.whatsapp_conversations conversation
  join public.whatsapp_contacts contact
    on contact.id = conversation.contact_id
   and contact.whatsapp_user_id = trim(p_external_contact_id)
   and contact.normalized_phone = p_customer_phone
   and contact.blocked_at is null
  join public.whatsapp_phone_number_tenants link
    on link.phone_number_id = conversation.phone_number_id
   and link.tenant_id = p_tenant_id
   and link.status = 'active'
  join public.tenant_whatsapp_settings settings
    on settings.tenant_id = p_tenant_id
   and settings.enabled
   and settings.booking_enabled
  join public.tenants tenant
    on tenant.id = p_tenant_id
   and tenant.state = 'published'
  where conversation.id = p_conversation_id
    and conversation.tenant_id = p_tenant_id
    and conversation.status in ('open', 'waiting_customer', 'processing')
  for share of conversation, contact, link, settings, tenant;

  if v_contact_id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_booking_context_not_found';
  end if;

  if v_settings_metadata ? 'allowed_service_ids' then
    if jsonb_typeof(v_settings_metadata -> 'allowed_service_ids') <> 'array' then
      raise exception using errcode = '22023', message = 'whatsapp_channel_configuration_invalid';
    end if;
    if jsonb_array_length(v_settings_metadata -> 'allowed_service_ids') > 200 then
      raise exception using errcode = '22023', message = 'whatsapp_channel_configuration_invalid';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_settings_metadata -> 'allowed_service_ids') item
      where jsonb_typeof(item) <> 'string'
        or coalesce(item #>> '{}', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception using errcode = '22023', message = 'whatsapp_channel_configuration_invalid';
    end if;

    if exists (
      select 1
      from unnest(p_service_ids) service_id
      where not exists (
        select 1
        from jsonb_array_elements_text(v_settings_metadata -> 'allowed_service_ids') allowed(value)
        where allowed.value = service_id::text
      )
    ) then
      raise exception using errcode = '42501', message = 'whatsapp_service_not_allowed';
    end if;
  end if;

  if v_settings_metadata ? 'allowed_location_ids' then
    if jsonb_typeof(v_settings_metadata -> 'allowed_location_ids') <> 'array' then
      raise exception using errcode = '22023', message = 'whatsapp_channel_configuration_invalid';
    end if;
    if jsonb_array_length(v_settings_metadata -> 'allowed_location_ids') > 200 then
      raise exception using errcode = '22023', message = 'whatsapp_channel_configuration_invalid';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_settings_metadata -> 'allowed_location_ids') item
      where jsonb_typeof(item) <> 'string'
        or coalesce(item #>> '{}', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception using errcode = '22023', message = 'whatsapp_channel_configuration_invalid';
    end if;

    if not exists (
      select 1
      from jsonb_array_elements_text(v_settings_metadata -> 'allowed_location_ids') allowed(value)
      where allowed.value = p_location_id::text
    ) then
      raise exception using errcode = '42501', message = 'whatsapp_location_not_allowed';
    end if;
  end if;

  select resolved.customer_id, resolved.customer_tenant_id
    into v_customer_id, v_customer_tenant_id
  from public.resolve_whatsapp_customer_tenant(
    p_conversation_id,
    v_contact_id,
    p_tenant_id,
    p_customer_name
  ) resolved;

  perform pg_advisory_xact_lock(hashtextextended(p_customer_phone, 0));

  select appointment.origin into v_existing_origin
  from public.appointments appointment
  where appointment.tenant_id = p_tenant_id
    and appointment.idempotency_key = p_idempotency_key;

  if v_existing_origin is not null and v_existing_origin <> 'whatsapp' then
    raise exception using errcode = '22023', message = 'booking_idempotency_channel_conflict';
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
    encode(extensions.digest(
      convert_to(
        p_tenant_id::text || ':' || v_contact_id::text || ':' || p_customer_phone || ':whatsapp-booking',
        'UTF8'
      ),
      'sha256'
    ), 'hex')
  );

  v_appointment_id := (v_result ->> 'appointmentId')::uuid;

  update public.appointments
  set origin = 'whatsapp',
      metadata = metadata || jsonb_build_object(
        'whatsapp_conversation_id', p_conversation_id,
        'whatsapp_contact_id', v_contact_id
      )
  where tenant_id = p_tenant_id
    and id = v_appointment_id
    and customer_tenant_id = v_customer_tenant_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'whatsapp_booking_customer_mismatch';
  end if;

  update public.customer_tenants
  set source = case when appointments_count <= 1 then 'whatsapp' else source end,
      last_interaction_at = statement_timestamp()
  where tenant_id = p_tenant_id and id = v_customer_tenant_id;

  update public.whatsapp_contacts
  set customer_id = v_customer_id, last_seen_at = statement_timestamp()
  where id = v_contact_id;

  update public.outbox_events
  set payload = payload || jsonb_build_object(
    'origin', 'whatsapp',
    'whatsapp_conversation_id', p_conversation_id
  )
  where tenant_id = p_tenant_id
    and aggregate_id = v_appointment_id
    and event_type in ('appointment.created', 'appointment.confirmed');

  return v_result || jsonb_build_object(
    'origin', 'whatsapp',
    'conversationId', p_conversation_id,
    'customerId', v_customer_id,
    'customerTenantId', v_customer_tenant_id
  );
end;
$$;

create or replace function public.list_whatsapp_customer_bookings(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_limit integer default 10
)
returns table (
  appointment_id uuid,
  location_id uuid,
  location_name text,
  staff_id uuid,
  staff_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  status public.appointment_status,
  origin public.appointment_origin,
  total_cents integer,
  service_names jsonb,
  can_cancel boolean,
  can_reschedule boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 20 then
    raise exception using errcode = '22023', message = 'invalid_booking_limit';
  end if;

  return query
  select
    appointment.id,
    appointment.location_id,
    location.name,
    appointment.staff_id,
    staff.name,
    appointment.starts_at,
    appointment.ends_at,
    appointment.timezone,
    appointment.status,
    appointment.origin,
    appointment.total_cents,
    coalesce((
      select jsonb_agg(service.name_snapshot order by service.sort_order)
      from public.appointment_services service
      where service.tenant_id = appointment.tenant_id
        and service.appointment_id = appointment.id
    ), '[]'::jsonb),
    settings.cancellations_enabled
      and business.allow_customer_cancellation
      and appointment.occupies_slot
      and appointment.starts_at > statement_timestamp() +
        make_interval(mins => business.cancellation_window_minutes),
    settings.rescheduling_enabled
      and business.allow_customer_reschedule
      and appointment.occupies_slot
      and appointment.starts_at > statement_timestamp() +
        make_interval(mins => business.cancellation_window_minutes)
  from public.customer_tenants relation
  join public.appointments appointment
    on appointment.tenant_id = relation.tenant_id
   and appointment.customer_tenant_id = relation.id
  join public.locations location
    on location.tenant_id = appointment.tenant_id and location.id = appointment.location_id
  join public.business_settings business on business.tenant_id = appointment.tenant_id
  join public.tenant_whatsapp_settings settings
    on settings.tenant_id = appointment.tenant_id and settings.enabled
  left join public.staff staff
    on staff.tenant_id = appointment.tenant_id and staff.id = appointment.staff_id
  where relation.tenant_id = p_tenant_id
    and relation.customer_id = p_customer_id
    and not relation.is_blocked
    and appointment.starts_at >= statement_timestamp()
    and appointment.occupies_slot
  order by appointment.starts_at
  limit p_limit;
end;
$$;

create or replace function public.get_whatsapp_reschedule_slots(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_appointment_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_staff_id uuid,
  p_limit integer
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
  -- plpgsql proíbe variável de linha em lista INTO com vários itens.
  v_row record;
begin
  select appointment as appointment_row, tenant.slug::text as tenant_slug
    into v_row
  from public.appointments appointment
  join public.customer_tenants relation
    on relation.tenant_id = appointment.tenant_id
   and relation.id = appointment.customer_tenant_id
   and relation.customer_id = p_customer_id
   and not relation.is_blocked
  join public.tenants tenant on tenant.id = appointment.tenant_id
  join public.business_settings business
    on business.tenant_id = appointment.tenant_id
   and business.allow_customer_reschedule
  join public.tenant_whatsapp_settings settings
    on settings.tenant_id = appointment.tenant_id
   and settings.enabled
   and settings.rescheduling_enabled
  where appointment.tenant_id = p_tenant_id
    and appointment.id = p_appointment_id
    and appointment.occupies_slot
    and appointment.starts_at > statement_timestamp() +
      make_interval(mins => business.cancellation_window_minutes);

  if found then
    v_appointment := v_row.appointment_row;
    v_slug := v_row.tenant_slug;
  end if;

  if v_appointment.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_booking_not_found';
  end if;

  select array_agg(service_id order by sort_order) into v_service_ids
  from public.appointment_services
  where tenant_id = p_tenant_id and appointment_id = p_appointment_id;

  return query
  select slot.starts_at, slot.ends_at, slot.staff_id, slot.staff_name
  from public.get_available_slots(
    v_slug,
    v_appointment.location_id,
    v_service_ids,
    p_staff_id,
    p_range_start,
    p_range_end,
    v_appointment.timezone,
    p_limit
  ) slot;
end;
$$;

create or replace function public.cancel_whatsapp_booking(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_appointment_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_window integer;
  -- plpgsql proíbe variável de linha em lista INTO com vários itens.
  v_row record;
begin
  if p_idempotency_key is null or p_conversation_id is null or not exists (
    select 1
    from public.whatsapp_conversations conversation
    join public.whatsapp_contacts contact on contact.id = conversation.contact_id
    where conversation.id = p_conversation_id
      and conversation.tenant_id = p_tenant_id
      and contact.customer_id = p_customer_id
  ) then
    raise exception using errcode = '42501', message = 'whatsapp_channel_actor_mismatch';
  end if;

  select appointment as appointment_row,
         business.cancellation_window_minutes as cancellation_window
    into v_row
  from public.appointments appointment
  join public.customer_tenants relation
    on relation.tenant_id = appointment.tenant_id
   and relation.id = appointment.customer_tenant_id
   and relation.customer_id = p_customer_id
   and not relation.is_blocked
  join public.business_settings business
    on business.tenant_id = appointment.tenant_id
   and business.allow_customer_cancellation
  join public.tenant_whatsapp_settings settings
    on settings.tenant_id = appointment.tenant_id
   and settings.enabled
   and settings.cancellations_enabled
  where appointment.tenant_id = p_tenant_id
    and appointment.id = p_appointment_id
  for update of appointment;

  if found then
    v_appointment := v_row.appointment_row;
    v_window := v_row.cancellation_window;
  end if;

  if v_appointment.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_booking_not_found';
  end if;

  if v_appointment.status = 'cancelled_by_customer' then
    return jsonb_build_object(
      'appointmentId', v_appointment.id,
      'status', 'cancelled_by_customer',
      'idempotent', true
    );
  end if;

  if not v_appointment.occupies_slot
    or v_appointment.starts_at <= statement_timestamp() + make_interval(mins => v_window) then
    raise exception using errcode = '22023', message = 'cancellation_not_allowed';
  end if;

  update public.appointments
  set status = 'cancelled_by_customer',
      cancellation_reason = left(nullif(trim(p_reason), ''), 500),
      metadata = metadata || jsonb_build_object(
        'cancelled_via', 'whatsapp',
        'whatsapp_cancellation_idempotency_key', p_idempotency_key,
        'whatsapp_conversation_id', p_conversation_id
      )
  where tenant_id = p_tenant_id and id = p_appointment_id;

  update public.customer_tenants
  set cancellation_count = cancellation_count + 1,
      next_appointment_at = null,
      last_interaction_at = statement_timestamp()
  where tenant_id = p_tenant_id and id = v_appointment.customer_tenant_id;

  insert into public.appointment_status_history (
    tenant_id, appointment_id, from_status, to_status, reason, metadata
  ) values (
    p_tenant_id,
    p_appointment_id,
    v_appointment.status,
    'cancelled_by_customer',
    left(nullif(trim(p_reason), ''), 500),
    jsonb_build_object(
      'channel', 'whatsapp',
      'idempotency_key', p_idempotency_key,
      'conversation_id', p_conversation_id
    )
  );

  insert into public.outbox_events (
    tenant_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    p_tenant_id,
    'appointment',
    p_appointment_id,
    'appointment.cancelled',
    jsonb_build_object(
      'appointment_id', p_appointment_id,
      'cancelled_by', 'customer',
      'channel', 'whatsapp',
      'previous_status', v_appointment.status,
      'idempotency_key', p_idempotency_key,
      'conversation_id', p_conversation_id
    )
  );

  return jsonb_build_object(
    'appointmentId', p_appointment_id,
    'status', 'cancelled_by_customer',
    'idempotent', false
  );
end;
$$;

create or replace function public.reschedule_whatsapp_booking(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_staff_id uuid,
  p_idempotency_key uuid,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.appointments%rowtype;
  v_token text;
  v_result jsonb;
  v_new_id uuid;
begin
  if p_idempotency_key is null or p_conversation_id is null or not exists (
    select 1
    from public.whatsapp_conversations conversation
    join public.whatsapp_contacts contact on contact.id = conversation.contact_id
    where conversation.id = p_conversation_id
      and conversation.tenant_id = p_tenant_id
      and contact.customer_id = p_customer_id
  ) then
    raise exception using errcode = '42501', message = 'whatsapp_channel_actor_mismatch';
  end if;

  select appointment.* into v_old
  from public.appointments appointment
  join public.customer_tenants relation
    on relation.tenant_id = appointment.tenant_id
   and relation.id = appointment.customer_tenant_id
   and relation.customer_id = p_customer_id
   and not relation.is_blocked
  join public.tenant_whatsapp_settings settings
    on settings.tenant_id = appointment.tenant_id
   and settings.enabled
   and settings.rescheduling_enabled
  where appointment.tenant_id = p_tenant_id
    and appointment.id = p_appointment_id
  for update of appointment;

  if v_old.id is null then
    raise exception using errcode = 'P0002', message = 'whatsapp_booking_not_found';
  end if;

  if v_old.idempotency_key is null then
    raise exception using errcode = '22023', message = 'booking_management_token_unavailable';
  end if;

  v_token := encode(
    extensions.digest(
      convert_to(p_tenant_id::text || ':' || v_old.idempotency_key::text || ':manage', 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  v_result := public.reschedule_public_booking(
    v_token,
    p_starts_at,
    p_staff_id,
    p_idempotency_key
  );

  v_new_id := (v_result ->> 'appointmentId')::uuid;

  update public.appointments
  set metadata = metadata || jsonb_build_object(
    'rescheduled_via', 'whatsapp',
    'previous_appointment_id', p_appointment_id,
    'whatsapp_reschedule_idempotency_key', p_idempotency_key,
    'whatsapp_conversation_id', p_conversation_id
  )
  where tenant_id = p_tenant_id and id = v_new_id;

  update public.customer_tenants
  set last_interaction_at = statement_timestamp()
  where tenant_id = p_tenant_id and customer_id = p_customer_id;

  update public.outbox_events
  set payload = payload || jsonb_build_object(
    'origin', v_old.origin,
    'rescheduled_via', 'whatsapp',
    'idempotency_key', p_idempotency_key,
    'conversation_id', p_conversation_id
  )
  where tenant_id = p_tenant_id
    and (
      (aggregate_id = v_new_id and event_type in (
        'appointment.created', 'appointment.confirmed'
      )) or
      (aggregate_id = p_appointment_id and event_type = 'appointment.rescheduled')
    );

  return v_result || jsonb_build_object('rescheduledVia', 'whatsapp');
end;
$$;

create or replace function public.record_whatsapp_opt_out(
  p_contact_id uuid,
  p_tenant_id uuid,
  p_source_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.whatsapp_opt_in_category;
  v_current public.whatsapp_opt_ins%rowtype;
begin
  if char_length(trim(coalesce(p_source_message_id, ''))) not between 1 and 300
    or not exists (
      select 1 from public.whatsapp_contacts where id = p_contact_id
    )
    or not exists (
      select 1 from public.tenants where id = p_tenant_id
    ) then
    raise exception using errcode = '22023', message = 'invalid_whatsapp_opt_out';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_contact_id::text || ':' || p_tenant_id::text || ':opt-out', 0
  ));

  foreach v_category in array array[
    'transactional'::public.whatsapp_opt_in_category,
    'reminders'::public.whatsapp_opt_in_category,
    'service_updates'::public.whatsapp_opt_in_category,
    'marketing'::public.whatsapp_opt_in_category
  ] loop
    select * into v_current
    from public.whatsapp_opt_ins
    where contact_id = p_contact_id
      and tenant_id = p_tenant_id
      and category = v_category
      and superseded_at is null
    for update;

    if v_current.id is not null
      and v_current.status = 'revoked'
      and v_current.evidence ->> 'sourceMessageId' = trim(p_source_message_id) then
      continue;
    end if;

    update public.whatsapp_opt_ins
    set superseded_at = statement_timestamp()
    where contact_id = p_contact_id
      and tenant_id = p_tenant_id
      and category = v_category
      and superseded_at is null;

    insert into public.whatsapp_opt_ins (
      contact_id,
      tenant_id,
      category,
      status,
      source,
      policy_version,
      evidence,
      revoked_at
    ) values (
      p_contact_id,
      p_tenant_id,
      v_category,
      'revoked',
      'whatsapp_message',
      coalesce(v_current.policy_version, 'opt-out-v1'),
      jsonb_build_object('sourceMessageId', trim(p_source_message_id)),
      statement_timestamp()
    );

    v_current := null;
  end loop;

  return true;
end;
$$;

create or replace function public.enqueue_whatsapp_appointment_notification(
  p_outbox_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.outbox_events%rowtype;
  v_appointment public.appointments%rowtype;
  v_settings public.tenant_whatsapp_settings%rowtype;
  v_phone public.whatsapp_phone_numbers%rowtype;
  v_contact public.whatsapp_contacts%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_template public.whatsapp_template_definitions%rowtype;
  -- plpgsql proíbe variável de linha em lista INTO com vários itens; o registro
  -- intermediário é reaproveitado entre as consultas desta função.
  v_row record;
  v_template_mapping jsonb;
  v_template_components jsonb;
  v_target_appointment_id uuid;
  v_customer_id uuid;
  v_purpose public.whatsapp_template_purpose;
  v_category public.whatsapp_opt_in_category;
  v_capability_enabled boolean;
  v_inside_window boolean;
  v_message_type public.whatsapp_message_type;
  v_response jsonb;
  v_idempotency_key text;
  v_message_id uuid;
  v_outbox_id uuid;
  v_reminders_scheduled integer := 0;
  v_operation_conversation_id text;
begin
  select * into v_event
  from public.outbox_events
  where id = p_outbox_event_id;

  if v_event.id is null or v_event.aggregate_type <> 'appointment' then
    return jsonb_build_object('status', 'skipped', 'reason', 'event_not_applicable');
  end if;

  if v_event.processed_at is not null then
    return jsonb_build_object('status', 'skipped', 'reason', 'event_already_processed');
  end if;

  case v_event.event_type
    when 'appointment.created' then
      v_target_appointment_id := v_event.aggregate_id;
      v_purpose := 'appointment_created';
      v_category := 'transactional';
    when 'appointment.confirmed' then
      v_target_appointment_id := v_event.aggregate_id;
      v_purpose := 'appointment_confirmed';
      v_category := 'transactional';
    when 'appointment.reminder_due' then
      v_target_appointment_id := v_event.aggregate_id;
      v_purpose := 'appointment_reminder';
      v_category := 'reminders';
    when 'appointment.rescheduled' then
      begin
        v_target_appointment_id := (v_event.payload ->> 'new_appointment_id')::uuid;
      exception when invalid_text_representation then
        return jsonb_build_object('status', 'skipped', 'reason', 'reschedule_payload_invalid');
      end;
      v_purpose := 'appointment_rescheduled';
      v_category := 'service_updates';
      update public.outbox_events
      set processed_at = statement_timestamp(),
          last_error_code = 'reminder_replaced'
      where tenant_id = v_event.tenant_id
        and aggregate_id = v_event.aggregate_id
        and event_type = 'appointment.reminder_due'
        and processed_at is null
        and id <> v_event.id;
    when 'appointment.cancelled' then
      v_target_appointment_id := v_event.aggregate_id;
      v_purpose := 'appointment_cancelled';
      v_category := 'service_updates';
      update public.outbox_events
      set processed_at = statement_timestamp(),
          last_error_code = 'reminder_cancelled'
      where tenant_id = v_event.tenant_id
        and aggregate_id = v_event.aggregate_id
        and event_type = 'appointment.reminder_due'
        and processed_at is null
        and id <> v_event.id;
    else
      return jsonb_build_object('status', 'skipped', 'reason', 'event_type_not_supported');
  end case;

  if v_event.event_type in ('appointment.created', 'appointment.rescheduled') then
    v_reminders_scheduled := app_private.schedule_whatsapp_appointment_reminders(
      v_event.tenant_id,
      v_target_appointment_id,
      v_event.id
    );
  end if;

  select appointment as appointment_row,
         relation.customer_id as customer_id,
         settings as settings_row,
         phone as phone_row
    into v_row
  from public.appointments appointment
  join public.customer_tenants relation
    on relation.tenant_id = appointment.tenant_id
   and relation.id = appointment.customer_tenant_id
   and not relation.is_blocked
  join public.tenant_whatsapp_settings settings
    on settings.tenant_id = appointment.tenant_id
   and settings.enabled
  join lateral (
    select link.phone_number_id
    from public.whatsapp_phone_number_tenants link
    where link.tenant_id = appointment.tenant_id
      and link.status = 'active'
    order by
      (link.phone_number_id = settings.preferred_phone_number_id) desc,
      link.is_primary desc,
      link.created_at
    limit 1
  ) selected_phone on true
  join public.whatsapp_phone_numbers phone
    on phone.id = selected_phone.phone_number_id
   and phone.status = 'connected'
  where appointment.tenant_id = v_event.tenant_id
    and appointment.id = v_target_appointment_id
  for update of appointment;

  if found then
    v_appointment := v_row.appointment_row;
    v_customer_id := v_row.customer_id;
    v_settings := v_row.settings_row;
    v_phone := v_row.phone_row;
  end if;

  if v_appointment.id is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'notification_context_not_found',
      'remindersScheduled', v_reminders_scheduled
    );
  end if;

  select * into v_event
  from public.outbox_events
  where id = p_outbox_event_id
  for update;

  if v_event.processed_at is not null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'event_already_processed',
      'remindersScheduled', v_reminders_scheduled
    );
  end if;

  if v_event.event_type = 'appointment.reminder_due'
    and (
      not v_appointment.occupies_slot
      or v_appointment.status in ('cancelled_by_customer', 'cancelled_by_business', 'completed', 'no_show')
      or v_appointment.starts_at <= statement_timestamp()
    ) then
    update public.outbox_events
    set processed_at = statement_timestamp(),
        last_error_code = 'whatsapp_reminder_not_applicable'
    where id = v_event.id;
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'reminder_not_applicable',
      'remindersScheduled', v_reminders_scheduled
    );
  end if;

  if v_event.event_type in (
      'appointment.created', 'appointment.confirmed', 'appointment.rescheduled'
    ) and not v_appointment.occupies_slot then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'appointment_no_longer_active',
      'remindersScheduled', v_reminders_scheduled
    );
  end if;

  if v_event.event_type = 'appointment.created'
    and (
      v_appointment.rescheduled_from_id is not null
      or v_event.payload ? 'rescheduled_via'
    ) then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'reschedule_created_suppressed',
      'remindersScheduled', v_reminders_scheduled
    );
  end if;

  v_operation_conversation_id := coalesce(
    nullif(v_event.payload ->> 'whatsapp_conversation_id', ''),
    nullif(v_event.payload ->> 'conversation_id', '')
  );
  if v_event.event_type in (
      'appointment.created', 'appointment.confirmed',
      'appointment.cancelled', 'appointment.rescheduled'
    )
    and (
      v_event.payload ->> 'origin' = 'whatsapp'
      or v_event.payload ->> 'channel' = 'whatsapp'
      or v_event.payload ->> 'rescheduled_via' = 'whatsapp'
    )
    and v_operation_conversation_id is not null
    and v_appointment.metadata ->> 'whatsapp_conversation_id' = v_operation_conversation_id then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'whatsapp_originated_operation',
      'remindersScheduled', v_reminders_scheduled
    );
  end if;

  v_capability_enabled := case v_event.event_type
    when 'appointment.reminder_due' then v_settings.reminders_enabled
    when 'appointment.rescheduled' then v_settings.rescheduling_enabled
    when 'appointment.cancelled' then v_settings.cancellations_enabled
    else v_settings.booking_enabled
  end;
  if not v_capability_enabled then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'notification_capability_disabled',
      'remindersScheduled', v_reminders_scheduled
    );
  end if;

  v_idempotency_key := 'notification:' || v_event.id::text;
  select message.id, item.id
    into v_message_id, v_outbox_id
  from public.whatsapp_messages message
  left join public.whatsapp_outbox item on item.message_id = message.id
  where message.idempotency_key = v_idempotency_key
  limit 1;

  if v_message_id is not null then
    return jsonb_build_object(
      'status', 'queued',
      'reason', 'already_enqueued',
      'messageId', v_message_id,
      'outboxId', v_outbox_id,
      'remindersScheduled', v_reminders_scheduled
    );
  end if;

  select * into v_contact
  from public.whatsapp_contacts contact
  where contact.provider = v_phone.provider
    and contact.customer_id = v_customer_id
    and contact.blocked_at is null
  order by contact.last_seen_at desc
  limit 1;

  if v_contact.id is null then
    return jsonb_build_object('status', 'blocked', 'reason', 'whatsapp_contact_not_found');
  end if;

  if not exists (
    select 1 from public.whatsapp_opt_ins opt_in
    where opt_in.contact_id = v_contact.id
      and opt_in.tenant_id = v_event.tenant_id
      and opt_in.category = v_category
      and opt_in.status = 'granted'
      and opt_in.superseded_at is null
  ) then
    return jsonb_build_object('status', 'blocked', 'reason', 'whatsapp_opt_in_missing');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_phone.id::text || ':' || v_contact.id::text || ':notification', 0
  ));

  select * into v_conversation
  from public.whatsapp_conversations conversation
  where conversation.phone_number_id = v_phone.id
    and conversation.contact_id = v_contact.id
    and conversation.status in ('open', 'waiting_customer', 'processing', 'human_handoff')
  for update;

  if v_conversation.id is not null
    and v_conversation.tenant_id is distinct from v_event.tenant_id then
    return jsonb_build_object('status', 'blocked', 'reason', 'active_conversation_other_context');
  end if;

  v_inside_window := v_conversation.id is not null
    and v_conversation.service_window_expires_at > statement_timestamp();

  if not v_inside_window then
    select definition as definition_row,
           tenant_template.variable_mapping as variable_mapping
      into v_row
    from public.tenant_whatsapp_templates tenant_template
    join public.whatsapp_template_definitions definition
      on definition.id = tenant_template.template_definition_id
    where tenant_template.tenant_id = v_event.tenant_id
      and tenant_template.purpose = v_purpose
      and tenant_template.enabled
      and definition.business_account_id = v_phone.business_account_id
      and (
        definition.status = 'approved' or
        (v_phone.provider = 'mock' and definition.status = 'local_draft')
      )
    limit 1;

    if found then
      v_template := v_row.definition_row;
      v_template_mapping := v_row.variable_mapping;
    end if;

    if v_template.id is null then
      return jsonb_build_object('status', 'blocked', 'reason', 'approved_template_missing');
    end if;

    begin
      v_template_components := app_private.build_whatsapp_template_components(
        v_template_mapping,
        v_target_appointment_id
      );
    exception
      when sqlstate '22023' then
        return jsonb_build_object('status', 'blocked', 'reason', 'template_mapping_invalid');
    end;

    v_message_type := 'template';
    v_response := jsonb_build_object(
      'kind', 'template',
      'name', v_template.name,
      'language', v_template.language,
      'components', v_template_components
    );
  else
    v_message_type := 'text';
    v_response := jsonb_build_object(
      'kind', 'text',
      'body', case v_purpose
        when 'appointment_created' then 'Seu agendamento foi criado.'
        when 'appointment_confirmed' then 'Seu agendamento foi confirmado.'
        when 'appointment_reminder' then 'Lembrete: você possui um agendamento próximo.'
        when 'appointment_rescheduled' then 'Seu agendamento foi reagendado.'
        when 'appointment_cancelled' then 'Seu agendamento foi cancelado.'
        else 'Há uma atualização no seu agendamento.'
      end
    );
  end if;

  if v_conversation.id is null then
    insert into public.whatsapp_conversations (
      phone_number_id,
      contact_id,
      tenant_id,
      status,
      current_state,
      session_expires_at,
      context
    ) values (
      v_phone.id,
      v_contact.id,
      v_event.tenant_id,
      'open',
      'MAIN_MENU',
      statement_timestamp() + make_interval(mins => v_settings.session_timeout_minutes),
      jsonb_build_object('notificationEventId', v_event.id)
    ) returning * into v_conversation;
  end if;

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
    v_conversation.id,
    v_event.tenant_id,
    v_phone.provider,
    'outbound',
    v_message_type,
    v_idempotency_key,
    'queued',
    v_response,
    v_response
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
    v_event.tenant_id,
    v_phone.id,
    v_phone.provider,
    v_conversation.id,
    v_message_id,
    v_contact.normalized_phone,
    v_message_type,
    jsonb_build_object(
      'recipient', v_contact.normalized_phone,
      'response', v_response,
      'idempotencyKey', v_idempotency_key,
      'purpose', v_purpose,
      'appointmentId', v_target_appointment_id,
      'eventType', v_event.event_type
    )
  ) returning id into v_outbox_id;

  update public.whatsapp_conversations
  set last_outbound_at = statement_timestamp()
  where id = v_conversation.id;

  return jsonb_build_object(
    'status', 'queued',
    'messageId', v_message_id,
    'outboxId', v_outbox_id,
    'remindersScheduled', v_reminders_scheduled
  );
exception
  when unique_violation then
    select message.id, item.id
      into v_message_id, v_outbox_id
    from public.whatsapp_messages message
    left join public.whatsapp_outbox item on item.message_id = message.id
    where message.idempotency_key = 'notification:' || p_outbox_event_id::text
    limit 1;
    return jsonb_build_object(
      'status', 'queued',
      'reason', 'already_enqueued',
      'messageId', v_message_id,
      'outboxId', v_outbox_id
    );
end;
$$;

do $$
declare function_signature text;
begin
  foreach function_signature in array array[
    'public.upsert_whatsapp_contact(text, text, text, text)',
    'public.record_web_whatsapp_opt_in(uuid, text, text, text, jsonb)',
    'public.get_public_whatsapp_consent_availability(text)',
    'public.create_public_booking_with_whatsapp_consent(text, uuid, uuid[], uuid, timestamptz, text, text, text, text, text, uuid, text, boolean, jsonb)',
    'public.consume_whatsapp_routing_code(uuid, text, text)',
    'public.resolve_whatsapp_customer_tenant(uuid, uuid, uuid, text)',
    'public.create_whatsapp_booking(uuid, uuid, uuid[], uuid, timestamptz, text, text, text, text, text, uuid, uuid, text)',
    'public.list_whatsapp_customer_bookings(uuid, uuid, integer)',
    'public.get_whatsapp_reschedule_slots(uuid, uuid, uuid, timestamptz, timestamptz, uuid, integer)',
    'public.cancel_whatsapp_booking(uuid, uuid, uuid, text, uuid, uuid)',
    'public.reschedule_whatsapp_booking(uuid, uuid, uuid, timestamptz, uuid, uuid, uuid)',
    'public.record_whatsapp_opt_out(uuid, uuid, text)',
    'public.enqueue_whatsapp_appointment_notification(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

grant execute on function public.get_public_whatsapp_consent_availability(text)
  to anon, authenticated;

revoke all on function app_private.whatsapp_adjust_quiet_hours(timestamptz, text, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.schedule_whatsapp_appointment_reminders(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.build_whatsapp_template_components(jsonb, uuid)
  from public, anon, authenticated;
revoke all on function app_private.cancel_whatsapp_appointment_reminders()
  from public, anon, authenticated;

commit;
