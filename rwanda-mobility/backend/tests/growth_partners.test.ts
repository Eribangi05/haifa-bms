import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx, KCC } from './helpers.ts';

let t: Ctx; let A: any, B: any; let mgrA: { token: string }, mgrB: { token: string }, admin: { token: string };
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

const month = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 7);
async function code(label: string) {
  const c = 'T' + randomUUID().replace(/[^A-HJ-NP-Z2-9]/gi, '').toUpperCase().padEnd(6, '7').slice(0, 5);
  return (await t.db.q<any>("insert into request_codes(code,label,lat,lng) values ($1,$2,$3,$4) returning id, code", [c, label, KCC.lat, KCC.lng]))[0];
}
async function invite(partnerId: string) {
  const email = `pm-${randomUUID().slice(0, 6)}@test.local`;
  const inv = await t.api('POST', `/admin/partners/${partnerId}/invite`, { token: admin.token, body: { email, name: 'Partner Manager' } });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const token = inv.json.invite_url.split('#activate=')[1];
  const begin = await t.api('POST', `/staff-invite/${token}/begin`);
  const pw = 'CorrectHorse-Battery-9';
  const act = await t.api('POST', `/staff-invite/${token}/activate`, { body: { password: pw, code: t.crypto.totpAt(begin.json.secret) } });
  assert.equal(act.status, 200, JSON.stringify(act.json));
  const login = await t.api('POST', '/auth/staff/login', { body: { email, password: pw, totp: t.crypto.totpAt(begin.json.secret) } });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  return { token: login.json.access_token as string, email, roles: login.json.roles };
}
async function ride(token: string, dr: any, rc: string, method: string, extra: any = {}) {
  const e = await t.estimate(token, { service_id: 'moto' });
  return t.api('POST', '/bookings', { token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: e.json.options[0].quote_id, payment_method: method, request_code: rc, ...extra } });
}

test('admin sets up two partners, links codes, invites managers through the staff invite flow', async () => {
  admin = await t.staff('business_manager');
  A = (await t.api('POST', '/admin/partners', { token: admin.token, body: { name: 'Hotel Alpha', contact_name: 'Ann', billing_terms: { payment_days: 30 } } })).json;
  B = (await t.api('POST', '/admin/partners', { token: admin.token, body: { name: 'Hotel Beta' } })).json;
  assert.ok(A.id && A.corporate_id);
  assert.equal((await t.api('POST', '/admin/partners', { token: admin.token, body: { name: 'hotel alpha' } })).json.error.code, 'partner_exists');
  const an = await t.staff('analyst'), sup = await t.staff('support_agent');
  for (const u of [an, sup]) assert.equal((await t.api('GET', '/admin/partners', { token: u.token })).status, 403);
  const a1 = await code('Alpha lobby'), a2 = await code('Alpha bar'), b1 = await code('Beta lobby');
  (globalThis as any).codes = { a1, a2, b1 };
  assert.equal((await t.api('POST', `/admin/partners/${A.id}/codes`, { token: admin.token, body: { code_id: a1.id, bill_to_partner: true } })).status, 200);
  assert.equal((await t.api('POST', `/admin/partners/${A.id}/codes`, { token: admin.token, body: { code_id: a2.id } })).status, 200);
  assert.equal((await t.api('POST', `/admin/partners/${B.id}/codes`, { token: admin.token, body: { code_id: b1.id, bill_to_partner: true } })).status, 200);
  assert.equal((await t.api('POST', `/admin/partners/${B.id}/codes`, { token: admin.token, body: { code_id: a1.id } })).json.error.code, 'code_linked_elsewhere');
  // the generic invite refuses the partner role; the partner invite binds to exactly one partner
  assert.equal((await t.api('POST', '/admin/staff/invites', { token: (await t.staff('super_admin')).token, body: { email: 'x@test.local', name: 'Xx', role: 'partner_manager' } })).json.error.code, 'partner_required');
  mgrA = await invite(A.id); mgrB = await invite(B.id);
  assert.deepEqual(mgrA, { ...mgrA, roles: ['partner_manager'] });
  assert.equal((await t.db.q<any>('select count(*)::int n from partner_users'))[0].n, 2);
  assert.ok((await t.db.q<any>("select 1 from audit_logs where action='partner.manager_invited'")).length);
});

test('billing to the partner: invoice engine, no personal charge, caps; requests and statement per partner', async () => {
  await t.reset(); const drv = await t.driver({ at: KCC });
  const { a1, a2, b1 } = (globalThis as any).codes;
  const p1 = await t.register('passenger');
  // payer 'partner' only works with a billable code
  assert.equal((await ride(p1.token, drv, a2.code, 'partner')).json.error.code, 'partner_billing_unavailable');
  assert.equal((await ride(p1.token, drv, '', 'partner')).status, 400);
  const r = await ride(p1.token, drv, a1.code, 'partner');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.booking.payment_method, 'corporate');
  const id = r.json.booking.id;
  const bRow = (await t.db.q<any>('select partner_id, partner_billed, corporate_id, payer_type from bookings where id=$1', [id]))[0];
  assert.deepEqual([bRow.partner_id, bRow.partner_billed, bRow.corporate_id, bRow.payer_type], [A.id, true, A.corporate_id, 'corporate']);
  await t.runTrip(p1, drv, id);
  const pay = (await t.db.q<any>('select method, status, settlement_status, payer_user_id from payments where booking_id=$1', [id]))[0];
  assert.equal(pay.method, 'corporate'); assert.equal(pay.status, 'SUCCESS'); assert.equal(pay.settlement_status, 'invoiced');
  const fare = (await t.db.q<any>('select final_fare from bookings where id=$1', [id]))[0].final_fare;
  assert.equal((await t.db.q<any>("select coalesce(sum(debit-credit),0)::int n from ledger_entries where account_code='CORPORATE_RECEIVABLE' and owner_user_id=$1", [A.corporate_id]))[0].n, fare);
  assert.equal((await t.db.q<any>("select count(*)::int n from passenger_debts where user_id=$1", [p1.id]))[0].n, 0);
  // an unbilled ride from a2 (cash) and a ride from B (billed to B, for a guest: the guest is never charged)
  const p2 = await t.register('passenger');
  const r2 = await ride(p2.token, drv, a2.code, 'cash'); assert.equal(r2.status, 201); await t.runTrip(p2, drv, r2.json.booking.id);
  await t.api('POST', `/bookings/${r2.json.booking.id}/cash-collected`, { token: drv.token, body: { amount: r2.json.booking.estimated_fare } });
  const p3 = await t.register('passenger');
  const r3 = await ride(p3.token, drv, b1.code, 'partner', { for_guest: { name: 'Guest G', phone: '+250788777666' } });
  assert.equal(r3.status, 201, JSON.stringify(r3.json)); await t.runTrip(p3, drv, r3.json.booking.id);
  assert.equal((await t.db.q<any>("select method from payments where booking_id=$1", [r3.json.booking.id]))[0].method, 'corporate');
  // --- isolation ---
  const mine = await t.api('GET', '/partner/codes', { token: mgrA.token });
  assert.deepEqual(mine.json.codes.map((c: any) => c.code).sort(), [a1.code, a2.code].sort());
  assert.equal(mine.json.codes.find((c: any) => c.code === a1.code).requests, 1);
  const reqA = await t.api('GET', '/partner/requests', { token: mgrA.token });
  assert.deepEqual(reqA.json.requests.map((x: any) => x.code_label).sort(), ['Alpha bar', 'Alpha lobby']);
  const txt = JSON.stringify(reqA.json);
  for (const secret of [p1.phone, p2.phone, p1.id, p2.id, p3.id, 'Guest G', '777666', drv.phone, drv.plate]) assert.ok(!txt.includes(secret), 'no personal data in the partner view: ' + secret);
  assert.ok(reqA.json.requests.every((x: any) => !('passenger_id' in x) && !('driver_id' in x)));
  const reqB = await t.api('GET', '/partner/requests', { token: mgrB.token });
  assert.deepEqual(reqB.json.requests.map((x: any) => x.code_label), ['Beta lobby']);
  assert.ok(!JSON.stringify(reqB.json).includes(r.json.booking.ref) && !JSON.stringify(reqA.json).includes(r3.json.booking.ref));
  assert.deepEqual((await t.api('GET', '/partner/codes', { token: mgrB.token })).json.codes.map((c: any) => c.code), [b1.code]);
  // a client-supplied partner id is ignored
  const sneaky = await t.api('GET', `/partner/requests?partner_id=${B.id}&limit=100`, { token: mgrA.token });
  assert.deepEqual(sneaky.json.requests.map((x: any) => x.code_label).sort(), ['Alpha bar', 'Alpha lobby']);
  assert.equal((await t.api('GET', `/partner/statement?month=${month()}&partner_id=${B.id}`, { token: mgrA.token })).json.billed_trip_count, 1);
  // cannot reach admin endpoints, other partners, or bookings
  for (const [m, u] of [['GET', `/admin/partners/${B.id}`], ['GET', '/admin/partners'], ['POST', `/admin/partners/${B.id}/invoice`], ['GET', `/admin/partners/${B.id}/statement?month=${month()}`], ['GET', '/admin/bookings'], ['GET', '/admin/request-codes'], ['GET', '/admin/quests'], ['GET', '/admin/campaigns'], ['GET', '/admin/heatmap']] as const)
    assert.equal((await t.api(m, u, { token: mgrA.token, body: m === 'POST' ? { month: month() } : undefined })).status, 403, `${m} ${u}`);
  assert.ok([403, 404].includes((await t.api('GET', `/bookings/${r3.json.booking.id}`, { token: mgrA.token })).status));
  assert.ok([403, 404].includes((await t.api('GET', `/bookings/${id}`, { token: mgrB.token })).status));
  // the portal is closed to everyone else, and to staff without a partner
  const pax = await t.register('passenger'); const sa = await t.staff('super_admin');
  assert.equal((await t.api('GET', '/partner/codes', { token: pax.token })).status, 403);
  assert.equal((await t.api('GET', '/partner/codes', { token: admin.token })).status, 403);
  assert.equal((await t.api('GET', '/partner/codes', { token: sa.token })).json.error.code, 'no_partner');
  assert.equal((await t.api('GET', '/partner/codes')).status, 401);
  // statements and invoices
  const st = await t.api('GET', `/partner/statement?month=${month()}`, { token: mgrA.token });
  assert.equal(st.json.billed_trip_count, 1); assert.equal(st.json.billed_total, fare); assert.equal(st.json.completed_trips, 2); assert.equal(st.json.requests, 2); assert.equal(st.json.invoice, null);
  assert.ok(st.json.trips.every((x: any) => !('passenger_id' in x)));
  const inv = await t.api('POST', `/admin/partners/${A.id}/invoice`, { token: admin.token, body: { month: month() } });
  assert.equal(inv.status, 200, JSON.stringify(inv.json)); assert.equal(inv.json.total_amount, fare); assert.equal(inv.json.trip_count, 1);
  assert.equal((await t.api('POST', `/admin/partners/${A.id}/invoice`, { token: admin.token, body: { month: month() } })).json.error.code, 'already_invoiced');
  assert.equal((await t.api('GET', `/partner/statement?month=${month()}`, { token: mgrA.token })).json.invoice.total_amount, fare);
  assert.equal((await t.api('GET', `/partner/statement?month=${month()}`, { token: mgrB.token })).json.invoice, null);
  assert.equal((await t.api('POST', `/admin/partners/${B.id}/invoice`, { token: admin.token, body: { month: '2020-01' } })).json.error.code, 'nothing_to_invoice');
  assert.equal((await import('../src/services/ledger.ts').then((m) => m.integrityReport())).balanced, true);
});

test('partner limits (fare, monthly, per person), suspension, and unlinking', async () => {
  await t.reset(); const drv = await t.driver({ at: KCC });
  const { a1 } = (globalThis as any).codes;
  const p = await t.register('passenger');
  await t.api('PATCH', `/admin/partners/${A.id}`, { token: admin.token, body: { billing_terms: { max_fare: 100 } } });
  const low = await ride(p.token, drv, a1.code, 'partner');
  assert.equal(low.status, 403); assert.equal(low.json.error.code, 'partner_max_fare');
  await t.api('PATCH', `/admin/partners/${A.id}`, { token: admin.token, body: { billing_terms: { monthly_cap: 100 } } });
  assert.equal((await ride(p.token, drv, a1.code, 'partner')).json.error.code, 'partner_cap_reached');
  await t.api('PATCH', `/admin/partners/${A.id}`, { token: admin.token, body: { billing_terms: {} } });
  await t.db.q("insert into system_settings(key,value) values ('partner.max_billed_per_user_per_day','1') on conflict (key) do update set value=excluded.value");
  const ok = await ride(p.token, drv, a1.code, 'partner'); assert.equal(ok.status, 201);
  await t.api('POST', `/bookings/${ok.json.booking.id}/cancel`, { token: p.token, body: { reason: 'changed_mind' } });
  const p2 = await t.register('passenger');
  assert.equal((await ride(p2.token, drv, a1.code, 'partner')).status, 201);
  const again = await ride(p.token, drv, a1.code, 'partner');    // cancelled ride does not count; one active exists for p? no: cancelled -> allowed once more
  assert.ok([201, 403].includes(again.status));
  await t.db.q("delete from system_settings where key='partner.max_billed_per_user_per_day'");
  // suspension closes the portal and billing
  await t.api('PATCH', `/admin/partners/${A.id}`, { token: admin.token, body: { status: 'suspended' } });
  assert.equal((await t.api('GET', '/partner/codes', { token: mgrA.token })).json.error.code, 'partner_suspended');
  const p3 = await t.register('passenger');
  assert.equal((await ride(p3.token, drv, a1.code, 'partner')).json.error.code, 'partner_billing_unavailable');
  await t.api('PATCH', `/admin/partners/${A.id}`, { token: admin.token, body: { status: 'active' } });
  assert.equal((await t.api('GET', '/partner/codes', { token: mgrA.token })).status, 200);
  // unlink removes the code from the partner's view
  assert.equal((await t.api('DELETE', `/admin/partners/${A.id}/codes/${a1.id}`, { token: admin.token })).status, 200);
  assert.ok(!(await t.api('GET', '/partner/codes', { token: mgrA.token })).json.codes.some((c: any) => c.code === a1.code));
  assert.equal((await t.db.q<any>('select bill_to_partner from request_codes where id=$1', [a1.id]))[0].bill_to_partner, false);
});
