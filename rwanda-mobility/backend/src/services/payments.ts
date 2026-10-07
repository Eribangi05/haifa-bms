import type { PoolClient } from 'pg';
import { q, q1, tx } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { providerFor, newReference, type ProviderStatus } from '../providers/payment.js';
import { transition, logEvent, type BookingRow } from './bookingMachine.js';
import { resolveCommission, calcCommission } from './commission.js';
import { post } from './ledger.js';
import { settleDebts } from './debts.js';
import { notify } from './notify.js';
import { maskMsisdn } from '../util/money.js';
import { bps } from '../util/money.js';
import { flag } from './settings.js';
import { normalizePhone } from '../util/phone.js';

/** Called inside the completion transaction. Creates what the passenger owes and moves the booking to PAYMENT_PENDING. */
export async function createDuePayment(c: PoolClient, b: BookingRow) {
  const sys = { id: null, role: 'system' };
  const amount = b.final_fare as number;
  if (b.payment_method === 'cash') {
    await q(`insert into payments(booking_id, payer_user_id, method, provider, amount, status, reference, settlement_status)
             values ($1,$2,'cash','cash',$3,'PENDING',$4,'not_applicable')`, [b.id, b.passenger_id, amount, newReference()], c);
    await transition(c, b.id, 'PAYMENT_PENDING', sys);
  } else if (b.payment_method === 'corporate') {
    const p = (await q<any>(`insert into payments(booking_id, payer_user_id, method, provider, amount, status, reference, settlement_status, completed_at)
             values ($1,$2,'corporate','corporate',$3,'SUCCESS',$4,'invoiced', now()) returning *`, [b.id, b.passenger_id, amount, newReference()], c))[0];
    await transition(c, b.id, 'PAYMENT_PENDING', sys);
    await settleBookingPayment(c, b.id, p);
  } else {
    await transition(c, b.id, 'PAYMENT_PENDING', sys);   // passenger initiates mobile-money request
  }
}

/** Earnings + commission + ledger + booking PAYMENT_COMPLETED. Runs exactly once per booking (unique earnings row). */
export async function settleBookingPayment(c: PoolClient, bookingId: string, pay: any) {
  const b = (await q1<BookingRow>('select * from bookings where id=$1', [bookingId], c))!;
  const bd = b.fare_breakdown;
  const dp = (await q1<any>('select fleet_id from driver_profiles where user_id=$1', [b.driver_id], c))!;
  const rule = await resolveCommission(b.service_id, b.driver_id, dp.fleet_id, new Date(), c);
  const commission = calcCommission(rule, bd.commissionable);
  const driverGross = bd.subtotal - commission;
  let fleetShare = 0, fleetOwner: string | null = null;
  if (dp.fleet_id) {
    const f = await q1<any>('select owner_user_id, revenue_share_bps from fleets where id=$1', [dp.fleet_id], c);
    fleetShare = bps(driverGross, f.revenue_share_bps); fleetOwner = f.owner_user_id;
  }
  const net = driverGross - fleetShare;
  const collectedBy = pay.method === 'cash' ? 'driver' : pay.method === 'corporate' ? 'corporate' : 'platform';
  const ins = await q(
    `insert into driver_earnings(booking_id, driver_id, fleet_id, fare_subtotal, discount, tax, passthrough, commissionable, commission, fleet_share, net, commission_rule_id, payment_method, collected_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (booking_id) do nothing returning id`,
    [b.id, b.driver_id, dp.fleet_id, bd.subtotal, bd.discount, bd.tax, bd.passthrough, bd.commissionable, commission, fleetShare, net, rule.id, pay.method, collectedBy], c);
  if (!ins.length) return; // already settled (idempotent)
  const paid = pay.method === 'cash' ? pay.amount_collected ?? pay.amount : pay.amount;
  const asset = pay.method === 'cash' ? 'CASH_WITH_DRIVERS' : pay.method === 'corporate' ? 'CORPORATE_RECEIVABLE' : 'PROVIDER_CLEARING';
  const owner = pay.method === 'cash' ? b.driver_id : pay.method === 'corporate' ? b.corporate_id : null;
  await post(c, [
    { account: asset, debit: paid, owner },
    { account: 'PROMO_EXPENSE', debit: bd.discount },
    { account: 'DRIVER_PAYABLE', credit: net, owner: b.driver_id },
    { account: 'DRIVER_PAYABLE', credit: fleetShare, owner: fleetOwner },
    { account: 'COMMISSION_REVENUE', credit: commission },
    { account: 'TAX_PAYABLE', credit: bd.tax },
    { account: 'PASSENGER_RECEIVABLE', credit: bd.debt ?? 0, owner: b.passenger_id },   // earlier cancellation fee collected with this fare
  ], { memo: `trip ${b.ref} settlement (${pay.method})`, bookingId: b.id, paymentId: pay.id });
  await settleDebts(c, b.id, b.passenger_id, bd.debt ?? 0);
  if (pay.fee_amount && pay.fee_amount > 0)
    await post(c, [{ account: 'PROCESSOR_FEES', debit: pay.fee_amount }, { account: 'PROVIDER_CLEARING', credit: pay.fee_amount }], { memo: `processor fee ${b.ref}`, bookingId: b.id, paymentId: pay.id });
  await transition(c, b.id, 'PAYMENT_COMPLETED', { id: null, role: 'system' }, { meta: { payment_id: pay.id, method: pay.method } });
  // referral: reward both sides after the referee's first paid trip
  const ref = await q1<any>("select * from referrals where referee_id=$1 and status='pending' for update", [b.passenger_id], c);
  if (ref) {
    for (const [uid, tag] of [[ref.referrer_id, 'A'], [ref.referee_id, 'B']]) {
      await q(`insert into promotions(code, kind, value, min_fare, per_user_limit, usage_limit, user_id, valid_to, budget)
               values ($1,'fixed',1000,1500,1,1,$2, now() + interval '60 days', 1000)`, [`REF-${ref.id.slice(0, 6).toUpperCase()}${tag}`, uid], c);
    }
    await q("update referrals set status='rewarded' where id=$1", [ref.id], c);
  }
}

// ---------- cash ----------
export async function confirmCash(driverId: string, bookingId: string, amount: number) {
  const out = await tx(async (c) => {
    const b = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b || b.driver_id !== driverId) throw notFound('booking');
    const p = await q1<any>("select * from payments where booking_id=$1 and method='cash' and status='PENDING' for update", [bookingId], c);
    if (!p) throw conflict('no_cash_due', 'No cash payment is due for this booking');
    if (!Number.isInteger(amount) || amount <= 0 || amount > p.amount) throw badRequest('invalid_amount', `Amount must be 1..${p.amount} RWF`);
    const total = (p.amount_collected ?? 0) + amount;
    if (total > p.amount) throw badRequest('invalid_amount', 'More than the amount due');
    await logEvent(c, bookingId, 'cash_collected', { id: driverId, role: 'driver' }, { amount, total_collected: total });
    if (total < p.amount) {
      await q('update payments set amount_collected=$2, updated_at=now() where id=$1', [p.id, total], c);
      return { status: 'PARTIAL', outstanding: p.amount - total, collected: total };
    }
    const done = (await q<any>("update payments set status='SUCCESS', amount_collected=$2, completed_at=now(), updated_at=now() where id=$1 returning *", [p.id, total], c))[0];
    await settleBookingPayment(c, bookingId, done);
    return { status: 'SUCCESS', outstanding: 0, collected: total, passenger: b.passenger_id, ref: b.ref };
  });
  if (out.status === 'SUCCESS') await notify((out as any).passenger, 'payment_success', { amount: out.collected, ref: (out as any).ref });
  return out;
}

/** Passenger may change how they pay after completion (e.g. MoMo failed -> cash). Only when nothing has been collected. */
export async function switchMethod(passengerId: string, bookingId: string, method: 'cash' | 'mtn_momo') {
  return tx(async (c) => {
    const b = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b || b.passenger_id !== passengerId) throw notFound('booking');
    if (b.status !== 'PAYMENT_PENDING') throw conflict('invalid_state', 'Payment method can only change while payment is pending');
    if (b.payer_type === 'corporate') throw conflict('corporate_booking', 'Corporate bookings are billed to the company');
    const live = await q1<any>("select * from payments where booking_id=$1 and status in ('INITIATED','PENDING') for update", [bookingId], c);
    if (live) {
      if (live.method === method) return b;
      if ((live.amount_collected ?? 0) > 0) throw conflict('cash_partly_collected', 'Part of the cash was already collected');
      if (live.method === 'mtn_momo' && live.status === 'PENDING') throw conflict('payment_in_flight', 'Wait for the mobile-money request to finish before switching');
      await q("update payments set status='CANCELLED', updated_at=now() where id=$1", [live.id], c);
    }
    await q('update bookings set payment_method=$2, updated_at=now() where id=$1', [bookingId, method], c);
    await logEvent(c, bookingId, 'payment_method_changed', { id: passengerId, role: 'passenger' }, { method });
    if (method === 'cash') await q(`insert into payments(booking_id, payer_user_id, method, provider, amount, status, reference, settlement_status) values ($1,$2,'cash','cash',$3,'PENDING',$4,'not_applicable')`, [bookingId, passengerId, b.final_fare, newReference()], c);
    return (await q1<BookingRow>('select * from bookings where id=$1', [bookingId], c))!;
  });
}

// ---------- mobile money ----------
export async function initiateMomo(passengerId: string, bookingId: string, msisdnRaw: string, method: 'mtn_momo' | 'airtel_money' = 'mtn_momo') {
  if (!(await flag(`payments.${method}`))) throw badRequest('payment_method_unavailable', 'This payment method is not enabled');
  const msisdn = normalizePhone(msisdnRaw);
  if (!msisdn) throw badRequest('invalid_phone', 'Enter a valid Rwandan mobile money number');
  const prep = await tx(async (c) => {
    const b = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b || b.passenger_id !== passengerId) throw notFound('booking');
    if (b.status !== 'PAYMENT_PENDING') throw conflict('invalid_state', 'Nothing to pay for this booking right now');
    if (b.payer_type === 'corporate') throw conflict('corporate_booking', 'Corporate bookings are billed to the company');
    const live = await q1<any>("select * from payments where booking_id=$1 and status in ('INITIATED','PENDING','SUCCESS')", [bookingId], c);
    if (live && live.method === method && live.status !== 'INITIATED') return { reuse: live };     // idempotent: never create a second charge
    if (live && live.method === 'cash') {
      if ((live.amount_collected ?? 0) > 0) throw conflict('cash_partly_collected', 'Part of the cash was already collected');
      await q("update payments set status='CANCELLED', updated_at=now() where id=$1", [live.id], c);
    }
    const ref = newReference();
    const p = (await q<any>(`insert into payments(booking_id, payer_user_id, method, provider, amount, status, reference, msisdn_masked, settlement_status)
      values ($1,$2,$3,$3,$4,'INITIATED',$5,$6,'unsettled') returning *`, [bookingId, passengerId, method, b.final_fare, ref, maskMsisdn(msisdn)], c))[0];
    await q('update bookings set payment_method=$2 where id=$1', [bookingId, method], c);
    return { pay: p, b };
  });
  if ('reuse' in prep) return prep.reuse;
  const { pay, b } = prep as { pay: any; b: BookingRow };
  try {
    const r = await providerFor(method).initiate({ reference: pay.reference, amount: pay.amount, msisdn, note: `Abasare ${b.ref}` });
    await q("update payments set status='PENDING', provider_reference=$2, updated_at=now() where id=$1", [pay.id, r.providerRef ?? null]);
  } catch (e: any) {
    await q("update payments set status='FAILED', failure_reason=$2, updated_at=now() where id=$1", [pay.id, String(e.message).slice(0, 200)]);
    await notify(passengerId, 'payment_failed', { ref: b.ref });
    throw new AppError(502, 'provider_error', 'Could not reach the mobile-money provider. You can retry or pay cash.');
  }
  return verifyPayment(pay.id, 'initiate');
}

/** Authoritative check: asks the provider for the transaction status. Never trusts client or callback bodies. */
export async function verifyPayment(paymentId: string, source: 'poll' | 'callback' | 'initiate' | 'sweep', rawBody?: unknown) {
  const p = await q1<any>('select * from payments where id=$1', [paymentId]);
  if (!p) throw notFound('payment');
  if (p.method === 'cash' || p.method === 'corporate') return p;
  if (p.status === 'FAILED' && p.failure_reason === 'timeout') {
    // late success after our local timeout: never auto-credit; surface in reconciliation for a human decision
    try {
      const late = await providerFor(p.method).status(p.reference);
      if (late.status === 'SUCCESS') {
        await q("insert into payment_provider_events(provider,event_key,payment_id,payload,verified,processed_at) values ($1,$2,$3,$4,true,now()) on conflict (event_key) do nothing", [p.method, `${p.method}:${p.reference}:LATE_SUCCESS`, p.id, JSON.stringify(late)]);
        await q("update payments set failure_reason='late_success_needs_review', updated_at=now() where id=$1", [p.id]);
      }
    } catch { /* provider unreachable */ }
    return p;
  }
  if (['SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED'].includes(p.status)) return p;
  let st: ProviderStatus;
  try { st = await providerFor(p.method).status(p.reference); } catch (e: any) { return p; }   // provider down: remain PENDING, retried by sweeper
  if (st.status === 'PENDING') return p;
  const key = `${p.method}:${p.reference}:${st.status}`;
  return tx(async (c) => {
    const ev = await q("insert into payment_provider_events(provider, event_key, payment_id, payload, verified, processed_at) values ($1,$2,$3,$4,true,now()) on conflict (event_key) do nothing returning id",
      [p.method, key, p.id, JSON.stringify({ source, status: st, body: rawBody ?? null })], c);
    const cur = await q1<any>('select * from payments where id=$1 for update', [paymentId], c);
    if (!ev.length || ['SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED'].includes(cur.status)) return cur;   // duplicate notification: no-op
    const b = (await q1<BookingRow>('select * from bookings where id=$1', [cur.booking_id], c))!;
    if (st.status === 'FAILED') {
      const f = (await q<any>("update payments set status='FAILED', failure_reason=$2, provider_reference=coalesce($3, provider_reference), updated_at=now() where id=$1 returning *", [cur.id, st.reason ?? 'failed', st.providerRef ?? null], c))[0];
      await notify(b.passenger_id, 'payment_failed', { ref: b.ref }, { db: c });
      return f;
    }
    if (st.amount != null && Number(st.amount) !== cur.amount) {
      // amount mismatch: do NOT mark paid; flag for reconciliation
      await q("update payments set failure_reason='amount_mismatch', updated_at=now() where id=$1", [cur.id], c);
      return { ...cur, failure_reason: 'amount_mismatch' };
    }
    const ok = (await q<any>("update payments set status='SUCCESS', provider_reference=coalesce($2, provider_reference), fee_amount=$3, completed_at=now(), updated_at=now() where id=$1 returning *", [cur.id, st.providerRef ?? null, st.fee ?? null], c))[0];
    await settleBookingPayment(c, b.id, ok);
    await notify(b.passenger_id, 'payment_success', { amount: ok.amount, ref: b.ref }, { db: c });
    return ok;
  });
}

/** Authenticated provider callback: body is only a hint to find the payment; the status is re-queried from the provider. */
export async function handleCallback(provider: string, body: any) {
  const reference = String(body?.externalId ?? body?.referenceId ?? body?.reference ?? '');
  const p = await q1<any>('select id from payments where reference=$1 and method=$2', [reference, provider]);
  if (!p) {
    await q("insert into payment_provider_events(provider,event_key,payload,verified) values ($1,$2,$3,false) on conflict do nothing", [provider, `${provider}:unmatched:${reference}:${Date.now()}`, JSON.stringify(body ?? {})]);
    return { matched: false };
  }
  const r = await verifyPayment(p.id, 'callback', body);
  return { matched: true, status: r.status };
}

export async function sweepPendingPayments() {
  const rows = await q<{ id: string }>("select id from payments where method in ('mtn_momo','airtel_money') and created_at > now() - interval '2 days' and (status='PENDING' or (status='FAILED' and failure_reason='timeout'))");
  for (const r of rows) await verifyPayment(r.id, 'sweep').catch(() => {});
  // abandon requests that never resolved after 15 minutes so the passenger can retry or pay cash
  const stale = await q<any>("update payments set status='FAILED', failure_reason='timeout', updated_at=now() where status='PENDING' and method in ('mtn_momo','airtel_money') and created_at < now() - interval '15 minutes' returning id");
  return { checked: rows.length, timedOut: stale.length };
}
