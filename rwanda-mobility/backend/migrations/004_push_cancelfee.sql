-- 004: push notifications, client error reports, passenger cancellation-fee debts

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android','ios','web')),
  device_id text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index push_tokens_user on push_tokens(user_id) where revoked_at is null;

-- Expo push tickets awaiting a delivery receipt (receipts are how DeviceNotRegistered is reported reliably)
create table push_tickets (
  ticket_id text primary key,
  token_id uuid references push_tokens(id) on delete cascade,
  notification_id uuid references notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index push_tickets_unchecked on push_tickets(created_at) where checked_at is null;

create table client_errors (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  message text not null,
  stack text,
  app_version text,
  platform text,
  screen text,
  lang text,
  created_at timestamptz not null default now()
);
create index client_errors_created on client_errors(created_at desc);

-- A passenger's unpaid cancellation / no-show fee. One debt per cancelled booking (idempotent).
create table passenger_debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  booking_id uuid not null unique references bookings(id),         -- the cancelled booking that caused the fee
  kind text not null default 'cancellation_fee' check (kind in ('cancellation_fee','no_show_fee')),
  amount int not null check (amount > 0),
  status text not null default 'open' check (status in ('open','settled','waived')),
  applied_booking_id uuid references bookings(id),                 -- the booking whose quote currently carries this debt
  settled_booking_id uuid references bookings(id),
  waived_by uuid references users(id),
  waive_reason text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  waived_at timestamptz
);
create index passenger_debts_open on passenger_debts(user_id) where status = 'open';
create index passenger_debts_applied on passenger_debts(applied_booking_id) where applied_booking_id is not null;

insert into ledger_accounts(code, name, type) values
  ('PASSENGER_RECEIVABLE', 'Passenger cancellation fees receivable', 'asset'),
  ('CANCELLATION_FEE_REVENUE', 'Cancellation and no-show fee revenue', 'revenue'),
  ('CANCELLATION_FEE_WAIVED', 'Cancellation fees waived by staff', 'expense')
on conflict do nothing;
