import { q, q1, tx } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { post, driverBalance, accountBalance, integrityReport } from './ledger.js';
import { getSetting } from './settings.js';
import { transition } from './bookingMachine.js';
import { audit, type Actor } from './audit.js';
import { notify } from './notify.js';

// ---------------- refunds (maker-checker) ----------------
export async function requestRefund(staff: Actor, bookingId: string, amount: number, reason: string, driverClawback = 0) {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('invalid_amount');
  if (!reason || reason.length < 5) throw badRequest('reason_required');
  return tx(async (c) => {
    const b = await q1<any>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b) throw notFound('booking');
    const p = await q1<any>("select * from payments where booking_id=$1 and status='SUCCESS'", [bookingId], c);
    if (!p) throw conflict('no_successful_payment', 'There is no completed payment to refund');
    const done = await q1<any>("select coalesce(sum(amount),0)::int s from refunds where booking_id=$1 and status in ('REQUESTED','APPROVED','PROCESSED')", [bookingId], c);
    if (done.s + amount > p.amount) throw badRequest('refund_exceeds_payment', `Only ${p.amount - done.s} RWF can still be refunded`);
    if (driverClawback < 0 || driverClawback > amount) throw badRequest('invalid_clawback');
    const r = (await q<any>('insert into refunds(booking_id, payment_id, amount, reason, driver_clawback, requested_by) values ($1,$2,$3,$4,$5,$6) returning *', [bookingId, p.id, amount, reason, driverClawback, staff.id], c))[0];
    await audit(staff, 'refund.requested', 'refund', r.id, undefined, r, c);
    return r;
  });
}

export async function decideRefund(approver: Actor, refundId: string, approve: boolean) {
  const out = await tx(async (c) => {
    const r = await q1<any>('select * from refunds where id=$1 for update', [refundId], c);
    if (!r) throw notFound('refund');
    if (r.status !== 'REQUESTED') throw conflict('already_decided', `Refund is ${r.status}`);
    if (r.requested_by === approver.id) throw forbidden('Maker-checker: the requester cannot approve their own refund');
    if (!approve) {
      await q("update refunds set status='REJECTED', approved_by=$2, processed_at=now() where id=$1", [refundId, approver.id], c);
      await audit(approver, 'refund.rejected', 'refund', refundId, r, undefined, c);
      return null;
    }
    const b = (await q1<any>('select * from bookings where id=$1 for update', [r.booking_id], c))!;
    const p = (await q1<any>('select * from payments where id=$1 for update', [r.payment_id], c))!;
    const credit = p.method === 'cash' ? 'PLATFORM_BANK' : p.method === 'corporate' ? 'CORPORATE_RECEIVABLE' : 'PROVIDER_CLEARING';
    await post(c, [
      { account: 'REFUNDS', debit: r.amount },
      { account: credit, credit: r.amount, owner: p.method === 'corporate' ? b.corporate_id : null },
      { account: 'DRIVER_PAYABLE', debit: r.driver_clawback, owner: b.driver_id },
      { account: 'REFUNDS', credit: r.driver_clawback },
    ], { memo: `refund ${b.ref}`, bookingId: b.id, paymentId: p.id });
    await q("update refunds set status='PROCESSED', approved_by=$2, processed_at=now() where id=$1", [refundId, approver.id], c);
    const total = (await q1<any>("select sum(amount)::int s from refunds where booking_id=$1 and status='PROCESSED'", [b.id], c)).s;
    const full = total >= p.amount;
    if (full) await q("update payments set status='REVERSED', updated_at=now() where id=$1", [p.id], c);
    const cur = (await q1<any>('select status from bookings where id=$1', [b.id], c)).status;
    const target = full ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    if (cur !== target) await transition(c, b.id, target as any, { id: approver.id, role: 'finance' }, { reason: `refund ${refundId}`, meta: { amount: r.amount } });
    await audit(approver, 'refund.processed', 'refund', refundId, r, { total_refunded: total }, c);
    return { passenger: b.passenger_id, ref: b.ref, amount: r.amount, manual: p.method !== 'cash' };
  });
  if (out) await notify(out.passenger, 'refund_processed', { amount: out.amount, ref: out.ref });
  return out ? { processed: true, manual_provider_payout_required: out.manual } : { processed: false };
}

// ---------------- payouts ----------------
export async function requestPayout(ownerId: string, amount: number, kind: 'driver' | 'fleet' = 'driver') {
  const [min, fee] = await Promise.all([getSetting('payout.min_amount'), getSetting('payout.fee')]);
  if (!Number.isInteger(amount) || amount < min) throw badRequest('below_minimum', `Minimum payout is ${min} RWF`);
  const dp = kind === 'driver' ? await q1<any>('select payout_provider, payout_msisdn from driver_profiles where user_id=$1', [ownerId]) : await q1<any>('select phone as payout_msisdn, \'mtn_momo\' as payout_provider from users where id=$1', [ownerId]);
  if (!dp?.payout_msisdn) throw badRequest('no_payout_account', 'Add a payout mobile-money number first');
  if (amount <= fee) throw badRequest('below_fee');
  return tx(async (c) => {
    await q('select pg_advisory_xact_lock(hashtext($1))', [ownerId], c);          // serialise payouts per owner
    // net cash held against earnings first, so commission owed on cash trips is deducted
    const bal0 = await driverBalance(ownerId, c);
    const net = Math.min(bal0.payable, bal0.cash_held);
    if (kind === 'driver' && net > 0) await post(c, [{ account: 'DRIVER_PAYABLE', debit: net, owner: ownerId }, { account: 'CASH_WITH_DRIVERS', credit: net, owner: ownerId }], { memo: 'cash netted against earnings at payout' });
    const bal = await driverBalance(ownerId, c);
    const eligible = bal.payable - bal.cash_held;
    if (amount > eligible) throw new AppError(409, 'insufficient_balance', `Eligible balance is ${Math.max(0, eligible)} RWF`);
    const p = (await q<any>('insert into payouts(owner_user_id, kind, amount, fee, provider, msisdn) values ($1,$2,$3,$4,$5,$6) returning *', [ownerId, kind, amount, fee, dp.payout_provider ?? 'mtn_momo', dp.payout_msisdn], c))[0];
    await post(c, [
      { account: 'DRIVER_PAYABLE', debit: amount, owner: ownerId },
      { account: 'PAYOUT_CLEARING', credit: amount - fee },
      { account: 'FEE_REVENUE', credit: fee },
    ], { memo: `payout ${p.id} requested` });
    return p;
  });
}

export async function reviewPayout(staff: Actor, id: string) {
  return tx(async (c) => {
    const p = await q1<any>('select * from payouts where id=$1 for update', [id], c);
    if (!p) throw notFound('payout');
    if (p.status !== 'REQUESTED') throw conflict('invalid_state', `Payout is ${p.status}`);
    await q("update payouts set status='REVIEWED', reviewed_by=$2 where id=$1", [id, staff.id], c);
    await audit(staff, 'payout.reviewed', 'payout', id, p, undefined, c);
    return { ...p, status: 'REVIEWED' };
  });
}

/** Approve: large payouts must be REVIEWED first and approved by someone other than the reviewer. */
export async function approvePayout(staff: Actor, id: string) {
  const large = await getSetting('payout.large_threshold');
  const p = await tx(async (c) => {
    const p = await q1<any>('select * from payouts where id=$1 for update', [id], c);
    if (!p) throw notFound('payout');
    if (!['REQUESTED', 'REVIEWED'].includes(p.status)) throw conflict('invalid_state', `Payout is ${p.status}`);
    if (p.amount >= large) {
      if (p.status !== 'REVIEWED') throw conflict('review_required', 'Large payouts need a prior review');
      if (p.reviewed_by === staff.id) throw forbidden('Maker-checker: reviewer cannot also approve');
    }
    await q("update payouts set status='APPROVED', approved_by=$2 where id=$1", [id, staff.id], c);
    await audit(staff, 'payout.approved', 'payout', id, p, undefined, c);
    return p;
  });
  await notify(p.owner_user_id, 'payout_update', { amount: p.amount - p.fee, status: 'APPROVED' });
  return { ...p, status: 'APPROVED' };
}

/** Mark paid after the disbursement is made (manual MoMo transfer today; automated disbursement is PENDING INTEGRATION). */
export async function markPayoutPaid(staff: Actor, id: string, providerReference: string) {
  if (!providerReference) throw badRequest('provider_reference_required');
  const p = await tx(async (c) => {
    const p = await q1<any>('select * from payouts where id=$1 for update', [id], c);
    if (!p) throw notFound('payout');
    if (p.status !== 'APPROVED') throw conflict('invalid_state', `Payout is ${p.status}`);
    if (p.approved_by === staff.id && p.amount >= (await getSetting('payout.large_threshold'))) throw forbidden('Maker-checker: approver cannot also release a large payout');
    await post(c, [{ account: 'PAYOUT_CLEARING', debit: p.amount - p.fee }, { account: 'PLATFORM_BANK', credit: p.amount - p.fee }], { memo: `payout ${id} paid` });
    await q("update payouts set status='PAID', provider_reference=$2, paid_at=now() where id=$1", [id, providerReference], c);
    await audit(staff, 'payout.paid', 'payout', id, p, { providerReference }, c);
    return p;
  });
  await notify(p.owner_user_id, 'payout_update', { amount: p.amount - p.fee, status: 'PAID' });
  return { ...p, status: 'PAID' };
}

export async function rejectPayout(staff: Actor, id: string, note: string) {
  return tx(async (c) => {
    const p = await q1<any>('select * from payouts where id=$1 for update', [id], c);
    if (!p) throw notFound('payout');
    if (!['REQUESTED', 'REVIEWED', 'APPROVED'].includes(p.status)) throw conflict('invalid_state', `Payout is ${p.status}`);
    // reverse the hold: money returns to the owner's payable balance
    await post(c, [{ account: 'PAYOUT_CLEARING', debit: p.amount - p.fee }, { account: 'FEE_REVENUE', debit: p.fee }, { account: 'DRIVER_PAYABLE', credit: p.amount, owner: p.owner_user_id }], { memo: `payout ${id} rejected` });
    await q("update payouts set status='REJECTED', note=$2 where id=$1", [id, note], c);
    await audit(staff, 'payout.rejected', 'payout', id, p, { note }, c);
    return { ...p, status: 'REJECTED' };
  });
}

/** Driver remits cash to the platform (finance records it). Reduces cash held. */
export async function recordCashRemittance(staff: Actor, driverId: string, amount: number, reference: string) {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('invalid_amount');
  return tx(async (c) => {
    const bal = await driverBalance(driverId, c);
    if (amount > bal.cash_held) throw badRequest('exceeds_cash_held', `Driver holds ${bal.cash_held} RWF`);
    await post(c, [{ account: 'PLATFORM_BANK', debit: amount }, { account: 'CASH_WITH_DRIVERS', credit: amount, owner: driverId }], { memo: `cash remittance ${reference}` });
    await audit(staff, 'cash.remittance', 'driver', driverId, undefined, { amount, reference }, c);
    return driverBalance(driverId, c);
  });
}

/** Exceptional manual adjustment to a driver's payable balance. Always a new ledger entry, always audited, reason required. */
export async function postDriverAdjustment(staff: Actor, driverId: string, amount: number, reason: string) {
  if (!Number.isInteger(amount) || amount === 0) throw badRequest('invalid_amount');
  if (!reason || reason.length < 10) throw badRequest('reason_required');
  return tx(async (c) => {
    if (amount > 0) await post(c, [{ account: 'ADJUSTMENTS', debit: amount }, { account: 'DRIVER_PAYABLE', credit: amount, owner: driverId }], { memo: `adjustment: ${reason}` });
    else await post(c, [{ account: 'DRIVER_PAYABLE', debit: -amount, owner: driverId }, { account: 'ADJUSTMENTS', credit: -amount }], { memo: `adjustment: ${reason}` });
    await audit(staff, 'ledger.adjustment', 'driver', driverId, undefined, { amount, reason }, c);
    return driverBalance(driverId, c);
  });
}

// ---------------- reconciliation ----------------
export type ProviderRow = { reference: string; amount: number; status: 'SUCCESS' | 'FAILED' | 'PENDING' };
export async function reconcile(staff: Actor, provider: string, runDate: string, rows: ProviderRow[]) {
  return tx(async (c) => {
    const run = (await q<any>('insert into reconciliation_runs(provider, run_date, created_by) values ($1,$2,$3) returning *', [provider, runDate, staff.id], c))[0];
    const seen = new Set<string>();
    const sum = { MATCHED: 0, MISSING_INTERNAL: 0, MISSING_PROVIDER: 0, AMOUNT_MISMATCH: 0, STATUS_MISMATCH: 0 };
    const add = async (kind: keyof typeof sum, pid: string | null, ref: string, ia: number | null, pa: number | null) => {
      sum[kind]++;
      await q('insert into reconciliation_items(run_id,payment_id,provider_reference,kind,internal_amount,provider_amount,resolved) values ($1,$2,$3,$4,$5,$6,$7)', [run.id, pid, ref, kind, ia, pa, kind === 'MATCHED'], c);
    };
    for (const r of rows) {
      if (seen.has(r.reference)) { await add('STATUS_MISMATCH', null, r.reference, null, r.amount); continue; }  // duplicate line in provider file
      seen.add(r.reference);
      const p = await q1<any>('select * from payments where method=$1 and reference=$2', [provider, r.reference], c);
      if (!p) { await add('MISSING_INTERNAL', null, r.reference, null, r.amount); continue; }
      if (p.amount !== r.amount) await add('AMOUNT_MISMATCH', p.id, r.reference, p.amount, r.amount);
      else if ((p.status === 'SUCCESS') !== (r.status === 'SUCCESS')) await add('STATUS_MISMATCH', p.id, r.reference, p.amount, r.amount);
      else {
        await add('MATCHED', p.id, r.reference, p.amount, r.amount);
        if (p.status === 'SUCCESS') await q("update payments set settlement_status='settled' where id=$1", [p.id], c);
      }
    }
    const internal = await q<any>("select * from payments where method=$1 and status='SUCCESS' and completed_at::date = $2::date", [provider, runDate], c);
    for (const p of internal) if (!seen.has(p.reference)) await add('MISSING_PROVIDER', p.id, p.reference, p.amount, null);
    const integrity = await integrityReport(c);
    const summary = { ...sum, ledger_balanced: integrity.balanced };
    await q('update reconciliation_runs set summary=$2 where id=$1', [run.id, JSON.stringify(summary)], c);
    await audit(staff, 'reconciliation.run', 'reconciliation_run', run.id, undefined, summary, c);
    return { run_id: run.id, summary };
  });
}

export async function financialPosition() {
  const accounts = await q<any>(`select a.code, a.name, a.type, coalesce(sum(e.debit),0)::bigint debit, coalesce(sum(e.credit),0)::bigint credit
    from ledger_accounts a left join ledger_entries e on e.account_code=a.code group by a.code, a.name, a.type order by a.code`);
  return { accounts: accounts.map((a) => ({ ...a, balance: a.type === 'asset' || a.type === 'expense' ? a.debit - a.credit : a.credit - a.debit })), integrity: await integrityReport() };
}
