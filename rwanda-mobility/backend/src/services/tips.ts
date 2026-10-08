import { q, q1, tx } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { providerFor, newReference, type ProviderStatus } from '../providers/payment.js';
import { post } from './ledger.js';
import { notify } from './notify.js';
import { flag, getSetting } from './settings.js';
import { logEvent } from './bookingMachine.js';
import { normalizePhone } from '../util/phone.js';
import { maskMsisdn } from '../util/money.js';

const DONE = ['COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED'];
const WINDOW_DAYS = 7;

export type TipIn = { amount: number; method: 'mtn_momo' | 'cash_tip'; msisdn?: string };

/** Validates and records a tip. 100% goes to the driver. MoMo: a payment of kind 'tip' with a balanced ledger posting on success. Cash: informational only. */
export async function createTip(passengerId: string, bookingId: string, t: TipIn) {
  if (!(await getSetting('tips.enabled'))) throw badRequest('tips_disabled', 'Tips are not enabled');
  const [min, max] = await Promise.all([getSetting('tips.min_amount'), getSetting('tips.max_amount')]);
  if (!Number.isInteger(t.amount) || t.amount < min) throw badRequest('tip_too_low', 'Tip is below the minimum', { min });
  if (t.amount > max) throw badRequest('tip_too_high', 'Tip is above the maximum', { max });
  let msisdn: string | null = null;
  if (t.method === 'mtn_momo') {
    if (!(await flag('payments.mtn_momo'))) throw badRequest('payment_method_unavailable');
    msisdn = t.msisdn ? normalizePhone(t.msisdn) : null;
    if (!msisdn) throw badRequest('invalid_phone', 'Enter a valid Rwandan mobile money number');
  }
  const prep = await tx(async (c) => {
    const b = await q1<any>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b || b.passenger_id !== passengerId) throw notFound('booking');
    if (!b.driver_id || !DONE.includes(b.status) || !b.completed_at || Date.now() - new Date(b.completed_at).getTime() > WINDOW_DAYS * 86400e3)
      throw conflict('tip_not_allowed', 'Tips are possible after a completed trip, for 7 days');
    const ex = await q1<any>('select t.*, p.status pstatus from tips t left join payments p on p.id=t.payment_id where t.booking_id=$1 for update of t', [bookingId], c);
    if (ex && !(ex.method === 'mtn_momo' && ['FAILED', 'CANCELLED'].includes(ex.pstatus))) throw conflict('tip_exists', 'You already tipped this trip');
    if (t.method === 'cash_tip') {
      const row = (await q<any>("insert into tips(booking_id,passenger_id,driver_id,amount,method) values ($1,$2,$3,$4,'cash_tip') returning *", [bookingId, passengerId, b.driver_id, t.amount], c))[0];
      await logEvent(c, bookingId, 'cash_tip', { id: passengerId, role: 'passenger' }, { amount: t.amount, informational: true });
      return { row, cash: true as const, b };
    }
    const pay = (await q<any>(`insert into payments(booking_id,payer_user_id,method,provider,amount,status,reference,msisdn_masked,settlement_status,kind)
      values ($1,$2,'mtn_momo','mtn_momo',$3,'INITIATED',$4,$5,'unsettled','tip') returning *`, [bookingId, passengerId, t.amount, newReference(), maskMsisdn(msisdn!)], c))[0];
    const row = ex
      ? (await q<any>('update tips set payment_id=$2, amount=$3, created_at=now() where id=$1 returning *', [ex.id, pay.id, t.amount], c))[0]
      : (await q<any>("insert into tips(booking_id,passenger_id,driver_id,amount,method,payment_id) values ($1,$2,$3,$4,'mtn_momo',$5) returning *", [bookingId, passengerId, b.driver_id, t.amount, pay.id], c))[0];
    return { row, cash: false as const, pay, b };
  });
  if (prep.cash) return tipView(prep.row, null);
  try {
    await providerFor('mtn_momo').initiate({ reference: prep.pay.reference, amount: t.amount, msisdn: msisdn!, note: `Abasare tip ${prep.b.ref}` });
    await q("update payments set status='PENDING', updated_at=now() where id=$1", [prep.pay.id]);
  } catch {
    await q("update payments set status='FAILED', failure_reason='provider_unreachable', updated_at=now() where id=$1", [prep.pay.id]);
    throw new AppError(502, 'provider_error', 'Could not reach the mobile-money provider.');
  }
  const p = await verifyTipPayment(prep.pay.id, 'initiate');
  return tipView(prep.row, p);
}

const tipView = (t: any, p: any) => ({
  id: t.id, booking_id: t.booking_id, amount: t.amount, method: t.method,
  status: t.method === 'cash_tip' ? 'recorded' : (p?.status ?? 'PENDING'), payment_id: t.payment_id ?? null,
  note: t.method === 'cash_tip' ? 'informational: cash handed to the driver, not processed by Abasare' : '100% of the tip goes to the driver, no commission',
});

/** Called by verifyPayment for payments of kind 'tip'. Same provider re-query rules as fares; never settles a booking. */
export async function verifyTipPayment(paymentId: string, source: string, rawBody?: unknown) {
  const p = await q1<any>('select * from payments where id=$1', [paymentId]);
  if (!p) throw notFound('payment');
  if (['SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED'].includes(p.status)) return p;
  let st: ProviderStatus;
  try { st = await providerFor(p.method).status(p.reference); } catch { return p; }
  if (st.status === 'PENDING') return p;
  const key = `${p.method}:${p.reference}:${st.status}`;
  return tx(async (c) => {
    const ev = await q("insert into payment_provider_events(provider,event_key,payment_id,payload,verified,processed_at) values ($1,$2,$3,$4,true,now()) on conflict (event_key) do nothing returning id",
      [p.method, key, p.id, JSON.stringify({ source, status: st, body: rawBody ?? null })], c);
    const cur = await q1<any>('select * from payments where id=$1 for update', [paymentId], c);
    if (!ev.length || ['SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED'].includes(cur.status)) return cur;
    const tip = (await q1<any>('select * from tips where payment_id=$1', [paymentId], c))!;
    if (st.status === 'FAILED') {
      const f = (await q<any>("update payments set status='FAILED', failure_reason=$2, updated_at=now() where id=$1 returning *", [cur.id, st.reason ?? 'failed'], c))[0];
      await notify(tip.passenger_id, 'tip_failed', { amount: tip.amount }, { db: c });
      return f;
    }
    if (st.amount != null && Number(st.amount) !== cur.amount) {
      await q("update payments set failure_reason='amount_mismatch', updated_at=now() where id=$1", [cur.id], c);
      return { ...cur, failure_reason: 'amount_mismatch' };
    }
    const ok = (await q<any>("update payments set status='SUCCESS', provider_reference=coalesce($2,provider_reference), fee_amount=$3, completed_at=now(), updated_at=now() where id=$1 returning *", [cur.id, st.providerRef ?? null, st.fee ?? null], c))[0];
    // 100% to the driver: no commission, no fleet share. The processor fee (if any) is the platform's cost.
    await post(c, [{ account: 'PROVIDER_CLEARING', debit: ok.amount }, { account: 'DRIVER_PAYABLE', credit: ok.amount, owner: tip.driver_id }],
      { memo: `tip ${tip.booking_id}`, bookingId: tip.booking_id, paymentId: ok.id });
    if (ok.fee_amount && ok.fee_amount > 0)
      await post(c, [{ account: 'PROCESSOR_FEES', debit: ok.fee_amount }, { account: 'PROVIDER_CLEARING', credit: ok.fee_amount }], { memo: `processor fee tip ${tip.booking_id}`, bookingId: tip.booking_id, paymentId: ok.id });
    await logEvent(c, tip.booking_id, 'tip_paid', { id: null, role: 'system' }, { amount: ok.amount, payment_id: ok.id });
    await notify(tip.driver_id, 'tip_received', { amount: ok.amount }, { db: c });
    return ok;
  });
}

/** Driver-facing and admin aggregates. */
export async function driverTipTotals(driverId: string) {
  return q1<any>(`select count(*)::int tips, coalesce(sum(t.amount) filter (where t.method='mtn_momo' and p.status='SUCCESS'),0)::int momo_total,
      coalesce(sum(t.amount) filter (where t.method='cash_tip'),0)::int cash_total_informational
    from tips t left join payments p on p.id=t.payment_id where t.driver_id=$1 and (t.method='cash_tip' or p.status='SUCCESS')`, [driverId]);
}
export async function driverTagCounts(driverId: string) {
  const rows = await q<{ tag: string; n: number }>('select unnest(tags) tag, count(*)::int n from ratings where reviewee_id=$1 and tags is not null group by 1 order by 2 desc', [driverId]);
  return Object.fromEntries(rows.map((r) => [r.tag, r.n]));
}
