-- Passenger-proposed fares with one driver counter-offer. Off unless the flag pricing.negotiated is on.
-- The platform price (the quote) is never changed; when both sides agree the booking's own fare breakdown gets one disclosed "agreed price" line.
alter table bookings
  add column proposed_fare int check (proposed_fare > 0),
  add column agreed_fare int check (agreed_fare > 0),
  add column agreed_by text check (agreed_by in ('driver_accepted_proposal', 'passenger_accepted_counter'));
alter table dispatch_offers
  add column counter_amount int check (counter_amount > 0),
  add column countered_at timestamptz;
create table fare_offers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  offer_id uuid references dispatch_offers(id),
  driver_id uuid references users(id),
  side text not null check (side in ('passenger', 'driver')),
  amount int not null check (amount > 0),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'expired', 'withdrawn')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index fare_offers_booking_idx on fare_offers(booking_id);
create unique index fare_offers_one_open_per_offer on fare_offers(offer_id) where status = 'open' and side = 'driver';
