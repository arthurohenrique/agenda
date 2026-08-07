begin;

-- O cliente admin do servidor (`src/lib/supabase/admin.ts`) autentica com a service
-- key, então o PostgREST executa como `service_role`. Dois caminhos leem tabelas do
-- núcleo diretamente por esse cliente:
--
--   src/features/whatsapp/application/booking-gateway.ts   tenants, services, staff,
--                                                          customer_tenants, appointments,
--                                                          locations e staff_services por
--                                                          embed do PostgREST
--   src/features/whatsapp/application/resolve-tenant.ts    tenants, customer_tenants
--   src/features/notifications/worker.ts                   tenants, customers,
--                                                          customer_tenants, appointments,
--                                                          appointment_services
--   src/app/api/app/platform/whatsapp/simulator/route.ts   tenants, appointments
--
-- A 0008 revogou os privilégios implícitos de `public`, `anon` e `authenticated` e
-- concedeu explicitamente ao `authenticated`, mas as tabelas do núcleo nunca
-- receberam grant para `service_role` — ao contrário das tabelas do canal, que já o
-- recebem na 0020. Sem isto toda leitura direta falha com `permission denied`, o que
-- quebra o fluxo de agendamento pelo WhatsApp e o worker de notificações.
--
-- Uma tabela embutida num `select` do PostgREST — `locations!locations_tenant_id_fkey(...)`
-- e `staff_services!inner(...)` — também é lida, e portanto também precisa do privilégio.
-- Listar apenas as tabelas que aparecem em `.from(...)` deixa esses casos de fora.
--
-- Somente leitura: nenhum desses caminhos escreve por aqui. Toda escrita continua
-- exclusivamente nas funções `security definer`.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tenants',
    'services',
    'staff',
    'customers',
    'customer_tenants',
    'appointments',
    'appointment_services',
    'locations',
    'staff_services'
  ] loop
    execute format('grant select on table public.%I to service_role', table_name);
  end loop;
end;
$$;

commit;
