import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { q, q1, type Db, pool } from '../db.js';

export type Entry = { account: string; debit?: number; credit?: number; owner?: string | null };
/** Post one balanced transaction. The DB constraint trigger rejects the commit if debits != credits. */
export async function post(c: PoolClient, entries: Entry[], ctx: { memo: string; bookingId?: string | null; paymentId?: string | null }) {
  const txn = randomUUID();
  const live = entries.filter((e) => (e.debit ?? 0) > 0 || (e.credit ?? 0) > 0);
  const d = live.reduce((s, e) => s + (e.debit ?? 0), 0), cr = live.reduce((s, e) => s + (e.credit ?? 0), 0);
  if (d !== cr) throw new Error(`unbalanced ledger transaction (${d} vs ${cr}): ${ctx.memo}`);
  for (const e of live)
    await q(`insert into ledger_entries(txn_id, account_code, owner_user_id, booking_id, payment_id, debit, credit, memo) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [txn, e.account, e.owner ?? null, ctx.bookingId ?? null, ctx.paymentId ?? null, e.debit ?? 0, e.credit ?? 0, ctx.memo], c);
  return txn;
}

export async function accountBalance(account: string, owner: string | null, db: Db = pool): Promise<{ debit: number; credit: number }> {
  const r = await q1<any>(`select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries where account_code=$1 and ($2::uuid is null or owner_user_id=$2)`, [account, owner], db);
  return { debit: r.d, credit: r.c };
}

/** Driver money position derived purely from the ledger. */
export async function driverBalance(driverId: string, db: Db = pool) {
  const p = await accountBalance('DRIVER_PAYABLE', driverId, db);
  const cash = await accountBalance('CASH_WITH_DRIVERS', driverId, db);
  const payable = p.credit - p.debit;            // owed to driver (net of payouts requested)
  const cashHeld = cash.debit - cash.credit;     // cash the driver collected and still holds
  return {
    payable, cash_held: cashHeld,
    eligible_payout: Math.max(0, payable - cashHeld),
    owed_to_platform: Math.max(0, cashHeld - payable),
  };
}

/** Whole-ledger integrity check used by reconciliation: every txn balances and totals match. */
export async function integrityReport(db: Db = pool) {
  const t = await q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries', [], db);
  const bad = await q<any>('select txn_id, sum(debit) d, sum(credit) c from ledger_entries group by txn_id having sum(debit) <> sum(credit)', [], db);
  return { total_debit: t.d, total_credit: t.c, balanced: t.d === t.c && bad.length === 0, unbalanced_txns: bad.length };
}
