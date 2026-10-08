import type { PoolClient } from 'pg';
import { q, q1, tx, pool, type Db } from '../db.js';
import { post } from './ledger.js';
import { getSetting } from './settings.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { notify } from './notify.js';
import { audit, type Actor } from './audit.js';

/**
 * Customer credit. NOT a cash wallet: it can be granted (refund, promo, referral, quest, claim, loyalty, staff adjustment) and spent on
 * trips, never topped up with cash and never withdrawn. Ledger: WALLET_CREDIT (spendable, per user), WALLET_HELD (reserved for an open
 * booking), funded from expense accounts (PROMO_EXPENSE, REFUNDS, ADJUSTMENTS, LOYALTY_EXPENSE, CLAIMS_EXPENSE). `wallet_lots` mirrors the
 * spendable balance per grant (for FIFO expiry); `wallet_txns` is the statement. creditReconciliation() proves they agree.
 */
export type CreditSource = 'refund' | 'promo' | 'referral' | 'quest' | 'claim' | 'adjustment' | 'loyalty' | 'deposit_refund' | 'goodwill';
export const FUNDING: Record<CreditSource, string> = {
  refund: 'REFUNDS', promo: 'PROMO_EXPENSE', referral: 'PROMO_EXPENSE', quest: 'PROMO_EXPENSE', claim: 'CLAIMS_EXPENSE',
  adjustment: 'ADJUSTMENTS', loyalty: 'LOYALTY_EXPENSE', deposit_refund: 'DEPOSIT_HELD', goodwill: 'ADJUSTMENTS',
};
type Opts = { bookingId?: string | null; refType?: string; refId?: string; memo?: string; idemKey?: string; by?: string | null; enforceCap?: boolean; funding?: string; expiryDays?: number; notifyUser?: boolean };

export const lockUser = (c: PoolClient, userId: string) => q('select pg_advisory_xact_lock(hashtext($1))', [`wallet:${userId}`], c);

export async function balances(userId: string, db: Db = pool): Promise<{ available: number; held: number }> {
  const r = await q1<any>(`select coalesce(sum(credit-debit) filter (where account_code='WALLET_CREDIT'),0)::bigint a, coalesce(sum(credit-debit) filter (where account_code='WALLET_HELD'),0)::bigint h
    from ledger_entries where owner_user_id=$1 and account_code in ('WALLET_CREDIT','WALLET_HELD')`, [userId], db);
  return { available: Number(r.a), held: Number(r.h) };
}

async function addTxn(c: PoolClient, userId: string, kind: string, o: Opts & { source?: string; availableDelta?: number; heldDelta?: number; ledgerTxn?: string }) {
  const b = await balances(userId, c);
  await q(`insert into wallet_txns(user_id, kind, source, available_delta, held_delta, available_after, held_after, booking_id, ref_type, ref_id, memo, idem_key, ledger_txn_id, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [userId, kind, o.source ?? null, o.availableDelta ?? 0, o.heldDelta ?? 0, b.available, b.held, o.bookingId ?? null, o.refType ?? null, o.refId ?? null, o.memo ?? null, o.idemKey ?? null, o.ledgerTxn ?? null, o.by ?? null], c);
  return b;
}

type Alloc = { lot: string; amount: number };
/** Consume spendable credit soonest-expiring first. Throws insufficient_credit. */
async function takeFromLots(c: PoolClient, userId: string, amount: number): Promise<Alloc[]> {
  const lots = await q<any>(`select id, remaining from wallet_lots where user_id=$1 and remaining > 0 and (expires_at is null or expires_at > now()) order by expires_at nulls last, created_at, id for update`, [userId], c);
  const have = lots.reduce((s, l) => s + l.remaining, 0);
  if (have < amount) throw conflict('insufficient_credit', 'Not enough credit', { available: have, needed: amount });
  const out: Alloc[] = []; let left = amount;
  for (const l of lots) {
    if (left <= 0) break;
    const t = Math.min(l.remaining, left);
    await q('update wallet_lots set remaining = remaining - $2 where id=$1', [l.id, t], c);
    out.push({ lot: l.id, amount: t }); left -= t;
  }
  return out;
}
/** Give `amount` back to the lots it came from (latest allocation first). Returns the allocations still outstanding. */
async function giveBack(c: PoolClient, allocs: Alloc[], amount: number): Promise<Alloc[]> {
  let left = amount; const rest = allocs.map((a) => ({ ...a }));
  for (let i = rest.length - 1; i >= 0 && left > 0; i--) {
    const t = Math.min(rest[i].amount, left);
    await q('update wallet_lots set remaining = remaining + $2 where id=$1', [rest[i].lot, t], c);
    rest[i].amount -= t; left -= t;
  }
  return rest.filter((a) => a.amount > 0);
}

async function expireFor(c: PoolClient, userId: string | null) {
  const lots = await q<any>(`select id, user_id, remaining from wallet_lots where remaining > 0 and expires_at is not null and expires_at <= now() and ($1::uuid is null or user_id=$1) order by id limit 200 for update skip locked`, [userId], c);
  for (const l of lots) {
    const t = await post(c, [{ account: 'WALLET_CREDIT', debit: l.remaining, owner: l.user_id }, { account: 'CREDIT_EXPIRED_REVENUE', credit: l.remaining }], { memo: 'customer credit expired' });
    await q('update wallet_lots set remaining=0 where id=$1', [l.id], c);
    await addTxn(c, l.user_id, 'expire', { source: 'expiry', availableDelta: -l.remaining, ledgerTxn: t, memo: 'Credit expired' });
  }
  return lots.length;
}
/** Job: expire credit past its date, and remind customers 7 days ahead. Idempotent. */
export async function creditSweep() {
  let expired = 0;
  for (;;) { const n = await tx((c) => expireFor(c, null)); expired += n; if (n < 200) break; }
  const soon = await q<any>(`select user_id, sum(remaining)::int amount, min(expires_at) at from wallet_lots where remaining > 0 and reminded_at is null and expires_at is not null and expires_at <= now() + interval '7 days' and expires_at > now() group by user_id`);
  for (const s of soon) {
    await q(`update wallet_lots set reminded_at=now() where user_id=$1 and remaining > 0 and reminded_at is null and expires_at is not null and expires_at <= now() + interval '7 days'`, [s.user_id]);
    await notify(s.user_id, 'credit_expiring', { amount: s.amount, date: new Date(s.at).toISOString().slice(0, 10) });
  }
  return { expired, reminded: soon.length };
}

async function requireEnabled() { if (!(await getSetting('wallet.enabled'))) throw badRequest('wallet_disabled', 'Credit is not available'); }

/** Record credit received (lot + statement). The caller has already posted the matching ledger entries. */
export async function recordCredit(c: PoolClient, userId: string, amount: number, source: CreditSource, ledgerTxn: string, o: Opts = {}) {
  const days = o.expiryDays ?? (await getSetting('wallet.credit_expiry_days'));
  await q(`insert into wallet_lots(user_id, amount, remaining, source, expires_at) values ($1,$2,$2,$3, case when $4::int > 0 then now() + make_interval(days => $4::int) else null end)`, [userId, amount, source, days], c);
  return addTxn(c, userId, 'credit', { ...o, source, availableDelta: amount, ledgerTxn });
}

/** Grant credit. Idempotent per (user, idemKey). */
export async function grantCredit(c: PoolClient, userId: string, amount: number, source: CreditSource, o: Opts = {}) {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('invalid_amount');
  await lockUser(c, userId);
  if (o.idemKey && await q1('select 1 from wallet_txns where user_id=$1 and idem_key=$2', [userId, o.idemKey], c)) return { replay: true as const, ...(await balances(userId, c)) };
  if (source !== 'refund' && source !== 'deposit_refund') await requireEnabled();
  if (o.enforceCap ?? !['refund', 'deposit_refund'].includes(source)) {
    const cap = await getSetting('wallet.max_balance'); const b = await balances(userId, c);
    if (b.available + b.held + amount > cap) throw conflict('credit_cap_exceeded', 'Credit limit reached', { max: cap });
  }
  const t = await post(c, [{ account: o.funding ?? FUNDING[source], debit: amount }, { account: 'WALLET_CREDIT', credit: amount, owner: userId }], { memo: o.memo ?? `credit: ${source}`, bookingId: o.bookingId });
  const b = await recordCredit(c, userId, amount, source, t, o);
  if (o.notifyUser !== false) await notify(userId, 'credit_received', { amount }, { db: c });
  return { replay: false as const, ...b };
}

/** Remove spendable credit (staff adjustment). */
export async function debitCredit(c: PoolClient, userId: string, amount: number, o: Opts & { source?: CreditSource } = {}) {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('invalid_amount');
  await lockUser(c, userId); await expireFor(c, userId);
  await takeFromLots(c, userId, amount);
  const t = await post(c, [{ account: 'WALLET_CREDIT', debit: amount, owner: userId }, { account: o.funding ?? 'ADJUSTMENTS', credit: amount }], { memo: o.memo ?? 'credit removed', bookingId: o.bookingId });
  return addTxn(c, userId, 'debit', { ...o, source: o.source ?? 'adjustment', availableDelta: -amount, ledgerTxn: t });
}

// ---------------- reservations for bookings ----------------
export async function holdCredit(c: PoolClient, bookingId: string, userId: string, amount: number) {
  await lockUser(c, userId); await expireFor(c, userId);
  const allocs = await takeFromLots(c, userId, amount);
  const t = await post(c, [{ account: 'WALLET_CREDIT', debit: amount, owner: userId }, { account: 'WALLET_HELD', credit: amount, owner: userId }], { memo: 'credit reserved for booking', bookingId });
  await q('insert into wallet_holds(booking_id, user_id, amount, remaining, allocations) values ($1,$2,$3,$3,$4)', [bookingId, userId, amount, JSON.stringify(allocs)], c);
  await addTxn(c, userId, 'hold', { source: 'booking', availableDelta: -amount, heldDelta: amount, bookingId, ledgerTxn: t, memo: 'Reserved for a booking' });
}
async function returnHeld(c: PoolClient, h: any, amount: number, memo: string) {
  if (amount <= 0) return;
  const t = await post(c, [{ account: 'WALLET_HELD', debit: amount, owner: h.user_id }, { account: 'WALLET_CREDIT', credit: amount, owner: h.user_id }], { memo, bookingId: h.booking_id });
  const rest = await giveBack(c, h.allocations, amount);
  await q('update wallet_holds set remaining = remaining - $2, allocations=$3, updated_at=now() where id=$1', [h.id, amount, JSON.stringify(rest)], c);
  await addTxn(c, h.user_id, 'release', { source: 'booking', availableDelta: amount, heldDelta: -amount, bookingId: h.booking_id, ledgerTxn: t, memo });
}
/** Booking ended without being paid: give all reserved credit back. */
export async function releaseHold(c: PoolClient, bookingId: string) {
  const h = await q1<any>("select * from wallet_holds where booking_id=$1 and status='held' for update", [bookingId], c);
  if (!h) return 0;
  await lockUser(c, h.user_id);
  await returnHeld(c, h, h.remaining, 'Booking ended: credit returned');
  await q("update wallet_holds set status='released', updated_at=now() where id=$1", [h.id], c);
  await q("update bookings set wallet_reserved=0 where id=$1", [bookingId], c);
  return h.remaining as number;
}
/** At completion: take what the final fare needs (topping up from free credit for full-credit bookings) and give back the rest. */
export async function captureHold(c: PoolClient, bookingId: string, wanted: number, topUp: boolean) {
  let h = await q1<any>("select * from wallet_holds where booking_id=$1 and status='held' for update", [bookingId], c);
  if (!h) return 0;
  await lockUser(c, h.user_id);
  if (topUp && wanted > h.remaining) {
    await expireFor(c, h.user_id);
    const extra = Math.min(wanted - h.remaining, (await balances(h.user_id, c)).available);
    if (extra > 0) {
      const al = await takeFromLots(c, h.user_id, extra);
      const t = await post(c, [{ account: 'WALLET_CREDIT', debit: extra, owner: h.user_id }, { account: 'WALLET_HELD', credit: extra, owner: h.user_id }], { memo: 'credit reserved for final fare', bookingId });
      await q('update wallet_holds set amount=amount+$2, remaining=remaining+$2, allocations=$3 where id=$1', [h.id, extra, JSON.stringify([...h.allocations, ...al])], c);
      await addTxn(c, h.user_id, 'hold', { source: 'booking', availableDelta: -extra, heldDelta: extra, bookingId, ledgerTxn: t, memo: 'Extra reserved for the final fare' });
      h = (await q1<any>('select * from wallet_holds where id=$1', [h.id], c))!;
    }
  }
  const apply = Math.min(wanted, h.remaining);
  await returnHeld(c, h, h.remaining - apply, 'Unused reserved credit returned');
  await q("update wallet_holds set status='captured', updated_at=now() where id=$1", [h.id], c);
  return apply;
}
/** After the settlement ledger entries consumed WALLET_HELD. */
export async function settleHold(c: PoolClient, bookingId: string) {
  const h = await q1<any>("select * from wallet_holds where booking_id=$1 and status='captured' for update", [bookingId], c);
  if (!h) return;
  await q("update wallet_holds set status='settled', remaining=0, updated_at=now() where id=$1", [h.id], c);
  await addTxn(c, h.user_id, 'spend', { source: 'booking', heldDelta: -h.remaining, bookingId, memo: 'Paid for a trip' });
}

/** Reserve credit for a new booking (full or partial). Runs inside the booking transaction. */
export async function reserveForBooking(c: PoolClient, b: { id: string; passenger_id: string; estimated_fare: number }, mode: 'full' | 'partial', requested?: number) {
  await requireEnabled();
  await lockUser(c, b.passenger_id); await expireFor(c, b.passenger_id);
  const { available } = await balances(b.passenger_id, c);
  let amount = mode === 'full' ? b.estimated_fare : Math.min(requested ?? available, b.estimated_fare);
  if (mode === 'partial' && amount >= b.estimated_fare) mode = 'full';
  if (mode === 'full') amount = b.estimated_fare;
  if (amount <= 0 || available < amount) throw conflict('insufficient_credit', 'Not enough credit', { available, needed: amount });
  await holdCredit(c, b.id, b.passenger_id, amount);
  await q('update bookings set wallet_mode=$2, wallet_reserved=$3 where id=$1', [b.id, mode, amount], c);
  return { mode, amount };
}

// ---------------- statement, summary ----------------
export async function statement(userId: string, limit = 30, before?: number) {
  const rows = await q<any>(`select id, kind, source, available_delta, held_delta, available_after, held_after, booking_id, memo, created_at from wallet_txns
    where user_id=$1 and ($2::bigint is null or id < $2) order by id desc limit $3`, [userId, before ?? null, limit]);
  return { balance: await balances(userId), entries: rows, next_before: rows.length === limit ? rows[rows.length - 1].id : null };
}
export async function creditSummary(userId: string) {
  const b = await balances(userId);
  const exp = await q1<any>(`select min(expires_at) next_expiry, coalesce(sum(remaining) filter (where expires_at is not null and expires_at <= now() + interval '30 days'),0)::int expiring_30d from wallet_lots where user_id=$1 and remaining > 0 and expires_at is not null`, [userId]);
  return { currency: 'RWF', available: b.available, reserved: b.held, next_expiry: exp?.next_expiry ?? null, expiring_within_30_days: exp?.expiring_30d ?? 0, note: 'Credit can only be spent on trips. It cannot be withdrawn or topped up with cash.' };
}

// ---------------- staff adjustments (maker-checker) ----------------
async function applyAdjustment(c: PoolClient, a: any, by: string) {
  const memo = `${a.source}: ${a.reason}`.slice(0, 200);
  if (a.amount > 0) await grantCredit(c, a.user_id, a.amount, (a.source === 'goodwill' ? 'goodwill' : a.source === 'adjustment' ? 'adjustment' : a.source) as CreditSource, { memo, refType: 'adjustment', refId: a.id, idemKey: `adj:${a.id}`, by });
  else await debitCredit(c, a.user_id, -a.amount, { memo, refType: 'adjustment', refId: a.id, by });
}
export async function requestAdjustment(staff: Actor, userId: string, amount: number, reason: string, source: 'adjustment' | 'promo' | 'quest' | 'goodwill' = 'adjustment') {
  if (!Number.isInteger(amount) || amount === 0) throw badRequest('invalid_amount');
  if (!reason || reason.trim().length < 10) throw badRequest('reason_required', 'A reason of at least 10 characters is required');
  if (amount < 0 && source !== 'adjustment') throw badRequest('invalid_amount');
  const threshold = await getSetting('wallet.adjust_approval_threshold');
  return tx(async (c) => {
    if (!(await q1('select 1 from users where id=$1', [userId], c))) throw notFound('user');
    const a = (await q<any>('insert into wallet_adjustments(user_id, amount, source, reason, requested_by) values ($1,$2,$3,$4,$5) returning *', [userId, amount, source, reason.trim(), staff.id], c))[0];
    await audit(staff, 'credit.adjustment.requested', 'user', userId, undefined, { id: a.id, amount, source, reason }, c);
    if (Math.abs(amount) >= threshold) return { ...a, needs_approval: true };
    await applyAdjustment(c, a, staff.id!);
    const done = (await q<any>("update wallet_adjustments set status='applied', decided_by=$2, decided_at=now() where id=$1 returning *", [a.id, staff.id], c))[0];
    await audit(staff, 'credit.adjustment.applied', 'user', userId, undefined, { id: a.id, amount }, c);
    return { ...done, needs_approval: false };
  });
}
export async function decideAdjustment(approver: Actor, id: string, approve: boolean) {
  return tx(async (c) => {
    const a = await q1<any>('select * from wallet_adjustments where id=$1 for update', [id], c);
    if (!a) throw notFound('adjustment');
    if (a.status !== 'pending') throw conflict('already_decided', `Adjustment is ${a.status}`);
    if (a.requested_by === approver.id) throw forbidden('Maker-checker: the requester cannot approve their own credit change');
    if (approve) await applyAdjustment(c, a, approver.id!);
    const r = (await q<any>('update wallet_adjustments set status=$2, decided_by=$3, decided_at=now() where id=$1 returning *', [id, approve ? 'applied' : 'rejected', approver.id], c))[0];
    await audit(approver, approve ? 'credit.adjustment.applied' : 'credit.adjustment.rejected', 'user', a.user_id, a, r, c);
    return r;
  });
}

// ---------------- reconciliation ----------------
/** Ledger vs the operational tables, per customer. Any row returned is a discrepancy a human must look at. */
export async function creditReconciliation(db: Db = pool) {
  const diff = (acct: string, table: string, col: string, where = 'true') => q<any>(
    `with l as (select owner_user_id u, sum(credit-debit)::bigint bal from ledger_entries where account_code='${acct}' group by 1),
          s as (select user_id u, sum(${col})::bigint bal from ${table} where ${where} group by 1)
     select coalesce(l.u, s.u) user_id, coalesce(l.bal,0)::int ledger, coalesce(s.bal,0)::int operational from l full join s on l.u = s.u where coalesce(l.bal,0) <> coalesce(s.bal,0)`, [], db);
  const [credit, held, deposits] = await Promise.all([
    diff('WALLET_CREDIT', 'wallet_lots', 'remaining'), diff('WALLET_HELD', 'wallet_holds', 'remaining'), diff('DEPOSIT_HELD', 'booking_deposits', 'held')]);
  const neg = await q<any>(`select owner_user_id user_id, account_code, sum(credit-debit)::int bal from ledger_entries where account_code in ('WALLET_CREDIT','WALLET_HELD','DEPOSIT_HELD') group by 1,2 having sum(credit-debit) < 0`, [], db);
  const tot = await q1<any>(`select coalesce(sum(credit-debit) filter (where account_code='WALLET_CREDIT'),0)::int credit_liability, coalesce(sum(credit-debit) filter (where account_code='WALLET_HELD'),0)::int held_liability,
    coalesce(sum(credit-debit) filter (where account_code='DEPOSIT_HELD'),0)::int deposits_held from ledger_entries where account_code in ('WALLET_CREDIT','WALLET_HELD','DEPOSIT_HELD')`, [], db);
  return { ok: !credit.length && !held.length && !deposits.length && !neg.length, credit_mismatches: credit, hold_mismatches: held, deposit_mismatches: deposits, negative_balances: neg, totals: tot };
}

/** Pay an Abasare deposit from free credit. */
export async function spendForDeposit(c: PoolClient, userId: string, amount: number, bookingId: string) {
  await lockUser(c, userId); await expireFor(c, userId);
  await takeFromLots(c, userId, amount);
  const t = await post(c, [{ account: 'WALLET_CREDIT', debit: amount, owner: userId }, { account: 'DEPOSIT_HELD', credit: amount, owner: userId }], { memo: 'deposit paid with credit', bookingId });
  await addTxn(c, userId, 'spend', { source: 'deposit', availableDelta: -amount, bookingId, ledgerTxn: t, memo: 'Deposit for an Abasare booking' });
}
