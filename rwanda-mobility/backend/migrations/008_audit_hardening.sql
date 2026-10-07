-- 008: backend audit follow-ups. Additive and idempotent: indexes for hot paths and foreign keys that had none,
-- and a case-insensitive unique e-mail (staff sign-in matches lower(email), so 'A@x' and 'a@x' must never coexist).

do $$
begin
  if exists (select 1 from users where email is not null group by lower(email) having count(*) > 1) then
    raise notice 'users_email_lower_uniq not created: e-mails that differ only by case exist; merge them and re-run this statement';
  else
    create unique index if not exists users_email_lower_uniq on users (lower(email)) where email is not null;
  end if;
end $$;

-- outbox retry back-off: a failed SMS / push waits 15s, 1m, 2m, 4m before the next attempt instead of being retried every tick
alter table notifications add column if not exists next_attempt_at timestamptz;

-- payout requests: optional Idempotency-Key so a retried / double-tapped request returns the payout already created
alter table payouts add column if not exists idempotency_key text;
create unique index if not exists payouts_idempotency on payouts (owner_user_id, idempotency_key) where idempotency_key is not null;

-- payments are read per booking on every booking view / receipt, and swept by status
create index if not exists payments_booking on payments (booking_id, created_at desc);
create index if not exists payments_sweep on payments (created_at) where status in ('INITIATED', 'PENDING');
-- dispatch: online driver lookups, offer expiry sweep, scheduled release
create index if not exists driver_profiles_online on driver_profiles (zone_id) where is_online;
create index if not exists dispatch_offers_expiry on dispatch_offers (expires_at) where status = 'pending';
create index if not exists bookings_scheduled on bookings (scheduled_for) where status = 'SCHEDULED';
create index if not exists bookings_customer_vehicle on bookings (customer_vehicle_id) where customer_vehicle_id is not null;
-- admin lists and dashboards order / range-scan by created_at (EXPLAIN at 300k bookings: 65 ms parallel seq scan + sort -> index scan)
create index if not exists bookings_created on bookings (created_at desc);
create index if not exists bookings_status_created on bookings (status, created_at desc);
-- foreign keys / lookups without an index
create index if not exists ratings_reviewee on ratings (reviewee_id);
create index if not exists promo_redemptions_promo_user on promotion_redemptions (promotion_id, user_id);
create index if not exists case_events_case on case_events (case_id, id);
create index if not exists support_cases_reporter on support_cases (reporter_id, created_at desc);
create index if not exists support_cases_open_sla on support_cases (sla_due_at) where status in ('open', 'in_progress', 'awaiting_user');
create index if not exists refunds_booking on refunds (booking_id);
create index if not exists payouts_owner on payouts (owner_user_id, requested_at desc);
create index if not exists corporate_members_user on corporate_members (user_id) where active;
create index if not exists fleet_invites_phone on fleet_invites (phone) where status = 'pending';
create index if not exists driver_earnings_fleet on driver_earnings (fleet_id) where fleet_id is not null;
create index if not exists vehicles_driver on vehicles (driver_id);
create index if not exists vehicles_fleet on vehicles (fleet_id) where fleet_id is not null;
create index if not exists driver_profiles_fleet on driver_profiles (fleet_id) where fleet_id is not null;
create index if not exists trip_shares_booking on trip_shares (booking_id);
create index if not exists consents_user on consents (user_id);
create index if not exists saved_places_user on saved_places (user_id);
-- retention jobs delete by age
create index if not exists sessions_expiry on sessions (expires_at);
create index if not exists sessions_revoked on sessions (revoked_at) where revoked_at is not null;
create index if not exists notifications_created on notifications (created_at);
create index if not exists otp_created on otp_challenges (created_at);
create index if not exists fare_quotes_expiry on fare_quotes (expires_at) where used_booking_id is null;
