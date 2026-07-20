begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

create temporary table availability_test_context (test_date date not null);
insert into availability_test_context values (
  current_date + case
    when extract(isodow from current_date)::integer = 1 then 7
    else 8 - extract(isodow from current_date)::integer
  end
);

select ok(
  (
    select count(*) > 0
    from public.get_available_slots(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      null,
      ((select test_date from availability_test_context) + time '00:00') at time zone 'America/Sao_Paulo',
      ((select test_date from availability_test_context) + interval '1 day') at time zone 'America/Sao_Paulo',
      'America/Sao_Paulo',
      200
    )
  ),
  'Retorna slots em dia útil configurado'
);

insert into public.time_off (
  tenant_id, staff_id, starts_at, ends_at, reason
) values (
  '20000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  ((select test_date from availability_test_context) + time '00:00') at time zone 'America/Sao_Paulo',
  ((select test_date from availability_test_context) + interval '1 day') at time zone 'America/Sao_Paulo',
  'Teste'
);

select is(
  (
    select count(*)::integer
    from public.get_available_slots(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      '50000000-0000-0000-0000-000000000001',
      ((select test_date from availability_test_context) + time '00:00') at time zone 'America/Sao_Paulo',
      ((select test_date from availability_test_context) + interval '1 day') at time zone 'America/Sao_Paulo',
      'America/Sao_Paulo',
      200
    )
  ),
  0,
  'Folga remove todos os slots do profissional'
);

insert into public.staff (
  id, tenant_id, name, is_active, is_public
) values (
  '50000000-0000-4000-8000-000000000099',
  '20000000-0000-0000-0000-000000000001',
  'Sem serviço',
  true,
  true
);
insert into public.staff_locations (tenant_id, staff_id, location_id) values (
  '20000000-0000-0000-0000-000000000001',
  '50000000-0000-4000-8000-000000000099',
  '30000000-0000-0000-0000-000000000001'
);

select is(
  (
    select count(*)::integer
    from public.get_available_slots(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      '50000000-0000-4000-8000-000000000099',
      ((select test_date from availability_test_context) + time '00:00') at time zone 'America/Sao_Paulo',
      ((select test_date from availability_test_context) + interval '1 day') at time zone 'America/Sao_Paulo',
      'America/Sao_Paulo',
      200
    )
  ),
  0,
  'Profissional não habilitado não recebe slots'
);

insert into public.calendar_blocks (
  tenant_id, location_id, resource_id, starts_at, ends_at, title
)
select
  r.tenant_id,
  r.location_id,
  r.id,
  ((select test_date from availability_test_context) + time '00:00') at time zone 'America/Sao_Paulo',
  ((select test_date from availability_test_context) + interval '1 day') at time zone 'America/Sao_Paulo',
  'Recurso indisponível'
from public.resources r
where r.tenant_id = '20000000-0000-0000-0000-000000000001';

select is(
  (
    select count(*)::integer
    from public.get_available_slots(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      null,
      ((select test_date from availability_test_context) + time '00:00') at time zone 'America/Sao_Paulo',
      ((select test_date from availability_test_context) + interval '1 day') at time zone 'America/Sao_Paulo',
      'America/Sao_Paulo',
      200
    )
  ),
  0,
  'Recursos obrigatórios indisponíveis removem slots'
);

select throws_ok(
  $$
    select * from public.get_available_slots(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      null,
      now(),
      now() + interval '1 day',
      'UTC',
      20
    )
  $$,
  '22023',
  'timezone_mismatch',
  'Timezone divergente é rejeitado'
);

select * from finish();
rollback;
