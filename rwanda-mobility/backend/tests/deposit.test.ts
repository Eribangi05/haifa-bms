import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';
import { abasareKit } from './helpersAbasare.ts';

let t: Ctx; let K: ReturnType<typeof abasareKit>; let fo: any, dispatcher: any;
before(async () => {
  t = await boot('rwanda_mobility_test');
  K = abasareKit(t, await t.staff('driver_verifier')); fo = await t.staff('finance_officer'); dispatcher = await t.staff('dispatcher');
});
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); await setSetting('abasare.deposit_percent', 30); });

const setSetting = (k: string, v: unknown) => t.db.q("insert into system_settings(key,value) values ($1,$2) on conflict (key) do update set value=excluded.value", [k, JSON.stringify(v)]);
const wallet = async (token: string) => (await t.api('GET', '/wallet', { token })).json;
const view = async (token: string, id: string) => (await t.api('GET', `/bookings/${id}`, { token })).json;
const pay = (token: string, id: string, body: any) => t.api('POST', `/bookings/${id}/deposit/pay`, { token, body });
const ledgerOk = async () => {
  const r = await t.db.q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries'); assert.equal(r.d, r.c);
  const rec = await t.api('GET', '/admin/wallet/reconciliation', { token: fo.token }); assert.equal(rec.json.ok, true, JSON.stringify(rec.json));
};
const offers = async (id: string) => (await t.db.q1<any>('select count(*)::int n from dispatch_offers where booking_id=$1', [id])).n;
async function setup() { const owner = await t.register(); const c = await K.car(owner); const d = await K.drvr(); return { owner, c, d }; }

test('deposit off by default: Abasare dispatches immediately (no regression)', async () => {
  await setSetting('abasare.deposit_percent', 0);
  const { owner, c, d } = await setup();
  const { res } = await K.book(owner, c.id);
  assert.equal(res.status, 201); assert.equal(res.json.booking.deposit, null); assert.equal(res.json.booking.status, 'SEARCHING_DRIVER');
  assert.equal(await offers(res.json.booking.id), 1); void d;
});

test('deposit required: never dispatched unpaid; paid by MoMo (simulated) it dispatches, is applied to the fare, remainder collected, ledger balanced', async () => {
  const { owner, c, d } = await setup();
  const { res, opt } = await K.book(owner, c.id);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const b = res.json.booking, id = b.id;
  assert.equal(b.status, 'REQUESTED'); assert.equal(b.awaiting_deposit, true);
  assert.equal(b.deposit.status, 'awaiting_payment'); assert.equal(b.deposit.amount, Math.ceil(opt.fare.total * 0.3));
  assert.equal(await offers(id), 0);
  const { dispatchSweep } = await import('../src/services/dispatch.ts'); await dispatchSweep();
  assert.equal(await offers(id), 0, 'sweeper must not dispatch an unpaid deposit booking');
  const man = await t.api('POST', `/admin/bookings/${id}/assign`, { token: dispatcher.token, body: { driver_id: d.id, reason: 'try to force it' } });
  assert.equal(man.status, 409); assert.equal(man.json.error.code, 'deposit_required');
  assert.equal((await t.api('POST', `/bookings/${id}/accept`, { token: d.token })).status === 200, false);

  const bad = await pay(owner.token, id, { method: 'mtn_momo', msisdn: 'abc' }); assert.equal(bad.status, 400);
  const ok = await pay(owner.token, id, { method: 'mtn_momo', msisdn: '0788123456' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.deposit.status, 'paid'); assert.equal(ok.json.deposit.held, b.deposit.amount);
  assert.equal(ok.json.deposit.paid_with, 'mtn_momo');
  assert.equal((await view(owner.token, id)).status, 'SEARCHING_DRIVER'); assert.equal(await offers(id), 1);
  const dep = b.deposit.amount;
  assert.equal((await t.db.q1<any>("select coalesce(sum(credit-debit),0)::int s from ledger_entries where account_code='DEPOSIT_HELD'")).s, dep);
  assert.equal((await pay(owner.token, id, { method: 'mtn_momo', msisdn: '0788123456' })).json.error.code, 'deposit_already_paid');
  assert.equal((await t.api('GET', '/notifications', { token: owner.token })).json.notifications.some((n: any) => n.template_key === 'deposit_paid'), true);

  const done = await K.fullTrip(owner, d, id);
  const v = await t.api('GET', `/bookings/${id}`, { token: d.token });
  assert.equal(v.json.payment.amount, done.final_fare - dep, 'only the remainder is collected');
  assert.equal((await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare - dep } })).json.status, 'SUCCESS');
  const fin = await view(owner.token, id);
  assert.equal(fin.status, 'PAYMENT_COMPLETED'); assert.equal(fin.deposit.status, 'applied'); assert.equal(fin.deposit.applied, dep);
  assert.equal((await t.db.q1<any>("select coalesce(sum(credit-debit),0)::int s from ledger_entries where account_code='DEPOSIT_HELD'")).s, 0);
  await ledgerOk();
});

test('failed deposit payment keeps the booking undispatched and can be retried; timed-out request is late-credited if it succeeds after expiry', async () => {
  const { owner, c, d } = await setup();
  const { res } = await K.book(owner, c.id); const id = res.json.booking.id;
  const f = await pay(owner.token, id, { method: 'mtn_momo', msisdn: '0788120000' });   // simulator: ...0000 fails
  assert.equal(f.json.deposit.status, 'failed'); assert.equal(f.json.deposit.last_attempt.status, 'failed');
  assert.equal(await offers(id), 0);
  assert.equal((await t.api('GET', '/notifications', { token: owner.token })).json.notifications.some((n: any) => n.template_key === 'deposit_failed'), true);

  const slow = await pay(owner.token, id, { method: 'mtn_momo', msisdn: '0788129999' });   // simulator: ...9999 stays pending
  assert.equal(slow.json.deposit.status, 'pending'); assert.equal(await offers(id), 0);
  const again = await pay(owner.token, id, { method: 'mtn_momo', msisdn: '0788129999' });   // double tap: no second charge
  assert.equal(again.json.deposit.status, 'pending');
  assert.equal((await t.db.q1<any>("select count(*)::int n from deposit_attempts where status in ('initiated','pending')")).n, 1);

  // time passes: attempt times out, deposit window ends, booking is cancelled by the system and never dispatched
  const { depositSweep } = await import('../src/services/deposit.ts');
  await t.db.q("update deposit_attempts set created_at = now() - interval '20 minutes' where status='pending'");
  await t.db.q("update booking_deposits set expires_at = now() - interval '1 minute'");
  await depositSweep();
  const after1 = await view(owner.token, id);
  assert.equal(after1.status, 'CANCELLED_BY_SYSTEM'); assert.equal(after1.deposit.status, 'expired');
  assert.equal((await t.api('GET', '/notifications', { token: owner.token })).json.notifications.some((n: any) => n.template_key === 'deposit_expired'), true);

  // the customer actually approved on the phone after the timeout: the money arrives late
  const { simulatorState } = await import('../src/providers/payment.ts');
  const att = await t.db.q1<any>("select reference from deposit_attempts where failure_reason='timeout'");
  simulatorState.get(att.reference)!.status = 'SUCCESS';
  await depositSweep(); await depositSweep();
  const lateA = await t.db.q1<any>('select status from deposit_attempts where reference=$1', [att.reference]);
  assert.equal(lateA.status, 'late_credited');
  const final = await view(owner.token, id);
  assert.equal(final.status, 'CANCELLED_BY_SYSTEM'); assert.equal(await offers(id), 0, 'late money never dispatches');
  assert.equal((await wallet(owner.token)).available, res.json.booking.deposit.amount);
  await ledgerOk(); void d;
});

test('provider callback for a deposit reference verifies it (idempotent)', async () => {
  const { owner, c, d } = await setup();
  const { res } = await K.book(owner, c.id); const id = res.json.booking.id;
  await pay(owner.token, id, { method: 'mtn_momo', msisdn: '0788129999' });
  const att = await t.db.q1<any>("select reference from deposit_attempts where status='pending'");
  const { simulatorState } = await import('../src/providers/payment.ts');
  simulatorState.get(att.reference)!.status = 'SUCCESS';
  const cb = () => t.api('POST', `/webhooks/payments/mtn_momo?token=dev-callback-token`, { body: { externalId: att.reference } });
  const r1 = await cb(); assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal((await view(owner.token, id)).deposit.status, 'paid'); assert.equal(await offers(id), 1);
  await cb(); await cb();
  assert.equal((await t.db.q1<any>("select coalesce(sum(credit-debit),0)::int s from ledger_entries where account_code='DEPOSIT_HELD'")).s, res.json.booking.deposit.amount, 'duplicate callbacks do not double count');
  assert.equal(await offers(id), 1); void d;
  await ledgerOk();
});

test('cancel before assignment refunds the whole deposit as credit', async () => {
  const { owner, c } = await setup();
  const { res } = await K.book(owner, c.id); const id = res.json.booking.id;
  await pay(owner.token, id, { method: 'mtn_momo', msisdn: '0788123456' });
  const amt = res.json.booking.deposit.amount;
  const cancel = await t.api('POST', `/bookings/${id}/cancel`, { token: owner.token, body: { reason: 'changed_mind' } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  assert.equal(cancel.json.cancel_fee, 0);
  const v = await view(owner.token, id); assert.equal(v.deposit.status, 'refunded'); assert.equal(v.deposit.refunded, amt);
  assert.equal((await wallet(owner.token)).available, amt);
  await ledgerOk();
});

test('cancel after assignment past the free window: the deposit pays the cancellation fee first, the rest returns as credit', async () => {
  const { owner, c, d } = await setup();
  const { res } = await K.book(owner, c.id); const id = res.json.booking.id;
  await pay(owner.token, id, { method: 'mtn_momo', msisdn: '0788123456' });
  const amt = res.json.booking.deposit.amount;
  assert.equal((await t.api('POST', `/bookings/${id}/accept`, { token: d.token })).status, 200);
  await t.db.q("update bookings set assigned_at = now() - interval '10 minutes' where id=$1", [id]);
  const cancel = await t.api('POST', `/bookings/${id}/cancel`, { token: owner.token, body: { reason: 'changed_mind' } });
  assert.equal(cancel.json.cancel_fee, 500);
  const v = await view(owner.token, id); assert.equal(v.deposit.retained, 500); assert.equal(v.deposit.refunded, amt - 500);
  assert.equal((await wallet(owner.token)).available, amt - 500);
  assert.equal((await t.db.q("select 1 from passenger_debts where booking_id=$1", [id])).length, 0, 'fee already covered by the deposit: no extra debt');
  await ledgerOk();
});

test('deposit paid with credit; deposit above the final fare returns the difference as credit and the trip is fully prepaid', async () => {
  const { owner, c, d } = await setup();
  const r0 = await t.api('POST', '/admin/wallet/adjustments', { token: fo.token, body: { user_id: owner.id, amount: 30000, reason: 'credit for deposit test run' } }); assert.equal(r0.status, 200);
  const { res, opt } = await K.book(owner, c.id); const id = res.json.booking.id;
  const dep = opt.fare.total + 1500;
  await t.db.q("update booking_deposits set amount = $2 where booking_id=$1", [id, dep]);
  const p = await pay(owner.token, id, { method: 'wallet' });
  assert.equal(p.status, 200, JSON.stringify(p.json)); assert.equal(p.json.deposit.paid_with, 'wallet');
  assert.equal((await wallet(owner.token)).available, 30000 - dep);
  await setSetting('abasare.deposit_percent', 0);
  const done = await K.fullTrip(owner, d, id);
  // deposit (= fare + 1500 here, as the deposit was raised) fully covers the fare; the difference comes back as credit
  const fin = await view(owner.token, id);
  assert.equal(fin.status, 'PAYMENT_COMPLETED', fin.status); assert.equal(fin.payment.method, 'wallet'); assert.equal(fin.deposit.applied, Math.min(dep, done.final_fare));
  const left = dep - Math.min(dep, done.final_fare);
  assert.equal((await wallet(owner.token)).available, 30000 - dep + left);
  await ledgerOk();
});

test('unpaid deposit past its time cancels the booking; errors are localized', async () => {
  const { owner, c } = await setup();
  const { res } = await K.book(owner, c.id); const id = res.json.booking.id;
  await t.db.q("update booking_deposits set expires_at = now() - interval '1 minute' where booking_id=$1", [id]);
  const { depositSweep } = await import('../src/services/deposit.ts'); await depositSweep();
  assert.equal((await view(owner.token, id)).status, 'CANCELLED_BY_SYSTEM');
  const late = await t.api('POST', `/bookings/${id}/deposit/pay`, { token: owner.token, headers: { 'accept-language': 'fr' }, body: { method: 'mtn_momo', msisdn: '0788123456' } });
  assert.equal(late.status, 409); assert.equal(late.json.error.code, 'deposit_closed'); assert.match(late.json.error.message, /acompte/);
  const other = await t.register();
  assert.equal((await pay(other.token, id, { method: 'wallet' })).status, 404, 'only the owner can pay');
});
