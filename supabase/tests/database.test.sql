begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

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

set local role anon;
select is((select count(*)::integer from public.tenants), 3, 'Anon vê somente tenants publicados');
select is((select count(*)::integer from public.customers), 0, 'Anon não enumera clientes');
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

select * from finish();
rollback;
