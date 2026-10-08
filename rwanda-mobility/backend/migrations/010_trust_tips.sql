-- 010: tips and tagged ratings, favourite / blocked drivers, driver badges. Additive and idempotent.

-- payments gain a kind: a tip is a second, separate payment on the same booking (never part of the fare, never commissioned)
alter table payments add column if not exists kind text not null default 'fare';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_kind_chk') then
    alter table payments add constraint payments_kind_chk check (kind in ('fare', 'tip'));
  end if;
end $$;
drop index if exists one_live_payment_per_booking;
create unique index if not exists one_live_fare_payment_per_booking on payments (booking_id) where kind = 'fare' and status in ('INITIATED', 'PENDING', 'SUCCESS');
create unique index if not exists one_live_tip_payment_per_booking on payments (booking_id) where kind = 'tip' and status in ('INITIATED', 'PENDING', 'SUCCESS');

-- one tip per booking. mtn_momo tips have a payment row (ledger-backed); cash tips are informational only (the driver was handed the cash directly)
create table if not exists tips (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id),
  passenger_id uuid not null references users(id),
  driver_id uuid not null references users(id),
  amount int not null check (amount > 0),
  method text not null check (method in ('mtn_momo', 'cash_tip')),
  payment_id uuid references payments(id),
  created_at timestamptz not null default now()
);
create index if not exists tips_driver on tips (driver_id, created_at desc);

-- favourite and blocked drivers (private to the passenger: the driver is never told)
create table if not exists passenger_driver_prefs (
  passenger_id uuid not null references users(id) on delete cascade,
  driver_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('favourite', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (passenger_id, driver_id)
);
create index if not exists passenger_driver_prefs_driver on passenger_driver_prefs (driver_id, kind);
alter table bookings add column if not exists prefer_favourite boolean not null default true;

-- badges that staff grant (training); every other badge is computed from approved documents and real data
create table if not exists driver_badge_grants (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references driver_profiles(user_id) on delete cascade,
  badge text not null check (badge in ('training_completed')),
  reason text not null,
  granted_by uuid references users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references users(id),
  revoke_reason text
);
create unique index if not exists driver_badge_grants_active on driver_badge_grants (driver_id, badge) where revoked_at is null;
create index if not exists ratings_reviewer on ratings (reviewer_id);
