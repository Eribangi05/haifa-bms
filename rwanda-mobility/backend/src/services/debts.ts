import type { PoolClient } from 'pg';
import { q, q1, tx, pool, type Db } from '../db.js';
import { conflict, badRequest, notFound } from '../errors.js';
import { post } from './ledger.js';
import { audit, type Actor } from './audit.js';
import type { Breakdown, Line } from './pricing.js';

/**
 * Passenger cancellation / no-show fee debts.
 * Lifecycle: open (applied_booking_id null) -> carried by exactly one booking (applied_booking_id set, still open)
 *            -> settled when that booking's payment completes (or waived by staff while not in use).
 * Ledger: fee charged  Dr PASSENGER_RECEIVABLE / Cr CANCELLATION_FEE_REVENUE
 *         fee collected as part of the next payment: Cr PASSENGER_RECEIVABLE (inside settleBookingPayment)
 *         fee waived   Dr CANCELLATION_FEE_WAIVED / Cr PASSENGER_RECEIVABLE
 */

/** Records the fee owed for a cancelled booking. Idempotent per booking (unique booking_id). Call inside the cancelling transaction. */
export async function recordDebt(c: PoolClient, passengerId: string, bookingId: string, amount: number, kind: 'cancellation_fee' | 'no_show_fee') {
  if (!Number.isInteger(amount) || amount <= 0) return null;
  const row = await q1<{ id: string }>(
    `insert into passenger_debts(user_id, booking_id, kind, amount) values ($1,$2,$3,$4) on conflict (booking_id) do nothing returning id`, [passengerId, bookingId, kind, amount], c);
  if (!row) return null;     // already recorded: nothing more to post
  await post(c, [{ account: 'PASSENGER_RECEIVABLE', debit: amount, owner: passengerId }, { account: 'CANCELLATION_FEE_REVENUE', credit: amount }],
    { memo: `${kind.replace('_', ' ')} for cancelled booking`, bookingId });
  return row.id;
}

/** What the next quote carries: open debts not yet attached to a booking. */
export async function quotableDebt(passengerId: string, db: Db = pool): Promise<number> {
  return (await q1<{ s: number }>("select coalesce(sum(amount),0)::int s from passenger_debts where user_id=$1 and status='open' and applied_booking_id is null", [passengerId], db))!.s;
}

/** Adds the pass-through line. It is collected on top of the fare (not taxed, no commission, not driver income). */
export function withDebt(bd: Breakdown, amount: number): Breakdown {
  if (amount <= 0) return bd;
  const line: Line = {
    code: 'previous_cancellation_fee', label_en: 'Previous cancellation fee', label_rw: 'Amafaranga yo guhagarika urugendo rwabanje', label_fr: 'Frais d\'annulation précédents',
    amount, passthrough: true,
  };
  return { ...bd, lines: [...bd.lines, line], debt: amount, total: bd.total + amount };
}

/** Removes the debt (corporate-paid bookings never carry a personal fee). */
export function withoutDebt(bd: Breakdown): Breakdown {
  if (!bd.debt) return bd;
  return { ...bd, lines: bd.lines.filter((l) => l.code !== 'previous_cancellation_fee'), total: bd.total - bd.debt, debt: 0 };
}

/**
 * Attach the passenger's open debts to a new booking. Must equal what the quote showed, otherwise the price changed
 * (a fee was added, waived, or already carried by another booking) and the passenger must re-quote.
 */
export async function applyDebts(c: PoolClient, passengerId: string, bookingId: string, quoted: number) {
  const rows = await q<{ id: string; amount: number }>(
    "select id, amount from passenger_debts where user_id=$1 and status='open' and applied_booking_id is null order by created_at for update", [passengerId], c);
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  if (sum !== quoted) throw conflict('fee_changed', 'Your outstanding fees changed; please re-check the price.');
  if (rows.length) await q('update passenger_debts set applied_booking_id=$2 where id = any($1::uuid[])', [rows.map((r) => r.id), bookingId], c);
}

/** The booking ended without being paid: the fee goes back to the passenger's open balance. */
export async function releaseDebts(c: PoolClient, bookingId: string) {
  await q("update passenger_debts set applied_booking_id=null where applied_booking_id=$1 and status='open'", [bookingId], c);
}

/**
 * A search that ended with NO_DRIVER_FOUND released its fee (it can ride on a later booking). If a dispatcher restarts that search, carry the
 * fee again; if the open balance changed meanwhile, re-state the booking's fare line so what is collected always equals what is carried.
 * Returns the updated booking row, or null when nothing changed.
 */
export async function reattachDebts(c: PoolClient, b: { id: string; passenger_id: string; payer_type?: string; fare_breakdown: Breakdown }) {
  if (b.payer_type === 'corporate') return null;
  const carried = b.fare_breakdown?.debt ?? 0;
  const rows = await q<{ id: string; amount: number }>(
    "select id, amount from passenger_debts where user_id=$1 and status='open' and applied_booking_id is null order by created_at for update", [b.passenger_id], c);
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  if (rows.length) await q('update passenger_debts set applied_booking_id=$2 where id = any($1::uuid[])', [rows.map((r) => r.id), b.id], c);
  if (sum === carried) return null;
  const bd = withDebt(withoutDebt(b.fare_breakdown), sum);
  return (await q<any>('update bookings set fare_breakdown=$2, estimated_fare=$3 where id=$1 returning *', [b.id, JSON.stringify(bd), bd.total], c))[0];
}

/** Called from settleBookingPayment (exactly once per booking). Marks the carried debts settled and clears the receivable. */
export async function settleDebts(c: PoolClient, bookingId: string, expected: number) {
  const rows = await q<{ id: string; amount: number }>("select id, amount from passenger_debts where applied_booking_id=$1 and status='open' for update", [bookingId], c);
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  if (sum !== expected) throw new Error(`debt mismatch on booking ${bookingId}: carried ${sum}, expected ${expected}`);
  if (rows.length) await q("update passenger_debts set status='settled', settled_booking_id=$2, settled_at=now() where id = any($1::uuid[])", [rows.map((r) => r.id), bookingId], c);
  return sum;
}

/** Staff waiver: permission-gated by the route, reason required, audited, own ledger entry. Not allowed while a live booking carries it. */
export async function waiveDebt(staff: Actor, debtId: string, reason: string) {
  if (!reason || reason.trim().length < 5) throw badRequest('reason_required');
  return tx(async (c) => {
    const d = await q1<any>('select * from passenger_debts where id=$1 for update', [debtId], c);
    if (!d) throw notFound('debt');
    if (d.status !== 'open') throw conflict('already_decided', `Fee is already ${d.status}`);
    if (d.applied_booking_id) throw conflict('debt_in_use', 'This fee is attached to an active booking and cannot be waived yet');
    await post(c, [{ account: 'CANCELLATION_FEE_WAIVED', debit: d.amount }, { account: 'PASSENGER_RECEIVABLE', credit: d.amount, owner: d.user_id }],
      { memo: `waived: ${reason.slice(0, 100)}`, bookingId: d.booking_id });
    const out = (await q<any>("update passenger_debts set status='waived', waived_by=$2, waive_reason=$3, waived_at=now() where id=$1 returning *", [debtId, staff.id, reason.trim()], c))[0];
    await audit(staff, 'passenger_debt.waived', 'passenger_debt', debtId, d, out, c);
    return out;
  });
}

export async function listDebts(filter: { user_id?: string; status?: string; limit: number }) {
  return q(`select d.id, d.user_id, u.display_name, u.phone, d.booking_id, b.ref booking_ref, d.kind, d.amount, d.status, d.applied_booking_id, d.settled_booking_id,
              d.waive_reason, d.created_at, d.settled_at, d.waived_at
            from passenger_debts d join users u on u.id=d.user_id join bookings b on b.id=d.booking_id
            where ($1::uuid is null or d.user_id=$1) and ($2::text is null or d.status=$2) order by d.created_at desc limit $3`,
    [filter.user_id ?? null, filter.status ?? null, filter.limit]);
}

export const myDebts = (userId: string) =>
  q("select id, booking_id, kind, amount, status, created_at from passenger_debts where user_id=$1 and status='open' order by created_at", [userId]);
