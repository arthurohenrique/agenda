begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ),
  'Todas as tabelas públicas possuem RLS'
);

select ok(
  not has_table_privilege('anon', 'public.customers', 'SELECT'),
  'Anon não possui privilégio para enumerar clientes'
);

set local role anon;
select is((select count(*)::integer from public.tenants), 3, 'Anon vê somente tenants publicados');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',
  true
);
select is((select count(*)::integer from public.tenant_members), 1, 'Owner vê apenas associações permitidas');
select is(
  (select count(*)::integer from public.customer_tenants where tenant_id = '20000000-0000-0000-0000-000000000002'),
  0,
  'Owner não acessa clientes de outro tenant'
);
reset role;

select throws_ok(
  $$
    insert into public.booking_allocations (
      tenant_id, appointment_id, allocatable_type, allocatable_id, capacity_slot, time_range
    )
    select
      tenant_id,
      '80000000-0000-0000-0000-000000000002',
      'staff',
      staff_id,
      1,
      tstzrange(blocked_starts_at, blocked_ends_at, '[)')
    from public.appointments
    where id = '80000000-0000-0000-0000-000000000001'
  $$,
  '23P01',
  null,
  'Constraint impede sobreposição de profissional'
);

select ok(
  public.is_reserved_slug('admin') and not public.is_reserved_slug('barbearia-central'),
  'Slugs internos são reservados'
);

select ok(
  not has_function_privilege('anon', 'public.claim_outbox_events(integer)', 'EXECUTE'),
  'Anon não executa claim da outbox'
);

select ok(
  not has_function_privilege('authenticated', 'public.claim_outbox_events(integer)', 'EXECUTE'),
  'Usuário autenticado não executa claim da outbox'
);

select ok(
  has_function_privilege('service_role', 'public.claim_outbox_events(integer)', 'EXECUTE'),
  'Service role executa claim da outbox'
);

insert into public.outbox_events (
  id, tenant_id, aggregate_type, aggregate_id, event_type
) values (
  '99000000-0000-4000-8000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'appointment',
  '80000000-0000-0000-0000-000000000001',
  'appointment.test'
);

set local role service_role;
select is(
  (select count(*)::integer from public.claim_outbox_events(1)),
  1,
  'Worker reclama um evento elegível'
);
select ok(
  public.complete_outbox_event('99000000-0000-4000-8000-000000000001'),
  'Worker conclui evento reclamado'
);
reset role;

select * from finish();
rollback;
