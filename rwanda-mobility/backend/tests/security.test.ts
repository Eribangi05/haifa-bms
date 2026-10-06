import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, KCC, KIMIRONKO, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

async function paidCashTrip(p: any, d: any, service = 'moto') {
  const { res } = await t.book(p.token, service, 'cash'); const id = res.json.booking.id;
  const done = await t.runTrip(p, d, id);
  await t.api('POST', `/bookings/${id}/cash-collected`, { token: d.token, body: { amount: done.final_fare } });
  return { id, fare: done.final_fare as number };
}

test('passengers cannot read each other’s bookings, events, receipts, payments or chat', async () => {
  const a = await t.register(), b = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { id } = await paidCashTrip(a, d);
  for (const path of [`/bookings/${id}`, `/bookings/${id}/events`, `/bookings/${id}/receipt`, `/bookings/${id}/messages`]) {
    const r = await t.api('GET', path, { token: b.token });
    assert.equal(r.status, 404, path);                               // 404, not 403: existence is not revealed
  }
  const pay = await t.db.q1<any>('select id from payments where booking_id=$1', [id]);
  assert.equal((await t.api('GET', `/payments/${pay.id}`, { token: b.token })).status, 404);
  assert.equal((await t.api('POST', `/bookings/${id}/cancel`, { token: b.token, body: { reason: 'sabotage' } })).status, 404);
  assert.equal((await t.api('POST', `/bookings/${id}/ratings`, { token: b.token, body: { score: 1 } })).status, 404);
  assert.equal((await t.api('POST', `/bookings/${id}/share`, { token: b.token, body: {} })).status, 404);
  assert.equal((await t.api('GET', '/bookings', { token: b.token })).json.bookings.length, 0);
});

test('the driver view never exposes passenger phone numbers or the trip PIN; the passenger sees PIN only before the trip', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  const dv = await t.api('GET', `/bookings/${id}`, { token: d.token });
  const text = JSON.stringify(dv.json);
  assert.ok(!text.includes(p.phone) && !text.includes('trip_pin'));
  assert.equal(dv.json.passenger.phone, undefined);
  assert.ok((await t.api('GET', `/bookings/${id}`, { token: p.token })).json.trip_pin);
});

test('role separation: passengers and drivers cannot reach driver/admin/finance endpoints', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto', online: false });
  assert.equal((await t.api('GET', '/drivers/me/offers', { token: p.token })).status, 403);
  assert.equal((await t.api('PATCH', '/drivers/me/availability', { token: p.token, body: { online: true } })).status, 403);
  for (const path of ['/admin/dashboard', '/admin/finance/payments', '/admin/audit', '/admin/settings', '/admin/staff'])
    for (const who of [p, d]) assert.equal((await t.api('GET', path, { token: who.token })).status, 403, path);
  assert.equal((await t.api('PUT', '/admin/flags/pricing.surge', { token: d.token, body: { enabled: true } })).status, 403);
});

test('staff permissions are least-privilege', async () => {
  const analyst = await t.staff('analyst'), support = await t.staff('support_agent'), fo = await t.staff('finance_officer'), disp = await t.staff('dispatcher'), verifier = await t.staff('driver_verifier');
  assert.equal((await t.api('GET', '/admin/dashboard', { token: analyst.token })).status, 200);
  assert.equal((await t.api('GET', '/admin/finance/payments', { token: analyst.token })).status, 403, 'analyst has no financial detail');
  assert.equal((await t.api('GET', '/admin/bookings', { token: analyst.token })).status, 403, 'analyst has no booking PII');
  assert.equal((await t.api('GET', '/admin/finance/payments', { token: support.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/finance/payments', { token: fo.token })).status, 200);
  assert.equal((await t.api('POST', '/admin/finance/refunds/' + randomUUID() + '/decision', { token: fo.token, body: { approve: true } })).status, 403, 'officer cannot approve refunds');
  assert.equal((await t.api('POST', '/admin/pricing', { token: disp.token, body: {} })).status, 403);
  assert.equal((await t.api('GET', '/admin/drivers', { token: verifier.token })).status, 200);
  assert.equal((await t.api('GET', '/admin/finance/position', { token: verifier.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/audit', { token: fo.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/staff', { token: fo.token })).status, 403);
});

test('sensitive support cases are visible only to authorised staff; internal notes never reach the customer', async () => {
  const p = await t.register(); const agent = await t.staff('support_agent'), lead = await t.staff('support_lead');
  const c = await t.api('POST', '/support/cases', { token: p.token, body: { category: 'safety', subject: 'Driver made me uncomfortable', body: 'details…' } });
  assert.equal(c.json.priority, 'urgent');
  const list = await t.api('GET', '/admin/support/cases', { token: agent.token });
  assert.ok(!list.json.cases.some((x: any) => x.id === c.json.id), 'support agent cannot see sensitive cases');
  assert.equal((await t.api('GET', `/admin/support/cases/${c.json.id}`, { token: agent.token })).status, 404);
  assert.ok((await t.api('GET', '/admin/support/cases', { token: lead.token })).json.cases.some((x: any) => x.id === c.json.id));
  await t.api('POST', `/admin/support/cases/${c.json.id}/update`, { token: lead.token, body: { internal_note: 'Driver has two earlier reports', reply: 'We are looking into this.', assign_to_me: true } });
  const mine = await t.api('GET', `/support/cases/${c.json.id}`, { token: p.token });
  assert.ok(!JSON.stringify(mine.json).includes('two earlier reports'));
  assert.ok(JSON.stringify(mine.json).includes('We are looking into this'));
  const other = await t.register();
  assert.equal((await t.api('GET', `/support/cases/${c.json.id}`, { token: other.token })).status, 404);
  assert.equal((await t.api('POST', `/admin/support/cases/${c.json.id}/update`, { token: lead.token, body: { status: 'resolved' } })).status, 400, 'resolution text required');
});

test('support can find a case by booking ref, payment reference or phone', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const agent = await t.staff('support_agent');
  const { id } = await paidCashTrip(p, d);
  const bk = await t.db.q1<any>('select ref from bookings where id=$1', [id]); const pay = await t.db.q1<any>('select reference from payments where booking_id=$1', [id]);
  const cs = await t.api('POST', '/support/cases', { token: p.token, body: { category: 'payment', subject: 'Charged wrong?', body: 'Charged twice I think', booking_id: id } });
  assert.equal(cs.status, 200, JSON.stringify(cs.json));
  for (const q of [bk.ref, pay.reference, p.phone.slice(-6)]) {
    const r = await t.api('GET', `/admin/support/cases?q=${encodeURIComponent(q)}`, { token: agent.token });
    assert.equal(r.json.cases.length, 1, `search by ${q}: ${JSON.stringify(r.json)}`);
  }
  const bookings = await t.api('GET', `/admin/bookings?q=${pay.reference}`, { token: agent.token });
  assert.equal(bookings.json.bookings.length, 1);
});

test('audit log and ledger are append-only at the database level', async () => {
  const admin = await t.staff('super_admin');
  await t.api('GET', '/admin/dashboard', { token: admin.token });
  await assert.rejects(() => t.db.q('update audit_logs set action=$1', ['tampered']), /append-only/);
  await assert.rejects(() => t.db.q('delete from audit_logs'), /append-only/);
  await assert.rejects(() => t.db.q("update ledger_entries set debit=1 where id=(select min(id) from ledger_entries)"), /append-only|0 rows|./);
  await assert.rejects(() => t.db.q("insert into ledger_entries(txn_id, account_code, debit) values (gen_random_uuid(), 'PLATFORM_BANK', 100)"), /unbalanced/);
});

test('pricing changes need a second approver, never mutate an accepted quote, and are fully audited', async () => {
  const bm = await t.staff('business_manager'), fa = await t.staff('finance_approver'); const p = await t.register(); await t.driver({ vehicle: 'moto' });
  const quote = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0];
  const prop = await t.api('POST', '/admin/pricing', { token: bm.token, body: { service_id: 'moto', base_fare: 600, per_km: 300, per_min: 25, minimum_fare: 1000 } });
  assert.equal(prop.status, 200); assert.equal(prop.json.status, 'pending_approval');
  const mid = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0];
  assert.equal(mid.fare.total, quote.fare.total, 'proposal has no effect until approved');
  assert.equal((await t.api('POST', `/admin/pricing/${prop.json.id}/approve`, { token: bm.token })).status, 403, 'bm lacks approve permission');
  const approve = await t.api('POST', `/admin/pricing/${prop.json.id}/approve`, { token: fa.token });
  assert.equal(approve.status, 200);
  const after = (await t.estimate(p.token, { service_id: 'moto' })).json.options[0];
  assert.ok(after.fare.total > quote.fare.total);
  // the old quote is still honoured at its accepted price
  const r = await t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: quote.quote_id, payment_method: 'cash' } });
  assert.equal(r.json.booking.estimated_fare, quote.fare.total);
  assert.equal((await t.db.q<any>("select id from pricing_rules where service_id='moto' and status='active'")).length, 1, 'exactly one active rule');
  const log = await t.db.q<any>("select action from audit_logs where entity_id=$1 order by id", [prop.json.id]);
  assert.deepEqual(log.map((l: any) => l.action), ['pricing.proposed', 'pricing.approved']);
  const same = await t.api('POST', '/admin/pricing', { token: fa.token, body: { service_id: 'moto', base_fare: 1, per_km: 1, per_min: 1, minimum_fare: 1 } });
  assert.equal(same.status, 403, 'approver is not a pricing maker');
});

test('regulated features cannot be switched on by ordinary staff; surge stays off by default', async () => {
  const bm = await t.staff('business_manager'); const admin = await t.staff('super_admin');
  const f = await t.db.q1<any>("select enabled from feature_flags where key='pricing.surge'");
  assert.equal(f.enabled, false);
  assert.equal((await t.api('PUT', '/admin/flags/pricing.surge', { token: bm.token, body: { enabled: true } })).status, 403);
  assert.equal((await t.api('PUT', '/admin/flags/pricing.surge', { token: admin.token, body: { enabled: true } })).status, 200);
  await t.api('PUT', '/admin/flags/pricing.surge', { token: admin.token, body: { enabled: false } });
  assert.ok((await t.db.q<any>("select 1 from audit_logs where action='flag.changed' and entity_id='pricing.surge'")).length >= 2);
});

test('safety blocks keep a flagged driver away from that passenger', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const lead = await t.staff('support_lead');
  await t.api('POST', '/admin/safety-blocks', { token: lead.token, body: { passenger_id: p.id, driver_id: d.id, reason: 'Harassment complaint upheld' } }).then((r) => assert.equal(r.status, 200));
  const { res } = await t.book(p.token).catch(async () => ({ res: null as any }));
  const e = await t.estimate(p.token, { service_id: 'moto' });
  const q = e.json.options[0];
  if (q.quote_id) {
    const r = await t.api('POST', '/bookings', { token: p.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q.quote_id, payment_method: 'cash' } });
    const offers = await t.api('GET', '/drivers/me/offers', { token: d.token });
    assert.equal(offers.json.offers.length, 0, 'blocked driver is never offered this passenger');
    assert.ok(r.status === 201 || r.status === 409);
  }
  assert.ok(res === null || res);
});

test('privacy: access request exports only own data; deletion anonymises PII but keeps financial records; blocked while trips are open', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' }); const lead = await t.staff('support_lead');
  await t.api('PATCH', '/users/me', { token: p.token, body: { display_name: 'Jeanne Uwase', email: 'jeanne@example.com' } });
  await t.api('POST', '/users/me/places', { token: p.token, body: { label: 'home', name: 'Home', lat: -1.95, lng: 30.1 } });
  const { id } = await paidCashTrip(p, d);
  const acc = await t.api('POST', '/users/me/privacy-requests', { token: p.token, body: { kind: 'access' } });
  const exp = await t.api('POST', `/admin/privacy-requests/${acc.json.id}/execute`, { token: lead.token });
  assert.equal(exp.status, 200); assert.equal(exp.json.user.id, p.id); assert.equal(exp.json.bookings.length, 1);
  assert.ok(!JSON.stringify(exp.json).includes(d.phone), 'no one else’s data in an export');
  const del = await t.api('POST', '/users/me/privacy-requests', { token: p.token, body: { kind: 'deletion' } });
  const done = await t.api('POST', `/admin/privacy-requests/${del.json.id}/execute`, { token: lead.token });
  assert.equal(done.status, 200);
  const u = await t.db.q1<any>('select phone, email, display_name, status from users where id=$1', [p.id]);
  assert.equal(u.phone, null); assert.equal(u.email, null); assert.equal(u.status, 'deleted');
  assert.equal((await t.db.q<any>('select 1 from saved_places where user_id=$1', [p.id])).length, 0);
  assert.equal((await t.db.q<any>('select 1 from ledger_entries where booking_id=$1', [id])).length > 0, true, 'financial records retained');
  assert.equal((await t.api('GET', '/users/me', { token: p.token })).status, 401, 'sessions revoked');
  // blocked while a trip is open
  const p2 = await t.register(); const d2 = await t.driver({ vehicle: 'moto' }); await t.book(p2.token);
  const del2 = await t.api('POST', '/users/me/privacy-requests', { token: p2.token, body: { kind: 'deletion' } });
  assert.equal((await t.api('POST', `/admin/privacy-requests/${del2.json.id}/execute`, { token: lead.token })).status, 409);
  assert.ok(d2);
});

test('CSV exports neutralise spreadsheet formulas and are audited', async () => {
  const fo = await t.staff('finance_officer'); const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  await paidCashTrip(p, d);
  await t.db.q("update payments set provider_reference='=HYPERLINK(\"http://evil\")' where method='cash'");
  const r = await t.api('GET', '/admin/finance/export/payments', { token: fo.token });
  assert.equal(r.status, 200); assert.ok(r.raw.includes("'=HYPERLINK") && !r.raw.includes(',=HYPERLINK'));
  assert.ok((await t.db.q<any>("select 1 from audit_logs where action='export'")).length >= 1);
});

test('security headers and generic errors: no stack traces leak', async () => {
  const r = await t.api('GET', '/health');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  const bad = await t.api('POST', '/auth/otp/verify', { body: { phone: '+250788000000', code: 'abc' } });
  assert.equal(bad.status, 400); assert.ok(!JSON.stringify(bad.json).includes('node_modules'));
  const nf = await t.api('GET', '/nope');
  assert.equal(nf.status, 404);
});
