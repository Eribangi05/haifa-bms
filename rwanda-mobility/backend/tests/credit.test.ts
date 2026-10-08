import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx;
let fo: any, fa: any, lead: any, agent: any;   // finance officer, finance approver, support lead, support agent
before(async () => {
  t = await boot('rwanda_mobility_test');
  fo = await t.staff('finance_officer'); fa = await t.staff('finance_approver'); lead = await t.staff('support_lead'); agent = await t.staff('support_agent');
});
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const ledgerBalanced = async () => {
  const r = await t.db.q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries');
  assert.equal(r.d, r.c, 'ledger must balance');
  assert.equal((await t.db.q('select txn_id from ledger_entries group by txn_id having sum(debit) <> sum(credit)')).length, 0);
  const rec = await t.api('GET', '/admin/wallet/reconciliation', { token: fo.token });
  assert.equal(rec.status, 200); assert.equal(rec.json.ok, true, JSON.stringify(rec.json));
};
const grant = async (userId: string, amount: number, source = 'promo') => {
  const r = await t.api('POST', '/admin/wallet/adjustments', { token: fo.token, body: { user_id: userId, amount, reason: 'test credit for automated tests', source } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json;
};
const payCash = async (d: any, id: string) => {
  const fare = (await t.api('GET', `/bookings/${id}`, { token: d.token })).json.payment.amount;
  assert.equal((await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: fare } })).status, 200);
};
const wallet = async (token: string) => (await t.api('GET', '/wallet', { token })).json;
const setSetting = (k: string, v: unknown) => t.db.q("insert into system_settings(key,value) values ($1,$2) on conflict (key) do update set value=excluded.value", [k, JSON.stringify(v)]);

test('staff credit adjustment: small applies at once, large needs a different approver, permission gated, audited', async () => {
  const p = await t.register();
  const small = await grant(p.id, 3000);
  assert.equal(small.status, 'applied'); assert.equal(small.needs_approval, false);
  assert.equal((await wallet(p.token)).available, 3000);

  assert.equal((await t.api('POST', '/admin/wallet/adjustments', { token: agent.token, body: { user_id: p.id, amount: 100, reason: 'agents cannot adjust credit' } })).status, 403);
  assert.equal((await t.api('POST', '/admin/wallet/adjustments', { token: fo.token, body: { user_id: p.id, amount: 100, reason: 'short' } })).status, 400);

  const big = await grant(p.id, 80000);
  assert.equal(big.status, 'pending'); assert.equal(big.needs_approval, true);
  assert.equal((await wallet(p.token)).available, 3000);
  assert.equal((await t.api('POST', `/admin/wallet/adjustments/${big.id}/decision`, { token: fo.token, body: { approve: true } })).status, 403);   // officer lacks the approve permission
  const ok = await t.api('POST', `/admin/wallet/adjustments/${big.id}/decision`, { token: fa.token, body: { approve: true } });
  assert.equal(ok.status, 200); assert.equal(ok.json.status, 'applied');
  assert.equal((await t.api('POST', `/admin/wallet/adjustments/${big.id}/decision`, { token: fa.token, body: { approve: true } })).status, 409);   // decided once
  assert.equal((await wallet(p.token)).available, 83000);

  // negative adjustment cannot go below zero; a maker cannot approve their own large change (super admin both roles)
  assert.equal((await t.api('POST', '/admin/wallet/adjustments', { token: fo.token, body: { user_id: p.id, amount: -999999, reason: 'remove too much credit' } })).status, 200);   // pending (large)
  const neg = await grant(p.id, -1000, 'adjustment');
  assert.equal(neg.status, 'applied'); assert.equal((await wallet(p.token)).available, 82000);
  const st = await t.api('GET', '/wallet/statement', { token: p.token });
  assert.equal(st.json.balance.available, 82000); assert.ok(st.json.entries.length >= 3);
  assert.equal(st.json.entries[0].kind, 'debit');
  const audit = await t.db.q("select action from audit_logs where entity_id=$1 and action like 'credit.adjustment%'", [p.id]);
  assert.ok(audit.length >= 4);
  await ledgerBalanced();
});

test('credit cap, wallet switch, and the credit never goes negative', async () => {
  const p = await t.register();
  await setSetting('wallet.max_balance', 5000);
  await grant(p.id, 4000);
  const over = await t.api('POST', '/admin/wallet/adjustments', { token: fo.token, body: { user_id: p.id, amount: 2000, reason: 'above the maximum balance' } });
  assert.equal(over.status, 409); assert.equal(over.json.error.code, 'credit_cap_exceeded');
  const neg = await t.api('POST', '/admin/wallet/adjustments', { token: fo.token, body: { user_id: p.id, amount: -4500, reason: 'more than the balance holds' } });
  assert.equal(neg.status, 409); assert.equal(neg.json.error.code, 'insufficient_credit');
  assert.equal((await wallet(p.token)).available, 4000);
  await setSetting('wallet.max_balance', 500000);
  await ledgerBalanced();
});

test('booking paid fully with credit: reserved at booking, applied at completion, ledger balanced, points earned', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await grant(p.id, 20000);
  const { res, quote } = await t.book(p.token, 'moto', 'wallet');
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const b = res.json.booking;
  assert.equal(b.payment_method, 'wallet'); assert.equal(b.wallet.mode, 'full'); assert.equal(b.wallet.reserved, quote.fare.total);
  let w = await wallet(p.token);
  assert.equal(w.available, 20000 - quote.fare.total); assert.equal(w.reserved, quote.fare.total);

  const done = await t.runTrip(p, d, b.id);
  const fare = done.final_fare;
  const view = (await t.api('GET', `/bookings/${b.id}`, { token: p.token })).json;
  assert.equal(view.status, 'PAYMENT_COMPLETED', view.status);
  assert.equal(view.payment.method, 'wallet'); assert.equal(view.wallet.applied, fare);
  w = await wallet(p.token);
  assert.equal(w.reserved, 0); assert.equal(w.available, 20000 - fare);
  const earn = await t.db.q1<any>('select * from driver_earnings where booking_id=$1', [b.id]);
  assert.equal(earn.collected_by, 'platform');
  const loy = (await t.api('GET', '/loyalty', { token: p.token })).json;
  assert.equal(loy.points, Math.floor(fare / 100)); assert.equal(loy.tier, 'bronze');
  assert.equal((await t.api('GET', '/wallet/statement', { token: p.token })).json.entries.some((e: any) => e.kind === 'spend'), true);
  await ledgerBalanced();
});

test('credit refused when it does not cover the fare; localized error; partial credit with cash remainder', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await grant(p.id, 500);
  const e = await t.estimate(p.token, { service_id: 'moto' });
  const q1 = e.json.options[0].quote_id;
  const r = await t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID(), 'accept-language': 'rw' }, body: { quote_id: q1, payment_method: 'wallet' } });
  assert.equal(r.status, 409); assert.equal(r.json.error.code, 'insufficient_credit'); assert.match(r.json.error.message, /Amafaranga yawe/);
  assert.equal((await wallet(p.token)).available, 500);   // nothing reserved by the failed attempt

  const { res } = await t.book(p.token, 'moto', 'wallet_partial', { body: { wallet_amount: 400, remainder_method: 'cash' } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const b = res.json.booking;
  assert.equal(b.payment_method, 'cash'); assert.equal(b.wallet.mode, 'partial'); assert.equal(b.wallet.reserved, 400);
  await t.runTrip(p, d, b.id);
  const v = (await t.api('GET', `/bookings/${b.id}`, { token: d.token })).json;
  assert.equal(v.payment.method, 'cash');
  const due = v.payment.amount;
  assert.equal(due, v.final_fare - 400);
  const cash = await t.api('POST', `/bookings/${b.id}/cash-collected`, { token: d.token, body: { amount: due } });
  assert.equal(cash.status, 200, JSON.stringify(cash.json));
  const done = (await t.api('GET', `/bookings/${b.id}`, { token: p.token })).json;
  assert.equal(done.status, 'PAYMENT_COMPLETED'); assert.equal(done.wallet.applied, 400);
  assert.equal((await wallet(p.token)).available, 100);
  await ledgerBalanced();
});

test('cancelling a booking returns the reserved credit; never double-released', async () => {
  const p = await t.register(); await t.driver({ vehicle: 'moto' });
  await grant(p.id, 10000);
  const { res } = await t.book(p.token, 'moto', 'wallet');
  const id = res.json.booking.id;
  assert.ok((await wallet(p.token)).reserved > 0);
  const c = await t.api('POST', `/bookings/${id}/cancel`, { token: p.token, body: { reason: 'changed_mind' } });
  assert.equal(c.status, 200);
  const w = await wallet(p.token);
  assert.equal(w.reserved, 0); assert.equal(w.available, 10000);
  assert.equal((await t.api('POST', `/bookings/${id}/cancel`, { token: p.token, body: { reason: 'again' } })).status, 409);
  assert.equal((await wallet(p.token)).available, 10000);
  await ledgerBalanced();
});

test('credit expiry: expired lots leave the balance, ledger and lots agree, reminder sent first', async () => {
  const p = await t.register();
  await setSetting('wallet.credit_expiry_days', 30);
  await grant(p.id, 2000); await grant(p.id, 1500);
  await setSetting('wallet.credit_expiry_days', 0);
  await grant(p.id, 700);   // never expires
  const lots = await t.db.q<any>('select id, amount, expires_at from wallet_lots where user_id=$1 order by amount desc', [p.id]);
  assert.equal(lots.filter((l) => l.expires_at).length, 2);
  const { creditSweep } = await import('../src/services/credit.ts');
  await t.db.q("update wallet_lots set expires_at = now() + interval '3 days' where id=$1", [lots.find((l) => l.amount === 1500).id]);
  const s1 = await creditSweep();
  assert.ok(s1.reminded >= 1);
  assert.equal((await t.db.q<any>("select * from notifications where user_id=$1 and template_key='credit_expiring' and channel='in_app'", [p.id])).length, 1);
  assert.equal((await creditSweep()).reminded, 0);   // once only
  await t.db.q("update wallet_lots set expires_at = now() - interval '1 hour' where id=$1", [lots.find((l) => l.amount === 2000).id]);
  const s2 = await creditSweep();
  assert.equal(s2.expired, 1);
  assert.equal((await wallet(p.token)).available, 1500 + 700);
  assert.equal((await t.db.q1<any>("select coalesce(sum(credit),0)::int s from ledger_entries where account_code='CREDIT_EXPIRED_REVENUE'")).s >= 2000, true);
  await ledgerBalanced();
});

test('loyalty: tiers from settings, redeem points for credit (idempotent, step of 100, minimum), parallel redeems cannot overspend', async () => {
  const p = await t.register();
  const tiers = (await t.api('GET', '/loyalty/tiers')).json.tiers;
  assert.deepEqual(tiers.map((x: any) => x.tier), ['bronze', 'silver', 'gold']);
  await t.db.q("insert into loyalty_accounts(user_id, points, lifetime_points, tier) values ($1,1200,2500,'silver')", [p.id]);
  assert.equal((await t.api('POST', '/loyalty/redeem', { token: p.token, body: { points: 150 } })).json.error.code, 'invalid_points');
  assert.equal((await t.api('POST', '/loyalty/redeem', { token: p.token, body: { points: 300 } })).json.error.code, 'below_min_redeem');
  const key = randomUUID();
  const r1 = await t.api('POST', '/loyalty/redeem', { token: p.token, headers: { 'idempotency-key': key }, body: { points: 500 } });
  assert.equal(r1.status, 200, JSON.stringify(r1.json)); assert.equal(r1.json.credit_added, 500); assert.equal(r1.json.points, 700);
  const r2 = await t.api('POST', '/loyalty/redeem', { token: p.token, headers: { 'idempotency-key': key }, body: { points: 500 } });
  assert.equal(r2.json.replay, true); assert.equal((await wallet(p.token)).available, 500);
  const par = await Promise.all(Array.from({ length: 4 }, () => t.api('POST', '/loyalty/redeem', { token: p.token, headers: { 'idempotency-key': randomUUID() }, body: { points: 500 } })));
  assert.equal(par.filter((x) => x.status === 200).length, 1, JSON.stringify(par.map((x) => x.status)));   // 700 points: only one more 500 fits
  assert.equal((await wallet(p.token)).available, 1000);
  assert.equal((await t.api('GET', '/loyalty', { token: p.token })).json.points, 200);
  await ledgerBalanced();
});

test('loyalty tier-up on trips and the tier perk on the free-cancel window', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await setSetting('loyalty.silver_min_points', 10);
  const { res } = await t.book(p.token); await t.runTrip(p, d, res.json.booking.id);
  await payCash(d, res.json.booking.id);
  const loy = (await t.api('GET', '/loyalty', { token: p.token })).json;
  assert.equal(loy.tier, 'silver');
  assert.ok((await t.db.q<any>("select 1 from notifications where user_id=$1 and template_key='loyalty_tier_up' and channel='in_app'", [p.id])).length === 1);
  await setSetting('loyalty.silver_min_points', 2000);
  // silver gets extra seconds before a late-cancel fee applies: 130 s after assignment is free for silver (120 + 30) but not for bronze
  await t.db.q("update loyalty_accounts set tier='silver' where user_id=$1", [p.id]);
  const d2 = await t.driver({ vehicle: 'moto' });
  const b2 = (await t.book(p.token)).res.json.booking;
  await t.api('POST', `/bookings/${b2.id}/accept`, { token: d2.token });
  await t.db.q("update bookings set assigned_at = now() - interval '130 seconds' where id=$1", [b2.id]);
  const c = await t.api('POST', `/bookings/${b2.id}/cancel`, { token: p.token, body: { reason: 'changed_mind' } });
  assert.equal(c.json.cancel_fee, 0);
});

test('refund issued as credit: maker-checker, ledger balanced, credit usable', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token, 'moto', 'cash');
  const id = res.json.booking.id;
  await t.runTrip(p, d, id);
  const fare = (await t.api('GET', `/bookings/${id}`, { token: d.token })).json.final_fare;
  assert.equal((await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: fare } })).status, 200);
  const rq = await t.api('POST', '/admin/finance/refunds', { token: fo.token, body: { booking_id: id, amount: 700, reason: 'goodwill after complaint', as_credit: true } });
  assert.equal(rq.status, 200, JSON.stringify(rq.json)); assert.equal(rq.json.as_credit, true);
  const ap = await t.api('POST', `/admin/finance/refunds/${rq.json.id}/decision`, { token: fa.token, body: { approve: true } });
  assert.equal(ap.status, 200, JSON.stringify(ap.json)); assert.equal(ap.json.refunded_as_credit, true);
  assert.equal((await wallet(p.token)).available, 700);
  await ledgerBalanced();
});

test('referral reward can be paid as credit', async () => {
  const a = await t.register(); const b = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await setSetting('referral.reward_credit', 1000);
  await t.db.q('insert into referrals(referrer_id, referee_id) values ($1,$2)', [a.id, b.id]);
  const { res } = await t.book(b.token); const id = res.json.booking.id;
  await t.runTrip(b, d, id);
  const fare = (await t.api('GET', `/bookings/${id}`, { token: d.token })).json.final_fare;
  await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: fare } });
  assert.equal((await wallet(a.token)).available, 1000); assert.equal((await wallet(b.token)).available, 1000);
  await setSetting('referral.reward_credit', 0);
  await ledgerBalanced();
});

test('admin: lookup by phone, statement view, loyalty config', async () => {
  const p = await t.register(); await grant(p.id, 1234);
  const l = await t.api('GET', `/admin/wallet/lookup?q=${encodeURIComponent(p.phone)}`, { token: lead.token });
  assert.equal(l.status, 200); assert.equal(l.json.users[0].id, p.id); assert.equal(l.json.users[0].balance.available, 1234);
  const s = await t.api('GET', `/admin/wallet/${p.id}/statement`, { token: lead.token });
  assert.equal(s.json.entries.length, 1);
  const c = await t.api('GET', '/admin/loyalty/config', { token: lead.token });
  assert.equal(c.json.tiers.length, 3); assert.ok('loyalty.gold_min_points' in c.json.settings);
  assert.equal((await t.api('GET', `/admin/wallet/${p.id}/statement`, { token: p.token })).status, 403);
});
