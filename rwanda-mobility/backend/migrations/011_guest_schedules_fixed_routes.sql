-- 011: ride for someone else (guest), recurring rides, fixed-price routes. Additive and idempotent.

-- ---------- ride for someone else ----------
-- The booker stays the payer and the passenger_id. The guest's phone is kept only as long as the trip needs it (purged by the retention job).
alter table bookings add column if not exists guest_name text;
alter table bookings add column if not exists guest_phone text;
alter table bookings add column if not exists guest_lang text;
alter table bookings add column if not exists guest_purged_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_guest_lang_check') then
    alter table bookings add constraint bookings_guest_lang_check check (guest_lang is null or guest_lang in ('rw','fr','en'));
  end if;
end $$;
create index if not exists bookings_guest_phone on bookings (guest_phone, created_at desc) where guest_phone is not null;
create index if not exists bookings_guest_active on bookings (passenger_id) where guest_phone is not null;

-- SMS to the guest (simulated until an SMS provider is connected). One row per message; the phone is read from the booking at send time.
create table if not exists guest_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  kind text not null check (kind in ('assigned','arrived','cancelled')),
  dedupe_key text not null,
  lang text not null,
  body text,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  attempts int not null default 0,
  error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (booking_id, dedupe_key)
);
create index if not exists guest_messages_queue on guest_messages (created_at) where status = 'queued';

-- ---------- recurring rides ----------
create table if not exists ride_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text,
  service_id text not null references service_categories(id),
  customer_vehicle_id uuid references customer_vehicles(id) on delete set null,
  hours int,
  owner_attested boolean not null default false,
  pickup_lat double precision not null, pickup_lng double precision not null, pickup_name text,
  dest_lat double precision not null, dest_lng double precision not null, dest_name text,
  days_of_week smallint[] not null check (cardinality(days_of_week) between 1 and 7),
  local_time text not null check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  start_date date not null,
  end_date date,
  status text not null default 'active' check (status in ('active','paused','ended')),
  skip_dates date[] not null default '{}',
  payment_method text not null default 'cash' check (payment_method in ('cash','mtn_momo')),
  expected_total int,
  expected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ride_schedules_user on ride_schedules (user_id, created_at desc);
create index if not exists ride_schedules_active on ride_schedules (status) where status = 'active';
create table if not exists ride_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references ride_schedules(id) on delete cascade,
  occurrence_date date not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','booked','price_changed','no_coverage','failed')),
  booking_id uuid references bookings(id) on delete set null,
  quoted_total int,
  detail text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, occurrence_date)
);

-- ---------- fixed-price routes (airport, intercity) ----------
create table if not exists fixed_routes (
  id uuid primary key default gen_random_uuid(),
  name_en text not null, name_rw text not null, name_fr text not null,
  from_place_id uuid references places(id) on delete set null,
  from_lat double precision not null, from_lng double precision not null, from_radius_m int not null default 1500 check (from_radius_m between 100 and 50000),
  to_place_id uuid references places(id) on delete set null,
  to_lat double precision not null, to_lng double precision not null, to_radius_m int not null default 1500 check (to_radius_m between 100 and 50000),
  service_id text not null references service_categories(id),
  price int not null check (price > 0 and price <= 10000000),
  bidirectional boolean not null default true,
  active boolean not null default false,
  valid_from timestamptz,
  valid_to timestamptz,
  placeholder boolean not null default false,
  pending jsonb,                       -- proposed price / activation waiting for a second person (maker-checker)
  proposed_by uuid references users(id),
  proposed_at timestamptz,
  approved_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fixed_routes_active on fixed_routes (service_id) where active;

-- PLACEHOLDER routes (Kigali Airport, Musanze, Huye, Rubavu) are seeded INACTIVE by seedGrowth() in src/services/growthSeed.ts, after the services exist.
