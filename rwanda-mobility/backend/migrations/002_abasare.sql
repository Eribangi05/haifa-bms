-- Abasare: hire a verified driver to drive YOUR OWN car (designated driver / chauffeur by hour).

alter table service_categories add column kind text not null default 'ride' check (kind in ('ride','abasare'));

-- pricing: night band, driver-return allowance, hourly packages with overtime
alter table pricing_rules
  add column billing text not null default 'distance' check (billing in ('distance','hourly')),
  add column return_per_km int not null default 0 check (return_per_km >= 0),
  add column night_start_hour int check (night_start_hour between 0 and 23),
  add column night_end_hour int check (night_end_hour between 0 and 24),
  add column night_fee int not null default 0 check (night_fee >= 0),
  add column hourly_rate int not null default 0 check (hourly_rate >= 0),
  add column min_hours int not null default 2 check (min_hours >= 1),
  add column max_hours int not null default 12 check (max_hours >= 1),
  add column long_hire_hours int,
  add column long_hire_rate int,
  add column overtime_per_30min int not null default 0 check (overtime_per_30min >= 0),
  add column overtime_grace_min int not null default 10 check (overtime_grace_min >= 0);

alter table fare_quotes add column meta jsonb not null default '{}';

-- the customer's own cars (what the Abasare drives)
create table customer_vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  plate text not null,
  make text, model text, color text, year int,
  vehicle_class text not null check (vehicle_class in ('car','suv','minivan','pickup','moto')),
  transmission text not null check (transmission in ('manual','automatic')),
  insurance_confirmed boolean not null default false,
  insurance_expiry date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (owner_id, plate)
);

alter table bookings
  add column hire_mode text check (hire_mode in ('point_to_point','hourly')),
  add column hours_booked int,
  add column customer_vehicle_id uuid references customer_vehicles(id),
  add column owner_attested_at timestamptz,
  add column overtime_blocks int not null default 0;

-- drivers: Abasare skill profile + what they currently accept
alter table driver_profiles
  add column abasare_status text not null default 'none' check (abasare_status in ('none','pending','approved','rejected','suspended')),
  add column abasare_skills jsonb not null default '{}',     -- {transmissions:[], classes:[], licence_since:'YYYY-MM-DD', years_experience:n, return_mode:'moto|taxi|own|walk'}
  add column abasare_applied_at timestamptz,
  add column abasare_decided_at timestamptz,
  add column abasare_reason text,
  add column accepting text[] not null default '{ride}';

-- check-in / check-out record of the customer's car (protects both sides)
create table abasare_handovers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  phase text not null check (phase in ('pickup','dropoff')),
  odometer_km int check (odometer_km >= 0),
  fuel_percent int check (fuel_percent between 0 and 100),
  notes text,
  damage_noted boolean not null default false,
  submitted_by uuid not null references users(id),
  owner_response text check (owner_response in ('ok','issue')),
  owner_note text,
  owner_responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (booking_id, phase)
);
create table handover_photos (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  phase text not null check (phase in ('pickup','dropoff')),
  file_key text not null,
  uploaded_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index handover_photos_b on handover_photos(booking_id, phase);
