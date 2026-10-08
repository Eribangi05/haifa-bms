import type { PoolClient } from 'pg';
import { q, q1 } from '../db.js';
import { post } from './ledger.js';
import { captureHold, lockUser, recordCredit, releaseHold, settleHold } from './credit.js';
import { notify } from './notify.js';

/**
 * Prepaid parts of a booking: reserved credit (wallet_holds) and the Abasare deposit (booking_deposits).
 * Lifecycle: reserve at booking -> capture at completion (final fare known) -> settle inside the fare settlement ledger entry
 * -> or release when the booking ends unpaid. No module in here imports the booking machine (it imports us).
 */

/** Refund what is left of a paid deposit as customer credit. */
async function refundDepositToCredit(c: PoolClient, d: any, amount: number, memo: string) {
  if (amount <= 0) return;
  await lockUser(c, d.user_id);
  const t = await post(c, [{ account: 'DEPOSIT_HELD', debit: amount, owner: d.user_id }, { account: 'WALLET_CREDIT', credit: amount, owner: d.user_id }], { memo, bookingId: d.booking_id });
  await recordCredit(c, d.user_id, amount, 'deposit_refund', t, { bookingId: d.booking_id, memo });
  await q('update booking_deposits set held = held - $2, refunded = refunded + $2, updated_at=now() where id=$1', [d.id, amount], c);
}

/** Booking cancelled with a late-cancellation fee: the deposit pays the fee first. Returns what was retained. Call before the cancelling transition. */
export async function retainDepositFee(c: PoolClient, bookingId: string, fee: number): Promise<number> {
  if (fee <= 0) return 0;
  const d = await q1<any>("select * from booking_deposits where booking_id=$1 and status='paid' for update", [bookingId], c);
  if (!d || d.held <= 0) return 0;
  const keep = Math.min(fee, d.held);
  await post(c, [{ account: 'DEPOSIT_HELD', debit: keep, owner: d.user_id }, { account: 'CANCELLATION_FEE_REVENUE', credit: keep }], { memo: 'cancellation fee taken from deposit', bookingId });
  await q('update booking_deposits set held = held - $2, retained = retained + $2, updated_at=now() where id=$1', [d.id, keep], c);
  return keep;
}

/** The booking ended without a fare (cancelled, no driver): give reserved credit back and refund the deposit as credit. */
export async function releasePrepaid(c: PoolClient, bookingId: string) {
  await releaseHold(c, bookingId);
  const d = await q1<any>("select * from booking_deposits where booking_id=$1 and status in ('awaiting_payment','pending','failed','paid') for update", [bookingId], c);
  if (!d) return;
  if (d.status === 'paid') {
    const back = d.held;
    await refundDepositToCredit(c, d, back, 'Deposit refunded as credit');
    await q("update booking_deposits set status = case when $2 > 0 then 'refunded' else 'cancelled' end, updated_at=now() where id=$1", [d.id, back], c);
    if (back > 0) await notify(d.user_id, 'deposit_refunded', { amount: back }, { db: c });
  } else await q("update booking_deposits set status='cancelled', updated_at=now() where id=$1", [d.id], c);
}

/** Completion: decide how much of the final fare the deposit and the reserved credit cover. Excess goes back to the customer as credit. */
export async function applyPrepaid(c: PoolClient, bookingId: string) {
  const b = (await q1<any>('select * from bookings where id=$1 for update', [bookingId], c))!;
  const final = b.final_fare as number;
  let dep = 0;
  const d = await q1<any>("select * from booking_deposits where booking_id=$1 and status='paid' for update", [bookingId], c);
  if (d) {
    dep = Math.min(d.held, final);
    await refundDepositToCredit(c, d, d.held - dep, 'Deposit above the final fare refunded as credit');
    await q("update booking_deposits set status='captured', applied=$2, updated_at=now() where id=$1", [d.id, dep], c);
    if (d.held - dep > 0) await notify(d.user_id, 'deposit_refunded', { amount: d.held - dep }, { db: c });
  }
  const wal = await captureHold(c, bookingId, final - dep, b.wallet_mode === 'full');
  if (dep || wal || b.wallet_mode) {
    const fullyCovered = dep + wal >= final;
    await q('update bookings set wallet_applied=$2, deposit_applied=$3, payment_method = case when payment_method=\'wallet\' and not $4 then \'cash\' else payment_method end where id=$1', [bookingId, wal, dep, fullyCovered], c);
  }
  const row = (await q1<any>('select * from bookings where id=$1', [bookingId], c))!;
  return { booking: row, total: dep + wal, remaining: final - dep - wal };
}

/** Inside the fare settlement, after its ledger entries debited WALLET_HELD / DEPOSIT_HELD. */
export async function settlePrepaid(c: PoolClient, bookingId: string) {
  await settleHold(c, bookingId);
  await q("update booking_deposits set held=0, status='applied', updated_at=now() where booking_id=$1 and status='captured'", [bookingId], c);
}
