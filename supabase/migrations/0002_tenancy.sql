begin;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique,
  name text not null check (char_length(name) between 2 and 120),
  segment public.business_segment not null default 'generic',
  state public.tenant_state not null default 'draft',
  timezone text not null default 'America/Sao_Paulo',
  locale text not null default 'pt-BR',
  currency char(3) not null default 'BRL',
  short_code text unique check (short_code is null or short_code ~ '^[A-Z0-9]{5,10}$'),
  city_search text,
  district_search text,
  category_search text,
  created_by uuid not null references auth.users(id),
  published_at timestamptz,
  suspended_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_normalized check (slug::text = public.normalize_slug(slug::text)),
  constraint tenants_slug_length check (char_length(slug::text) between 3 and 80),
  constraint tenants_slug_not_reserved check (not public.is_reserved_slug(slug::text)),
  constraint tenants_currency_upper check (currency = upper(currency)),
  constraint tenants_publication_consistent check (
    (state <> 'published' or published_at is not null)
  )
);

create index tenants_public_search_idx
  on public.tenants (state, city_search, district_search, category_search);

create table public.tenant_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  description text check (description is null or char_length(description) <= 500),
  logo_url text,
  cover_url text,
  favicon_url text,
  phone text,
  email extensions.citext,
  website_url text,
  instagram_handle text,
  seo_title text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 170),
  social_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.tenant_role not null,
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  staff_id uuid,
  is_active boolean not null default true,
  invited_by uuid references auth.users(id),
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index tenant_members_user_active_idx on public.tenant_members (user_id, is_active, tenant_id);
create index tenant_members_tenant_role_idx on public.tenant_members (tenant_id, role) where is_active;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  timezone text,
  phone text,
  email extensions.citext,
  address_line_1 text not null,
  address_line_2 text,
  district text,
  city text not null,
  region text not null,
  postal_code text,
  country_code char(2) not null default 'BR',
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_primary boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create unique index locations_one_primary_per_tenant_idx
  on public.locations (tenant_id) where is_primary and is_active;
create index locations_tenant_active_idx on public.locations (tenant_id, is_active, sort_order);

create table public.business_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  default_slot_minutes smallint not null default 15 check (default_slot_minutes between 5 and 240),
  default_min_notice_minutes integer not null default 120 check (default_min_notice_minutes >= 0),
  default_max_booking_days integer not null default 60 check (default_max_booking_days between 1 and 730),
  cancellation_window_minutes integer not null default 720 check (cancellation_window_minutes >= 0),
  late_tolerance_minutes smallint not null default 10 check (late_tolerance_minutes between 0 and 180),
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  approval_mode text not null default 'automatic' check (approval_mode in ('automatic', 'manual')),
  allow_customer_cancellation boolean not null default true,
  allow_customer_reschedule boolean not null default true,
  customer_lookup_enabled boolean not null default false,
  retention_days integer not null default 1825 check (retention_days between 30 and 36500),
  booking_policy text,
  privacy_policy_url text,
  feature_flags jsonb not null default '{}'::jsonb check (jsonb_typeof(feature_flags) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.theme_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  primary_color text not null default '#171717' check (app_private.is_valid_hex_color(primary_color)),
  accent_color text not null default '#2563EB' check (app_private.is_valid_hex_color(accent_color)),
  background_color text not null default '#F6F7F8' check (app_private.is_valid_hex_color(background_color)),
  surface_color text not null default '#FFFFFF' check (app_private.is_valid_hex_color(surface_color)),
  text_color text not null default '#171717' check (app_private.is_valid_hex_color(text_color)),
  color_mode text not null default 'light' check (color_mode in ('light', 'dark', 'auto')),
  header_alignment text not null default 'left' check (header_alignment in ('left', 'center')),
  summary_position text not null default 'right' check (summary_position in ('right', 'bottom')),
  service_view text not null default 'cards' check (service_view in ('list', 'cards')),
  density text not null default 'comfortable' check (density in ('comfortable', 'compact')),
  cover_style text not null default 'none' check (cover_style in ('none', 'small', 'wide')),
  is_contrast_valid boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id uuid,
  ip_hash text,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_no_sensitive_fields check (
    not (changes ?| array['phone', 'email', 'notes', 'medical_data', 'token'])
  )
);

create index audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (tenant_id, entity_type, entity_id);

create or replace function app_private.validate_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = new.timezone
  ) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;
  return new;
end;
$$;

create trigger tenants_validate_timezone
before insert or update of timezone on public.tenants
for each row execute function app_private.validate_timezone();

create or replace function app_private.validate_location_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = new.timezone
  ) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;
  return new;
end;
$$;

create trigger locations_validate_timezone
before insert or update of timezone on public.locations
for each row execute function app_private.validate_location_timezone();

create or replace function app_private.create_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_profiles (tenant_id) values (new.id);
  insert into public.business_settings (tenant_id) values (new.id);
  insert into public.theme_settings (tenant_id) values (new.id);
  insert into public.tenant_members (
    tenant_id, user_id, role, is_active, accepted_at
  ) values (
    new.id, new.created_by, 'owner', true, statement_timestamp()
  );
  return new;
end;
$$;

create trigger tenants_create_defaults
after insert on public.tenants
for each row execute function app_private.create_tenant_defaults();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tenants', 'tenant_profiles', 'tenant_members', 'locations',
    'business_settings', 'theme_settings'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app_private.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end;
$$;

commit;
