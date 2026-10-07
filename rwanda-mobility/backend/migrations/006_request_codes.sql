-- Request codes: printable QR codes placed at venues that let a customer request a ride / Abasare in a couple of taps.
create table request_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6,8}$'),
  label text not null,
  partner_name text,
  lat double precision not null,
  lng double precision not null,
  address_note text,
  default_service text not null default 'ride' check (default_service in ('ride','abasare')),
  pickup_note text,
  active boolean not null default true,
  expires_at timestamptz,
  scans int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table bookings add column request_code_id uuid references request_codes(id);
create index bookings_request_code_idx on bookings (request_code_id) where request_code_id is not null;
