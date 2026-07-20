begin;

create or replace function app_private.color_luminance(p_hex text)
returns numeric
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  v_bytes bytea;
  v_r numeric;
  v_g numeric;
  v_b numeric;
begin
  if p_hex !~ '^#[0-9A-Fa-f]{6}$' then
    return null;
  end if;

  v_bytes := decode(substr(p_hex, 2), 'hex');
  v_r := get_byte(v_bytes, 0) / 255.0;
  v_g := get_byte(v_bytes, 1) / 255.0;
  v_b := get_byte(v_bytes, 2) / 255.0;

  v_r := case when v_r <= 0.04045 then v_r / 12.92 else power((v_r + 0.055) / 1.055, 2.4) end;
  v_g := case when v_g <= 0.04045 then v_g / 12.92 else power((v_g + 0.055) / 1.055, 2.4) end;
  v_b := case when v_b <= 0.04045 then v_b / 12.92 else power((v_b + 0.055) / 1.055, 2.4) end;

  return 0.2126 * v_r + 0.7152 * v_g + 0.0722 * v_b;
end;
$$;

create or replace function app_private.contrast_ratio(p_first text, p_second text)
returns numeric
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  with luminance as (
    select
      app_private.color_luminance(p_first) as first_value,
      app_private.color_luminance(p_second) as second_value
  )
  select
    (greatest(first_value, second_value) + 0.05) /
    (least(first_value, second_value) + 0.05)
  from luminance;
$$;

create or replace function app_private.validate_theme_contrast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.is_contrast_valid :=
    app_private.contrast_ratio(new.text_color, new.background_color) >= 4.5
    and app_private.contrast_ratio(new.text_color, new.surface_color) >= 4.5
    and app_private.contrast_ratio('#FFFFFF', new.primary_color) >= 4.5
    and app_private.contrast_ratio(new.accent_color, new.background_color) >= 4.5;

  if not new.is_contrast_valid then
    raise exception using
      errcode = '23514',
      message = 'theme_contrast_below_wcag_aa';
  end if;

  return new;
end;
$$;

create trigger theme_settings_validate_contrast
before insert or update of primary_color, accent_color, background_color, surface_color, text_color
on public.theme_settings
for each row execute function app_private.validate_theme_contrast();

create or replace function public.complete_tenant_onboarding(
  p_name text,
  p_slug text,
  p_segment public.business_segment,
  p_location_name text,
  p_address text,
  p_district text,
  p_city text,
  p_region text,
  p_postal_code text,
  p_opens_at time,
  p_closes_at time,
  p_staff_name text,
  p_primary_color text,
  p_accent_color text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_tenant_id uuid;
  v_location_id uuid;
  v_category_id uuid;
  v_staff_id uuid;
  v_service_id uuid;
  v_service record;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if char_length(trim(p_name)) not between 2 and 120
    or public.normalize_slug(p_slug) <> p_slug
    or char_length(p_slug) not between 3 and 80
    or public.is_reserved_slug(p_slug)
    or char_length(trim(p_location_name)) not between 2 and 100
    or char_length(trim(p_address)) < 3
    or char_length(trim(p_city)) < 2
    or char_length(trim(p_region)) < 2
    or char_length(trim(p_staff_name)) not between 2 and 120
    or p_closes_at <= p_opens_at
    or not app_private.is_valid_hex_color(p_primary_color)
    or not app_private.is_valid_hex_color(p_accent_color) then
    raise exception using errcode = '22023', message = 'invalid_onboarding_data';
  end if;

  insert into public.tenants (
    slug, name, segment, state, created_by, city_search, district_search, category_search
  ) values (
    p_slug,
    trim(p_name),
    p_segment,
    'draft',
    v_user_id,
    lower(trim(p_city)),
    lower(nullif(trim(p_district), '')),
    p_segment::text
  ) returning id into v_tenant_id;

  insert into public.locations (
    tenant_id,
    name,
    address_line_1,
    district,
    city,
    region,
    postal_code,
    is_primary
  ) values (
    v_tenant_id,
    trim(p_location_name),
    trim(p_address),
    nullif(trim(p_district), ''),
    trim(p_city),
    upper(trim(p_region)),
    nullif(trim(p_postal_code), ''),
    true
  ) returning id into v_location_id;

  insert into public.working_hours (
    tenant_id, location_id, day_of_week, opens_at, closes_at, is_open
  )
  select v_tenant_id, v_location_id, day_number, p_opens_at, p_closes_at, true
  from generate_series(1, 6) day_number;

  insert into public.service_categories (tenant_id, name, sort_order)
  values (v_tenant_id, 'Serviços', 0)
  returning id into v_category_id;

  for v_service in
    select * from (
      values
        ('barbershop'::public.business_segment, 'Corte', 45, 5000, 0),
        ('barbershop'::public.business_segment, 'Barba', 30, 3500, 1),
        ('barbershop'::public.business_segment, 'Corte e barba', 60, 7500, 2),
        ('salon'::public.business_segment, 'Corte feminino', 60, 9000, 0),
        ('salon'::public.business_segment, 'Escova', 45, 7000, 1),
        ('salon'::public.business_segment, 'Coloração', 120, 18000, 2),
        ('salon'::public.business_segment, 'Tratamento', 60, 11000, 3),
        ('nails'::public.business_segment, 'Manicure', 45, 4500, 0),
        ('nails'::public.business_segment, 'Pedicure', 45, 5000, 1),
        ('nails'::public.business_segment, 'Mão e pé', 90, 8500, 2),
        ('nails'::public.business_segment, 'Alongamento', 120, 16000, 3),
        ('clinic'::public.business_segment, 'Consulta', 60, 20000, 0),
        ('clinic'::public.business_segment, 'Retorno', 30, 0, 1),
        ('clinic'::public.business_segment, 'Avaliação', 45, 15000, 2),
        ('clinic'::public.business_segment, 'Procedimento', 60, 25000, 3),
        ('generic'::public.business_segment, 'Atendimento', 60, 10000, 0)
    ) template(segment, name, duration_minutes, price_cents, sort_order)
    where template.segment = p_segment
  loop
    insert into public.services (
      tenant_id,
      category_id,
      name,
      duration_minutes,
      price_cents,
      sort_order,
      is_active,
      is_public
    ) values (
      v_tenant_id,
      v_category_id,
      v_service.name,
      v_service.duration_minutes,
      v_service.price_cents,
      v_service.sort_order,
      true,
      true
    ) returning id into v_service_id;

    insert into public.service_locations (tenant_id, service_id, location_id)
    values (v_tenant_id, v_service_id, v_location_id);
  end loop;

  insert into public.staff (
    tenant_id, name, is_active, is_public, inherits_tenant_hours
  ) values (
    v_tenant_id, trim(p_staff_name), true, true, true
  ) returning id into v_staff_id;

  insert into public.staff_locations (tenant_id, staff_id, location_id)
  values (v_tenant_id, v_staff_id, v_location_id);

  insert into public.staff_services (tenant_id, staff_id, service_id)
  select v_tenant_id, v_staff_id, s.id
  from public.services s where s.tenant_id = v_tenant_id;

  update public.theme_settings
    set primary_color = upper(p_primary_color),
        accent_color = upper(p_accent_color)
    where tenant_id = v_tenant_id;

  insert into public.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    v_tenant_id,
    v_user_id,
    'tenant.onboarding_completed',
    'tenant',
    v_tenant_id,
    jsonb_build_object('segment', p_segment)
  );

  return jsonb_build_object('tenantId', v_tenant_id, 'slug', p_slug);
end;
$$;

grant execute on function public.complete_tenant_onboarding(
  text, text, public.business_segment, text, text, text, text, text, text,
  time, time, text, text, text
) to authenticated;

commit;
