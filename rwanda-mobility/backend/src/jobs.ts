import { dispatchSweep } from './services/dispatch.js';
import { sweepPendingPayments } from './services/payments.js';
import { flushSms } from './services/notify.js';
import { expiryReminders, refreshEligibility } from './services/drivers.js';
import { q } from './db.js';
import { getSetting } from './services/settings.js';

/** In-process scheduler (single instance). For multi-instance deployments run jobs on one worker or use pg-boss; every job is idempotent. */
export function startJobs(log: (m: string) => void = console.log) {
  const guard = (name: string, fn: () => Promise<unknown>) => async () => { try { await fn(); } catch (e: any) { log(`job ${name} failed: ${e.message}`); } };
  const timers = [
    setInterval(guard('dispatch', dispatchSweep), 3_000),
    setInterval(guard('payments', sweepPendingPayments), 30_000),
    setInterval(guard('sms', () => flushSms()), 5_000),
    setInterval(guard('eligibility', async () => { await expiryReminders(); await refreshEligibility(); }), 60 * 60_000),
    setInterval(guard('retention', retention), 6 * 60 * 60_000),
    // stale drivers: no heartbeat for 2 minutes => offline (never trust last-known location)
    setInterval(guard('stale-drivers', () => q("update driver_profiles set is_online=false where is_online and (last_seen_at is null or last_seen_at < now() - interval '2 minutes') and not exists (select 1 from bookings b where b.driver_id=driver_profiles.user_id and b.status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS'))")), 30_000),
  ];
  timers.forEach((t) => t.unref());
  void guard('eligibility', async () => { await expiryReminders(); await refreshEligibility(); })();
  return () => timers.forEach(clearInterval);
}

export async function retention() {
  const days = await getSetting('retention.location_days');
  await q("delete from driver_locations where received_at < now() - make_interval(days => $1)", [days]);
  await q("delete from otp_challenges where created_at < now() - interval '2 days'");
  await q("delete from fare_quotes where expires_at < now() - interval '2 days' and used_booking_id is null");
}
