import type { PoolClient } from 'pg';
import { q, q1, tx } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { providerFor, newReference } from '../providers/payment.js';
import { getSetting, flag } from './settings.js';
import { post } from './ledger.js';
import { recordCredit, spendForDeposit, lockUser } from './credit.js';
import { transition } from './bookingMachine.js';
import { startSearch } from './dispatch.js';
import { notify } from './notify.js';
import { normalizePhone } from '../util/phone.js';
import { maskMsisdn } from '../util/money.js';

/**
 * Abasare deposit: when `abasare.deposit_percent` > 0 an Abasare booking is created but NOT dispatched until the deposit is paid
 * (mobile money through the same provider layer as fares, or free credit). Paid deposits sit in DEPOSIT_HELD; completion applies them
 * to the fare (prepaid.ts), cancellation refunds them as credit (minus any late-cancellation fee).
 * Failure handling: failed/timed-out attempts can be retried; a success that arrives after the deposit expired or the booking was
 * cancelled is credited to the customer (never lost, never dispatches). MoMo refunds to the phone are not available: refunds are credit.
 */

/** Inside the booking transaction. Returns the deposit row when one is required. */
export async function requireDeposit(c: PoolClient, b: { id: string; passenger_id: string; estimated_fare: number; corporate_id?: string | null; scheduled_for?: string | Date | null }) {
  const pct = await getSetting('abasare.deposit_percent');
  if (!pct || b.corporate_id) return null;
  const mins = await getSetting('abasare.deposit_timeout_min');
  const amount = Math.max(1, Math.ceil((b.estimated_fare * pct) / 100));
  const exp = b.scheduled_for ? new Date(b.scheduled_for) : new Date(Date.now() + mins * 60_000);
  return (await q<any>(`insert into booking_deposits(booking_id, user_id, percent, amount, expires_at) values ($1,$2,$3,$4,$5) returning *`, [b.id, b.passenger_id, pct, amount, exp], c))[0];
}

export async function depositView(bookingId: string) {
  const d = await q1<any>('select * from booking_deposits where booking_id=$1', [bookingId]);
  if (!d) return null;
  const a = await q1<any>('select status, failure_reason, method from deposit_attempts where deposit_id=$1 order by created_at desc limit 1', [d.id]);
  return { required: true, status: d.status, percent: d.percent, amount: d.amount, held: d.held, applied: d.applied, refunded: d.refunded, retained: d.retained, pay_by: d.expires_at, paid_at: d.paid_at, paid_with: d.paid_with,
    last_attempt: a ? { method: a.method, status: a.status, failure_reason: a.failure_reason } : null };
}

async function ownDeposit(userId: string, bookingId: string, c?: PoolClient) {
  const d = await q1<any>(`select d.*, b.status booking_status, b.passenger_id from booking_deposits d join bookings b on b.id=d.booking_id where d.booking_id=$1${c ? ' for update of d' : ''}`, [bookingId], c);
  if (!d || d.passenger_id !== userId) throw notFound('booking');
  return d;
}
const closedMsg = (d: any) => {
  if (['paid', 'captured', 'applied'].includes(d.status)) throw conflict('deposit_already_paid', 'The deposit is already paid');
  if (['expired', 'cancelled', 'refunded'].includes(d.status) || !['REQUESTED', 'SCHEDULED'].includes(d.booking_status)) throw conflict('deposit_closed', 'This booking no longer needs a deposit');
};

export async function payDeposit(userId: string, bookingId: string, input: { method: 'mtn_momo' | 'wallet'; msisdn?: string }) {
  if (input.method === 'wallet') {
    const started = await tx(async (c) => {
      const d = await ownDeposit(userId, bookingId, c); closedMsg(d);
      await spendForDeposit(c, userId, d.amount, bookingId);
      await markPaid(c, d, 'wallet');
      return d.booking_status === 'REQUESTED';
    });
    if (started) await startSearch(bookingId);
    return depositView(bookingId);
  }
  if (!(await flag('payments.mtn_momo'))) throw badRequest('payment_method_unavailable');
  const msisdn = normalizePhone(input.msisdn ?? '');
  if (!msisdn) throw badRequest('invalid_phone', 'Enter a valid Rwandan mobile money number');
  const prep = await tx(async (c) => {
    const d = await ownDeposit(userId, bookingId, c); closedMsg(d);
    const live = await q1<any>("select * from deposit_attempts where deposit_id=$1 and status in ('initiated','pending') order by created_at desc limit 1 for update", [d.id], c);
    if (live) {
      const stuck = live.status === 'initiated' && Date.now() - new Date(live.updated_at).getTime() > 60_000;
      if (!stuck) return { reuse: true as const };
      await q("update deposit_attempts set status='cancelled', failure_reason='abandoned_before_send', updated_at=now() where id=$1", [live.id], c);
    }
    const a = (await q<any>(`insert into deposit_attempts(deposit_id, reference, method, amount, msisdn_masked) values ($1,$2,'mtn_momo',$3,$4) returning *`, [d.id, newReference(), d.amount, maskMsisdn(msisdn)], c))[0];
    await q("update booking_deposits set status='pending', updated_at=now() where id=$1", [d.id], c);
    return { reuse: false as const, a, d };
  });
  if (prep.reuse) return depositView(bookingId);
  try {
    const r = await providerFor('mtn_momo').initiate({ reference: prep.a.reference, amount: prep.a.amount, msisdn, note: 'Abasare deposit' });
    await q("update deposit_attempts set status='pending', provider_reference=$2, updated_at=now() where id=$1", [prep.a.id, r.providerRef ?? null]);
  } catch {
    await q("update deposit_attempts set status='failed', failure_reason='provider_unreachable', updated_at=now() where id=$1", [prep.a.id]);
    await q("update booking_deposits set status='failed', updated_at=now() where id=$1 and status='pending'", [prep.d.id]);
    await notify(userId, 'deposit_failed', {});
    throw new AppError(502, 'provider_error', 'Could not reach the mobile-money provider. You can retry.');
  }
  await verifyAttempt(prep.a.id, 'initiate');
  return depositView(bookingId);
}

async function markPaid(c: PoolClient, d: any, with_: string) {
  await q("update booking_deposits set status='paid', held=amount, paid_at=now(), paid_with=$2, updated_at=now() where id=$1", [d.id, with_], c);
  await notify(d.user_id, 'deposit_paid', { amount: d.amount }, { db: c });
}

/** Ask the provider about one attempt and apply the result exactly once. Safe to call from callbacks, polling and the sweeper. */
export async function verifyAttempt(attemptId: string, source: string) {
  const a = await q1<any>('select * from deposit_attempts where id=$1', [attemptId]);
  if (!a) throw notFound('payment');
  if (['success', 'cancelled', 'late_credited'].includes(a.status) || (a.status === 'failed' && a.failure_reason !== 'timeout')) return a;
  let st;
  try { st = await providerFor(a.method).status(a.reference); } catch { return a; }
  if (st.status === 'PENDING') return a;
  const key = `deposit:${a.reference}:${st.status}`;
  let start: string | null = null;
  const out = await tx(async (c) => {
    const ev = await q("insert into payment_provider_events(provider, event_key, payload, verified, processed_at) values ($1,$2,$3,true,now()) on conflict (event_key) do nothing returning id", [a.method, key, JSON.stringify({ source, status: st })], c);
    const d = (await q1<any>(`select d.*, b.status booking_status from booking_deposits d join bookings b on b.id=d.booking_id where d.id=$1 for update of d`, [a.deposit_id], c))!;
    const cur = (await q1<any>('select * from deposit_attempts where id=$1 for update', [a.id], c))!;
    if (!ev.length || ['success', 'late_credited'].includes(cur.status)) return cur;
    if (st.status === 'FAILED') {
      await q("update deposit_attempts set status='failed', failure_reason=$2, updated_at=now() where id=$1", [a.id, st.reason ?? 'failed'], c);
      if (['pending', 'awaiting_payment'].includes(d.status) && !(await q1("select 1 from deposit_attempts where deposit_id=$1 and id<>$2 and status in ('initiated','pending')", [d.id, a.id], c))) {
        await q("update booking_deposits set status='failed', updated_at=now() where id=$1", [d.id], c);
        await notify(d.user_id, 'deposit_failed', {}, { db: c });
      }
      return { ...cur, status: 'failed' };
    }
    if (st.amount != null && Number(st.amount) !== cur.amount) {
      await q("update deposit_attempts set status='failed', failure_reason='amount_mismatch', updated_at=now() where id=$1", [a.id], c);
      return { ...cur, status: 'failed', failure_reason: 'amount_mismatch' };
    }
    if (st.fee) await post(c, [{ account: 'PROCESSOR_FEES', debit: st.fee }, { account: 'PROVIDER_CLEARING', credit: st.fee }], { memo: 'processor fee (deposit)', bookingId: d.booking_id });
    const open = ['awaiting_payment', 'pending', 'failed'].includes(d.status) && ['REQUESTED', 'SCHEDULED'].includes(d.booking_status);
    await q("update deposit_attempts set provider_reference=coalesce($2, provider_reference), updated_at=now() where id=$1", [a.id, st.providerRef ?? null], c);
    if (open) {
      await post(c, [{ account: 'PROVIDER_CLEARING', debit: cur.amount }, { account: 'DEPOSIT_HELD', credit: cur.amount, owner: d.user_id }], { memo: 'deposit received', bookingId: d.booking_id });
      await q("update deposit_attempts set status='success', failure_reason=null, updated_at=now() where id=$1", [a.id], c);
      await markPaid(c, d, 'mtn_momo');
      if (d.booking_status === 'REQUESTED') start = d.booking_id;
      return { ...cur, status: 'success' };
    }
    // late success: the money arrived but the deposit/booking is closed. Keep it for the customer as credit, never dispatch.
    await lockUser(c, d.user_id);
    const t = await post(c, [{ account: 'PROVIDER_CLEARING', debit: cur.amount }, { account: 'WALLET_CREDIT', credit: cur.amount, owner: d.user_id }], { memo: 'late deposit payment kept as credit', bookingId: d.booking_id });
    await recordCredit(c, d.user_id, cur.amount, 'deposit_refund', t, { bookingId: d.booking_id, memo: 'Deposit paid after the booking closed' });
    await q("update deposit_attempts set status='late_credited', updated_at=now() where id=$1", [a.id], c);
    await notify(d.user_id, 'deposit_late_credit', { amount: cur.amount }, { db: c });
    return { ...cur, status: 'late_credited' };
  });
  if (start) await startSearch(start).catch(() => {});
  return out;
}

/** Provider callback for a reference that is not a fare payment. Returns null when it is not a deposit either. */
export async function handleDepositCallback(provider: string, reference: string) {
  const a = await q1<any>('select id from deposit_attempts where reference=$1 and method=$2', [reference, provider]);
  if (!a) return null;
  const r = await verifyAttempt(a.id, 'callback');
  return { matched: true, status: r.status };
}

/** Job: settle open attempts, time out slow ones, expire unpaid deposits (cancelling their bookings). */
export async function depositSweep() {
  const open = await q<{ id: string }>("select id from deposit_attempts where created_at > now() - interval '2 days' and (status='pending' or (status='failed' and failure_reason='timeout'))");
  for (const r of open) await verifyAttempt(r.id, 'sweep').catch(() => {});
  await q("update deposit_attempts set status='cancelled', failure_reason='abandoned_before_send', updated_at=now() where status='initiated' and updated_at < now() - interval '5 minutes'");
  const slow = await q<any>("update deposit_attempts set status='failed', failure_reason='timeout', updated_at=now() where status='pending' and created_at < now() - interval '15 minutes' returning deposit_id");
  for (const s of slow) {
    await q(`update booking_deposits d set status='failed', updated_at=now() where d.id=$1 and d.status='pending' and not exists (select 1 from deposit_attempts a where a.deposit_id=d.id and a.status in ('initiated','pending'))`, [s.deposit_id]);
  }
  const due = await q<any>("select d.id, d.booking_id, d.user_id from booking_deposits d where d.status in ('awaiting_payment','pending','failed') and d.expires_at < now()");
  let expired = 0;
  for (const d of due) {
    const ok = await tx(async (c) => {
      const cur = await q1<any>("select * from booking_deposits where id=$1 and status in ('awaiting_payment','pending','failed') for update", [d.id], c);
      if (!cur) return false;
      await q("update booking_deposits set status='expired', updated_at=now() where id=$1", [d.id], c);
      const b = await q1<any>('select status from bookings where id=$1', [d.booking_id], c);
      if (b && ['REQUESTED', 'SCHEDULED'].includes(b.status)) await transition(c, d.booking_id, 'CANCELLED_BY_SYSTEM', { id: null, role: 'system' }, { reason: 'deposit_not_paid', patch: { cancelled_at: new Date(), cancel_by: 'system', cancel_reason: 'deposit_not_paid' } });
      await notify(d.user_id, 'deposit_expired', {}, { db: c });
      return true;
    });
    if (ok) expired++;
  }
  return { checked: open.length, expired };
}

/** Extra booking-view fields for the passenger and staff: credit used, deposit state, channel. */
export async function prepaidView(b: any) {
  const deposit = await depositView(b.id);
  return {
    channel: b.channel ?? 'app',
    wallet: b.wallet_mode ? { mode: b.wallet_mode, reserved: b.wallet_reserved, applied: b.wallet_applied } : null,
    deposit,
    awaiting_deposit: !!deposit && ['awaiting_payment', 'pending', 'failed'].includes(deposit.status),
  };
}
