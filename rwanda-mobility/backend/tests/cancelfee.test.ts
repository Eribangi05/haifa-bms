import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const ledgerBalanced = async () => {
  const r = await t.db.q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries');
  assert.equal(r.d, r.c, 'ledger must balance');
  const bad = await t.db.q('select txn_id from ledger_entries group by txn_id having sum(debit) <> sum(credit)');
  assert.equal(bad.length, 0);
};
const receivable = async (uid: string) => { const r = await t.db.q1<any>("select coalesce(sum(debit)-sum(credit),0)::int b from ledger_entries where account_code='PASSENGER_RECEIVABLE' and owner_user_id=$1", [uid]); return r.b as number; };
const FEE = 500;

/** Passenger books, driver accepts, grace period passes, passenger cancels => a fee debt. */
async function cancelWithFee(p: any, d: any) {
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  await t.db.q("update bookings set assigned_at = now() - interval '10 minutes' where id=$1", [id]);
  const c = await t.api('POST', `/bookings/${id}/cancel`, { token: p.token, body: { reason: 'changed_mind' } });
  assert.equal(c.json.cancel_fee, FEE);
  return id as string;
}

test('cancellation fee becomes a ledger-backed debt, is added to the next quote, collected in cash and settled', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const base = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0];
  assert.ok(!base.fare.lines.some((l: any) => l.code === 'previous_cancellation_fee'));

  const cancelled = await cancelWithFee(p, d);
  const debt = await t.db.q1<any>('select * from passenger_debts where booking_id=$1', [cancelled]);
  assert.equal(debt.amount, FEE); assert.equal(debt.status, 'open'); assert.equal(debt.kind, 'cancellation_fee'); assert.equal(debt.user_id, p.id);
  assert.equal(await receivable(p.id), FEE);
  assert.equal((await t.db.q1<any>("select coalesce(sum(credit),0)::int c from ledger_entries where account_code='CANCELLATION_FEE_REVENUE' and booking_id=$1", [cancelled])).c, FEE);
  await ledgerBalanced();
  const mine = await t.api('GET', '/users/me/debts', { token: p.token });
  assert.equal(mine.json.total, FEE);

  // idempotent: recording the same booking again changes nothing
  const { recordDebt } = await import('../src/services/debts.ts');
  const { tx } = await import('../src/db.ts');
  assert.equal(await tx((c) => recordDebt(c, p.id, cancelled, FEE, 'cancellation_fee')), null);
  assert.equal((await t.db.q1<any>('select count(*)::int n from passenger_debts where booking_id=$1', [cancelled])).n, 1);
  assert.equal(await receivable(p.id), FEE);

  // next quote: separate pass-through line in three languages; fare, tax and driver income unchanged
  const e = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0];
  const line = e.fare.lines.find((l: any) => l.code === 'previous_cancellation_fee');
  assert.equal(line.amount, FEE); assert.ok(line.label_rw && line.label_fr && line.label_en);
  assert.equal(line.label_fr, 'Frais d\'annulation précédents');
  assert.equal(e.fare.total, base.fare.total + FEE); assert.equal(e.fare.subtotal, base.fare.subtotal); assert.equal(e.fare.tax, base.fare.tax);
  assert.equal(e.fare.debt, FEE);

  // book (cash) -> trip -> pay: the fee is collected with the fare and the debt settled
  const b = await t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: e.quote_id, payment_method: 'cash', pickup_name: 'KCC', dest_name: 'Kimironko' } });
  assert.ok(b.status < 300, JSON.stringify(b.json));
  const id = b.json.booking.id;
  assert.equal(b.json.booking.estimated_fare, e.fare.total);
  assert.equal((await t.db.q1<any>('select applied_booking_id from passenger_debts where id=$1', [debt.id])).applied_booking_id, id);
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).json.options[0].fare.debt ?? 0, 0, 'a carried fee is not quoted twice');
  const done = await t.runTrip(p, d, id);
  assert.equal(done.final_fare ?? done.total, e.fare.total);
  const cash = await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: e.fare.total } });
  assert.equal(cash.status, 200, JSON.stringify(cash.json));
  const after = await t.db.q1<any>('select * from passenger_debts where id=$1', [debt.id]);
  assert.equal(after.status, 'settled'); assert.equal(after.settled_booking_id, id);
  assert.equal(await receivable(p.id), 0);
  const earn = await t.db.q1<any>('select * from driver_earnings where booking_id=$1', [id]);
  assert.equal(earn.fare_subtotal, e.fare.subtotal, 'the fee is not driver income and carries no commission or tax');
  assert.equal(earn.net + earn.fleet_share + earn.commission, earn.fare_subtotal);
  await ledgerBalanced();
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).json.options[0].fare.total, base.fare.total);
});

test('mobile-money payment settles the carried fee; settlement is idempotent', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await cancelWithFee(p, d);
  const { res, quote } = await t.book(p.token, 'moto', 'mtn_momo'); const id = res.json.booking.id;
  assert.equal(quote.fare.debt, FEE);
  await t.runTrip(p, d, id);
  const pay = await t.api('POST', '/payments', { token: p.token, body: { booking_id: id, msisdn: '0788123456' } });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  assert.equal(pay.json.amount, quote.fare.total);
  await t.api('POST', '/dev/momo/settle', { body: { reference: pay.json.reference, status: 'SUCCESS' } });
  const g = await t.api('GET', `/payments/${pay.json.id}`, { token: p.token });
  assert.equal(g.json.status, 'SUCCESS');
  assert.equal((await t.db.q1<any>("select status from passenger_debts where user_id=$1", [p.id])).status, 'settled');
  assert.equal(await receivable(p.id), 0);
  const { settleBookingPayment } = await import('../src/services/payments.ts');
  const { tx } = await import('../src/db.ts');
  const before = (await t.db.q1<any>('select count(*)::int n from ledger_entries')).n;
  await tx(async (c) => { await settleBookingPayment(c, id, await t.db.q1<any>('select * from payments where id=$1', [pay.json.id])); });
  assert.equal((await t.db.q1<any>('select count(*)::int n from ledger_entries')).n, before, 'second settlement posts nothing');
  await ledgerBalanced();
});

test('no-show fee also becomes a debt; cancelling the booking that carried a fee returns it to the open balance', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  await t.api('POST', '/drivers/me/location', { token: d.token, body: { lat: -1.9541, lng: 30.0927 } });
  await t.api('POST', `/bookings/${id}/arrived`, { token: d.token });
  await t.db.q("update bookings set arrived_at = now() - interval '30 minutes' where id=$1", [id]);
  const ns = await t.api('POST', `/bookings/${id}/no-show`, { token: d.token });
  assert.equal(ns.status, 200, JSON.stringify(ns.json));
  const debt = await t.db.q1<any>('select * from passenger_debts where booking_id=$1', [id]);
  assert.equal(debt.kind, 'no_show_fee'); assert.equal(debt.amount, 1000); assert.equal(await receivable(p.id), 1000);

  // book carrying the fee, then cancel before assignment: no new fee, the old fee is open again
  const { res: r2, quote } = await t.book(p.token); assert.equal(quote.fare.debt, 1000);
  const id2 = r2.json.booking.id;
  assert.equal((await t.db.q1<any>('select applied_booking_id from passenger_debts where id=$1', [debt.id])).applied_booking_id, id2);
  const c = await t.api('POST', `/bookings/${id2}/cancel`, { token: p.token, body: { reason: 'changed_mind' } });
  assert.equal(c.json.cancel_fee, 0);
  const back = await t.db.q1<any>('select status, applied_booking_id from passenger_debts where id=$1', [debt.id]);
  assert.equal(back.status, 'open'); assert.equal(back.applied_booking_id, null);
  await ledgerBalanced();
});

test('staff can waive a fee with a reason: permission-gated, audited, ledger-consistent, not while in use', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const cancelled = await cancelWithFee(p, d);
  const debt = await t.db.q1<any>('select id from passenger_debts where booking_id=$1', [cancelled]);
  const agent = await t.staff('support_agent'), officer = await t.staff('finance_officer');
  assert.equal((await t.api('POST', `/admin/finance/passenger-debts/${debt.id}/waive`, { token: agent.token, body: { reason: 'goodwill gesture' } })).status, 403);
  assert.equal((await t.api('POST', `/admin/finance/passenger-debts/${debt.id}/waive`, { token: p.token, body: { reason: 'goodwill gesture' } })).status, 403);
  assert.equal((await t.api('POST', `/admin/finance/passenger-debts/${debt.id}/waive`, { token: officer.token, body: { reason: 'x' } })).status, 400);
  // in use by a live booking
  const { res } = await t.book(p.token); const live = res.json.booking.id;
  const busy = await t.api('POST', `/admin/finance/passenger-debts/${debt.id}/waive`, { token: officer.token, body: { reason: 'goodwill gesture' }, headers: { 'accept-language': 'fr' } });
  assert.equal(busy.status, 409); assert.equal(busy.json.error.code, 'debt_in_use'); assert.match(busy.json.error.message, /course en cours/);
  await t.api('POST', `/bookings/${live}/cancel`, { token: p.token, body: { reason: 'changed_mind' } });
  const w = await t.api('POST', `/admin/finance/passenger-debts/${debt.id}/waive`, { token: officer.token, body: { reason: 'goodwill gesture' } });
  assert.equal(w.status, 200); assert.equal(w.json.debt.status, 'waived');
  assert.equal(await receivable(p.id), 0);
  assert.equal((await t.db.q1<any>("select coalesce(sum(debit),0)::int s from ledger_entries where account_code='CANCELLATION_FEE_WAIVED'")).s >= FEE, true);
  const log = await t.db.q1<any>("select actor_id, after from audit_logs where action='passenger_debt.waived' and entity_id=$1", [debt.id]);
  assert.equal(log.actor_id, officer.id); assert.equal(log.after.waive_reason, 'goodwill gesture');
  assert.equal((await t.api('POST', `/admin/finance/passenger-debts/${debt.id}/waive`, { token: officer.token, body: { reason: 'goodwill gesture' } })).status, 409, 'cannot waive twice');
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).json.options[0].fare.debt ?? 0, 0);
  const list = await t.api('GET', `/admin/finance/passenger-debts?user_id=${p.id}`, { token: officer.token });
  assert.equal(list.json.debts[0].status, 'waived'); assert.equal(list.json.debts[0].waive_reason, 'goodwill gesture');
  await ledgerBalanced();
});

test('concurrency: one fee can be carried by only one booking, and a stale quote must be re-priced', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await cancelWithFee(p, d);
  const q1 = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0];
  const q2 = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0];
  assert.equal(q1.fare.debt, FEE); assert.equal(q2.fare.debt, FEE);
  const mk = (q: any) => t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q.quote_id, payment_method: 'cash' } });
  const [a, b] = await Promise.all([mk(q1), mk(q2)]);
  const ok = [a, b].filter((r) => r.status < 300);
  assert.equal(ok.length, 1, JSON.stringify([a.json, b.json]));
  const carried = await t.db.q("select * from passenger_debts where user_id=$1 and applied_booking_id is not null", [p.id]);
  assert.equal(carried.length, 1);
  assert.equal(carried[0].applied_booking_id, ok[0].json.booking.id);
  // a stale quote after the fee was waived elsewhere is refused with a localised "price changed"
  await t.reset();
  await t.api('PATCH', '/drivers/me/availability', { token: d.token, body: { online: true } });
  await t.api('POST', '/drivers/me/location', { token: d.token, body: { lat: -1.954, lng: 30.0927 } });
  await t.db.q("update passenger_debts set applied_booking_id=null where user_id=$1", [p.id]);
  const stale = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0];
  await t.db.q("update passenger_debts set status='waived' where user_id=$1", [p.id]);
  const r = await t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID(), 'accept-language': 'rw' }, body: { quote_id: stale.quote_id, payment_method: 'cash' } });
  assert.equal(r.status, 409); assert.equal(r.json.error.code, 'fee_changed'); assert.match(r.json.error.message, /Amafaranga/);
});

test('a personal fee can be stripped from a quote (corporate bookings never carry it)', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await cancelWithFee(p, d);
  const { quote } = await t.book(p.token); // personal booking carries it; cancel to release
  assert.equal(quote.fare.debt, FEE);
  const { withoutDebt } = await import('../src/services/debts.ts');
  const stripped = withoutDebt(quote.fare);
  assert.equal(stripped.total, quote.fare.total - FEE); assert.ok(!stripped.lines.some((l: any) => l.code === 'previous_cancellation_fee'));
});
