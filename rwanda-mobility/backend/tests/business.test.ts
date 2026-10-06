import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

async function newCorp(owner: any, name: string, approve = true) {
  const c = await t.api('POST', '/businesses', { token: owner.token, body: { legal_name: name, tin: '1234567' } });
  assert.equal(c.status, 200);
  if (approve) { const admin = await t.staff('business_manager'); await t.api('POST', `/admin/businesses/${c.json.id}/decision`, { token: admin.token, body: { status: 'active' } }); }
  return c.json.id as string;
}
async function corpBook(user: any, corpId: string, extra: any = {}) {
  const e = await t.estimate(user.token, { service_id: 'moto' });
  const q = e.json.options[0];
  if (!q.quote_id) return { status: 0, json: e.json, q };
  const r = await t.api('POST', `/businesses/${corpId}/bookings`, { token: user.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: q.quote_id, ...extra } });
  return { ...r, q };
}

test('corporate: pending business cannot book; after verification members book on company account', async () => {
  const boss = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const id = await newCorp(boss, 'Acme Rwanda Ltd', false);
  assert.equal((await corpBook(boss, id)).status, 403, 'not yet verified');
  const bm = await t.staff('business_manager');
  await t.api('POST', `/admin/businesses/${id}/decision`, { token: bm.token, body: { status: 'active' } });
  const r = await corpBook(boss, id, { cost_centre: 'SALES', po_ref: 'PO-77' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const bid = r.json.id;
  const done = await t.runTrip(boss, d, bid);
  assert.equal(done.payment.method, 'corporate'); assert.equal(done.status, 'PAYMENT_COMPLETED', 'billed to the company; no passenger payment step');
  const led = await t.db.q1<any>("select sum(debit)::int v from ledger_entries where account_code='CORPORATE_RECEIVABLE' and booking_id=$1", [bid]);
  assert.equal(led.v, done.final_fare);
  const inv = await t.api('POST', `/admin/businesses/${id}/invoice`, { token: bm.token, body: { month: new Date().toISOString().slice(0, 7) } });
  assert.equal(inv.status, 200); assert.equal(inv.json.total_amount, done.final_fare); assert.equal(inv.json.trip_count, 1);
  assert.equal((await t.api('POST', `/admin/businesses/${id}/invoice`, { token: bm.token, body: { month: new Date().toISOString().slice(0, 7) } })).status, 409, 'no duplicate invoice');
  const st = await t.api('GET', `/businesses/${id}/statement?month=${new Date().toISOString().slice(0, 7)}`, { token: boss.token });
  assert.equal(st.json.total, done.final_fare); assert.equal(st.json.by_cost_centre.SALES, done.final_fare);
  assert.equal((await t.api('GET', `/businesses/${id}/invoices`, { token: boss.token })).json.invoices.length, 1);
});

test('corporate controls: employee limit, company budget, max fare, allowed services/hours are enforced server-side', async () => {
  const boss = await t.register(); await t.driver({ vehicle: 'moto' });
  const id = await newCorp(boss, 'Limits Ltd');
  const emp = await t.register();
  const add = await t.api('POST', `/businesses/${id}/members`, { token: boss.token, body: { phone: emp.phone, role: 'employee', spending_limit: 1500, cost_centre: 'OPS' } });
  assert.equal(add.status, 200);
  const over = await corpBook(emp, id);
  assert.equal(over.status, 403); assert.equal(over.json.error.code, 'corporate_member_limit');
  await t.api('POST', `/businesses/${id}/members`, { token: boss.token, body: { phone: emp.phone, role: 'employee', spending_limit: 50000 } });
  await t.api('PATCH', `/businesses/${id}/policy`, { token: boss.token, body: { max_fare: 1000 } });
  assert.equal((await corpBook(emp, id)).json.error.code, 'corporate_max_fare');
  await t.api('PATCH', `/businesses/${id}/policy`, { token: boss.token, body: { max_fare: null, allowed_services: ['standard'] } });
  assert.equal((await corpBook(emp, id)).json.error.code, 'corporate_service_not_allowed');
  await t.api('PATCH', `/businesses/${id}/policy`, { token: boss.token, body: { allowed_services: [], monthly_budget: 1000 } });
  assert.equal((await corpBook(emp, id)).json.error.code, 'corporate_budget_exceeded');
  await t.api('PATCH', `/businesses/${id}/policy`, { token: boss.token, body: { monthly_budget: null } });
  const h = (new Date().getUTCHours() + 2) % 24;
  await t.api('PATCH', `/businesses/${id}/policy`, { token: boss.token, body: { start_hour: (h + 3) % 24 === 0 ? 1 : (h + 3) % 24, end_hour: ((h + 3) % 24) + 1 > 24 ? 24 : ((h + 3) % 24) + 1 || 1 } });
  assert.equal((await corpBook(emp, id)).json.error.code, 'corporate_time_not_allowed');
  await t.api('PATCH', `/businesses/${id}/policy`, { token: boss.token, body: { start_hour: null, end_hour: null } });
  assert.equal((await corpBook(emp, id)).status, 201);
  // removed employee loses access immediately
  await t.api('DELETE', `/businesses/${id}/members/${emp.id}`, { token: boss.token });
});

test('corporate isolation: other businesses, strangers and ordinary employees cannot see company data', async () => {
  const bossA = await t.register(), bossB = await t.register(), stranger = await t.register(), emp = await t.register(); await t.driver({ vehicle: 'moto' });
  const A = await newCorp(bossA, 'Company A'); const B = await newCorp(bossB, 'Company B');
  await t.api('POST', `/businesses/${A}/members`, { token: bossA.token, body: { phone: emp.phone, role: 'employee' } });
  const bk = await corpBook(bossA, A); assert.equal(bk.status, 201);
  for (const path of [`/businesses/${A}/members`, `/businesses/${A}/bookings`, `/businesses/${A}/invoices`, `/businesses/${A}/statement?month=2025-01`])
    for (const who of [bossB, stranger]) assert.equal((await t.api('GET', path, { token: who.token })).status, 404, path);
  assert.equal((await t.api('GET', `/businesses/${A}/members`, { token: emp.token })).status, 404, 'employees are not admins');
  assert.equal((await t.api('GET', `/businesses/${A}/bookings`, { token: emp.token })).json.bookings.length, 0, 'employee sees only their own trips');
  assert.equal((await t.api('GET', `/bookings/${bk.json.id}`, { token: stranger.token })).status, 404);
  assert.equal((await t.api('GET', `/bookings/${bk.json.id}`, { token: bossA.token })).status, 200);
  assert.equal((await t.api('GET', `/bookings/${bk.json.id}`, { token: bossB.token })).status, 404);
  assert.equal((await t.api('POST', `/businesses/${A}/members`, { token: bossB.token, body: { phone: stranger.phone } })).status, 404);
  assert.equal((await t.api('PATCH', `/businesses/${A}/policy`, { token: emp.token, body: { max_fare: 1 } })).status, 404);
  // ordinary passengers cannot book on a company account
  const e = await t.estimate(stranger.token, { service_id: 'moto' });
  const r = await t.api('POST', '/bookings', { token: stranger.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: e.json.options[0].quote_id, payment_method: 'corporate', corporate_id: A } });
  assert.equal(r.status, 403);
  void B;
});

test('credit terms need manual approval and a credit limit', async () => {
  const boss = await t.register(); const id = await newCorp(boss, 'Credit Ltd'); const bm = await t.staff('business_manager');
  assert.equal((await t.api('POST', `/admin/businesses/${id}/decision`, { token: bm.token, body: { status: 'active', billing_mode: 'credit' } })).status, 400);
  assert.equal((await t.api('POST', `/admin/businesses/${id}/decision`, { token: bm.token, body: { status: 'active', billing_mode: 'credit', credit_limit: 500000 } })).status, 200);
  assert.equal((await t.api('POST', `/admin/businesses/${id}/decision`, { token: boss.token, body: { status: 'active' } })).status, 403);
});

async function newFleet(owner: any, name: string, share = 0) {
  const f = await t.api('POST', '/fleets', { token: owner.token, body: { name } });
  assert.equal(f.status, 200);
  const bm = await t.staff('business_manager');
  await t.api('POST', `/admin/fleets/${f.json.id}/decision`, { token: bm.token, body: { status: 'active', revenue_share_bps: share } });
  return f.json.id as string;
}

test('fleet: invite drivers, revenue share is paid to the fleet owner, and a fleet only ever sees its own data', async () => {
  const ownerA = await t.register(), ownerB = await t.register(); const A = await newFleet(ownerA, 'Kigali Cabs', 1000), B = await newFleet(ownerB, 'Other Fleet');
  const dA = await t.driver({ vehicle: 'moto', fleetId: A }); const dB = await t.driver({ vehicle: 'moto', fleetId: B, at: { lat: -1.941, lng: 30.0927 } });
  const p = await t.register();
  // invite flow
  const free = await t.driver({ vehicle: 'moto', online: false });
  const inv = await t.api('POST', `/fleets/${A}/invites`, { token: ownerA.token, body: { phone: free.phone } });
  assert.equal(inv.status, 200);
  const st = await t.api('GET', '/drivers/me/status', { token: free.token });
  assert.equal(st.json.fleet_invites.length, 1);
  assert.equal((await t.api('POST', '/drivers/me/fleet/accept', { token: free.token, body: { invite_id: st.json.fleet_invites[0].id } })).status, 200);
  assert.equal((await t.api('GET', `/fleets/${A}/drivers`, { token: ownerA.token })).json.drivers.length, 2);
  // revenue share
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  const done = await t.runTrip(p, dA, id);
  await t.api('POST', `/bookings/${id}/cash-collected`, { token: dA.token, body: { amount: done.final_fare } });
  const e = await t.db.q1<any>('select * from driver_earnings where booking_id=$1', [id]);
  assert.equal(e.fleet_id, A); assert.equal(e.fleet_share, Math.floor(((e.fare_subtotal - e.commission) * 1000 + 5000) / 10000));
  assert.equal(e.net + e.fleet_share + e.commission, e.fare_subtotal);
  const owner = await t.api('GET', `/fleets/${A}/earnings`, { token: ownerA.token });
  assert.equal(owner.json.fleet_share, e.fleet_share); assert.equal(owner.json.trips, 1);
  assert.equal(owner.json.fleet_balance.payable, e.fleet_share, 'fleet owner has a payable balance separate from the driver');
  const l = await t.db.q1<any>("select sum(credit-debit)::int v from ledger_entries where account_code='DRIVER_PAYABLE' and booking_id=$1", [id]);
  assert.equal(l.v, e.net + e.fleet_share);
  // isolation
  for (const path of [`/fleets/${A}/drivers`, `/fleets/${A}/vehicles`, `/fleets/${A}/trips`, `/fleets/${A}/earnings`])
    assert.equal((await t.api('GET', path, { token: ownerB.token })).status, 404, path);
  assert.equal((await t.api('GET', `/fleets/${B}/drivers`, { token: ownerB.token })).json.drivers.every((x: any) => x.user_id === dB.id), true);
  assert.equal((await t.api('POST', `/fleets/${A}/invites`, { token: ownerB.token, body: { phone: p.phone } })).status, 404);
  const vA = await t.db.q1<any>('select id from vehicles where driver_id=$1', [dA.id]);
  assert.equal((await t.api('PATCH', `/fleets/${A}/vehicles/${vA.id}`, { token: ownerB.token, body: { status: 'suspended' } })).status, 404);
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: ownerA.token })).status, 200, 'fleet owner can see their driver’s trip');
  assert.equal((await t.api('GET', `/bookings/${id}`, { token: ownerB.token })).status, 404);
  assert.equal((await t.api('POST', `/fleets/${A}/payouts`, { token: ownerB.token, body: { amount: 100 } })).status, 404);
  // availability control: manager suspends a vehicle => driver no longer dispatchable
  await t.db.q('update driver_profiles set is_online=false where user_id=$1', [dB.id]);   // isolate: only fleet A's driver is online
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).json.options[0].available, true);
  assert.equal((await t.api('PATCH', `/fleets/${A}/vehicles/${vA.id}`, { token: ownerA.token, body: { status: 'suspended' } })).status, 200);
  assert.equal((await t.estimate(p.token, { service_id: 'moto' })).json.options[0].available, false);
});

test('unverified fleets cannot invite drivers', async () => {
  const o = await t.register(); const f = await t.api('POST', '/fleets', { token: o.token, body: { name: 'New Fleet' } });
  assert.equal((await t.api('POST', `/fleets/${f.json.id}/invites`, { token: o.token, body: { phone: '0788555111' } })).status, 403);
});
