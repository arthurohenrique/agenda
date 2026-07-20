begin;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email extensions.citext,
  birth_date date,
  locale text not null default 'pt-BR',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index customers_phone_active_idx on public.customers (phone_e164) where deleted_at is null;
create index customers_email_active_idx on public.customers (email) where deleted_at is null and email is not null;

create table public.customer_tenants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  display_name text,
  tags text[] not null default '{}',
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  next_appointment_at timestamptz,
  appointments_count integer not null default 0 check (appointments_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  cancellation_count integer not null default 0 check (cancellation_count >= 0),
  no_show_count integer not null default 0 check (no_show_count >= 0),
  is_blocked boolean not null default false,
  blocked_reason text,
  source public.appointment_origin,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, customer_id),
  unique (tenant_id, id)
);

create index customer_tenants_tenant_visit_idx on public.customer_tenants (tenant_id, last_visit_at desc);
create index customer_tenants_tags_idx on public.customer_tenants using gin (tags);

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_tenant_id uuid not null,
  visibility public.note_visibility not null default 'operational',
  content text not null check (char_length(content) between 1 and 5000),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_tenant_id)
    references public.customer_tenants (tenant_id, id) on delete cascade
);

create table public.customer_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_tenant_id uuid not null,
  key text not null check (char_length(key) between 1 and 80),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, customer_tenant_id, key),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_tenant_id)
    references public.customer_tenants (tenant_id, id) on delete cascade
);

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_tenant_id uuid not null,
  consent_type text not null check (char_length(consent_type) between 2 and 80),
  granted boolean not null,
  policy_version text not null,
  source text not null,
  ip_hash text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_tenant_id)
    references public.customer_tenants (tenant_id, id) on delete cascade
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'customers', 'customer_tenants', 'customer_notes', 'customer_preferences'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app_private.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end;
$$;

commit;
