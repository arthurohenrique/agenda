-- Dados exclusivamente locais. Senha comum: AgendaLocal123!
-- IDs fixos tornam testes e reset idempotentes.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  reauthentication_token,
  created_at,
  updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'dono.barbearia@agenda.local', extensions.crypt('AgendaLocal123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Rafael Demo"}', '', '', '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'dona.salao@agenda.local', extensions.crypt('AgendaLocal123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Ana Demo"}', '', '', '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'dona.clinica@agenda.local', extensions.crypt('AgendaLocal123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Camila Demo"}', '', '', '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'multi@agenda.local', extensions.crypt('AgendaLocal123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Operação Multi"}', '', '', '', '', '', '', now(), now())
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'dono.barbearia@agenda.local', '{"sub":"10000000-0000-0000-0000-000000000001","email":"dono.barbearia@agenda.local"}', 'email', now(), now(), now()),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'dona.salao@agenda.local', '{"sub":"10000000-0000-0000-0000-000000000002","email":"dona.salao@agenda.local"}', 'email', now(), now(), now()),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'dona.clinica@agenda.local', '{"sub":"10000000-0000-0000-0000-000000000003","email":"dona.clinica@agenda.local"}', 'email', now(), now(), now()),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'multi@agenda.local', '{"sub":"10000000-0000-0000-0000-000000000004","email":"multi@agenda.local"}', 'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

insert into public.tenants (
  id, slug, name, segment, state, timezone, locale, currency, short_code,
  city_search, district_search, category_search, created_by, published_at
) values
  ('20000000-0000-0000-0000-000000000001', 'barbearia-central', 'Barbearia Central', 'barbershop', 'published', 'America/Sao_Paulo', 'pt-BR', 'BRL', 'BARB01', 'sao paulo', 'centro', 'barbearia', '10000000-0000-0000-0000-000000000001', now()),
  ('20000000-0000-0000-0000-000000000002', 'salao-da-ana', 'Salão da Ana', 'salon', 'published', 'America/Sao_Paulo', 'pt-BR', 'BRL', 'SALA01', 'campinas', 'cambui', 'salao', '10000000-0000-0000-0000-000000000002', now()),
  ('20000000-0000-0000-0000-000000000003', 'clinica-vida', 'Clínica Vida', 'clinic', 'published', 'America/Sao_Paulo', 'pt-BR', 'BRL', 'CLIN01', 'sao paulo', 'moema', 'clinica', '10000000-0000-0000-0000-000000000003', now())
on conflict (id) do nothing;

insert into public.tenant_members (
  tenant_id, user_id, role, is_active, accepted_at
) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'receptionist', true, now()),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'admin', true, now())
on conflict (tenant_id, user_id) do nothing;

update public.tenant_profiles set
  description = 'Cortes precisos, barba bem cuidada e horários que cabem no seu dia.',
  phone = '+551130000001',
  email = 'contato@barbearia-central.local'
where tenant_id = '20000000-0000-0000-0000-000000000001';

update public.tenant_profiles set
  description = 'Cuidado leve e atendimento próximo para você se sentir bem.',
  phone = '+551930000002',
  email = 'contato@salao-da-ana.local'
where tenant_id = '20000000-0000-0000-0000-000000000002';

update public.tenant_profiles set
  description = 'Atendimento integrado com conforto, clareza e pontualidade.',
  phone = '+551130000003',
  email = 'contato@clinica-vida.local'
where tenant_id = '20000000-0000-0000-0000-000000000003';

update public.theme_settings set primary_color = '#111827', accent_color = '#B45309', service_view = 'cards'
where tenant_id = '20000000-0000-0000-0000-000000000001';
update public.theme_settings set primary_color = '#4C1D3D', accent_color = '#9D174D', background_color = '#FFF7FB', service_view = 'cards', header_alignment = 'center'
where tenant_id = '20000000-0000-0000-0000-000000000002';
update public.theme_settings set primary_color = '#164E63', accent_color = '#0369A1', background_color = '#F5FAFC', service_view = 'list'
where tenant_id = '20000000-0000-0000-0000-000000000003';

insert into public.locations (
  id, tenant_id, name, address_line_1, district, city, region, postal_code, is_primary
) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Centro', 'Rua da Agenda, 120', 'Centro', 'São Paulo', 'SP', '01000-000', true),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Cambuí', 'Rua das Flores, 45', 'Cambuí', 'Campinas', 'SP', '13000-000', true),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'Moema', 'Alameda Saúde, 88', 'Moema', 'São Paulo', 'SP', '04000-000', true)
on conflict (id) do nothing;

insert into public.working_hours (tenant_id, location_id, day_of_week, opens_at, closes_at, break_starts_at, break_ends_at)
select tenant_id, location_id, day_number, opens_at, closes_at, break_start, break_end
from (
  values
    ('20000000-0000-0000-0000-000000000001'::uuid, '30000000-0000-0000-0000-000000000001'::uuid, '09:00'::time, '19:00'::time, '12:00'::time, '13:00'::time),
    ('20000000-0000-0000-0000-000000000002'::uuid, '30000000-0000-0000-0000-000000000002'::uuid, '09:00'::time, '18:00'::time, '12:30'::time, '13:30'::time),
    ('20000000-0000-0000-0000-000000000003'::uuid, '30000000-0000-0000-0000-000000000003'::uuid, '08:00'::time, '18:00'::time, '12:00'::time, '13:00'::time)
) hours(tenant_id, location_id, opens_at, closes_at, break_start, break_end)
cross join generate_series(1, 6) day_number;

insert into public.service_categories (id, tenant_id, name, sort_order) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Barbearia', 0),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Cabelo', 0),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'Consultas', 0)
on conflict (id) do nothing;

insert into public.services (
  id, tenant_id, category_id, name, description, duration_minutes, price_cents,
  buffer_after_minutes, min_notice_minutes, max_booking_days, sort_order
) values
  ('41000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Corte', 'Corte personalizado com acabamento.', 45, 5000, 5, 60, 45, 0),
  ('41000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Barba', 'Modelagem e cuidado completo.', 30, 3500, 5, 60, 45, 1),
  ('41000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Corte e barba', 'Experiência completa em uma visita.', 60, 7500, 10, 120, 45, 2),
  ('42000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Corte feminino', 'Consulta breve e corte personalizado.', 60, 9000, 10, 120, 60, 0),
  ('42000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Escova', 'Finalização leve ou modelada.', 45, 7000, 5, 60, 60, 1),
  ('42000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Tratamento', 'Tratamento capilar conforme diagnóstico.', 60, 11000, 10, 120, 60, 2),
  ('43000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 'Consulta', 'Consulta inicial com avaliação completa.', 60, 20000, 10, 240, 30, 0),
  ('43000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 'Retorno', 'Acompanhamento do plano de cuidado.', 30, 0, 10, 240, 30, 1),
  ('43000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 'Avaliação', 'Avaliação direcionada para procedimento.', 45, 15000, 10, 240, 30, 2)
on conflict (id) do nothing;

insert into public.service_locations (tenant_id, service_id, location_id)
select s.tenant_id, s.id, l.id
from public.services s
join public.locations l on l.tenant_id = s.tenant_id
where s.id::text like '4%'
on conflict do nothing;

insert into public.staff (id, tenant_id, name, title, color, sort_order) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Rafael', 'Barbeiro', '#1D4ED8', 0),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Diego', 'Barbeiro', '#7C3AED', 1),
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'Ana', 'Cabeleireira', '#BE185D', 0),
  ('50000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 'Marina', 'Colorista', '#C2410C', 1),
  ('50000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000003', 'Dra. Camila', 'Clínica geral', '#0369A1', 0),
  ('50000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003', 'Dr. Bruno', 'Especialista', '#0F766E', 1)
on conflict (id) do nothing;

insert into public.staff_locations (tenant_id, staff_id, location_id)
select st.tenant_id, st.id, l.id
from public.staff st join public.locations l on l.tenant_id = st.tenant_id
on conflict do nothing;

insert into public.staff_services (tenant_id, staff_id, service_id)
select st.tenant_id, st.id, sv.id
from public.staff st join public.services sv on sv.tenant_id = st.tenant_id
on conflict do nothing;

insert into public.resources (id, tenant_id, location_id, name, resource_type, capacity) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Cadeira 1', 'chair', 1),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Cadeira 2', 'chair', 1),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Estação 1', 'station', 2),
  ('60000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Consultório 1', 'room', 1),
  ('60000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Consultório 2', 'room', 1)
on conflict (id) do nothing;

insert into public.resource_services (tenant_id, resource_id, service_id)
select r.tenant_id, r.id, s.id
from public.resources r join public.services s on s.tenant_id = r.tenant_id
on conflict do nothing;

insert into public.customers (id, full_name, phone_e164, email) values
  ('70000000-0000-0000-0000-000000000001', 'João Cliente', '+551199990001', 'joao@cliente.local'),
  ('70000000-0000-0000-0000-000000000002', 'Luiza Cliente', '+551199990002', 'luiza@cliente.local'),
  ('70000000-0000-0000-0000-000000000003', 'Marcos Cliente', '+551199990003', 'marcos@cliente.local'),
  ('70000000-0000-0000-0000-000000000004', 'Beatriz Cliente', '+551199990004', 'beatriz@cliente.local')
on conflict (id) do nothing;

insert into public.customer_tenants (id, tenant_id, customer_id, display_name, source) values
  ('71000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'João Cliente', 'public_web'),
  ('71000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'Luiza Cliente', 'admin'),
  ('71000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'Luiza Cliente', 'public_web'),
  ('71000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003', 'Marcos Cliente', 'public_web'),
  ('71000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000004', 'Beatriz Cliente', 'admin')
on conflict (id) do nothing;

with demo_appointments as (
  select * from (values
    ('80000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000001'::uuid, '30000000-0000-0000-0000-000000000001'::uuid, '71000000-0000-0000-0000-000000000001'::uuid, '50000000-0000-0000-0000-000000000001'::uuid, '41000000-0000-0000-0000-000000000001'::uuid, 'Corte', 45, 5000, 'confirmed'::public.appointment_status, 10),
    ('80000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000001'::uuid, '30000000-0000-0000-0000-000000000001'::uuid, '71000000-0000-0000-0000-000000000002'::uuid, '50000000-0000-0000-0000-000000000002'::uuid, '41000000-0000-0000-0000-000000000003'::uuid, 'Corte e barba', 60, 7500, 'awaiting_approval'::public.appointment_status, 14),
    ('80000000-0000-0000-0000-000000000003'::uuid, '20000000-0000-0000-0000-000000000002'::uuid, '30000000-0000-0000-0000-000000000002'::uuid, '71000000-0000-0000-0000-000000000003'::uuid, '50000000-0000-0000-0000-000000000003'::uuid, '42000000-0000-0000-0000-000000000001'::uuid, 'Corte feminino', 60, 9000, 'confirmed'::public.appointment_status, 11),
    ('80000000-0000-0000-0000-000000000004'::uuid, '20000000-0000-0000-0000-000000000003'::uuid, '30000000-0000-0000-0000-000000000003'::uuid, '71000000-0000-0000-0000-000000000004'::uuid, '50000000-0000-0000-0000-000000000005'::uuid, '43000000-0000-0000-0000-000000000001'::uuid, 'Consulta', 60, 20000, 'checked_in'::public.appointment_status, 9),
    ('80000000-0000-0000-0000-000000000005'::uuid, '20000000-0000-0000-0000-000000000003'::uuid, '30000000-0000-0000-0000-000000000003'::uuid, '71000000-0000-0000-0000-000000000005'::uuid, '50000000-0000-0000-0000-000000000006'::uuid, '43000000-0000-0000-0000-000000000003'::uuid, 'Avaliação', 45, 15000, 'completed'::public.appointment_status, 15)
  ) rows(id, tenant_id, location_id, customer_tenant_id, staff_id, service_id, service_name, duration_minutes, price_cents, status, local_hour)
), inserted as (
  insert into public.appointments (
    id, tenant_id, location_id, customer_tenant_id, staff_id,
    starts_at, ends_at, blocked_starts_at, blocked_ends_at, timezone,
    original_price_cents, total_cents, currency, origin, status
  )
  select
    d.id,
    d.tenant_id,
    d.location_id,
    d.customer_tenant_id,
    d.staff_id,
    ((current_date + case when d.status = 'completed' then -1 else 1 end) + make_interval(hours => d.local_hour)) at time zone 'America/Sao_Paulo',
    ((current_date + case when d.status = 'completed' then -1 else 1 end) + make_interval(hours => d.local_hour, mins => d.duration_minutes)) at time zone 'America/Sao_Paulo',
    ((current_date + case when d.status = 'completed' then -1 else 1 end) + make_interval(hours => d.local_hour)) at time zone 'America/Sao_Paulo',
    ((current_date + case when d.status = 'completed' then -1 else 1 end) + make_interval(hours => d.local_hour, mins => d.duration_minutes + 10)) at time zone 'America/Sao_Paulo',
    'America/Sao_Paulo',
    d.price_cents,
    d.price_cents,
    'BRL',
    'public_web',
    d.status
  from demo_appointments d
  on conflict (id) do nothing
  returning id
)
insert into public.appointment_services (
  tenant_id, appointment_id, service_id, staff_id, name_snapshot, duration_minutes,
  buffer_after_minutes, price_cents
)
select d.tenant_id, d.id, d.service_id, d.staff_id, d.service_name, d.duration_minutes, 10, d.price_cents
from demo_appointments d
on conflict do nothing;

insert into public.booking_allocations (
  tenant_id, appointment_id, allocatable_type, allocatable_id, capacity_slot, time_range
)
select
  a.tenant_id,
  a.id,
  'staff',
  a.staff_id,
  1,
  tstzrange(a.blocked_starts_at, a.blocked_ends_at, '[)')
from public.appointments a
where a.id::text like '80000000-%' and a.occupies_slot
on conflict do nothing;

insert into public.appointment_status_history (
  tenant_id, appointment_id, to_status, reason
)
select tenant_id, id, status, 'Dado de demonstração'
from public.appointments
where id::text like '80000000-%';
