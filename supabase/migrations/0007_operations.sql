begin;

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  service_id uuid not null,
  staff_id uuid,
  customer_tenant_id uuid not null,
  desired_dates daterange,
  desired_weekdays smallint[] check (
    desired_weekdays is null or desired_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  desired_periods text[] not null default '{}',
  notes text,
  status public.waitlist_status not null default 'active',
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id) on delete set null,
  foreign key (tenant_id, customer_tenant_id)
    references public.customer_tenants (tenant_id, id) on delete cascade
);

create index waitlist_matching_idx
  on public.waitlist_entries (tenant_id, location_id, service_id, status) where status = 'active';

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.form_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_id uuid not null,
  field_type public.form_field_type not null,
  label text not null,
  help_text text,
  placeholder text,
  options jsonb not null default '[]'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  is_required boolean not null default false,
  is_sensitive boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, form_id) references public.forms (tenant_id, id) on delete cascade
);

create table public.service_forms (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null,
  form_id uuid not null,
  timing public.form_timing not null,
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (tenant_id, service_id, form_id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete cascade,
  foreign key (tenant_id, form_id) references public.forms (tenant_id, id) on delete cascade
);

create table public.form_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  form_id uuid not null,
  appointment_id uuid not null,
  customer_tenant_id uuid not null,
  form_version integer not null,
  responses jsonb not null check (jsonb_typeof(responses) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, form_id, appointment_id),
  unique (tenant_id, id),
  foreign key (tenant_id, form_id) references public.forms (tenant_id, id) on delete restrict,
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_tenant_id)
    references public.customer_tenants (tenant_id, id) on delete restrict
);

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null,
  channel public.notification_channel not null,
  locale text not null default 'pt-BR',
  subject_template text,
  body_template text not null,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, event_type, channel, locale, version),
  unique (tenant_id, id)
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid,
  channel public.notification_channel not null,
  event_type text not null,
  recipient_ref uuid,
  recipient_address_encrypted text,
  payload jsonb not null default '{}'::jsonb,
  status public.notification_status not null default 'pending',
  attempts smallint not null default 0,
  max_attempts smallint not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, template_id)
    references public.notification_templates (tenant_id, id) on delete set null
);

create index notification_jobs_worker_idx
  on public.notification_jobs (status, available_at) where status in ('pending', 'failed');

create table public.notification_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null,
  provider text not null,
  provider_message_id text,
  status public.notification_status not null,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, job_id) references public.notification_jobs (tenant_id, id) on delete cascade
);

create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  event_version smallint not null default 1,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts smallint not null default 0,
  last_error_code text,
  created_at timestamptz not null default now()
);

create index outbox_events_worker_idx
  on public.outbox_events (available_at, occurred_at) where processed_at is null;

create table public.public_rate_limits (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rate_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (tenant_id, rate_key, window_started_at)
);

create index public_rate_limits_expiry_idx on public.public_rate_limits (expires_at);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'waitlist_entries', 'forms', 'form_fields', 'form_responses',
    'notification_templates', 'notification_jobs'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app_private.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end;
$$;

commit;
