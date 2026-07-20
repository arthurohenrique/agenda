begin;

create or replace function app_private.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'platform_owner'), 'false') = 'true';
$$;

create or replace function app_private.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_owner() or exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = (select auth.uid())
      and tm.is_active
  );
$$;

create or replace function app_private.has_tenant_role(
  p_tenant_id uuid,
  p_roles public.tenant_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_owner() or exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = (select auth.uid())
      and tm.is_active
      and tm.role = any (p_roles)
  );
$$;

create or replace function app_private.is_own_staff(p_tenant_id uuid, p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = (select auth.uid())
      and tm.staff_id = p_staff_id
      and tm.role = 'professional'
      and tm.is_active
  );
$$;

create or replace function app_private.has_permission(p_tenant_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_owner() or exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = (select auth.uid())
      and tm.is_active
      and (
        tm.role = 'owner' or
        coalesce((tm.permissions ->> p_permission)::boolean, false)
      )
  );
$$;

create or replace function app_private.is_published_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenants t
    where t.id = p_tenant_id and t.state = 'published'
  );
$$;

create or replace function app_private.can_read_appointment(
  p_tenant_id uuid,
  p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.is_platform_owner() or
    app_private.has_tenant_role(
      p_tenant_id,
      array['owner', 'admin', 'receptionist', 'viewer']::public.tenant_role[]
    ) or
    app_private.is_own_staff(p_tenant_id, p_staff_id);
$$;

create or replace function app_private.can_read_customer(
  p_tenant_id uuid,
  p_customer_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.has_tenant_role(
      p_tenant_id,
      array['owner', 'admin', 'receptionist', 'viewer']::public.tenant_role[]
    ) or exists (
      select 1
      from public.appointments a
      join public.tenant_members tm
        on tm.tenant_id = a.tenant_id
       and tm.staff_id = a.staff_id
       and tm.user_id = (select auth.uid())
       and tm.is_active
      where a.tenant_id = p_tenant_id
        and a.customer_tenant_id = p_customer_tenant_id
    );
$$;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

grant select on table
  public.tenants,
  public.tenant_profiles,
  public.locations,
  public.theme_settings,
  public.service_categories,
  public.services,
  public.service_locations,
  public.staff,
  public.staff_services,
  public.staff_locations
to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tenants', 'tenant_profiles', 'tenant_members', 'locations', 'business_settings',
    'theme_settings', 'audit_logs', 'service_categories', 'services', 'service_addons',
    'service_locations', 'staff', 'staff_services', 'staff_locations', 'resources',
    'resource_services', 'working_hours', 'staff_working_hours',
    'availability_exceptions', 'time_off', 'calendar_blocks', 'customers',
    'customer_tenants', 'customer_notes', 'customer_preferences', 'customer_consents',
    'appointments', 'appointment_services', 'appointment_resources',
    'appointment_status_history', 'appointment_notes', 'booking_tokens',
    'booking_allocations', 'waitlist_entries', 'forms', 'form_fields', 'service_forms',
    'form_responses', 'notification_templates', 'notification_jobs',
    'notification_logs', 'outbox_events', 'public_rate_limits'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end;
$$;

-- Tenant e associação
create policy tenants_public_read on public.tenants
  for select to anon, authenticated
  using (state = 'published');

create policy tenants_member_read on public.tenants
  for select to authenticated
  using (app_private.is_tenant_member(id));

create policy tenants_create on public.tenants
  for insert to authenticated
  with check (created_by = (select auth.uid()) and state = 'draft');

create policy tenants_manage on public.tenants
  for update to authenticated
  using (app_private.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]))
  with check (app_private.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]));

create policy tenant_members_read on public.tenant_members
  for select to authenticated
  using (
    user_id = (select auth.uid()) or
    app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
  );

create policy tenant_members_create on public.tenant_members
  for insert to authenticated
  with check (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    and (
      role <> 'owner' or
      app_private.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    )
  );

create policy tenant_members_manage on public.tenant_members
  for update to authenticated
  using (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    and (
      role <> 'owner' or
      app_private.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    )
  )
  with check (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    and (
      role <> 'owner' or
      app_private.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    )
  );

create policy tenant_members_remove on public.tenant_members
  for delete to authenticated
  using (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    and (
      role <> 'owner' or
      app_private.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])
    )
    and user_id <> (select auth.uid())
  );

-- Leitura pública mínima
create policy tenant_profiles_public_read on public.tenant_profiles
  for select to anon, authenticated using (app_private.is_published_tenant(tenant_id));

create policy locations_public_read on public.locations
  for select to anon, authenticated
  using (is_active and app_private.is_published_tenant(tenant_id));

create policy theme_settings_public_read on public.theme_settings
  for select to anon, authenticated using (app_private.is_published_tenant(tenant_id));

create policy service_categories_public_read on public.service_categories
  for select to anon, authenticated
  using (is_active and is_public and app_private.is_published_tenant(tenant_id));

create policy services_public_read on public.services
  for select to anon, authenticated
  using (is_active and is_public and app_private.is_published_tenant(tenant_id));

create policy service_locations_public_read on public.service_locations
  for select to anon, authenticated
  using (
    is_active and app_private.is_published_tenant(tenant_id) and exists (
      select 1 from public.services s
      where s.tenant_id = service_locations.tenant_id
        and s.id = service_locations.service_id
        and s.is_active and s.is_public
    )
  );

create policy staff_public_read on public.staff
  for select to anon, authenticated
  using (is_active and is_public and app_private.is_published_tenant(tenant_id));

create policy staff_services_public_read on public.staff_services
  for select to anon, authenticated
  using (
    is_active and app_private.is_published_tenant(tenant_id) and exists (
      select 1 from public.staff st
      join public.services sv on sv.tenant_id = st.tenant_id
      where st.tenant_id = staff_services.tenant_id
        and st.id = staff_services.staff_id
        and sv.id = staff_services.service_id
        and st.is_active and st.is_public
        and sv.is_active and sv.is_public
    )
  );

create policy staff_locations_public_read on public.staff_locations
  for select to anon, authenticated
  using (
    is_active and app_private.is_published_tenant(tenant_id) and exists (
      select 1 from public.staff st
      where st.tenant_id = staff_locations.tenant_id
        and st.id = staff_locations.staff_id
        and st.is_active and st.is_public
    )
  );

-- Configuração: todos os membros leem; owner/admin escrevem.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tenant_profiles', 'locations', 'business_settings', 'theme_settings',
    'service_categories', 'services', 'service_addons', 'service_locations',
    'staff', 'staff_services', 'staff_locations', 'resources', 'resource_services',
    'notification_templates', 'forms', 'form_fields', 'service_forms'
  ] loop
    execute format(
      'create policy member_read on public.%I for select to authenticated using (app_private.is_tenant_member(tenant_id))',
      table_name
    );
    execute format(
      'create policy manager_insert on public.%I for insert to authenticated with check (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'']::public.tenant_role[]))',
      table_name
    );
    execute format(
      'create policy manager_update on public.%I for update to authenticated using (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'']::public.tenant_role[])) with check (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'']::public.tenant_role[]))',
      table_name
    );
    execute format(
      'create policy manager_delete on public.%I for delete to authenticated using (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'']::public.tenant_role[]))',
      table_name
    );
  end loop;
end;
$$;

-- Horários: recepção opera; profissional lê e altera somente via RPC própria.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'working_hours', 'staff_working_hours', 'availability_exceptions', 'time_off', 'calendar_blocks'
  ] loop
    execute format(
      'create policy member_read on public.%I for select to authenticated using (app_private.is_tenant_member(tenant_id))',
      table_name
    );
    execute format(
      'create policy operator_insert on public.%I for insert to authenticated with check (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[]))',
      table_name
    );
    execute format(
      'create policy operator_update on public.%I for update to authenticated using (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[])) with check (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[]))',
      table_name
    );
    execute format(
      'create policy operator_delete on public.%I for delete to authenticated using (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[]))',
      table_name
    );
  end loop;
end;
$$;

-- Clientes globais nunca são públicos e não podem ser enumerados por telefone.
create policy customers_tenant_read on public.customers
  for select to authenticated
  using (
    app_private.is_platform_owner() or exists (
      select 1 from public.customer_tenants ct
      where ct.customer_id = customers.id
        and app_private.can_read_customer(ct.tenant_id, ct.id)
    )
  );

create policy customer_tenants_read on public.customer_tenants
  for select to authenticated using (app_private.can_read_customer(tenant_id, id));
create policy customer_tenants_operate_insert on public.customer_tenants
  for insert to authenticated with check (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin', 'receptionist']::public.tenant_role[])
  );
create policy customer_tenants_operate_update on public.customer_tenants
  for update to authenticated
  using (app_private.has_tenant_role(tenant_id, array['owner', 'admin', 'receptionist']::public.tenant_role[]))
  with check (app_private.has_tenant_role(tenant_id, array['owner', 'admin', 'receptionist']::public.tenant_role[]));

create policy customer_notes_read on public.customer_notes
  for select to authenticated
  using (
    app_private.can_read_customer(tenant_id, customer_tenant_id) and
    (visibility = 'operational' or app_private.has_permission(tenant_id, 'sensitive_data'))
  );
create policy customer_notes_operate on public.customer_notes
  for insert to authenticated
  with check (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin', 'receptionist']::public.tenant_role[])
    and (visibility = 'operational' or app_private.has_permission(tenant_id, 'sensitive_data'))
  );
create policy customer_notes_update_own on public.customer_notes
  for update to authenticated
  using (created_by = (select auth.uid()) or app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin', 'receptionist']::public.tenant_role[])
    and (visibility = 'operational' or app_private.has_permission(tenant_id, 'sensitive_data'))
  );

do $$
declare table_name text;
begin
  foreach table_name in array array['customer_preferences', 'customer_consents'] loop
    execute format(
      'create policy customer_data_read on public.%I for select to authenticated using (app_private.can_read_customer(tenant_id, customer_tenant_id))',
      table_name
    );
    execute format(
      'create policy customer_data_operate on public.%I for insert to authenticated with check (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[]))',
      table_name
    );
    execute format(
      'create policy customer_data_update on public.%I for update to authenticated using (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[])) with check (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[]))',
      table_name
    );
  end loop;
end;
$$;

-- Agenda
create policy appointments_read on public.appointments
  for select to authenticated using (app_private.can_read_appointment(tenant_id, staff_id));
create policy appointments_operate_insert on public.appointments
  for insert to authenticated with check (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin', 'receptionist']::public.tenant_role[])
  );
create policy appointments_operate_update on public.appointments
  for update to authenticated
  using (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin', 'receptionist']::public.tenant_role[])
    or app_private.is_own_staff(tenant_id, staff_id)
  )
  with check (
    app_private.has_tenant_role(tenant_id, array['owner', 'admin', 'receptionist']::public.tenant_role[])
    or app_private.is_own_staff(tenant_id, staff_id)
  );

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'appointment_services', 'appointment_resources', 'appointment_status_history',
    'appointment_notes', 'booking_tokens', 'booking_allocations'
  ] loop
    execute format(
      'create policy appointment_child_read on public.%I for select to authenticated using (exists (select 1 from public.appointments a where a.tenant_id = %I.tenant_id and a.id = %I.appointment_id and app_private.can_read_appointment(a.tenant_id, a.staff_id)))',
      table_name, table_name, table_name
    );
    execute format(
      'create policy appointment_child_operate on public.%I for insert to authenticated with check (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[]))',
      table_name
    );
  end loop;
end;
$$;

-- Operação complementar
do $$
declare table_name text;
begin
  foreach table_name in array array['waitlist_entries', 'form_responses'] loop
    execute format(
      'create policy operation_read on public.%I for select to authenticated using (app_private.is_tenant_member(tenant_id))',
      table_name
    );
    execute format(
      'create policy operation_insert on public.%I for insert to authenticated with check (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[]))',
      table_name
    );
    execute format(
      'create policy operation_update on public.%I for update to authenticated using (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[])) with check (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''receptionist'']::public.tenant_role[]))',
      table_name
    );
  end loop;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'audit_logs', 'notification_jobs', 'notification_logs', 'outbox_events'
  ] loop
    execute format(
      'create policy manager_read on public.%I for select to authenticated using (app_private.has_tenant_role(tenant_id, array[''owner'', ''admin'']::public.tenant_role[]))',
      table_name
    );
  end loop;
end;
$$;

-- public_rate_limits: nenhuma policy. Somente funções security definer acessam.

commit;
