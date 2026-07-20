begin;

create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  opens_at time not null,
  closes_at time not null,
  break_starts_at time,
  break_ends_at time,
  is_open boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade,
  constraint working_hours_valid_window check (closes_at > opens_at),
  constraint working_hours_break_pair check (
    (break_starts_at is null and break_ends_at is null) or
    (break_starts_at is not null and break_ends_at is not null and
      break_starts_at > opens_at and break_ends_at < closes_at and break_ends_at > break_starts_at)
  )
);

create index working_hours_lookup_idx
  on public.working_hours (tenant_id, location_id, day_of_week, is_open);

create table public.staff_working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null,
  location_id uuid not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  starts_at time not null,
  ends_at time not null,
  break_starts_at time,
  break_ends_at time,
  is_working boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete cascade,
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade,
  constraint staff_working_hours_valid_window check (ends_at > starts_at),
  constraint staff_working_hours_break_pair check (
    (break_starts_at is null and break_ends_at is null) or
    (break_starts_at is not null and break_ends_at is not null and
      break_starts_at > starts_at and break_ends_at < ends_at and break_ends_at > break_starts_at)
  )
);

create index staff_working_hours_lookup_idx
  on public.staff_working_hours (tenant_id, staff_id, location_id, day_of_week, is_working);

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid,
  staff_id uuid,
  resource_id uuid,
  kind public.exception_kind not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity_override smallint,
  reason text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete cascade,
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade,
  constraint availability_exceptions_valid_window check (ends_at > starts_at),
  constraint availability_exceptions_target check (
    num_nonnulls(location_id, staff_id, resource_id) <= 1
  ),
  constraint availability_exceptions_capacity check (
    (kind = 'capacity_override' and capacity_override is not null and capacity_override >= 0) or
    (kind <> 'capacity_override' and capacity_override is null)
  )
);

create index availability_exceptions_range_idx
  on public.availability_exceptions using gist (tenant_id, tstzrange(starts_at, ends_at, '[)'))
  where is_active;

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  is_all_day boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete cascade,
  constraint time_off_valid_window check (ends_at > starts_at)
);

create index time_off_range_idx
  on public.time_off using gist (tenant_id, staff_id, tstzrange(starts_at, ends_at, '[)'));

create table public.calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  staff_id uuid,
  resource_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text not null default 'Horário bloqueado',
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete cascade,
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete cascade,
  constraint calendar_blocks_valid_window check (ends_at > starts_at),
  constraint calendar_blocks_target check (staff_id is not null or resource_id is not null)
);

create index calendar_blocks_range_idx
  on public.calendar_blocks using gist (tenant_id, tstzrange(starts_at, ends_at, '[)'));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'working_hours', 'staff_working_hours', 'availability_exceptions', 'time_off', 'calendar_blocks'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app_private.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end;
$$;

commit;
