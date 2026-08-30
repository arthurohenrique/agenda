begin;

-- Modo de interação do canal WhatsApp por estabelecimento.
--
-- `buttons` mantém o comportamento original: o bot envia botões e listas, e
-- texto digitado em estado de escolha só reapresenta as opções.
-- `text` nunca envia interativos: cada mensagem é interpretada por regras
-- determinísticas e o que falta é perguntado em texto.
--
-- A preferência vive em `tenant_whatsapp_settings.metadata.interaction_mode`,
-- como as demais preferências pequenas do canal (`quiet_hours`,
-- `emergency_notice`). Ausente equivale a `buttons`. Nenhum grant ou policy
-- muda: a coluna `metadata` já é lida e escrita pelo owner/admin.
--
-- O onboarding passa a escolher o modo e a criar a linha de configuração do
-- canal — até aqui ela só nascia no primeiro salvamento do painel. A linha nasce
-- com `enabled = false`: escolher o modo não liga o canal.
--
-- O Postgres trataria a função com parâmetro a mais como uma sobrecarga nova e
-- as duas assinaturas coexistiriam, cada uma com seu grant. A antiga é removida
-- antes de recriar.

drop function if exists public.complete_tenant_onboarding(
  text, text, public.business_segment, text, text, text, text, text, text,
  time, time, text, text, text
);

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
  p_accent_color text,
  p_whatsapp_interaction_mode text default 'buttons'
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
    or not app_private.is_valid_hex_color(p_accent_color)
    or p_whatsapp_interaction_mode is null
    or p_whatsapp_interaction_mode not in ('buttons', 'text') then
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

  -- Só o modo é gravado. `enabled` e `booking_enabled` ficam no default
  -- (false): o canal continua desligado até o painel habilitá-lo.
  insert into public.tenant_whatsapp_settings (tenant_id, metadata)
  values (
    v_tenant_id,
    jsonb_build_object('interaction_mode', p_whatsapp_interaction_mode)
  );

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
    jsonb_build_object(
      'segment', p_segment,
      'whatsapp_interaction_mode', p_whatsapp_interaction_mode
    )
  );

  return jsonb_build_object('tenantId', v_tenant_id, 'slug', p_slug);
end;
$$;

grant execute on function public.complete_tenant_onboarding(
  text, text, public.business_segment, text, text, text, text, text, text,
  time, time, text, text, text, text
) to authenticated;

commit;
