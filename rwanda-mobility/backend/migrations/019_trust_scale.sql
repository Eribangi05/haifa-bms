-- Round 5: spatial cells for fast nearby-driver lookup, gradual feature rollout, fraud signals, staff alerts, chat read state and number privacy,
-- referral rewards and ambassadors, vehicle applications, onboarding SLA. Additive and idempotent.

-- 1) geohash cells of the driver's last position (precision 4 ~ 39x20 km, 5 ~ 5x5 km, 6 ~ 1.2x0.6 km)
alter table driver_profiles add column if not exists gh4 text, add column if not exists gh5 text, add column if not exists gh6 text;
create index if not exists driver_gh5_online on driver_profiles(gh5) where is_online;
create index if not exists driver_gh4_online on driver_profiles(gh4) where is_online;

-- 2) gradual rollout and remote off-switch for features
alter table feature_flags add column if not exists rollout_pct int not null default 100 check (rollout_pct between 0 and 100);
alter table feature_flags add column if not exists disabled_message text;
alter table feature_flags add column if not exists client_visible boolean not null default false;   -- sent to the apps in /config/flags

-- 3) fraud / abuse signals
create table if not exists risk_events (
  id bigserial primary key,
  user_id uuid references users(id),
  kind text not null,                       -- cancel_loop | promo_device | gps_mock | rapid_requests | ...
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists risk_user_kind on risk_events(user_id, kind, created_at desc);
create index if not exists risk_recent on risk_events(created_at desc);
alter table promotion_redemptions add column if not exists device_id text;
create index if not exists promo_redeem_device on promotion_redemptions(promotion_id, device_id) where device_id is not null;

-- 4) alerts for staff (suspicious staff activity, fraud spikes, payment failure bursts)
create table if not exists admin_alerts (
  id bigserial primary key,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  kind text not null,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references users(id),
  dedupe_key text,
  status text not null default 'open' check (status in ('open','acknowledged')),
  created_at timestamptz not null default now(),
  acknowledged_by uuid references users(id),
  acknowledged_at timestamptz
);
create unique index if not exists alert_dedupe_open on admin_alerts(dedupe_key) where status = 'open' and dedupe_key is not null;
create index if not exists alert_status on admin_alerts(status, created_at desc);

-- 5) chat: read receipts, and per-trip consent to share phone numbers (hidden by default)
alter table trip_messages add column if not exists read_at timestamptz;
alter table bookings add column if not exists passenger_shared_phone boolean not null default false;
alter table bookings add column if not exists driver_shared_phone boolean not null default false;

-- 6) referral rewards (paid when the referred person completes a first trip) and ambassadors
alter table referrals add column if not exists reward_referrer int, add column if not exists reward_referee int,
  add column if not exists rewarded_at timestamptz, add column if not exists trigger_booking_id uuid, add column if not exists reject_reason text;
create table if not exists ambassadors (
  user_id uuid primary key references users(id),
  tier text not null default 'bronze' check (tier in ('bronze','silver','gold')),
  status text not null default 'active' check (status in ('active','paused')),
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- 7) vehicle applications by an approved driver who bought a car later; onboarding review SLA
alter table vehicles add column if not exists review_requested_at timestamptz, add column if not exists review_note text;
alter table driver_profiles add column if not exists review_started_at timestamptz;
