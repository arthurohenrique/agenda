begin;

-- Vocabulário interno estável. Valores externos da Meta permanecem em text/metadata.
create type public.whatsapp_provider as enum ('mock', 'meta_cloud');
create type public.whatsapp_account_ownership as enum ('platform_owned', 'tenant_owned');
create type public.whatsapp_connection_status as enum (
  'pending', 'connected', 'restricted', 'disconnected', 'error'
);
create type public.whatsapp_connection_mode as enum (
  'shared_platform', 'exclusive_platform', 'tenant_owned'
);
create type public.whatsapp_routing_mode as enum ('shared', 'direct');
create type public.whatsapp_link_status as enum ('active', 'inactive');
create type public.whatsapp_routing_code_type as enum (
  'permanent_tenant_code', 'temporary_context_token', 'campaign_code', 'appointment_context'
);
create type public.whatsapp_routing_code_status as enum ('active', 'disabled', 'expired');
create type public.whatsapp_conversation_status as enum (
  'open', 'waiting_customer', 'processing', 'human_handoff', 'completed', 'expired', 'closed', 'failed'
);
create type public.whatsapp_message_direction as enum ('inbound', 'outbound');
create type public.whatsapp_message_type as enum (
  'text', 'button', 'list', 'template', 'flow', 'image', 'document', 'location', 'unsupported'
);
create type public.whatsapp_message_status as enum (
  'received', 'queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'ignored'
);
create type public.whatsapp_webhook_processing_status as enum (
  'received', 'queued', 'processing', 'processed', 'ignored', 'failed', 'dead_letter'
);
create type public.whatsapp_outbox_status as enum (
  'pending', 'processing', 'sent', 'retry', 'failed', 'cancelled', 'dead_letter'
);
create type public.whatsapp_template_purpose as enum (
  'appointment_created',
  'appointment_confirmed',
  'appointment_reminder',
  'appointment_rescheduled',
  'appointment_cancelled',
  'appointment_confirmation_request',
  'waitlist_slot_available',
  'human_follow_up'
);
create type public.whatsapp_opt_in_category as enum (
  'transactional', 'reminders', 'service_updates', 'marketing'
);
create type public.whatsapp_opt_in_status as enum ('granted', 'revoked', 'pending');
create type public.whatsapp_handoff_requester as enum ('customer', 'automation', 'user');
create type public.whatsapp_handoff_status as enum ('requested', 'accepted', 'resolved', 'cancelled');
create type public.whatsapp_flow_session_status as enum (
  'created', 'active', 'completed', 'expired', 'cancelled', 'failed'
);

-- Chaves opacas particionam a inbox sem persistir telefone ou identificador Meta
-- em claro. O adapter normaliza, deduplica e calcula SHA-256 antes do insert.
create or replace function app_private.is_valid_whatsapp_ordering_keys(p_keys text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select array_ndims(p_keys) = 1
    and cardinality(p_keys) between 1 and 256
    and not exists (
      select 1
      from unnest(p_keys) as ordering_key(value)
      where ordering_key.value is null
        or ordering_key.value !~ '^[0-9a-f]{64}$'
    )
    and cardinality(p_keys) = (
      select count(distinct ordering_key.value)
      from unnest(p_keys) as ordering_key(value)
    );
$$;

revoke all on function app_private.is_valid_whatsapp_ordering_keys(text[])
from public, anon, authenticated;
grant execute on function app_private.is_valid_whatsapp_ordering_keys(text[])
to service_role;

-- Interações do canal contam para roteamento mesmo antes de uma visita concluída.
alter table public.customer_tenants
  add column last_interaction_at timestamptz;

create index customer_tenants_interaction_idx
  on public.customer_tenants (customer_id, last_interaction_at desc)
  where last_interaction_at is not null;

create table public.whatsapp_business_accounts (
  id uuid primary key default gen_random_uuid(),
  provider public.whatsapp_provider not null,
  external_waba_id text not null check (char_length(external_waba_id) between 1 and 200),
  business_portfolio_id text check (
    business_portfolio_id is null or char_length(business_portfolio_id) between 1 and 200
  ),
  ownership_type public.whatsapp_account_ownership not null,
  owner_tenant_id uuid references public.tenants(id) on delete restrict,
  secret_reference text check (
    secret_reference is null or char_length(secret_reference) between 1 and 500
  ),
  status public.whatsapp_connection_status not null default 'pending',
  display_name text check (display_name is null or char_length(display_name) <= 200),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_waba_id),
  unique (id, provider),
  constraint whatsapp_business_accounts_owner_check check (
    (ownership_type = 'platform_owned' and owner_tenant_id is null) or
    (ownership_type = 'tenant_owned' and owner_tenant_id is not null)
  ),
  constraint whatsapp_business_accounts_connection_dates check (
    disconnected_at is null or connected_at is null or disconnected_at >= connected_at
  )
);

create index whatsapp_business_accounts_owner_idx
  on public.whatsapp_business_accounts (owner_tenant_id, status)
  where owner_tenant_id is not null;

create table public.whatsapp_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null,
  provider public.whatsapp_provider not null,
  external_phone_number_id text not null check (
    char_length(external_phone_number_id) between 1 and 200
  ),
  display_phone_number text check (
    display_phone_number is null or char_length(display_phone_number) <= 40
  ),
  normalized_phone_number text not null check (
    normalized_phone_number ~ '^\+[1-9][0-9]{7,14}$'
  ),
  verified_name text check (verified_name is null or char_length(verified_name) <= 200),
  connection_mode public.whatsapp_connection_mode not null,
  status public.whatsapp_connection_status not null default 'pending',
  is_default boolean not null default false,
  quality_status text check (quality_status is null or char_length(quality_status) <= 80),
  messaging_limit_tier text check (
    messaging_limit_tier is null or char_length(messaging_limit_tier) <= 80
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_account_id, provider)
    references public.whatsapp_business_accounts (id, provider) on delete restrict,
  unique (provider, external_phone_number_id),
  unique (provider, normalized_phone_number),
  unique (id, provider)
);

create unique index whatsapp_phone_numbers_default_idx
  on public.whatsapp_phone_numbers (business_account_id)
  where is_default;
create index whatsapp_phone_numbers_status_idx
  on public.whatsapp_phone_numbers (provider, status, connection_mode);

create table public.whatsapp_phone_number_tenants (
  id uuid primary key default gen_random_uuid(),
  phone_number_id uuid not null references public.whatsapp_phone_numbers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid,
  routing_mode public.whatsapp_routing_mode not null,
  purpose text check (purpose is null or char_length(purpose) <= 80),
  is_primary boolean not null default false,
  status public.whatsapp_link_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone_number_id),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id)
    references public.locations (tenant_id, id) on delete restrict
);

create unique index whatsapp_phone_number_direct_active_idx
  on public.whatsapp_phone_number_tenants (phone_number_id)
  where routing_mode = 'direct' and status = 'active';
create unique index whatsapp_phone_number_primary_tenant_idx
  on public.whatsapp_phone_number_tenants (tenant_id)
  where is_primary and status = 'active';
create index whatsapp_phone_number_tenants_lookup_idx
  on public.whatsapp_phone_number_tenants (tenant_id, status, phone_number_id);

create table public.tenant_whatsapp_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  preferred_phone_number_id uuid,
  booking_enabled boolean not null default false,
  reminders_enabled boolean not null default false,
  cancellations_enabled boolean not null default false,
  rescheduling_enabled boolean not null default false,
  human_handoff_enabled boolean not null default false,
  human_handoff_phone text check (
    human_handoff_phone is null or human_handoff_phone ~ '^\+[1-9][0-9]{7,14}$'
  ),
  human_handoff_email extensions.citext,
  welcome_message text check (welcome_message is null or char_length(welcome_message) <= 2000),
  unknown_message_response text check (
    unknown_message_response is null or char_length(unknown_message_response) <= 2000
  ),
  timezone text,
  session_timeout_minutes integer not null default 30 check (
    session_timeout_minutes between 5 and 1440
  ),
  default_language text not null default 'pt-BR' check (
    char_length(default_language) between 2 and 20
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, preferred_phone_number_id)
    references public.whatsapp_phone_number_tenants (tenant_id, phone_number_id)
    on delete restrict
);

create table public.whatsapp_routing_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  phone_number_id uuid not null references public.whatsapp_phone_numbers(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9]{5,64}$'),
  type public.whatsapp_routing_code_type not null,
  campaign text check (campaign is null or char_length(campaign) <= 120),
  source text check (source is null or char_length(source) <= 120),
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses_count integer not null default 0 check (uses_count >= 0),
  status public.whatsapp_routing_code_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, phone_number_id)
    references public.whatsapp_phone_number_tenants (tenant_id, phone_number_id)
    on delete restrict,
  unique (phone_number_id, code),
  constraint whatsapp_routing_codes_usage_check check (
    max_uses is null or uses_count <= max_uses
  ),
  constraint whatsapp_routing_codes_expiry_check check (
    type <> 'temporary_context_token' or expires_at is not null
  )
);

create index whatsapp_routing_codes_lookup_idx
  on public.whatsapp_routing_codes (phone_number_id, code, status);
create index whatsapp_routing_codes_expiry_idx
  on public.whatsapp_routing_codes (expires_at)
  where status = 'active' and expires_at is not null;

-- Ledger técnico evita consumir o mesmo código duas vezes no retry do mesmo inbound.
create table public.whatsapp_routing_code_uses (
  routing_code_id uuid not null
    references public.whatsapp_routing_codes(id) on delete restrict,
  usage_key text not null check (char_length(usage_key) between 1 and 300),
  used_at timestamptz not null default now(),
  primary key (routing_code_id, usage_key)
);

create table public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  provider public.whatsapp_provider not null,
  normalized_phone text not null check (normalized_phone ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_user_id text not null check (char_length(whatsapp_user_id) between 1 and 200),
  profile_name text check (profile_name is null or char_length(profile_name) <= 200),
  customer_id uuid references public.customers(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  blocked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, whatsapp_user_id),
  unique (provider, normalized_phone),
  constraint whatsapp_contacts_seen_check check (last_seen_at >= first_seen_at)
);

create index whatsapp_contacts_customer_idx
  on public.whatsapp_contacts (customer_id)
  where customer_id is not null;

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  phone_number_id uuid not null references public.whatsapp_phone_numbers(id) on delete restrict,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete restrict,
  tenant_id uuid references public.tenants(id) on delete restrict,
  status public.whatsapp_conversation_status not null default 'open',
  current_state text not null default 'START' check (char_length(current_state) between 1 and 100),
  service_window_expires_at timestamptz,
  session_expires_at timestamptz,
  assigned_user_id uuid references auth.users(id) on delete set null,
  handoff_requested_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  version bigint not null default 1 check (version > 0),
  processing_locked_at timestamptz,
  processing_locked_until timestamptz,
  processing_locked_by text check (
    processing_locked_by is null or char_length(processing_locked_by) between 1 and 120
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (id, tenant_id),
  foreign key (tenant_id, phone_number_id)
    references public.whatsapp_phone_number_tenants (tenant_id, phone_number_id)
    on delete restrict,
  constraint whatsapp_conversations_closed_check check (
    (status in ('completed', 'expired', 'closed', 'failed') and closed_at is not null) or
    (status not in ('completed', 'expired', 'closed', 'failed') and closed_at is null)
  ),
  constraint whatsapp_conversations_lock_check check (
    (processing_locked_at is null and processing_locked_until is null and processing_locked_by is null) or
    (processing_locked_at is not null and processing_locked_until is not null and
      processing_locked_by is not null and processing_locked_until > processing_locked_at)
  )
);

create unique index whatsapp_conversations_one_active_idx
  on public.whatsapp_conversations (phone_number_id, contact_id)
  where status in ('open', 'waiting_customer', 'processing', 'human_handoff');
create index whatsapp_conversations_tenant_activity_idx
  on public.whatsapp_conversations (tenant_id, updated_at desc)
  where tenant_id is not null;
create index whatsapp_conversations_session_expiry_idx
  on public.whatsapp_conversations (session_expires_at)
  where status in ('open', 'waiting_customer', 'processing');

create table public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider public.whatsapp_provider not null,
  external_event_key text not null check (char_length(external_event_key) between 1 and 300),
  event_type text not null check (char_length(event_type) between 1 and 120),
  phone_number_id uuid references public.whatsapp_phone_numbers(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  ordering_keys text[] not null,
  ordering_global_fallback boolean not null default false,
  signature_valid boolean not null,
  payload jsonb not null,
  processing_status public.whatsapp_webhook_processing_status not null default 'received',
  attempts smallint not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_until timestamptz,
  locked_by text check (locked_by is null or char_length(locked_by) between 1 and 120),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_event_key),
  constraint whatsapp_webhook_events_lock_check check (
    (locked_at is null and locked_until is null and locked_by is null) or
    (locked_at is not null and locked_until is not null and locked_by is not null and locked_until > locked_at)
  ),
  constraint whatsapp_webhook_events_ordering_keys_check check (
    app_private.is_valid_whatsapp_ordering_keys(ordering_keys)
  ),
  constraint whatsapp_webhook_events_ordering_fallback_check check (
    not ordering_global_fallback or cardinality(ordering_keys) = 1
  )
);

create index whatsapp_webhook_events_worker_idx
  on public.whatsapp_webhook_events (provider, next_attempt_at, received_at, id)
  where processing_status in ('received', 'queued', 'processing');
create index whatsapp_webhook_events_stream_order_idx
  on public.whatsapp_webhook_events (provider, received_at, id)
  where processing_status in ('received', 'queued', 'processing');
create index whatsapp_webhook_events_ordering_keys_idx
  on public.whatsapp_webhook_events using gin (ordering_keys)
  where processing_status in ('received', 'queued', 'processing');
create index whatsapp_webhook_events_ordering_fallback_idx
  on public.whatsapp_webhook_events (provider, received_at, id)
  where processing_status in ('received', 'queued', 'processing')
    and ordering_global_fallback;
create index whatsapp_webhook_events_correlation_idx
  on public.whatsapp_webhook_events (correlation_id);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete restrict,
  provider public.whatsapp_provider not null,
  direction public.whatsapp_message_direction not null,
  message_type public.whatsapp_message_type not null,
  provider_message_id text check (
    provider_message_id is null or char_length(provider_message_id) between 1 and 300
  ),
  provider_reply_to_id text check (
    provider_reply_to_id is null or char_length(provider_reply_to_id) between 1 and 300
  ),
  external_event_key text check (
    external_event_key is null or char_length(external_event_key) between 1 and 300
  ),
  idempotency_key text check (
    idempotency_key is null or char_length(idempotency_key) between 1 and 200
  ),
  status public.whatsapp_message_status not null,
  content jsonb not null default '{}'::jsonb,
  normalized_content jsonb not null default '{}'::jsonb,
  provider_payload jsonb,
  error_code text check (error_code is null or char_length(error_code) <= 120),
  error_message text check (error_message is null or char_length(error_message) <= 500),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, tenant_id)
    references public.whatsapp_conversations (id, tenant_id) on delete cascade
);

create unique index whatsapp_messages_provider_message_idx
  on public.whatsapp_messages (provider, provider_message_id)
  where provider_message_id is not null;
create unique index whatsapp_messages_external_event_idx
  on public.whatsapp_messages (provider, external_event_key)
  where external_event_key is not null;
create unique index whatsapp_messages_idempotency_idx
  on public.whatsapp_messages (conversation_id, idempotency_key)
  where idempotency_key is not null;
create unique index whatsapp_messages_notification_idempotency_idx
  on public.whatsapp_messages (idempotency_key)
  where direction = 'outbound' and idempotency_key like 'notification:%';
create index whatsapp_messages_conversation_created_idx
  on public.whatsapp_messages (conversation_id, created_at);
create index whatsapp_messages_tenant_created_idx
  on public.whatsapp_messages (tenant_id, created_at desc)
  where tenant_id is not null;
create index whatsapp_messages_inbound_pending_idx
  on public.whatsapp_messages (conversation_id, created_at)
  where direction = 'inbound' and processed_at is null;

-- Status pode chegar antes de a resposta HTTP do provider ser persistida na outbox.
create table public.whatsapp_pending_message_statuses (
  provider public.whatsapp_provider not null,
  provider_message_id text not null check (
    char_length(provider_message_id) between 1 and 300
  ),
  status public.whatsapp_message_status not null check (
    status in ('sent', 'delivered', 'read', 'failed')
  ),
  event_timestamp timestamptz not null,
  error_code text check (error_code is null or char_length(error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_message_id, status)
);

create table public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete restrict,
  phone_number_id uuid not null references public.whatsapp_phone_numbers(id) on delete restrict,
  provider public.whatsapp_provider not null,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  message_id uuid not null unique references public.whatsapp_messages(id) on delete cascade,
  recipient text not null check (recipient ~ '^\+[1-9][0-9]{7,14}$'),
  message_kind public.whatsapp_message_type not null,
  payload jsonb not null,
  scheduled_for timestamptz not null default now(),
  status public.whatsapp_outbox_status not null default 'pending',
  attempt_count smallint not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_until timestamptz,
  locked_by text check (locked_by is null or char_length(locked_by) between 1 and 120),
  provider_message_id text check (
    provider_message_id is null or char_length(provider_message_id) between 1 and 300
  ),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (conversation_id, tenant_id)
    references public.whatsapp_conversations (id, tenant_id) on delete cascade,
  foreign key (phone_number_id, provider)
    references public.whatsapp_phone_numbers (id, provider) on delete restrict,
  constraint whatsapp_outbox_lock_check check (
    (locked_at is null and locked_until is null and locked_by is null) or
    (locked_at is not null and locked_until is not null and locked_by is not null and locked_until > locked_at)
  )
);

create index whatsapp_outbox_worker_idx
  on public.whatsapp_outbox (next_attempt_at, scheduled_for, created_at)
  where status in ('pending', 'retry', 'processing');
create index whatsapp_outbox_tenant_status_idx
  on public.whatsapp_outbox (tenant_id, status, created_at desc)
  where tenant_id is not null;
create index whatsapp_outbox_conversation_order_idx
  on public.whatsapp_outbox (provider, conversation_id, scheduled_for, created_at, id)
  where status in ('pending', 'retry', 'processing');

create table public.whatsapp_template_definitions (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.whatsapp_business_accounts(id) on delete cascade,
  external_template_id text check (
    external_template_id is null or char_length(external_template_id) between 1 and 200
  ),
  -- O limite de 512 caracteres é da Meta, mas `{m,n}` de regex do Postgres aceita
  -- no máximo 255. O comprimento fica fora da expressão para manter o limite real.
  name text not null check (
    name ~ '^[a-z0-9_]+$' and char_length(name) between 1 and 512
  ),
  language text not null check (char_length(language) between 2 and 20),
  category text not null check (category in ('utility', 'authentication', 'marketing')),
  status text not null check (
    status in (
      'local_draft', 'submitted', 'approved', 'rejected', 'paused', 'disabled', 'unknown'
    )
  ),
  components jsonb not null default '[]'::jsonb check (jsonb_typeof(components) = 'array'),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_account_id, name, language)
);

create unique index whatsapp_template_definitions_external_idx
  on public.whatsapp_template_definitions (business_account_id, external_template_id)
  where external_template_id is not null;

create table public.tenant_whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_definition_id uuid not null
    references public.whatsapp_template_definitions(id) on delete cascade,
  purpose public.whatsapp_template_purpose not null,
  enabled boolean not null default true,
  variable_mapping jsonb not null default '{}'::jsonb check (
    jsonb_typeof(variable_mapping) = 'object'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, purpose)
);

create table public.whatsapp_opt_ins (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category public.whatsapp_opt_in_category not null,
  status public.whatsapp_opt_in_status not null,
  source text not null check (char_length(source) between 1 and 120),
  policy_version text not null check (char_length(policy_version) between 1 and 80),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  granted_at timestamptz,
  revoked_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_opt_ins_dates_check check (
    (status = 'granted' and granted_at is not null and revoked_at is null) or
    (status = 'revoked' and revoked_at is not null) or
    status = 'pending'
  )
);

create unique index whatsapp_opt_ins_current_idx
  on public.whatsapp_opt_ins (contact_id, tenant_id, category)
  where superseded_at is null;
create index whatsapp_opt_ins_tenant_status_idx
  on public.whatsapp_opt_ins (tenant_id, category, status, created_at desc);

create table public.whatsapp_handoffs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete restrict,
  requested_by public.whatsapp_handoff_requester not null,
  reason text check (reason is null or char_length(reason) <= 1000),
  status public.whatsapp_handoff_status not null default 'requested',
  assigned_user_id uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text check (
    resolution_notes is null or char_length(resolution_notes) <= 3000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, tenant_id)
    references public.whatsapp_conversations (id, tenant_id) on delete cascade,
  constraint whatsapp_handoffs_dates_check check (
    (accepted_at is null or accepted_at >= requested_at) and
    (resolved_at is null or resolved_at >= requested_at)
  )
);

create unique index whatsapp_handoffs_active_idx
  on public.whatsapp_handoffs (conversation_id)
  where status in ('requested', 'accepted');
create index whatsapp_handoffs_tenant_status_idx
  on public.whatsapp_handoffs (tenant_id, status, requested_at);

create table public.whatsapp_flow_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  flow_definition_id text not null check (char_length(flow_definition_id) between 1 and 200),
  flow_token_hash bytea not null unique,
  status public.whatsapp_flow_session_status not null default 'created',
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, tenant_id)
    references public.whatsapp_conversations (id, tenant_id) on delete cascade,
  constraint whatsapp_flow_sessions_expiry_check check (expires_at > created_at),
  constraint whatsapp_flow_sessions_completion_check check (
    status <> 'completed' or completed_at is not null
  )
);

create index whatsapp_flow_sessions_active_idx
  on public.whatsapp_flow_sessions (tenant_id, expires_at)
  where status in ('created', 'active');

create or replace function app_private.validate_whatsapp_phone_tenant_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode public.whatsapp_connection_mode;
  v_ownership public.whatsapp_account_ownership;
  v_owner_tenant_id uuid;
begin
  select pn.connection_mode, account.ownership_type, account.owner_tenant_id
    into v_mode, v_ownership, v_owner_tenant_id
  from public.whatsapp_phone_numbers pn
  join public.whatsapp_business_accounts account on account.id = pn.business_account_id
  where pn.id = new.phone_number_id;

  if v_mode is null then
    raise exception using errcode = '23503', message = 'whatsapp_phone_number_not_found';
  end if;

  if (v_mode = 'shared_platform' and new.routing_mode <> 'shared') or
     (v_mode <> 'shared_platform' and new.routing_mode <> 'direct') then
    raise exception using errcode = '23514', message = 'invalid_whatsapp_routing_mode';
  end if;

  if v_ownership = 'tenant_owned' and v_owner_tenant_id <> new.tenant_id then
    raise exception using errcode = '23514', message = 'tenant_owned_waba_mismatch';
  end if;

  return new;
end;
$$;

create trigger whatsapp_phone_number_tenants_validate
before insert or update of phone_number_id, tenant_id, routing_mode
on public.whatsapp_phone_number_tenants
for each row execute function app_private.validate_whatsapp_phone_tenant_link();

create or replace function app_private.validate_whatsapp_phone_number_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ownership public.whatsapp_account_ownership;
  v_owner_tenant_id uuid;
begin
  if exists (
    select 1 from public.whatsapp_phone_number_tenants link
    where link.phone_number_id = old.id
      and (
        (new.connection_mode = 'shared_platform' and link.routing_mode <> 'shared') or
        (new.connection_mode <> 'shared_platform' and link.routing_mode <> 'direct')
      )
  ) then
    raise exception using errcode = '23514', message = 'whatsapp_phone_mode_has_incompatible_links';
  end if;

  select ownership_type, owner_tenant_id
    into v_ownership, v_owner_tenant_id
  from public.whatsapp_business_accounts
  where id = new.business_account_id;

  if v_ownership = 'tenant_owned' and exists (
    select 1 from public.whatsapp_phone_number_tenants link
    where link.phone_number_id = old.id and link.tenant_id <> v_owner_tenant_id
  ) then
    raise exception using errcode = '23514', message = 'tenant_owned_waba_mismatch';
  end if;

  return new;
end;
$$;

create trigger whatsapp_phone_numbers_validate_change
before update of business_account_id, connection_mode
on public.whatsapp_phone_numbers
for each row execute function app_private.validate_whatsapp_phone_number_change();

create or replace function app_private.validate_whatsapp_account_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ownership_type = 'tenant_owned' and exists (
    select 1
    from public.whatsapp_phone_numbers phone
    join public.whatsapp_phone_number_tenants link on link.phone_number_id = phone.id
    where phone.business_account_id = old.id
      and link.tenant_id <> new.owner_tenant_id
  ) then
    raise exception using errcode = '23514', message = 'tenant_owned_waba_mismatch';
  end if;
  return new;
end;
$$;

create trigger whatsapp_business_accounts_validate_change
before update of ownership_type, owner_tenant_id
on public.whatsapp_business_accounts
for each row execute function app_private.validate_whatsapp_account_change();

create or replace function app_private.validate_tenant_whatsapp_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;
  return new;
end;
$$;

create trigger tenant_whatsapp_settings_validate_timezone
before insert or update of timezone on public.tenant_whatsapp_settings
for each row execute function app_private.validate_tenant_whatsapp_timezone();

create or replace function app_private.validate_tenant_whatsapp_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.whatsapp_template_definitions definition
    join public.whatsapp_phone_numbers phone
      on phone.business_account_id = definition.business_account_id
    join public.whatsapp_phone_number_tenants link
      on link.phone_number_id = phone.id
     and link.tenant_id = new.tenant_id
     and link.status = 'active'
    where definition.id = new.template_definition_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'invalid_whatsapp_template_business_account';
  end if;

  return new;
end;
$$;

create trigger tenant_whatsapp_templates_validate_business_account
before insert or update of tenant_id, template_definition_id
on public.tenant_whatsapp_templates
for each row execute function app_private.validate_tenant_whatsapp_template();

-- Código publicado vira identificador histórico. Desativação mantém tombstone sob
-- a restrição única e impede que links antigos apontem para outro tenant.
create or replace function app_private.preserve_whatsapp_routing_code_tombstone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_routing_code_delete_forbidden',
      hint = 'set status to disabled';
  end if;

  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.phone_number_id is distinct from old.phone_number_id
    or new.code is distinct from old.code
    or new.type is distinct from old.type
    or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_routing_code_identity_immutable';
  end if;

  if old.status in ('disabled', 'expired') and new.status = 'active' then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_routing_code_reactivation_forbidden';
  end if;

  return new;
end;
$$;

create trigger whatsapp_routing_codes_preserve_tombstone
before update or delete on public.whatsapp_routing_codes
for each row execute function app_private.preserve_whatsapp_routing_code_tombstone();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'whatsapp_business_accounts', 'whatsapp_phone_numbers',
    'whatsapp_phone_number_tenants', 'tenant_whatsapp_settings',
    'whatsapp_routing_codes', 'whatsapp_contacts', 'whatsapp_conversations',
    'whatsapp_webhook_events', 'whatsapp_messages', 'whatsapp_outbox',
    'whatsapp_pending_message_statuses',
    'whatsapp_template_definitions', 'tenant_whatsapp_templates',
    'whatsapp_opt_ins', 'whatsapp_handoffs', 'whatsapp_flow_sessions'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app_private.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end;
$$;

create or replace function app_private.can_read_whatsapp_conversation(
  p_tenant_id uuid,
  p_status public.whatsapp_conversation_status,
  p_assigned_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_tenant_id is null then app_private.is_platform_owner()
    else
      app_private.has_tenant_role(
        p_tenant_id,
        array['owner', 'admin', 'receptionist']::public.tenant_role[]
      ) or (
        p_status = 'human_handoff'
        and app_private.has_permission(p_tenant_id, 'whatsapp_handoff')
      )
  end;
$$;

-- Privilégios explícitos. Workers recebem acesso direto; usuários recebem somente superfícies seguras.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'whatsapp_business_accounts', 'whatsapp_phone_numbers',
    'whatsapp_phone_number_tenants', 'tenant_whatsapp_settings',
    'whatsapp_routing_codes', 'whatsapp_routing_code_uses',
    'whatsapp_contacts', 'whatsapp_conversations',
    'whatsapp_webhook_events', 'whatsapp_messages', 'whatsapp_outbox',
    'whatsapp_pending_message_statuses',
    'whatsapp_template_definitions', 'tenant_whatsapp_templates',
    'whatsapp_opt_ins', 'whatsapp_handoffs', 'whatsapp_flow_sessions'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end;
$$;

grant select (
  id, provider, external_waba_id, business_portfolio_id, ownership_type,
  owner_tenant_id, status, display_name, metadata, connected_at,
  disconnected_at, created_at, updated_at
) on public.whatsapp_business_accounts to authenticated;
grant select on public.whatsapp_phone_numbers to authenticated;
grant select on public.whatsapp_phone_number_tenants to authenticated;
grant select, insert, update on public.tenant_whatsapp_settings to authenticated;
grant select, insert on public.whatsapp_routing_codes to authenticated;
grant update (campaign, source, expires_at, max_uses, status, metadata)
on public.whatsapp_routing_codes to authenticated;
revoke delete on public.whatsapp_routing_codes from authenticated, service_role;
-- Contato é uma identidade global. O tenant recebe somente os campos necessários
-- à operação; customer_id, identificadores externos, timestamps e metadata ficam
-- restritos ao service_role mesmo quando a RLS permite a linha por uma conversa.
grant select (id, normalized_phone, profile_name)
on public.whatsapp_contacts to authenticated;
grant select on public.whatsapp_conversations to authenticated;
grant select (
  id, conversation_id, tenant_id, provider, direction, message_type,
  provider_message_id, provider_reply_to_id, external_event_key, idempotency_key,
  status, content, normalized_content, error_code, error_message,
  sent_at, delivered_at, read_at, failed_at, processed_at, created_at, updated_at
) on public.whatsapp_messages to authenticated;
grant select (
  id, provider, event_type, phone_number_id, correlation_id, signature_valid,
  processing_status, attempts, next_attempt_at, received_at, processed_at,
  created_at, updated_at
) on public.whatsapp_webhook_events to authenticated;
grant select (
  id, tenant_id, phone_number_id, provider, conversation_id, message_id,
  message_kind, scheduled_for, status, attempt_count, next_attempt_at,
  locked_at, locked_until, created_at, updated_at, processed_at
) on public.whatsapp_outbox to authenticated;
grant select on public.whatsapp_template_definitions to authenticated;
grant select, insert, update, delete on public.tenant_whatsapp_templates to authenticated;
grant select on public.whatsapp_opt_ins to authenticated;
grant select on public.whatsapp_handoffs to authenticated;
-- O hash do token e o contexto do Flow são credenciais/estado interno. A UI
-- administrativa recebe apenas o ledger operacional necessário para auditoria.
grant select (
  id, conversation_id, tenant_id, flow_definition_id, status,
  expires_at, completed_at, created_at, updated_at
) on public.whatsapp_flow_sessions to authenticated;

create policy whatsapp_business_accounts_read
on public.whatsapp_business_accounts for select to authenticated
using (
  app_private.is_platform_owner() or
  (owner_tenant_id is not null and app_private.has_tenant_role(
    owner_tenant_id, array['owner', 'admin']::public.tenant_role[]
  )) or exists (
    select 1
    from public.whatsapp_phone_numbers pn
    join public.whatsapp_phone_number_tenants link on link.phone_number_id = pn.id
    where pn.business_account_id = whatsapp_business_accounts.id
      and app_private.has_tenant_role(
        link.tenant_id, array['owner', 'admin']::public.tenant_role[]
      )
  )
);

create policy whatsapp_phone_numbers_read
on public.whatsapp_phone_numbers for select to authenticated
using (
  app_private.is_platform_owner() or exists (
    select 1 from public.whatsapp_phone_number_tenants link
    where link.phone_number_id = whatsapp_phone_numbers.id
      and app_private.has_tenant_role(
        link.tenant_id, array['owner', 'admin']::public.tenant_role[]
      )
  )
);

create policy whatsapp_phone_number_tenants_read
on public.whatsapp_phone_number_tenants for select to authenticated
using (
  app_private.is_platform_owner() or
  app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
);

create policy tenant_whatsapp_settings_read
on public.tenant_whatsapp_settings for select to authenticated
using (
  app_private.is_platform_owner() or
  app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
);
create policy tenant_whatsapp_settings_insert
on public.tenant_whatsapp_settings for insert to authenticated
with check (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
));
create policy tenant_whatsapp_settings_update
on public.tenant_whatsapp_settings for update to authenticated
using (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
))
with check (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
));

create policy whatsapp_routing_codes_read
on public.whatsapp_routing_codes for select to authenticated
using (
  app_private.is_platform_owner() or
  app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
);
create policy whatsapp_routing_codes_insert
on public.whatsapp_routing_codes for insert to authenticated
with check (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
));
create policy whatsapp_routing_codes_update
on public.whatsapp_routing_codes for update to authenticated
using (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
))
with check (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
));

create policy whatsapp_contacts_read
on public.whatsapp_contacts for select to authenticated
using (
  app_private.is_platform_owner() or exists (
    select 1 from public.whatsapp_conversations conversation
    where conversation.contact_id = whatsapp_contacts.id
      and app_private.can_read_whatsapp_conversation(
        conversation.tenant_id, conversation.status, conversation.assigned_user_id
      )
  )
);

create policy whatsapp_conversations_read
on public.whatsapp_conversations for select to authenticated
using (app_private.can_read_whatsapp_conversation(tenant_id, status, assigned_user_id));

create policy whatsapp_messages_read
on public.whatsapp_messages for select to authenticated
using (exists (
  select 1 from public.whatsapp_conversations conversation
  where conversation.id = whatsapp_messages.conversation_id
    and conversation.tenant_id is not distinct from whatsapp_messages.tenant_id
    and app_private.can_read_whatsapp_conversation(
      conversation.tenant_id, conversation.status, conversation.assigned_user_id
    )
));

create policy whatsapp_webhook_events_platform_read
on public.whatsapp_webhook_events for select to authenticated
using (app_private.is_platform_owner());

create policy whatsapp_outbox_platform_read
on public.whatsapp_outbox for select to authenticated
using (app_private.is_platform_owner());

create policy whatsapp_template_definitions_read
on public.whatsapp_template_definitions for select to authenticated
using (
  app_private.is_platform_owner() or exists (
    select 1 from public.tenant_whatsapp_templates tenant_template
    where tenant_template.template_definition_id = whatsapp_template_definitions.id
      and app_private.has_tenant_role(
        tenant_template.tenant_id, array['owner', 'admin']::public.tenant_role[]
      )
  )
);

create policy tenant_whatsapp_templates_read
on public.tenant_whatsapp_templates for select to authenticated
using (
  app_private.is_platform_owner() or
  app_private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
);
create policy tenant_whatsapp_templates_insert
on public.tenant_whatsapp_templates for insert to authenticated
with check (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
));
create policy tenant_whatsapp_templates_update
on public.tenant_whatsapp_templates for update to authenticated
using (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
))
with check (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
));
create policy tenant_whatsapp_templates_delete
on public.tenant_whatsapp_templates for delete to authenticated
using (app_private.has_tenant_role(
  tenant_id, array['owner', 'admin']::public.tenant_role[]
));

create policy whatsapp_opt_ins_read
on public.whatsapp_opt_ins for select to authenticated
using (
  app_private.is_platform_owner() or
  app_private.has_tenant_role(
    tenant_id, array['owner', 'admin', 'receptionist']::public.tenant_role[]
  )
);

create policy whatsapp_handoffs_read
on public.whatsapp_handoffs for select to authenticated
using (exists (
  select 1 from public.whatsapp_conversations conversation
  where conversation.id = whatsapp_handoffs.conversation_id
    and conversation.tenant_id is not distinct from whatsapp_handoffs.tenant_id
    and app_private.can_read_whatsapp_conversation(
      conversation.tenant_id, conversation.status, conversation.assigned_user_id
    )
));

create policy whatsapp_flow_sessions_read
on public.whatsapp_flow_sessions for select to authenticated
using (exists (
  select 1 from public.whatsapp_conversations conversation
  where conversation.id = whatsapp_flow_sessions.conversation_id
    and conversation.tenant_id is not distinct from whatsapp_flow_sessions.tenant_id
    and app_private.can_read_whatsapp_conversation(
      conversation.tenant_id, conversation.status, conversation.assigned_user_id
    )
));

create policy tenants_platform_owner_read
on public.tenants for select to authenticated
using (app_private.is_platform_owner());

revoke all on function app_private.validate_tenant_whatsapp_template()
  from public, anon, authenticated;
revoke all on function app_private.preserve_whatsapp_routing_code_tombstone()
  from public, anon, authenticated;

-- Reservas futuras do shell da plataforma e das integrações não podem virar tenant.
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
    'sitemap-xml', 'next', 'platform', 'integrations', 'integracoes', 'whatsapp',
    'simulator', 'simulador'
  ]);
$$;

commit;
