begin;

create or replace function public.publish_tenant(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text[] := '{}';
begin
  if not app_private.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin']::public.tenant_role[]
  ) then
    raise exception using errcode = '42501', message = 'insufficient_permission';
  end if;

  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'tenant_not_found';
  end if;

  if not exists (
    select 1 from public.locations
    where tenant_id = p_tenant_id and is_active
  ) then v_missing := array_append(v_missing, 'location'); end if;

  if not exists (
    select 1 from public.services
    where tenant_id = p_tenant_id and is_active and is_public
  ) then v_missing := array_append(v_missing, 'service'); end if;

  if not exists (
    select 1 from public.staff
    where tenant_id = p_tenant_id and is_active and is_public
  ) then v_missing := array_append(v_missing, 'staff'); end if;

  if not exists (
    select 1 from public.staff_services
    where tenant_id = p_tenant_id and is_active
  ) then v_missing := array_append(v_missing, 'staff_service'); end if;

  if not exists (
    select 1 from public.working_hours
    where tenant_id = p_tenant_id and is_open
  ) then v_missing := array_append(v_missing, 'working_hours'); end if;

  if not exists (
    select 1 from public.theme_settings
    where tenant_id = p_tenant_id and is_contrast_valid
  ) then v_missing := array_append(v_missing, 'theme_contrast'); end if;

  if cardinality(v_missing) > 0 then
    raise exception using
      errcode = '23514',
      message = 'tenant_not_ready',
      detail = array_to_string(v_missing, ',');
  end if;

  update public.tenants
    set state = 'published',
        published_at = coalesce(published_at, statement_timestamp()),
        suspended_at = null
    where id = p_tenant_id;

  insert into public.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id
  ) values (
    p_tenant_id, (select auth.uid()), 'tenant.published', 'tenant', p_tenant_id
  );
end;
$$;

create or replace function public.unpublish_tenant(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin']::public.tenant_role[]
  ) then
    raise exception using errcode = '42501', message = 'insufficient_permission';
  end if;

  update public.tenants set state = 'draft'
  where id = p_tenant_id and state = 'published';

  if not found then
    raise exception using errcode = '22023', message = 'tenant_not_published';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id
  ) values (
    p_tenant_id, (select auth.uid()), 'tenant.unpublished', 'tenant', p_tenant_id
  );
end;
$$;

grant execute on function public.publish_tenant(uuid) to authenticated;
grant execute on function public.unpublish_tenant(uuid) to authenticated;

commit;
