-- 016: USSD booking channel. Additive and idempotent.

alter table bookings add column if not exists channel text not null default 'app';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_channel_check') then
    alter table bookings add constraint bookings_channel_check check (channel in ('app','ussd','web'));
  end if;
end $$;
create index if not exists bookings_channel on bookings(channel, created_at desc) where channel <> 'app';

-- language and terms are remembered per phone number (the phone is verified by the telecom, so no OTP)
create table if not exists ussd_phones (
  phone text primary key check (phone ~ '^\+250[0-9]{9}$'),
  language text check (language in ('rw','fr','en')),
  terms_accepted_at timestamptz,
  user_id uuid references users(id),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- one row per USSD dialogue. The state machine position and what the user picked live in `state`; expired rows are purged by the retention job.
create table if not exists ussd_sessions (
  session_id text primary key,
  phone text not null,
  provider text not null default 'africastalking',
  service_code text,
  step text not null default 'start',
  state jsonb not null default '{}',
  language text,
  last_text text,
  last_response text,
  screens int not null default 0,
  outcome text,                                              -- booked | cancelled | abandoned | error | null while open
  booking_id uuid references bookings(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ussd_sessions_phone on ussd_sessions(phone, created_at desc);
create index if not exists ussd_sessions_created on ussd_sessions(created_at desc);
