-- 014: customer credit (NOT a cash wallet: no cash-in, no cash-out), loyalty points and the Abasare pay-before-trip deposit.
-- Additive and idempotent. Credit is a liability on the ledger (WALLET_CREDIT); credit reserved for an open booking sits in WALLET_HELD;
-- deposits sit in DEPOSIT_HELD until the fare is settled. Every balance below is reconcilable against the ledger (see services/credit.ts).

insert into ledger_accounts(code, name, type) values
  ('WALLET_CREDIT', 'Customer credit balances (spendable on trips only, not withdrawable)', 'liability'),
  ('WALLET_HELD', 'Customer credit reserved for open bookings', 'liability'),
  ('DEPOSIT_HELD', 'Abasare deposits held until the trip is settled', 'liability'),
  ('CREDIT_EXPIRED_REVENUE', 'Customer credit that expired unused', 'revenue'),
  ('LOYALTY_EXPENSE', 'Loyalty points redeemed as credit', 'expense'),
  ('CLAIMS_EXPENSE', 'Damage, loss and injury claim settlements', 'expense')
on conflict do nothing;

-- one row per grant of credit: lets credit expire FIFO and be returned to the right lot when a reservation is released
create table if not exists wallet_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  amount int not null check (amount > 0),
  remaining int not null check (remaining >= 0),
  source text not null,
  expires_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  check (remaining <= amount)
);
create index if not exists wallet_lots_user on wallet_lots(user_id, expires_at nulls last);
create index if not exists wallet_lots_expiry on wallet_lots(expires_at) where remaining > 0 and expires_at is not null;

-- the user-facing statement. available_delta / held_delta are the signed effect on the two balances; *_after are running balances.
create table if not exists wallet_txns (
  id bigserial primary key,
  user_id uuid not null references users(id),
  kind text not null check (kind in ('credit','debit','hold','release','spend','expire')),
  source text,                                 -- refund | promo | referral | quest | claim | adjustment | loyalty | deposit_refund | booking
  available_delta int not null default 0,
  held_delta int not null default 0,
  available_after int not null,
  held_after int not null,
  booking_id uuid references bookings(id),
  ref_type text, ref_id text,
  memo text,
  idem_key text,
  ledger_txn_id uuid,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists wallet_txns_user on wallet_txns(user_id, id desc);
create unique index if not exists wallet_txns_idem on wallet_txns(user_id, idem_key) where idem_key is not null;

-- credit reserved for one booking while it is open
create table if not exists wallet_holds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id),
  user_id uuid not null references users(id),
  amount int not null check (amount > 0),
  remaining int not null check (remaining >= 0),           -- what is still in WALLET_HELD for this booking
  allocations jsonb not null default '[]',                   -- [{lot, amount}] so a release goes back to the same lots
  status text not null default 'held' check (status in ('held','captured','settled','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wallet_holds_user on wallet_holds(user_id) where status in ('held','captured');

-- staff-made credit changes. Small ones apply at once; large ones wait for a second person (maker-checker).
create table if not exists wallet_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  amount int not null check (amount <> 0),
  source text not null default 'adjustment' check (source in ('adjustment','promo','quest','goodwill')),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','applied','rejected')),
  requested_by uuid not null references users(id),
  decided_by uuid references users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists wallet_adjustments_status on wallet_adjustments(status, created_at desc);

-- loyalty points
create table if not exists loyalty_accounts (
  user_id uuid primary key references users(id),
  points int not null default 0 check (points >= 0),
  lifetime_points int not null default 0,
  tier text not null default 'bronze' check (tier in ('bronze','silver','gold')),
  updated_at timestamptz not null default now()
);
create table if not exists loyalty_events (
  id bigserial primary key,
  user_id uuid not null references users(id),
  kind text not null check (kind in ('earn','redeem','adjust')),
  points int not null,
  booking_id uuid references bookings(id),
  memo text,
  idem_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists loyalty_earn_once on loyalty_events(booking_id) where kind = 'earn' and booking_id is not null;
create unique index if not exists loyalty_idem on loyalty_events(user_id, idem_key) where idem_key is not null;
create index if not exists loyalty_events_user on loyalty_events(user_id, id desc);

-- how a booking is paid when credit and/or a deposit is involved
alter table bookings add column if not exists wallet_mode text check (wallet_mode in ('full','partial'));
alter table bookings add column if not exists wallet_reserved int not null default 0;
alter table bookings add column if not exists wallet_applied int not null default 0;
alter table bookings add column if not exists deposit_applied int not null default 0;

-- a refund can be issued as customer credit instead of through the original payment method
alter table refunds add column if not exists as_credit boolean not null default false;

-- Abasare deposit (pay before the trip is dispatched). Not stored in `payments`: that table allows one live payment per booking (the fare).
create table if not exists booking_deposits (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id),
  user_id uuid not null references users(id),
  percent int not null check (percent between 1 and 100),
  amount int not null check (amount > 0),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','pending','paid','failed','expired','cancelled','captured','applied','refunded')),
  held int not null default 0 check (held >= 0),            -- what is still in DEPOSIT_HELD for this booking
  applied int not null default 0,
  refunded int not null default 0,
  retained int not null default 0,                           -- kept as cancellation fee
  expires_at timestamptz not null,
  paid_at timestamptz,
  paid_with text,                                            -- mtn_momo | wallet
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists booking_deposits_open on booking_deposits(expires_at) where status in ('awaiting_payment','pending','failed');
create table if not exists deposit_attempts (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references booking_deposits(id),
  reference text not null unique,
  method text not null,
  status text not null default 'initiated' check (status in ('initiated','pending','success','failed','cancelled','late_credited')),
  msisdn_masked text,
  provider_reference text,
  failure_reason text,
  amount int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deposit_attempts_deposit on deposit_attempts(deposit_id, created_at desc);
create index if not exists deposit_attempts_open on deposit_attempts(created_at) where status in ('initiated','pending') or failure_reason = 'timeout';
