begin;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  location_id uuid not null,
  customer_tenant_id uuid not null,
  staff_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_starts_at timestamptz not null,
  blocked_ends_at timestamptz not null,
  timezone text not null,
  original_price_cents integer not null default 0 check (original_price_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  currency char(3) not null default 'BRL',
  origin public.appointment_origin not null,
  status public.appointment_status not null,
  customer_notes text check (customer_notes is null or char_length(customer_notes) <= 2000),
  internal_summary text check (internal_summary is null or char_length(internal_summary) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  cancellation_reason text,
  rescheduled_from_id uuid references public.appointments(id) on delete set null,
  rescheduled_to_id uuid references public.appointments(id) on delete set null,
  idempotency_key uuid,
  occupies_slot boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_tenant_id)
    references public.customer_tenants (tenant_id, id) on delete restrict,
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete restrict,
  constraint appointments_valid_window check (
    ends_at > starts_at and
    blocked_starts_at <= starts_at and
    blocked_ends_at >= ends_at and
    blocked_ends_at > blocked_starts_at
  ),
  constraint appointments_total_consistent check (
    discount_cents <= original_price_cents and total_cents = original_price_cents - discount_cents
  )
);

create unique index appointments_idempotency_idx
  on public.appointments (tenant_id, idempotency_key) where idempotency_key is not null;
create index appointments_tenant_start_idx on public.appointments (tenant_id, starts_at, status);
create index appointments_staff_start_idx on public.appointments (tenant_id, staff_id, starts_at) where staff_id is not null;
create index appointments_customer_idx on public.appointments (tenant_id, customer_tenant_id, starts_at desc);

create table public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  appointment_id uuid not null,
  service_id uuid not null,
  staff_id uuid,
  name_snapshot text not null,
  duration_minutes smallint not null check (duration_minutes between 1 and 1440),
  buffer_before_minutes smallint not null default 0 check (buffer_before_minutes between 0 and 720),
  buffer_after_minutes smallint not null default 0 check (buffer_after_minutes between 0 and 720),
  price_cents integer not null check (price_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents between 0 and price_cents),
  sort_order smallint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete restrict,
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete restrict
);

create index appointment_services_appointment_idx
  on public.appointment_services (tenant_id, appointment_id, sort_order);

create table public.appointment_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  appointment_id uuid not null,
  resource_id uuid not null,
  capacity_slot smallint not null default 1 check (capacity_slot >= 1),
  created_at timestamptz not null default now(),
  unique (tenant_id, appointment_id, resource_id, capacity_slot),
  unique (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, resource_id) references public.resources (tenant_id, id) on delete restrict
);

create table public.appointment_status_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  appointment_id uuid not null,
  from_status public.appointment_status,
  to_status public.appointment_status not null,
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id) on delete cascade
);

create index appointment_status_history_idx
  on public.appointment_status_history (tenant_id, appointment_id, created_at);

create table public.appointment_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  appointment_id uuid not null,
  visibility public.note_visibility not null default 'operational',
  content text not null check (char_length(content) between 1 and 5000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id) on delete cascade
);

create table public.booking_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null,
  purpose public.booking_token_purpose not null,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  use_count integer not null default 0 check (use_count >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id) on delete cascade
);

create index booking_tokens_active_idx
  on public.booking_tokens (token_hash, expires_at) where revoked_at is null;

create table public.booking_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  appointment_id uuid,
  block_id uuid,
  allocatable_type text not null check (allocatable_type in ('staff', 'resource', 'service_capacity')),
  allocatable_id uuid not null,
  capacity_slot smallint not null default 1 check (capacity_slot >= 1),
  time_range tstzrange not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, appointment_id, block_id, allocatable_type, allocatable_id, capacity_slot),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, block_id) references public.calendar_blocks (tenant_id, id) on delete cascade,
  constraint booking_allocations_owner check (num_nonnulls(appointment_id, block_id) = 1),
  constraint booking_allocations_nonempty check (not isempty(time_range))
);

alter table public.booking_allocations
  add constraint booking_allocations_no_overlap
  exclude using gist (
    tenant_id with =,
    allocatable_type with =,
    allocatable_id with =,
    capacity_slot with =,
    time_range with &&
  ) where (active);

create index booking_allocations_lookup_idx
  on public.booking_allocations using gist (tenant_id, allocatable_id, time_range) where active;

create or replace function app_private.status_occupies_slot(value public.appointment_status)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select value in (
    'pending', 'awaiting_approval', 'confirmed', 'checked_in', 'in_service'
  );
$$;

create or replace function app_private.sync_appointment_occupancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.occupies_slot = app_private.status_occupies_slot(new.status);

  if tg_op = 'UPDATE' and old.occupies_slot is distinct from new.occupies_slot then
    update public.booking_allocations
      set active = new.occupies_slot
      where tenant_id = new.tenant_id and appointment_id = new.id;
  end if;

  return new;
end;
$$;

create trigger appointments_sync_occupancy
before insert or update of status on public.appointments
for each row execute function app_private.sync_appointment_occupancy();

create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function app_private.set_updated_at();

create trigger appointment_notes_set_updated_at
before update on public.appointment_notes
for each row execute function app_private.set_updated_at();

create or replace function app_private.sync_calendar_block_allocations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
begin
  if tg_op = 'UPDATE' then
    delete from public.booking_allocations
    where tenant_id = old.tenant_id and block_id = old.id;
  end if;

  if new.staff_id is not null then
    insert into public.booking_allocations (
      tenant_id, block_id, allocatable_type, allocatable_id, capacity_slot, time_range
    ) values (
      new.tenant_id,
      new.id,
      'staff',
      new.staff_id,
      1,
      tstzrange(new.starts_at, new.ends_at, '[)')
    );
  end if;

  if new.resource_id is not null then
    select capacity into v_capacity
    from public.resources
    where tenant_id = new.tenant_id and id = new.resource_id;

    insert into public.booking_allocations (
      tenant_id, block_id, allocatable_type, allocatable_id, capacity_slot, time_range
    )
    select
      new.tenant_id,
      new.id,
      'resource',
      new.resource_id,
      slot,
      tstzrange(new.starts_at, new.ends_at, '[)')
    from generate_series(1, v_capacity) slot;
  end if;

  return new;
end;
$$;

create trigger calendar_blocks_sync_allocations
after insert or update of staff_id, resource_id, starts_at, ends_at
on public.calendar_blocks
for each row execute function app_private.sync_calendar_block_allocations();

commit;
