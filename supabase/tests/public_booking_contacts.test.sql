begin;

create extension if not exists pgtap with schema extensions;
select plan(2);

create temporary table public_booking_contact_context as
select starts_at, staff_id
from public.get_available_slots(
  'barbearia-central',
  '30000000-0000-0000-0000-000000000001',
  array['41000000-0000-0000-0000-000000000001']::uuid[],
  null,
  ((current_date + 1) + time '00:00') at time zone 'America/Sao_Paulo',
  ((current_date + 8) + time '00:00') at time zone 'America/Sao_Paulo',
  'America/Sao_Paulo',
  1
)
limit 1;

select ok(
  (
    select (public.create_public_booking(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      staff_id,
      starts_at,
      'America/Sao_Paulo',
      'Contato E164',
      '+5511988800099',
      'contato.teste@example.com',
      null,
      'a1000000-0000-4000-8000-000000000001',
      'contact-e164-valid-rate-key-000001'
    ) ->> 'appointmentId') is not null
    from public_booking_contact_context
  ),
  'Reserva pública aceita telefone E.164 e e-mail válidos'
);

select throws_ok(
  $$
    select public.create_public_booking(
      'barbearia-central',
      '30000000-0000-0000-0000-000000000001',
      array['41000000-0000-0000-0000-000000000001']::uuid[],
      null,
      now(),
      'America/Sao_Paulo',
      'Telefone inválido',
      '5511988800099',
      null,
      null,
      'a1000000-0000-4000-8000-000000000002',
      'contact-e164-invalid-rate-key-0002'
    )
  $$,
  '22023',
  'invalid_booking_request',
  'Reserva pública rejeita telefone fora de E.164'
);

select * from finish();
rollback;
