-- 009: trusted contacts that auto-notify, live-share v2, route-deviation / long-stop safety checks. Additive and idempotent.

-- trusted contacts: opt-in per contact, message language of the contact (they may not speak the passenger's language)
alter table emergency_contacts add column if not exists notify_on_trip boolean not null default false;
alter table emergency_contacts add column if not exists lang text not null default 'rw';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'emergency_contacts_lang_chk') then
    alter table emergency_contacts add constraint emergency_contacts_lang_chk check (lang in ('rw', 'fr', 'en'));
  end if;
end $$;
-- passenger profile preference: master switch for automatic sharing with the contacts that opted in (a contact is still only messaged when notify_on_trip is on)
alter table users add column if not exists auto_share boolean not null default true;

-- per-trip switches and the safety-check cursor
alter table bookings add column if not exists safety_checks boolean not null default true;
alter table bookings add column if not exists auto_share boolean not null default true;
alter table bookings add column if not exists safety_checked_at timestamptz;

-- one share link per contact for automatic sharing; the destination can be withheld
alter table trip_shares add column if not exists contact_id uuid references emergency_contacts(id) on delete set null;
alter table trip_shares add column if not exists hide_destination boolean not null default false;
alter table trip_shares add column if not exists auto boolean not null default false;
create index if not exists trip_shares_contact on trip_shares (contact_id) where contact_id is not null;

-- SMS to someone who is not a user (a trusted contact): the target number lives on the outbox row
alter table notifications add column if not exists to_phone text;

-- numbers that asked to stop receiving trip messages (STOP link on the share page, or recorded by staff)
create table if not exists sms_opt_outs (
  phone text primary key check (phone ~ '^\+250[0-9]{9}$'),
  source text not null default 'contact' check (source in ('contact', 'staff')),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- each trusted-contact message is sent at most once per trip and kind
create table if not exists trip_contact_notices (
  booking_id uuid not null references bookings(id) on delete cascade,
  contact_id uuid not null references emergency_contacts(id) on delete cascade,
  kind text not null check (kind in ('started', 'arrived')),
  created_at timestamptz not null default now(),
  primary key (booking_id, contact_id, kind)
);

-- "Are you OK?" checks raised during an IN_PROGRESS trip
create table if not exists safety_alerts (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  booking_id uuid not null references bookings(id),
  passenger_id uuid not null references users(id),
  driver_id uuid references users(id),
  kind text not null check (kind in ('route_deviation', 'long_stop')),
  status text not null default 'asked' check (status in ('asked', 'ok', 'escalated', 'resolved', 'trip_ended')),
  answer text check (answer in ('ok', 'help')),
  detail jsonb not null default '{}',
  lat double precision, lng double precision,
  asked_at timestamptz not null default now(),
  respond_by timestamptz not null,
  responded_at timestamptz,
  escalated_at timestamptz,
  escalation_reason text check (escalation_reason in ('help', 'no_answer')),
  incident_id uuid references safety_incidents(id),
  case_id uuid references support_cases(id),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now()
);
create index if not exists safety_alerts_booking on safety_alerts (booking_id, kind, asked_at desc);
create index if not exists safety_alerts_due on safety_alerts (respond_by) where status = 'asked';
create index if not exists safety_alerts_status on safety_alerts (status, created_at desc);
