import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const balanced = async () => { const r = await t.db.q1<any>('select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from ledger_entries'); assert.equal(r.d, r.c); };

async function trip(p: any, d: any, method: 'cash' | 'mtn_momo' = 'cash') {
  const { res } = await t.book(p.token, 'moto', method); const id = res.json.booking.id;
  const done = await t.runTrip(p, d, id);
  if (method === 'cash') await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare } });
  else { const pay = await t.api('POST', '/payments', { token: p.token, body: { booking_id: id, msisdn: '0788111234' } }); assert.equal(pay.json.status, 'SUCCESS'); }
  return { id, fare: done.final_fare as number };
}
const earnings = (id: string) => t.db.q1<any>('select * from driver_earnings where booking_id=$1', [id]);

test('ledger accounts reflect gross, commission, driver payable and cash separately (cash + mobile money)', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const a = await trip(p, d, 'cash'); const b = await trip(p, d, 'mtn_momo');
  const ea = await earnings(a.id), eb = await earnings(b.id);
  const fo = await t.staff('finance_officer');
  const r = await t.api('GET', '/admin/finance/position', { token: fo.token });
  const acc = Object.fromEntries(r.json.accounts.map((x: any) => [x.code, x.balance]));
  assert.equal(r.json.integrity.balanced, true);
  assert.equal(acc.COMMISSION_REVENUE, ea.commission + eb.commission);
  assert.equal(acc.DRIVER_PAYABLE, ea.net + eb.net);
  assert.equal(acc.CASH_WITH_DRIVERS, a.fare, 'cash is tracked as held by the driver');
  assert.equal(acc.PROVIDER_CLEARING, b.fare, 'mobile money sits in provider clearing until settled');
  const bal = await t.api('GET', '/drivers/me/wallet', { token: d.token });
  // payable = net_a + net_b ; cash held = fare_a ; eligible = payable - cash_held
  assert.equal(bal.json.balance.eligible_payout, Math.max(0, ea.net + eb.net - a.fare));
  assert.equal(bal.json.balance.owed_to_platform, Math.max(0, a.fare - (ea.net + eb.net)));
});

test('refund: maker-checker, cannot exceed payment, creates new ledger entries, never edits history', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const lead = await t.staff('support_lead'), fa = await t.staff('finance_approver'), fa2 = await t.staff('finance_approver');
  const { id, fare } = await trip(p, d, 'mtn_momo');
  const before = await t.db.q1<any>('select count(*)::int n from ledger_entries');
  const tooBig = await t.api('POST', '/admin/finance/refunds', { token: lead.token, body: { booking_id: id, amount: fare + 1, reason: 'too much' } });
  assert.equal(tooBig.status, 400);
  const rq = await t.api('POST', '/admin/finance/refunds', { token: lead.token, body: { booking_id: id, amount: 500, reason: 'Driver took a longer route', driver_clawback: 300 } });
  assert.equal(rq.status, 200); assert.equal(rq.json.status, 'REQUESTED');
  assert.equal((await t.db.q1<any>('select count(*)::int n from ledger_entries')).n, before.n, 'a request alone moves no money');
  // requester cannot approve (support_lead has no approve permission), and approver who is also the requester is blocked
  assert.equal((await t.api('POST', `/admin/finance/refunds/${rq.json.id}/decision`, { token: lead.token, body: { approve: true } })).status, 403);
  const sa = await t.staff('super_admin');           // holds every permission, but still cannot approve what they requested
  const selfReq = await t.api('POST', '/admin/finance/refunds', { token: sa.token, body: { booking_id: id, amount: 100, reason: 'self approval test' } });
  const self = await t.api('POST', `/admin/finance/refunds/${selfReq.json.id}/decision`, { token: sa.token, body: { approve: true } });
  assert.equal(self.status, 403); assert.ok(/Maker-checker/.test(self.json.error.message));
  await t.api('POST', `/admin/finance/refunds/${selfReq.json.id}/decision`, { token: fa.token, body: { approve: false } });
  const ok = await t.api('POST', `/admin/finance/refunds/${rq.json.id}/decision`, { token: fa.token, body: { approve: true } });
  assert.equal(ok.status, 200); assert.equal(ok.json.processed, true); assert.equal(ok.json.manual_provider_payout_required, true);
  assert.equal((await t.api('POST', `/admin/finance/refunds/${rq.json.id}/decision`, { token: fa2.token, body: { approve: true } })).status, 409, 'cannot process twice');
  assert.ok((await t.db.q1<any>('select count(*)::int n from ledger_entries')).n > before.n);
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [id])).status, 'PARTIALLY_REFUNDED');
  const ref = await t.db.q1<any>("select sum(debit-credit)::int v from ledger_entries where account_code='REFUNDS' and booking_id=$1", [id]);
  assert.equal(ref.v, 500 - 300, 'platform bears the refund net of the driver clawback');
  await balanced();
  const rest = await t.api('POST', '/admin/finance/refunds', { token: lead.token, body: { booking_id: id, amount: fare - 500, reason: 'Remaining amount, trip not made' } });
  await t.api('POST', `/admin/finance/refunds/${rest.json.id}/decision`, { token: fa.token, body: { approve: true } });
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [id])).status, 'REFUNDED');
  assert.equal((await t.db.q1<any>('select status from payments where booking_id=$1', [id])).status, 'REVERSED');
  await balanced();
});

test('commission rules: most specific wins, exemptions expire, and changes need maker-checker approval', async () => {
  const bm = await t.staff('business_manager'), fa = await t.staff('finance_approver');
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const first = await trip(p, d); const e1 = await earnings(first.id);
  assert.equal(e1.commission, Math.floor((e1.commissionable * 1200 + 5000) / 10000));     // moto 12%
  const prop = await t.api('POST', '/admin/commissions', { token: bm.token, body: { driver_id: d.id, kind: 'percent', percent_bps: 500, note: 'Introductory 5%' } });
  assert.equal(prop.json.status, 'pending_approval');
  const stillOld = await trip(p, d); assert.equal((await earnings(stillOld.id)).commission_rule_id, e1.commission_rule_id, 'pending rule not applied');
  assert.equal((await t.api('POST', `/admin/commissions/${prop.json.id}/approve`, { token: bm.token })).status, 403);
  assert.equal((await t.api('POST', `/admin/commissions/${prop.json.id}/approve`, { token: fa.token })).status, 200);
  const promo = await trip(p, d); const e3 = await earnings(promo.id);
  assert.equal(e3.commission, Math.floor((e3.commissionable * 500 + 5000) / 10000));
  const ex = await t.api('POST', '/admin/commissions', { token: bm.token, body: { driver_id: d.id, kind: 'percent', percent_bps: 0, exempt_until: new Date(Date.now() + 86400000).toISOString(), note: 'Temporary exemption' } });
  await t.api('POST', `/admin/commissions/${ex.json.id}/approve`, { token: fa.token });
  const free = await trip(p, d); assert.equal((await earnings(free.id)).commission, 0);
  await balanced();
});

test('payouts: minimum, eligible balance, cash netting, large-payout two-person approval, and rejection restores the balance', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const fo = await t.staff('finance_officer'), fa = await t.staff('finance_approver'), fa2 = await t.staff('finance_approver');
  let total = 0;
  for (let i = 0; i < 3; i++) { const r = await trip(p, d, 'mtn_momo'); total += (await earnings(r.id)).net; }
  await t.db.q("insert into system_settings(key,value) values ('payout.min_amount','1000'),('payout.large_threshold','3000') on conflict (key) do update set value=excluded.value");
  const bal = (await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance;
  assert.equal(bal.eligible_payout, total);
  assert.equal((await t.api('POST', '/drivers/me/payouts', { token: d.token, body: { amount: 500 } })).status, 400, 'below minimum');
  assert.equal((await t.api('POST', '/drivers/me/payouts', { token: d.token, body: { amount: total + 1 } })).status, 409, 'above eligible balance');
  // concurrent requests cannot overdraw the balance
  const half = Math.floor(total * 0.6);
  const rs = await Promise.all([1, 2, 3].map(() => t.api('POST', '/drivers/me/payouts', { token: d.token, body: { amount: half } })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1, JSON.stringify(rs.map((r) => r.status)));
  const payout = rs.find((r) => r.status === 200)!.json;
  assert.equal((await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance.eligible_payout, total - half);
  // large payout: must be reviewed, and approver != reviewer
  assert.ok(payout.amount >= 3000);
  assert.equal((await t.api('POST', `/admin/finance/payouts/${payout.id}/approve`, { token: fa.token })).json.error.code, 'review_required');
  assert.equal((await t.api('POST', `/admin/finance/payouts/${payout.id}/review`, { token: fa.token })).status, 200);
  assert.equal((await t.api('POST', `/admin/finance/payouts/${payout.id}/approve`, { token: fa.token })).status, 403, 'reviewer cannot also approve');
  assert.equal((await t.api('POST', `/admin/finance/payouts/${payout.id}/approve`, { token: fa2.token })).status, 200);
  assert.equal((await t.api('POST', `/admin/finance/payouts/${payout.id}/paid`, { token: fa2.token, body: { provider_reference: 'MOMO-123456' } })).status, 403, 'approver cannot release a large payout');
  assert.equal((await t.api('POST', `/admin/finance/payouts/${payout.id}/paid`, { token: fa.token, body: { provider_reference: 'MOMO-123456' } })).status, 200);
  assert.equal((await t.api('GET', '/drivers/me/payouts', { token: d.token })).json.payouts[0].status, 'PAID');
  assert.equal((await t.api('POST', '/admin/finance/payouts/' + payout.id + '/review', { token: fo.token })).status, 409);
  await balanced();
  // rejection puts the money back
  const second = await t.api('POST', '/drivers/me/payouts', { token: d.token, body: { amount: total - half } });
  assert.equal(second.status, 200);
  assert.equal((await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance.eligible_payout, 0);
  await t.api('POST', `/admin/finance/payouts/${second.json.id}/reject`, { token: fo.token, body: { note: 'Wrong payout number on file' } });
  assert.equal((await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance.eligible_payout, total - half);
  await balanced();
  await t.db.q("delete from system_settings where key in ('payout.min_amount','payout.large_threshold')");
});

test('cash commission is netted against earnings at payout, and remittance clears what the driver owes', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const fo = await t.staff('finance_officer');
  const cash = await trip(p, d, 'cash'); const mm = await trip(p, d, 'mtn_momo');
  const ec = await earnings(cash.id), em = await earnings(mm.id);
  await t.db.q("insert into system_settings(key,value) values ('payout.min_amount','100') on conflict (key) do update set value='100'");
  const expected = em.net - ec.commission;                        // MoMo net minus the commission owed on the cash trip... 
  const bal = (await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance;
  assert.equal(bal.eligible_payout, ec.net + em.net - cash.fare);
  assert.equal(bal.eligible_payout, expected);
  const po = await t.api('POST', '/drivers/me/payouts', { token: d.token, body: { amount: expected } });
  assert.equal(po.status, 200);
  const after = (await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance;
  assert.equal(after.cash_held, 0, 'the cash the driver holds was netted against what the platform owed them');
  assert.equal(after.payable, 0);
  // a cash-only driver owes the platform the commission; remit it
  const d2 = await t.driver({ vehicle: 'moto' }); const c2 = await trip(p, d2, 'cash'); const e2 = await earnings(c2.id);
  const owed = (await t.api('GET', '/drivers/me/wallet', { token: d2.token })).json.balance;
  assert.equal(owed.owed_to_platform, e2.commission);
  assert.equal((await t.api('POST', '/admin/finance/cash-remittance', { token: fo.token, body: { driver_id: d2.id, amount: c2.fare + 1, reference: 'BANK-1' } })).status, 400);
  assert.equal((await t.api('POST', '/admin/finance/cash-remittance', { token: fo.token, body: { driver_id: d2.id, amount: e2.commission, reference: 'BANK-7788' } })).status, 200);
  const cleared = (await t.api('GET', '/drivers/me/wallet', { token: d2.token })).json.balance;
  assert.equal(cleared.cash_held, c2.fare - e2.commission);
  await balanced();
  await t.db.q("delete from system_settings where key='payout.min_amount'");
});

test('adjustments are new ledger entries with a reason, an actor and an audit record', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const fa = await t.staff('finance_approver'); const fo = await t.staff('finance_officer');
  await trip(p, d, 'mtn_momo');
  const before = (await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance.payable;
  assert.equal((await t.api('POST', '/admin/finance/adjustments', { token: fo.token, body: { driver_id: d.id, amount: 1000, reason: 'Bonus for the night shift' } })).status, 403);
  assert.equal((await t.api('POST', '/admin/finance/adjustments', { token: fa.token, body: { driver_id: d.id, amount: 1000, reason: 'short' } })).status, 400);
  assert.equal((await t.api('POST', '/admin/finance/adjustments', { token: fa.token, body: { driver_id: d.id, amount: 1000, reason: 'Compensation for platform outage' } })).status, 200);
  assert.equal((await t.api('GET', '/drivers/me/wallet', { token: d.token })).json.balance.payable, before + 1000);
  assert.equal((await t.api('POST', '/admin/finance/adjustments', { token: fa.token, body: { driver_id: d.id, amount: 500000, reason: 'Way too large adjustment' } })).status, 403);
  const a = await t.db.q1<any>("select * from audit_logs where action='ledger.adjustment'"); assert.equal(a.actor_id, fa.id);
  await balanced();
});

test('reconciliation flags matches, missing, mismatched and duplicate lines; late success after timeout needs review', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const fo = await t.staff('finance_officer');
  const a = await trip(p, d, 'mtn_momo'); const b = await trip(p, d, 'mtn_momo');
  const pa = await t.db.q1<any>("select reference, amount from payments where booking_id=$1", [a.id]);
  const pb = await t.db.q1<any>("select reference, amount from payments where booking_id=$1", [b.id]);
  const today = new Date().toISOString().slice(0, 10);
  const rec = await t.api('POST', '/admin/finance/reconcile', { token: fo.token, body: { provider: 'mtn_momo', run_date: today, rows: [
    { reference: pa.reference, amount: pa.amount, status: 'SUCCESS' },
    { reference: pb.reference, amount: pb.amount - 100, status: 'SUCCESS' },
    { reference: randomUUID(), amount: 1500, status: 'SUCCESS' },
    { reference: pa.reference, amount: pa.amount, status: 'SUCCESS' },
  ] } });
  assert.equal(rec.status, 200);
  const s = rec.json.summary;
  assert.equal(s.MATCHED, 1); assert.equal(s.AMOUNT_MISMATCH, 1); assert.equal(s.MISSING_INTERNAL, 1); assert.equal(s.STATUS_MISMATCH, 1); assert.equal(s.ledger_balanced, true);
  assert.equal((await t.db.q1<any>('select settlement_status from payments where reference=$1', [pa.reference])).settlement_status, 'settled');
  const missing = await t.api('POST', '/admin/finance/reconcile', { token: fo.token, body: { provider: 'mtn_momo', run_date: today, rows: [] } });
  assert.ok(missing.json.summary.MISSING_PROVIDER >= 2, 'internal successes absent from the provider file');
  const items = await t.db.q<any>("select provider_reference from reconciliation_items where run_id=$1 and kind='MISSING_PROVIDER'", [missing.json.run_id]);
  assert.ok([pa.reference, pb.reference].every((r) => items.some((i: any) => i.provider_reference === r)));
  const ex = await t.api('GET', '/admin/finance/reconciliation', { token: fo.token });
  assert.ok(ex.json.open_items.length >= 4);
  // timeout then late success: never auto-credited
  const p2 = await t.register(); const d2 = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p2.token, 'moto', 'mtn_momo'); const id = res.json.booking.id; await t.runTrip(p2, d2, id);
  const pend = await t.api('POST', '/payments', { token: p2.token, body: { booking_id: id, msisdn: '0788119999' } });
  await t.db.q("update payments set created_at = now() - interval '20 minutes' where id=$1", [pend.json.id]);
  const { sweepPendingPayments, verifyPayment } = await import('../src/services/payments.ts');
  await sweepPendingPayments();
  assert.equal((await t.db.q1<any>('select status, failure_reason from payments where id=$1', [pend.json.id])).failure_reason, 'timeout');
  await t.api('POST', '/dev/momo/settle', { body: { reference: pend.json.reference, status: 'SUCCESS' } });
  await verifyPayment(pend.json.id, 'sweep');
  const row = await t.db.q1<any>('select status, failure_reason from payments where id=$1', [pend.json.id]);
  assert.equal(row.status, 'FAILED'); assert.equal(row.failure_reason, 'late_success_needs_review');
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [id])).status, 'PAYMENT_PENDING');
  const ex2 = await t.api('GET', '/admin/finance/reconciliation', { token: fo.token });
  assert.ok(ex2.json.payment_exceptions.some((x: any) => x.id === pend.json.id));
});

test('amount mismatch from the provider is never marked paid', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token, 'moto', 'mtn_momo'); const id = res.json.booking.id; await t.runTrip(p, d, id);
  const { simulatorState } = await import('../src/providers/payment.ts');
  const pend = await t.api('POST', '/payments', { token: p.token, body: { booking_id: id, msisdn: '0788119999' } });
  const sim = simulatorState.get(pend.json.reference)!; sim.amount = sim.amount - 100; sim.status = 'SUCCESS';
  const r = await t.api('GET', `/payments/${pend.json.id}`, { token: p.token });
  assert.equal(r.json.status, 'PENDING'); assert.equal(r.json.failure_reason, 'amount_mismatch');
  assert.equal((await t.db.q1<any>('select status from bookings where id=$1', [id])).status, 'PAYMENT_PENDING');
});

test('dashboard separates gross booking value, platform revenue and cash collected', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const an = await t.staff('analyst');
  const r0 = (await t.api('GET', '/admin/dashboard', { token: an.token })).json.revenue;
  const c = await trip(p, d, 'cash'); const m = await trip(p, d, 'mtn_momo');
  const r = await t.api('GET', '/admin/dashboard', { token: an.token });
  assert.equal(r.status, 200);
  const rev = r.json.revenue;
  assert.equal(Number(rev.gross_booking_value) - Number(r0.gross_booking_value), c.fare + m.fare);
  assert.equal(Number(rev.cash_collected) - Number(r0.cash_collected), c.fare);
  assert.equal(Number(rev.platform_commission_revenue) - Number(r0.platform_commission_revenue), (await earnings(c.id)).commission + (await earnings(m.id)).commission);
  assert.ok(Number(rev.platform_commission_revenue) < Number(rev.gross_booking_value));
  assert.ok(r.json.payments.success_rate_pct > 0);
  assert.ok(r.json.bookings.fulfilment_rate_pct > 0);
  const an2 = await t.api('GET', '/admin/analytics', { token: an.token });
  assert.ok(!JSON.stringify(an2.json).includes('+250'), 'no PII in analytics');
});
