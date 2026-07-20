begin;

create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create type public.tenant_role as enum (
  'owner', 'admin', 'receptionist', 'professional', 'viewer'
);

create type public.tenant_state as enum (
  'draft', 'published', 'suspended', 'archived'
);

create type public.business_segment as enum (
  'generic', 'barbershop', 'salon', 'nails', 'clinic'
);

create type public.appointment_status as enum (
  'pending',
  'awaiting_approval',
  'confirmed',
  'checked_in',
  'in_service',
  'completed',
  'cancelled_by_customer',
  'cancelled_by_business',
  'no_show'
);

create type public.appointment_origin as enum (
  'public_web', 'admin', 'staff', 'import', 'whatsapp', 'instagram', 'google', 'api', 'partner'
);

create type public.exception_kind as enum (
  'closed', 'special_hours', 'capacity_override'
);

create type public.booking_token_purpose as enum (
  'manage', 'cancel', 'reschedule', 'context'
);

create type public.note_visibility as enum (
  'operational', 'sensitive'
);

create type public.notification_channel as enum (
  'email', 'sms', 'whatsapp', 'internal'
);

create type public.notification_status as enum (
  'pending', 'processing', 'sent', 'failed', 'cancelled'
);

create type public.form_field_type as enum (
  'short_text', 'long_text', 'number', 'date', 'single_select', 'multi_select', 'consent_checkbox'
);

create type public.form_timing as enum (
  'during_booking', 'after_confirmation', 'before_service'
);

create type public.waitlist_status as enum (
  'active', 'notified', 'booked', 'expired', 'cancelled'
);

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create or replace function public.normalize_slug(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    lower(translate(value,
      'ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäåéèêëíìîïóòôõöúùûüçñ',
      'AAAAAAEEEEIIIIOOOOOUUUUCNaaaaaaeeeeiiiiooooouuuucn'
    )),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

create or replace function public.is_reserved_slug(value text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select public.normalize_slug(value) = any (array[
    'app', 'api', 'auth', 'login', 'logout', 'admin', 'configuracoes',
    'onboarding', 'definir-senha', 'suporte', 'status', 'favicon-ico', 'robots-txt',
    'sitemap-xml', 'next'
  ]);
$$;

create or replace function app_private.is_valid_hex_color(value text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select value ~ '^#[0-9A-Fa-f]{6}$';
$$;

comment on schema app_private is
  'Funções auxiliares não expostas pela Data API. Nunca adicionar aos exposed schemas.';

commit;
