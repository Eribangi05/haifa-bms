import { dispatchSweep } from './services/dispatch.js';
import { sweepPendingPayments } from './services/payments.js';
import { flushSms } from './services/notify.js';
import { flushPush, checkPushReceipts } from './services/push.js';
import { expiryReminders, refreshEligibility } from './services/drivers.js';
import { q, pool } from './db.js';
import { getSetting } from './services/settings.js';
import { deleteFileByKey } from './services/storage.js';
import { creditSweep } from './services/credit.js';
import { depositSweep } from './services/deposit.js';
import { claimsSweep } from './services/claims.js';
import { purgeUssdSessions } from './services/ussd.js';
import { registerGrowthJobs, growthRetention } from './services/growthJobs.js';
import { runSafetyChecks } from './services/safety.js';
import { fraudSweep } from './services/fraud.js';

/** Last-run bookkeeping for every job, exposed through /ready and the system-health endpoint. */
type JobState = { runs: number; failures: number; last_start: number | null; last_ok: number | null; last_error: string | null; running: boolean; every_ms: number };
const jobState = new Map<string, JobState>();
let jobsStarted = false;

export function jobHealth() {
  const now = Date.now();
  return {
    started: jobsStarted,
    jobs: Object.fromEntries([...jobState].map(([name, j]) => [name, {
      runs: j.runs, failures: j.failures, running: j.running, last_error: j.last_error,
      last_ok_age_s: j.last_ok ? Math.round((now - j.last_ok) / 1000) : null,
      // a job is stale when it has not succeeded for 10 intervals (and at least 2 minutes); the first run gets that long to complete too
      stale: now - (j.last_ok ?? startedAt) > Math.max(120_000, j.every_ms * 10),
    }])),
  };
}
let startedAt = Date.now();

/**
 * Runs `fn` under a cluster-wide advisory lock so that two API instances never run the same job at once
 * (SMS and push flushing would otherwise double-send). Returns false when another instance holds the lock.
 */
async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<{ ran: boolean }> {
  const c = await pool.connect();
  try {
    const got = (await c.query('select pg_try_advisory_lock(hashtext($1)) ok', [`job:${name}`])).rows[0].ok;
    if (!got) return { ran: false };
    try { await fn(); } finally { await c.query('select pg_advisory_unlock(hashtext($1))', [`job:${name}`]).catch(() => {}); }
    return { ran: true };
  } finally { c.release(); }
}

/**
 * In-process scheduler. Each job never overlaps itself (a slow run skips the next tick), takes a cluster-wide lock, and records its health.
 * Every job is idempotent, so a missed or repeated tick is harmless.
 */
export function startJobs(log: (m: string) => void = console.log) {
  jobsStarted = true; startedAt = Date.now();
  const timers: NodeJS.Timeout[] = [];
  const every = (name: string, ms: number, fn: () => Promise<unknown>) => {
    const st: JobState = { runs: 0, failures: 0, last_start: null, last_ok: null, last_error: null, running: false, every_ms: ms };
    jobState.set(name, st);
    const tick = async () => {
      if (st.running) return;
      st.running = true; st.last_start = Date.now();
      try {
        const r = await withJobLock(name, fn);
        if (r.ran) { st.runs++; st.last_ok = Date.now(); st.last_error = null; } else st.last_ok = Date.now();   // another instance is running it: healthy
      } catch (e: any) { st.failures++; st.last_error = String(e.message).slice(0, 200); log(`job ${name} failed: ${e.message}`); }
      finally { st.running = false; }
    };
    timers.push(setInterval(tick, ms));
    return tick;
  };
  every('dispatch', 3_000, dispatchSweep);
  every('payments', 30_000, sweepPendingPayments);
  every('sms', 5_000, () => flushSms());
  every('deposits', 20_000, depositSweep);          // round 3: Abasare deposits (verify, time out, expire)
  every('credit', 10 * 60_000, creditSweep);        // credit expiry and reminders
  every('fraud_alerts', 5 * 60_000, fraudSweep);    // bursts of fraud signals / failed payments raise a staff alert
  every('claims', 5 * 60_000, claimsSweep);         // claim SLA warnings, reminders, auto-close
  every('push', 3_000, () => flushPush());
  every('push-receipts', 60_000, () => checkPushReceipts());
  const eligibility = every('eligibility', 60 * 60_000, async () => { await expiryReminders(); await refreshEligibility(); });
  every('retention', 6 * 60 * 60_000, retention);
  registerGrowthJobs(every);   // guest SMS, recurring rides, quests, campaigns
  // stale drivers: no heartbeat for 2 minutes => offline (never trust last-known location)
  every('safety-checks', 30_000, runSafetyChecks);   // route deviation / long stop: "Are you OK?" and escalation
  every('stale-drivers', 30_000, () => q("update driver_profiles set is_online=false where is_online and (last_seen_at is null or last_seen_at < now() - interval '2 minutes') and not exists (select 1 from bookings b where b.driver_id=driver_profiles.user_id and b.status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS'))"));
  timers.forEach((t) => t.unref());
  void eligibility();
  return () => { timers.forEach(clearInterval); jobsStarted = false; };
}

/** Deletes in slices so one purge of a large backlog never runs into the statement timeout or holds long locks. `table`/`where` are constants of this file. */
async function deleteInBatches(table: string, where: string, params: unknown[] = [], slice = 5000) {
  for (;;) {
    const r = await pool.query(`delete from ${table} where ctid in (select ctid from ${table} where ${where} limit ${slice})`, params);
    if ((r.rowCount ?? 0) < slice) return;
  }
}

export async function retention() {
  await growthRetention();   // guest name/phone, campaign recipients, schedule runs
  const [days, notifDays, sessionDays] = await Promise.all([getSetting('retention.location_days'), getSetting('retention.notification_days'), getSetting('retention.session_days')]);
  await purgeUssdSessions().catch(() => {});
  await deleteInBatches('driver_locations', 'received_at < now() - make_interval(days => $1)', [days]);
  await q("delete from otp_challenges where created_at < now() - interval '2 days'");
  await purgeHandoverPhotos();
  await purgeClientErrors();
  await q("delete from push_tokens where revoked_at < now() - interval '30 days'");
  await q("delete from fare_quotes where expires_at < now() - interval '2 days' and used_booking_id is null");
  // Delivered/finished notifications carry names and plates; sessions pile up (one per token refresh); invites and share links hold emails / tokens.
  await deleteInBatches('notifications', "created_at < now() - make_interval(days => $1) and status <> 'queued'", [notifDays]);
  await deleteInBatches('sessions', 'revoked_at < now() - make_interval(days => $1) or expires_at < now() - make_interval(days => $1)', [sessionDays]);
  await q("delete from staff_invites where coalesce(used_at, revoked_at, expires_at) < now() - interval '30 days'");
  await q("delete from trip_shares where expires_at < now() - interval '7 days'");
}

/** Car check-in/out photos can show personal belongings: purge after the retention period unless the booking has an open case. */
export async function purgeHandoverPhotos() {
  const days = await getSetting('retention.handover_days');
  const rows = await q<{ id: string; file_key: string }>(
    `select p.id, p.file_key from handover_photos p where p.created_at < now() - make_interval(days => $1)
       and not exists (select 1 from support_cases c where c.booking_id=p.booking_id and c.status in ('open','in_progress','awaiting_user'))
       and not exists (select 1 from bookings b where b.id=p.booking_id and b.status='DISPUTED')
       and not exists (select 1 from claims cl where cl.booking_id=p.booking_id and cl.status in ('submitted','under_review','info_requested','accepted','partially_accepted','rejected','settled'))`, [days]);   // evidence for a claim is kept until the claim is closed
  for (const r of rows) { await deleteFileByKey(r.file_key); await q('delete from handover_photos where id=$1', [r.id]); }
  return rows.length;
}

/** Client error reports are diagnostics only: keep them for a short period. */
export async function purgeClientErrors() {
  const days = await getSetting('retention.client_error_days');
  const r = await q('delete from client_errors where created_at < now() - make_interval(days => $1) returning id', [days]);
  return r.length;
}
