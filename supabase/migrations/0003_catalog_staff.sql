begin;

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text,
  is_active boolean not null default true,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid,
  name text not null check (char_length(name) between 2 and 120),
  description text check (description is null or char_length(description) <= 1000),
  duration_minutes smallint not null check (duration_minutes between 5 and 1440),
  price_cents integer not null default 0 check (price_cents >= 0),
  promotional_price_cents integer check (
    promotional_price_cents is null or
    (promotional_price_cents >= 0 and promotional_price_cents <= price_cents)
  ),
  currency char(3) not null default 'BRL',
  buffer_before_minutes smallint not null default 0 check (buffer_before_minutes between 0 and 720),
  buffer_after_minutes smallint not null default 0 check (buffer_after_minutes between 0 and 720),
  min_notice_minutes integer check (min_notice_minutes is null or min_notice_minutes >= 0),
  max_booking_days integer check (max_booking_days is null or max_booking_days between 1 and 730),
  capacity smallint not null default 1 check (capacity between 1 and 500),
  is_active boolean not null default true,
  is_public boolean not null default true,
  image_url text,
  sort_order integer not null default 0,
  requires_manual_approval boolean not null default false,
  allow_staff_selection boolean not null default true,
  allow_auto_assignment boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint services_category_fk foreign key (tenant_id, category_id)
    references public.service_categories (tenant_id, id) on delete set null
);

create index services_public_idx
  on public.services (tenant_id, is_public, is_active, sort_order) where is_public and is_active;
create index services_category_idx on public.services (tenant_id, category_id, is_active);

create table public.service_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null,
  name text not null,
  description text,
  duration_minutes smallint not null default 0 check (duration_minutes between 0 and 720),
  price_cents integer not null default 0 check (price_cents >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade
);

create table public.service_locations (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null,
  location_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, service_id, location_id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  title text,
  bio text check (bio is null or char_length(bio) <= 1000),
  avatar_url text,
  color text not null default '#2563EB' check (app_private.is_valid_hex_color(color)),
  inherits_tenant_hours boolean not null default true,
  is_active boolean not null default true,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  commission_settings jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

alter table public.tenant_members
  add constraint tenant_members_staff_fk
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete set null;

create unique index tenant_members_staff_login_idx
  on public.tenant_members (tenant_id, staff_id) where staff_id is not null and is_active;

create table public.staff_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  custom_duration_minutes smallint check (custom_duration_minutes is null or custom_duration_minutes between 5 and 1440),
  custom_price_cents integer check (custom_price_cents is null or custom_price_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, staff_id, service_id),
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade
);

create index staff_services_service_idx on public.staff_services (tenant_id, service_id, staff_id) where is_active;

create table public.staff_locations (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null,
  location_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, staff_id, location_id),
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  name text not null check (char_length(name) between 2 and 120),
  resource_type text not null check (char_length(resource_type) between 2 and 60),
  description text,
  capacity smallint not null default 1 check (capacity between 1 and 100),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade
);

create index resources_location_idx on public.resources (tenant_id, location_id, resource_type) where is_active;

create table public.resource_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_id uuid not null,
  service_id uuid not null,
  is_required boolean not null default true,
  priority smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (tenant_id, resource_id, service_id),
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'service_categories', 'services', 'service_addons', 'staff',
    'staff_services', 'resources'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app_private.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end;
$$;

commit;
