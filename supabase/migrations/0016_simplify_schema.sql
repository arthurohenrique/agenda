begin;

-- Remove módulos antecipados que não possuem interface, API ou worker ativo.
-- O banco mantém apenas o necessário para operação, catálogo, disponibilidade,
-- clientes, agendamentos e segurança multiempresa.

drop table if exists public.service_addons cascade;

drop table if exists public.customer_notes cascade;
drop table if exists public.customer_preferences cascade;
drop table if exists public.customer_consents cascade;

drop table if exists public.waitlist_entries cascade;
drop table if exists public.form_responses cascade;
drop table if exists public.service_forms cascade;
drop table if exists public.form_fields cascade;
drop table if exists public.forms cascade;

drop table if exists public.notification_logs cascade;
drop table if exists public.notification_jobs cascade;
drop table if exists public.notification_templates cascade;

drop table if exists public.appointment_notes cascade;

drop type if exists public.waitlist_status;
drop type if exists public.notification_channel;
drop type if exists public.notification_status;
drop type if exists public.form_field_type;
drop type if exists public.form_timing;
drop type if exists public.note_visibility;

commit;
