# Banco de dados

O schema operacional possui 30 tabelas, divididas em seis áreas. Tabelas sem fluxo
na aplicação não fazem parte do banco ativo.

## Organização e acesso

- `tenants`, `tenant_profiles`, `tenant_members`, `locations`
- `business_settings`, `theme_settings`, `audit_logs`

## Catálogo e equipe

- `service_categories`, `services`, `service_locations`
- `staff`, `staff_services`, `staff_locations`
- `resources`, `resource_services`

## Disponibilidade

- `working_hours`, `staff_working_hours`, `availability_exceptions`
- `time_off`, `calendar_blocks`

## Clientes

- `customers`, `customer_tenants`

## Agenda

- `appointments`, `appointment_services`, `appointment_resources`
- `appointment_status_history`, `booking_tokens`, `booking_allocations`

## Infraestrutura operacional

- `outbox_events`, `public_rate_limits`

Eventos são reclamados por `claim_outbox_events` com `FOR UPDATE SKIP LOCKED` e
lease de cinco minutos. `complete_outbox_event` conclui; `defer_outbox_event`
reagenda com backoff. As três RPCs aceitam somente `service_role`.

## Regra de manutenção

Uma nova tabela só deve ser criada quando houver um fluxo ativo que precise de
integridade relacional própria. Preferências pequenas e metadados opcionais devem
usar as colunas `jsonb` já existentes nas entidades principais.

## Histórico atual

- `0016_simplify_schema.sql`: remove módulos sem fluxo ativo.
- `0017_outbox_worker.sql`: adiciona consumo transacional sem criar tabela.
- `0018_fix_public_booking_contact_validation.sql`: corrige a validação de telefone
  E.164 e e-mail na RPC transacional de reserva pública.
- `0019_ensure_agenda_realtime.sql`: garante publicação Realtime e identidade de
  réplica para agendamentos e bloqueios.
