-- Rwanda Mobility: initial schema. All money is integer RWF. All timestamps UTC.

create table users (
  id uuid primary key default gen_random_uuid(),
  phone text unique check (phone ~ '^\+250[0-9]{9}$'),
  email text unique,
  password_hash text,
  display_name text,
  photo_key text,
  preferred_language text not null default 'rw' check (preferred_language in ('rw','en','fr','sw')),
  status text not null default 'active' check (status in ('active','restricted','deactivated','deletion_requested','deleted')),
  mfa_secret_enc text,
  mfa_enabled boolean not null default false,
  referral_code text unique,
  notif_prefs jsonb not null default '{"push":true,"sms":true,"email":false,"marketing":false}',
  risk_score int not null default 0,
  device_fingerprint text,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('passenger','driver','fleet_manager','corporate_admin','corporate_booker',
    'super_admin','dispatcher','support_agent','support_lead','driver_verifier','finance_officer','finance_approver',
    'business_manager','analyst')),
  primary key (user_id, role)
);

create table roles (name text primary key, description text);
create table role_permissions (
  role text not null references roles(name) on delete cascade,
  permission text not null,
  primary key (role, permission)
);

create table otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  purpose text not null default 'login',
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  ip text,
  device_id text,
  created_at timestamptz not null default now()
);
create index otp_phone_created on otp_challenges(phone, created_at desc);
create index otp_ip_created on otp_challenges(ip, created_at desc);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  refresh_hash text not null unique,
  device_id text,
  device_name text,
  ip text,
  privileged boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index sessions_user on sessions(user_id) where revoked_at is null;

create table consents (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,           -- terms | privacy | location | background_location | marketing
  version text not null,
  granted boolean not null,
  created_at timestamptz not null default now()
);

create table privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind in ('access','correction','deletion','deactivation')),
  status text not null default 'open' check (status in ('open','in_progress','completed','rejected')),
  due_at timestamptz not null,
  notes text,
  handled_by uuid references users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null check (label in ('home','work','school','other')),
  name text not null,
  lat double precision not null, lng double precision not null,
  note text,
  created_at timestamptz not null default now()
);
create table emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  phone text not null check (phone ~ '^\+250[0-9]{9}$'),
  created_at timestamptz not null default now()
);

-- catalogue & zones
create table service_zones (
  id text primary key,
  name text not null,
  polygon jsonb not null,            -- ring of [lng,lat]; first == last
  active boolean not null default true,
  config jsonb not null default '{}'
);
create table service_categories (
  id text primary key,
  name_en text not null, name_rw text not null,
  description_en text, description_rw text,
  vehicle_types text[] not null,
  min_capacity int not null default 1,
  requires_comfort boolean not null default false,
  passenger_capacity int not null default 1,
  luggage text,
  phase int not null default 1,
  enabled boolean not null default false,
  restrictions jsonb not null default '{}',
  sort int not null default 100
);
create table zone_services (
  zone_id text not null references service_zones(id),
  service_id text not null references service_categories(id),
  enabled boolean not null default true,
  primary key (zone_id, service_id)
);
create table places (
  id uuid primary key default gen_random_uuid(),
  name_en text not null, name_rw text,
  kind text not null default 'landmark',
  lat double precision not null, lng double precision not null,
  zone_id text references service_zones(id),
  designated_pickup boolean not null default false
);

create table pricing_rules (
  id uuid primary key default gen_random_uuid(),
  service_id text not null references service_categories(id),
  zone_id text references service_zones(id),
  model text not null default 'platform' check (model in ('fixed','platform','negotiated')),
  base_fare int not null check (base_fare >= 0),
  per_km int not null check (per_km >= 0),
  per_min int not null check (per_min >= 0),
  minimum_fare int not null check (minimum_fare >= 0),
  booking_fee int not null default 0,
  wait_per_min int not null default 0,
  free_wait_min int not null default 3,
  airport_fee int not null default 0,
  scheduled_fee int not null default 0,
  long_distance_km int,
  long_distance_per_km int,
  tax_bps int not null default 0,          -- tax in basis points on subtotal (0 = none)
  rounding int not null default 50,        -- round to nearest N RWF
  surge_enabled boolean not null default false,
  surge_cap_bps int not null default 15000,
  version int not null default 1,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  status text not null default 'draft' check (status in ('draft','pending_approval','active','retired')),
  created_by uuid references users(id),
  approved_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index pricing_lookup on pricing_rules(service_id, status, effective_from);

create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  service_id text references service_categories(id),
  fleet_id uuid,
  driver_id uuid,
  kind text not null check (kind in ('percent','fixed')),
  percent_bps int,                         -- 1500 = 15%
  fixed_amount int,
  exempt_until timestamptz,                -- temporary exemption (admin approved)
  note text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  status text not null default 'pending_approval' check (status in ('pending_approval','active','retired')),
  created_by uuid references users(id),
  approved_by uuid references users(id),
  created_at timestamptz not null default now(),
  check ((kind='percent' and percent_bps between 0 and 10000) or (kind='fixed' and fixed_amount >= 0))
);

-- fleets / corporate
create table fleets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references users(id),
  revenue_share_bps int not null default 0 check (revenue_share_bps between 0 and 10000),
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  created_at timestamptz not null default now()
);
create table fleet_members (
  fleet_id uuid not null references fleets(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'manager',
  primary key (fleet_id, user_id)
);
create table corporate_accounts (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  tin text,
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  billing_mode text not null default 'payg' check (billing_mode in ('prepaid','payg','credit')),
  credit_limit int not null default 0,
  monthly_budget int,
  policy jsonb not null default '{}',      -- {max_fare, allowed_services[], start_hour, end_hour}
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create table corporate_members (
  corporate_id uuid not null references corporate_accounts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'employee' check (role in ('admin','booker','employee')),
  spending_limit int,
  cost_centre text,
  active boolean not null default true,
  primary key (corporate_id, user_id)
);
create table corporate_invoices (
  id uuid primary key default gen_random_uuid(),
  corporate_id uuid not null references corporate_accounts(id),
  period_start date not null, period_end date not null,
  total_amount bigint not null,
  trip_count int not null,
  status text not null default 'issued' check (status in ('draft','issued','paid','void')),
  created_at timestamptz not null default now(),
  unique (corporate_id, period_start, period_end)
);

-- drivers & vehicles
create table driver_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  status text not null default 'APPLICATION_STARTED' check (status in
    ('APPLICATION_STARTED','DOCUMENTS_SUBMITTED','UNDER_REVIEW','INFO_REQUIRED','APPROVED','REJECTED','SUSPENDED','EXPIRED_INELIGIBLE','DEACTIVATED')),
  status_reason text,
  legal_name text,
  national_id_enc text,
  emergency_contact_enc text,
  fleet_id uuid references fleets(id),
  zone_id text references service_zones(id),
  preferred_hours jsonb,
  payout_provider text,
  payout_msisdn text,
  is_online boolean not null default false,
  last_lat double precision, last_lng double precision,
  last_location_at timestamptz,
  last_seen_at timestamptz,
  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  offers_count int not null default 0,
  accepted_count int not null default 0,
  rejected_count int not null default 0,
  cancel_count int not null default 0,
  completed_count int not null default 0,
  last_trip_at timestamptz,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references driver_profiles(user_id),
  fleet_id uuid references fleets(id),
  vehicle_type text not null check (vehicle_type in ('moto','car','minivan','pickup','truck')),
  comfort boolean not null default false,
  make text, model text, color text, year int,
  plate text not null unique,
  capacity int not null default 1,
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  created_at timestamptz not null default now()
);
create unique index one_active_vehicle_per_driver on vehicles(driver_id) where status = 'approved';
create table document_requirements (
  id serial primary key,
  vehicle_type text not null,
  doc_type text not null,
  mandatory boolean not null default true,
  requires_expiry boolean not null default true,
  unique (vehicle_type, doc_type)
);
create table driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references driver_profiles(user_id) on delete cascade,
  doc_type text not null,
  file_key text not null,
  mime text not null, size int not null,
  expiry_date date,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected','resubmit')),
  reviewer_id uuid references users(id),
  review_note text,
  reviewed_at timestamptz,
  superseded boolean not null default false,
  reminder_sent_days int,
  created_at timestamptz not null default now()
);
create index driver_docs on driver_documents(driver_id) where not superseded;
create table driver_status_history (
  id bigserial primary key,
  driver_id uuid not null references driver_profiles(user_id) on delete cascade,
  from_status text, to_status text not null, reason text, actor_id uuid,
  created_at timestamptz not null default now()
);

-- pricing quotes & bookings
create table fare_quotes (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references users(id),
  service_id text not null references service_categories(id),
  zone_id text not null references service_zones(id),
  pickup_lat double precision not null, pickup_lng double precision not null,
  dest_lat double precision not null, dest_lng double precision not null,
  distance_m int not null, duration_s int not null,
  route_source text not null,
  rule_id uuid not null references pricing_rules(id),
  rule_version int not null,
  promo_code text,
  breakdown jsonb not null,
  total int not null,
  scheduled_for timestamptz,
  expires_at timestamptz not null,
  used_booking_id uuid,
  created_at timestamptz not null default now()
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  passenger_id uuid not null references users(id),
  driver_id uuid references driver_profiles(user_id),
  vehicle_id uuid references vehicles(id),
  service_id text not null references service_categories(id),
  zone_id text not null references service_zones(id),
  status text not null check (status in (
    'DRAFT','FARE_ESTIMATED','REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED',
    'AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS','COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED',
    'CANCELLATION_REQUESTED','CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER','CANCELLED_BY_SYSTEM',
    'DISPUTED','REFUNDED','PARTIALLY_REFUNDED','PAYMENT_REVERSED','NO_DRIVER_FOUND','SCHEDULED')),
  pickup_lat double precision not null, pickup_lng double precision not null,
  pickup_name text, pickup_note text,
  dest_lat double precision not null, dest_lng double precision not null,
  dest_name text,
  quote_id uuid not null references fare_quotes(id),
  estimated_fare int not null,
  final_fare int,
  fare_breakdown jsonb,
  distance_m int, duration_s int,
  payment_method text not null check (payment_method in ('cash','mtn_momo','airtel_money','corporate','wallet','card')),
  payer_type text not null default 'passenger' check (payer_type in ('passenger','corporate')),
  corporate_id uuid references corporate_accounts(id),
  cost_centre text, po_ref text,
  rider_name text, rider_phone text,
  scheduled_for timestamptz,
  idempotency_key text not null,
  version int not null default 1,
  pin_attempts int not null default 0,
  pin_verified_at timestamptz,
  pin_override_by uuid references users(id),
  waiting_min int not null default 0,
  extra_charges jsonb not null default '[]',
  dispatch_round int not null default 0,
  last_round_at timestamptz,
  search_started_at timestamptz,
  requested_at timestamptz,
  assigned_at timestamptz, arrived_at timestamptz, started_at timestamptz, completed_at timestamptz,
  cancelled_at timestamptz, cancel_by text, cancel_reason text, cancel_fee int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (passenger_id, idempotency_key)
);
-- DB-level guarantees against conflicting assignments
create unique index one_active_trip_per_driver on bookings(driver_id)
  where driver_id is not null and status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS');
create unique index one_active_trip_per_vehicle on bookings(vehicle_id)
  where vehicle_id is not null and status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS');
create unique index one_open_request_per_passenger on bookings(passenger_id)
  where payer_type = 'passenger' and scheduled_for is null and status in
  ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS');
create index bookings_status on bookings(status);
create index bookings_passenger on bookings(passenger_id, created_at desc);
create index bookings_driver on bookings(driver_id, created_at desc);
create index bookings_corp on bookings(corporate_id, created_at desc);

create table booking_events (
  id bigserial primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  type text not null,
  from_status text, to_status text,
  actor_id uuid, actor_role text,
  reason text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index booking_events_b on booking_events(booking_id, id);

create table dispatch_offers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  driver_id uuid not null references driver_profiles(user_id),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','expired','cancelled')),
  round int not null,
  eta_s int, distance_m int,
  driver_net int,
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  reject_reason text,
  excused boolean not null default false,
  unique (booking_id, driver_id)
);
create index offers_driver_pending on dispatch_offers(driver_id) where status = 'pending';

create table driver_locations (
  id bigserial primary key,
  driver_id uuid not null,
  booking_id uuid,
  lat double precision not null, lng double precision not null,
  accuracy real, speed real,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index driver_loc_booking on driver_locations(booking_id, recorded_at);
create index driver_loc_time on driver_locations(received_at);

create table trip_shares (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table ratings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  reviewer_id uuid not null references users(id),
  reviewee_id uuid not null references users(id),
  score int not null check (score between 1 and 5),
  comment text, tags text[],
  created_at timestamptz not null default now(),
  unique (booking_id, reviewer_id)
);

-- payments & ledger
create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  payer_user_id uuid references users(id),
  method text not null check (method in ('cash','mtn_momo','airtel_money','corporate','wallet','card')),
  provider text not null,
  amount int not null check (amount >= 0),
  currency text not null default 'RWF',
  status text not null default 'INITIATED' check (status in ('INITIATED','PENDING','SUCCESS','FAILED','CANCELLED','REVERSED')),
  reference text not null unique,          -- our unique reference (also the MoMo X-Reference-Id)
  provider_reference text,
  msisdn_masked text,
  amount_collected int,
  fee_amount int,
  failure_reason text,
  settlement_status text not null default 'unsettled' check (settlement_status in ('unsettled','settled','not_applicable','invoiced')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index one_live_payment_per_booking on payments(booking_id) where status in ('INITIATED','PENDING','SUCCESS');
create index payments_status on payments(status, created_at);
create table payment_provider_events (
  id bigserial primary key,
  provider text not null,
  event_key text not null unique,          -- idempotency: provider ref + status
  payment_id uuid references payments(id),
  payload jsonb not null,
  verified boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table ledger_accounts (
  code text primary key,
  name text not null,
  type text not null check (type in ('asset','liability','revenue','expense'))
);
create table ledger_entries (
  id bigserial primary key,
  txn_id uuid not null,
  account_code text not null references ledger_accounts(code),
  owner_user_id uuid,
  booking_id uuid,
  payment_id uuid,
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  currency text not null default 'RWF',
  memo text,
  created_at timestamptz not null default now(),
  check (debit = 0 or credit = 0)
);
create index ledger_txn on ledger_entries(txn_id);
create index ledger_owner on ledger_entries(owner_user_id, account_code);
create index ledger_booking on ledger_entries(booking_id);

-- balanced-transaction enforcement (checked at commit)
create or replace function ledger_check_balance() returns trigger language plpgsql as $$
declare d bigint; c bigint;
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from ledger_entries where txn_id = new.txn_id;
  if d <> c then raise exception 'ledger txn % unbalanced: debit % credit %', new.txn_id, d, c; end if;
  return null;
end $$;
create constraint trigger ledger_balanced after insert on ledger_entries
  deferrable initially deferred for each row execute function ledger_check_balance();
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger ledger_immutable before update or delete on ledger_entries for each row execute function forbid_mutation();

create table driver_earnings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id),
  driver_id uuid not null references driver_profiles(user_id),
  fleet_id uuid,
  fare_subtotal int not null,
  discount int not null default 0,
  tax int not null default 0,
  passthrough int not null default 0,
  commissionable int not null,
  commission int not null,
  fleet_share int not null default 0,
  net int not null,
  commission_rule_id uuid,
  payment_method text not null,
  collected_by text not null check (collected_by in ('platform','driver','corporate')),
  created_at timestamptz not null default now()
);
create index earnings_driver on driver_earnings(driver_id, created_at desc);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id),
  kind text not null default 'driver' check (kind in ('driver','fleet')),
  amount int not null check (amount > 0),
  fee int not null default 0,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','REVIEWED','APPROVED','PAID','REJECTED','FAILED')),
  provider text, msisdn text,
  provider_reference text,
  reviewed_by uuid references users(id),
  approved_by uuid references users(id),
  note text,
  requested_at timestamptz not null default now(),
  paid_at timestamptz
);
create table refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  payment_id uuid not null references payments(id),
  amount int not null check (amount > 0),
  reason text not null,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','APPROVED','REJECTED','PROCESSED')),
  driver_clawback int not null default 0,
  requested_by uuid not null references users(id),
  approved_by uuid references users(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create table reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  run_date date not null,
  summary jsonb not null default '{}',
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create table reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reconciliation_runs(id) on delete cascade,
  payment_id uuid,
  provider_reference text,
  kind text not null check (kind in ('MATCHED','MISSING_INTERNAL','MISSING_PROVIDER','AMOUNT_MISMATCH','STATUS_MISMATCH')),
  internal_amount int, provider_amount int,
  resolved boolean not null default false,
  note text
);

-- growth
create table promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null check (kind in ('percent','fixed')),
  value int not null check (value > 0),
  max_discount int,
  min_fare int not null default 0,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  usage_limit int, per_user_limit int not null default 1,
  budget int, spent int not null default 0,
  service_ids text[], zone_ids text[],
  first_ride_only boolean not null default false,
  funding text not null default 'platform',
  user_id uuid references users(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id),
  user_id uuid not null references users(id),
  booking_id uuid not null unique references bookings(id),
  amount int not null,
  created_at timestamptz not null default now()
);
create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references users(id),
  referee_id uuid not null unique references users(id),
  status text not null default 'pending' check (status in ('pending','rewarded','rejected')),
  created_at timestamptz not null default now(),
  check (referrer_id <> referee_id)
);

-- support & safety
create table support_cases (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  booking_id uuid references bookings(id),
  reporter_id uuid not null references users(id),
  category text not null check (category in ('booking','payment','refund','driver_complaint','lost_item','safety','fare_dispute','appeal','account','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','awaiting_user','resolved','closed')),
  subject text not null,
  assigned_to uuid references users(id),
  sensitive boolean not null default false,
  sla_due_at timestamptz not null,
  resolution text,
  csat int check (csat between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table case_events (
  id bigserial primary key,
  case_id uuid not null references support_cases(id) on delete cascade,
  author_id uuid references users(id),
  kind text not null check (kind in ('message','internal_note','status','evidence')),
  body text,
  visibility text not null default 'public' check (visibility in ('public','internal')),
  file_key text,
  created_at timestamptz not null default now()
);
create table safety_incidents (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  booking_id uuid references bookings(id),
  reporter_id uuid not null references users(id),
  kind text not null check (kind in ('sos','accident','harassment','misconduct','lost_property','other')),
  lat double precision, lng double precision,
  description text,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  acknowledged_by uuid references users(id),
  acknowledged_at timestamptz,
  resolution text,
  created_at timestamptz not null default now()
);

-- comms, config, audit
create table notification_templates (
  key text not null, lang text not null,
  title text not null, body text not null,
  primary key (key, lang)
);
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  channel text not null check (channel in ('in_app','sms','push','email','whatsapp')),
  template_key text not null,
  params jsonb not null default '{}',
  title text, body text, lang text,
  critical boolean not null default false,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  attempts int not null default 0,
  error text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notif_user on notifications(user_id, created_at desc);
create index notif_queue on notifications(status) where status = 'queued';
create table feature_flags (
  key text primary key, enabled boolean not null default false, description text,
  updated_by uuid, updated_at timestamptz not null default now()
);
create table system_settings (
  key text primary key, value jsonb not null, description text,
  updated_by uuid, updated_at timestamptz not null default now()
);
create table audit_logs (
  id bigserial primary key,
  actor_id uuid, actor_role text,
  action text not null,
  entity_type text, entity_id text,
  before jsonb, after jsonb, ip text,
  created_at timestamptz not null default now()
);
create index audit_entity on audit_logs(entity_type, entity_id);
create index audit_actor on audit_logs(actor_id, created_at desc);
create trigger audit_immutable before update or delete on audit_logs for each row execute function forbid_mutation();

create table safety_blocks (
  passenger_id uuid not null references users(id),
  driver_id uuid not null references users(id),
  reason text, created_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (passenger_id, driver_id)
);

create table trip_messages (
  id bigserial primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  sender_id uuid not null references users(id),
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index trip_messages_b on trip_messages(booking_id, id);

create table fleet_invites (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references fleets(id) on delete cascade,
  phone text not null check (phone ~ '^\+250[0-9]{9}$'),
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked')),
  created_at timestamptz not null default now(),
  unique (fleet_id, phone)
);
