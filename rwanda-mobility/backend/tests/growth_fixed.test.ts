import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });
const AIRPORT = { lat: -1.9686, lng: 30.1395 }, CENTRE = { lat: -1.9441, lng: 30.0619 };

test('seeded placeholder routes are inactive and flagged; estimates are unchanged', async () => {
  const rows = await t.db.q<any>('select * from fixed_routes order by name_en');
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r: any) => r.placeholder && !r.active));
  assert.deepEqual(rows.map((r: any) => r.name_en).sort(), ['Kigali - Huye', 'Kigali - Musanze', 'Kigali - Rubavu', 'Kigali Airport - City centre']);
  await t.reset(); await t.driver({ at: AIRPORT });
  const u = await t.register('passenger');
  const e = await t.api('POST', '/fares/estimate', { token: u.token, body: { pickup: AIRPORT, dest: CENTRE, service_id: 'standard' } });
  assert.equal(e.status, 200);
  assert.ok(!e.json.options.some((o: any) => o.fixed_price));
});

test('maker-checker, placeholder guard, fixed option labelled in rw/fr/en, bidirectional, commission and tax as normal', async () => {
  await t.reset(); const drv = await t.driver({ vehicle: 'car', at: AIRPORT });
  const mgr = await t.staff('business_manager'), appr = await t.staff('finance_approver'), analyst = await t.staff('analyst');
  const route = (await t.db.q<any>("select id from fixed_routes where name_en='Kigali Airport - City centre'"))[0];
  assert.equal((await t.api('GET', '/admin/fixed-routes', { token: analyst.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/fixed-routes', { token: appr.token })).status, 200);
  assert.equal((await t.api('POST', `/admin/fixed-routes/${route.id}/approve`, { token: appr.token, body: {} })).json.error.code, 'nothing_pending');
  const p = await t.api('PATCH', `/admin/fixed-routes/${route.id}`, { token: mgr.token, body: { active: true } });
  assert.equal(p.status, 200); assert.equal(p.json.active, false); assert.deepEqual(p.json.pending, { active: true });
  assert.equal((await t.api('POST', `/admin/fixed-routes/${route.id}/approve`, { token: mgr.token, body: {} })).status, 403);   // not by the proposer, and mgr lacks approve anyway
  const noConfirm = await t.api('POST', `/admin/fixed-routes/${route.id}/approve`, { token: appr.token, body: {} });
  assert.equal(noConfirm.json.error.code, 'placeholder_price');
  // set the real price (pending again), then approve
  await t.api('PATCH', `/admin/fixed-routes/${route.id}`, { token: mgr.token, body: { price_rwf: 9000 } });
  const ok = await t.api('POST', `/admin/fixed-routes/${route.id}/approve`, { token: appr.token, body: {} });
  assert.equal(ok.status, 200); assert.equal(ok.json.active, true); assert.equal(ok.json.price, 9000); assert.equal(ok.json.placeholder, false);
  const audits = await t.db.q<any>("select action from audit_logs where entity_id=$1", [route.id]);
  assert.ok(audits.some((a: any) => a.action === 'fixed_route.approved'));
  // give the standard rule a tax so we can see the rule applied
  await t.db.q("update pricing_rules set tax_bps=1800 where service_id='standard' and status='active'");
  const u = await t.register('passenger');
  const est = async (pickup: any, dest: any, lang = 'en') => (await t.api('POST', '/fares/estimate', { token: u.token, body: { pickup, dest, service_id: 'standard' }, headers: { 'accept-language': lang } })).json;
  const e = await est(AIRPORT, CENTRE);
  const fx = e.options.find((o: any) => o.fixed_price);
  assert.ok(fx, JSON.stringify(e));
  assert.equal(fx.fare.subtotal, 9000); assert.equal(fx.fare.tax, 1620); assert.equal(fx.fare.total, 10620);
  const line = fx.fare.lines.find((l: any) => l.code === 'fixed_route');
  assert.equal(line.label_fr, 'Prix fixe : Aéroport de Kigali - Centre-ville'); assert.match(line.label_rw, /^Igiciro kidahinduka: Ikibuga/); assert.match(line.label_en, /^Fixed price: Kigali Airport/);
  assert.ok(fx.fare.lines.some((l: any) => l.code === 'tax'));
  assert.equal(fx.fixed_route.id, route.id);
  assert.ok(e.options.some((o: any) => !o.fixed_price && o.service_id === 'standard'), 'metered option still offered');
  assert.ok((await est(CENTRE, AIRPORT)).options.some((o: any) => o.fixed_price), 'reverse direction');
  assert.ok(!(await est(AIRPORT, { lat: -1.9780, lng: 30.0447 })).options.some((o: any) => o.fixed_price), 'other destination');
  // validity window
  await t.db.q("update fixed_routes set valid_to = now() - interval '1 day' where id=$1", [route.id]);
  assert.ok(!(await est(AIRPORT, CENTRE)).options.some((o: any) => o.fixed_price));
  await t.db.q("update fixed_routes set valid_to = null where id=$1", [route.id]);
  // book and complete: commission on the fixed subtotal, tax collected, ledger balanced
  const f2 = (await est(AIRPORT, CENTRE)).options.find((o: any) => o.fixed_price);
  const bk = await t.api('POST', '/bookings', { token: u.token, headers: { 'idempotency-key': randomUUID() }, body: { quote_id: f2.quote_id, payment_method: 'cash' } });
  assert.equal(bk.status, 201);
  const done = await t.runTrip(u, drv, bk.json.booking.id);
  assert.equal(done.fare_is_final, true);
  const bkRow = (await t.db.q<any>('select final_fare from bookings where id=$1', [bk.json.booking.id]))[0];
  assert.equal(bkRow.final_fare, 10620);
  assert.equal((await t.api('POST', `/bookings/${bk.json.booking.id}/cash-collected`, { token: drv.token, body: { amount: 10620 } })).json.status, 'SUCCESS');
  const earn = (await t.db.q<any>('select commissionable, commission, tax from driver_earnings where booking_id=$1', [bk.json.booking.id]))[0];
  assert.equal(earn.commissionable, 9000); assert.equal(earn.tax, 1620); assert.ok(earn.commission > 0);
  const { integrityReport } = await import('../src/services/ledger.ts');
  assert.equal((await integrityReport()).balanced, true);
  // deactivation applies at once
  assert.equal((await t.api('PATCH', `/admin/fixed-routes/${route.id}`, { token: mgr.token, body: { active: false } })).json.active, false);
  assert.ok(!(await est(AIRPORT, CENTRE)).options.some((o: any) => o.fixed_price));
});

test('creating a route by place ids with a radius; validation', async () => {
  const mgr = await t.staff('business_manager');
  const place = (await t.db.q<any>("select id from places where name_en like 'Kimironko%' limit 1"))[0] ?? (await t.db.q<any>('select id from places limit 1'))[0];
  const r = await t.api('POST', '/admin/fixed-routes', { token: mgr.token, body: { name_en: 'Test route', name_rw: 'Inzira y\'igerageza', name_fr: 'Itinéraire test', from: { place_id: place.id, radius_m: 800 }, to: { lat: -1.95, lng: 30.1, radius_m: 900 }, service_id: 'standard', price_rwf: 5000 } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.active, false); assert.equal(r.json.from_radius_m, 800);
  assert.equal((await t.api('POST', '/admin/fixed-routes', { token: mgr.token, body: { name_en: 'x', name_rw: 'xx', name_fr: 'xx', from: { radius_m: 800 }, to: { lat: 1, lng: 1 }, service_id: 'standard', price_rwf: 5000 } })).status, 400);
  assert.equal((await t.api('POST', '/admin/fixed-routes', { token: mgr.token, body: { name_en: 'xx', name_rw: 'xx', name_fr: 'xx', from: { lat: -1.9, lng: 30 }, to: { lat: -1.95, lng: 30.1 }, service_id: 'nope', price_rwf: 5000 } })).status, 400);
});
