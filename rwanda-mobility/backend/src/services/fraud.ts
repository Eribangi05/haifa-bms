import { q, q1, type Db, pool } from '../db.js';
import { AppError } from '../errors.js';
import { getSetting } from './settings.js';
import { raiseAlert } from './alerts.js';

/** Fraud and abuse signals. Everything here is recorded in risk_events (visible to staff) and acted on by small, explainable rules. */
export async function recordRisk(userId: string | null, kind: string, detail: Record<string, unknown> = {}, db: Db = pool) {
  await q('insert into risk_events(user_id, kind, detail) values ($1,$2,$3)', [userId, kind, JSON.stringify(detail)], db);
}

/**
 * Cancel-and-rebook loop: a rider who cancels N times inside a window is paused for a few minutes (people hunting for a closer driver tie up drivers
 * and waste offers). The pause is announced with a clear message and a retry time; support can still book on their behalf.
 */
export async function cancelLoopCheck(passengerId: string) {
  const [count, windowMin, blockMin] = await Promise.all([getSetting('fraud.cancel_loop_count'), getSetting('fraud.cancel_loop_window_min'), getSetting('fraud.cancel_loop_block_min')]);
  const rows = await q<{ cancelled_at: string }>(
    `select cancelled_at from bookings where passenger_id=$1 and cancel_by='passenger' and cancelled_at > now() - make_interval(mins => $2) order by cancelled_at desc limit $3`,
    [passengerId, windowMin, count]);
  if (rows.length < count) return;
  const last = new Date(rows[0].cancelled_at).getTime();
  const until = last + blockMin * 60_000;
  if (Date.now() >= until) return;                       // the pause since the last cancellation has already passed
  const recent = await q1("select 1 from risk_events where user_id=$1 and kind='cancel_loop' and created_at > now() - make_interval(mins => $2)", [passengerId, blockMin]);
  if (!recent) await recordRisk(passengerId, 'cancel_loop', { cancellations: rows.length, window_min: windowMin });
  throw new AppError(429, 'cancel_loop', 'Too many cancellations', { minutes: Math.max(1, Math.ceil((until - Date.now()) / 60_000)) });
}

/** Phone identifiers seen for this account: the sign-up device and every session's device. */
async function devicesOf(userId: string, db: Db): Promise<string[]> {
  const r = await q<{ d: string }>(
    `select device_fingerprint d from users where id=$1 and device_fingerprint is not null
     union select device_id from sessions where user_id=$1 and device_id is not null`, [userId], db);
  return r.map((x) => x.d);
}

/** One promo code, one account per phone: true when this account may use the promo (not already used by a different account on the same phone). */
export async function promoDeviceOk(promotionId: string, userId: string, db: Db = pool): Promise<boolean> {
  const limit = await getSetting('fraud.promo_accounts_per_device');
  const devs = await devicesOf(userId, db);
  if (!devs.length) return true;
  const r = await q1<{ n: number }>(
    `select count(distinct r.user_id)::int n from promotion_redemptions r
     where r.promotion_id=$1 and r.user_id <> $2 and (
       r.device_id = any($3) or exists (select 1 from sessions s where s.user_id=r.user_id and s.device_id = any($3)) or exists (select 1 from users u where u.id=r.user_id and u.device_fingerprint = any($3)))`,
    [promotionId, userId, devs], db);
  if ((r?.n ?? 0) >= limit) { await recordRisk(userId, 'promo_device', { promotion_id: promotionId, other_accounts: r!.n }, db); return false; }
  return true;
}

/** Called by the hourly job: a burst of fraud signals or failed payments raises one alert for staff. */
export async function fraudSweep() {
  const [perHour, payFail] = await Promise.all([getSetting('alerts.fraud_events_per_hour'), getSetting('alerts.payment_failures_per_hour')]);
  const f = await q1<{ n: number }>("select count(*)::int n from risk_events where created_at > now() - interval '1 hour'");
  if ((f?.n ?? 0) >= perHour) await raiseAlert({ kind: 'fraud_burst', severity: 'warning', title: `${f!.n} fraud signals in the last hour`, detail: { count: f!.n }, dedupe: `fraud_burst:${new Date().toISOString().slice(0, 13)}` });
  const p = await q1<{ n: number }>("select count(*)::int n from payments where status='FAILED' and created_at > now() - interval '1 hour'");
  if ((p?.n ?? 0) >= payFail) await raiseAlert({ kind: 'payment_failures', severity: 'critical', title: `${p!.n} failed payments in the last hour`, detail: { count: p!.n }, dedupe: `pay_fail:${new Date().toISOString().slice(0, 13)}` });
}
