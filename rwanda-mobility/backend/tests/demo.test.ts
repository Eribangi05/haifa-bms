import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx, q: typeof import('../src/db.ts').q, q1: typeof import('../src/db.ts').q1;
before(async () => { t = await boot('rwanda_mobility_test'); ({ q, q1 } = await import('../src/db.ts')); });
after(async () => { await t.close(); });

test('demo data: loads a week of activity, feeds revenue / ratings / statement / receipt, and clears without leaving a trace', async () => {
  const sa = await t.staff('super_admin'); const fo = await t.staff('finance_officer');
  assert.equal((await t.api('POST', '/admin/demo/load', { token: fo.token, body: {} })).status, 403, 'only administrators');
  const ld = await t.api('POST', '/admin/demo/load', { token: sa.token, body: { drivers: 12, riders: 25, days: 5 } });
  assert.equal(ld.status, 200, JSON.stringify(ld.json));
  assert.ok(ld.json.trips > 40 && ld.json.completed > 25 && ld.json.ratings > 10 && ld.json.scheduled === 3, JSON.stringify(ld.json));
  assert.equal(ld.json.status.drivers, 20, '12 drivers plus 8 applicants');
  const bal = await q1<any>('select coalesce(sum(debit),0)::bigint d, coalesce(sum(credit),0)::bigint c from ledger_entries');
  assert.equal(String(bal.d), String(bal.c), 'demo ledger entries are real double entries');

  // owner revenue
  const from = new Date(Date.now() - 12 * 864e5 + 2 * 3600e3).toISOString().slice(0, 10), rv = await t.api('GET', `/admin/revenue?group=day&from=${from}`, { token: fo.token });
  assert.equal(rv.status, 200, JSON.stringify(rv.json));
  assert.ok(rv.json.totals.commission >= ld.json.revenue_commission * 0.9 && rv.json.totals.completed >= ld.json.completed, 'the report counts paid trips; a few just-finished ones may still be unpaid');
  assert.ok(rv.json.totals.commission > 0 && rv.json.totals.commission < rv.json.totals.gross);
  assert.ok(rv.json.trend.length >= 4 && rv.json.top_drivers.length > 0 && rv.json.by_service.length > 0 && rv.json.drivers_online_now >= 0);
  assert.equal((await t.api('GET', '/admin/revenue?from=2026-05-02&to=2026-05-01', { token: fo.token })).status, 400);
  assert.equal((await t.api('GET', '/admin/revenue?from=2020-01-01&to=2026-05-01', { token: fo.token })).status, 400, 'more than a year');
  assert.equal((await t.api('GET', '/admin/revenue', { token: (await t.register()).token })).status, 403);
  const csv = await t.api('GET', '/admin/revenue/csv?group=week', { token: fo.token });
  assert.equal(csv.status, 200); assert.match(csv.raw, /week_start,paid_trips,gross_rwf,commission_rwf/); assert.match(String(csv.headers['content-disposition']), /abasare-revenue-/);
  const rw = await t.api('GET', '/admin/revenue/report?lang=rw', { token: fo.token }), fr = await t.api('GET', '/admin/revenue/report?lang=fr', { token: fo.token });
  assert.match(rw.raw, /Raporo y&#39;amafaranga/); assert.doesNotMatch(rw.raw, /Revenue report|Rapport de revenus/);
  assert.match(fr.raw, /Rapport de revenus/); assert.doesNotMatch(fr.raw, /Raporo|Revenue report/);

  // ratings review: the weak demo drivers are flagged, low ratings carry their comments
  const rt = await t.api('GET', '/admin/ratings', { token: sa.token });
  assert.equal(rt.status, 200, JSON.stringify(rt.json));
  assert.ok(rt.json.summary.count > 10 && rt.json.summary.spread.length === 5 && Array.isArray(rt.json.flagged) && Array.isArray(rt.json.recent));
  assert.equal((await t.api('GET', '/admin/ratings', { token: (await t.register()).token })).status, 403);

  // a demo driver signs in and reads the weekly statement
  const d = await t.register('driver', '+250788991001');
  const st = await t.api('GET', '/drivers/me/statement?week=0', { token: d.token });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  assert.match(st.json.from, /^\d{4}-\d{2}-\d{2}$/); assert.equal(st.json.totals.net + st.json.totals.commission + st.json.totals.fleet_share >= 0, true);
  assert.equal(st.json.days.reduce((a: number, x: any) => a + x.trips, 0), st.json.totals.trips);
  const st1 = await t.api('GET', '/drivers/me/statement?week=1', { token: d.token });
  assert.equal(st1.status, 200); assert.ok(st1.json.to < st.json.from || st1.json.from < st.json.from);
  assert.equal((await t.api('GET', '/drivers/me/statement', { token: (await t.register()).token })).status, 403);

  // the rider with the most trips shares a receipt link; it opens without login, in the chosen language, and a changed token does not
  const r = await q1<any>("select b.id, b.ref from bookings b join users u on u.id=b.passenger_id where u.phone='+250788990001' and b.status='PAYMENT_COMPLETED' limit 1");
  assert.ok(r, 'the first demo rider has a completed trip');
  const rider = await t.register('passenger', '+250788990001');
  const lk = await t.api('POST', `/bookings/${r.id}/receipt/link`, { token: rider.token, headers: { 'accept-language': 'fr' } });
  assert.equal(lk.status, 200, JSON.stringify(lk.json));
  const path = lk.json.url.replace(/^https?:\/\/[^/]+/, '');
  const page = await t.api('GET', path); assert.equal(page.status, 200); assert.match(page.raw, new RegExp(r.ref)); assert.match(page.raw, /Reçu de course/); assert.doesNotMatch(page.raw, /Trip receipt|Inyemezabwishyu/);
  assert.equal((await t.api('GET', path.replace(/token=[^&]+/, 'token=1.abc'))).status, 404);
  assert.equal((await t.api('POST', `/bookings/${r.id}/receipt/link`, { token: (await t.register()).token })).status, 403, 'only the rider who booked');

  // the people-and-operations side is filled too, and the busy-now trips exist
  const n = await q1<any>(`select (select count(*) from support_cases)::int sc, (select count(*) from promotions where code like 'DEMO-%')::int pr, (select count(*) from admin_alerts where kind='mass_view')::int al, (select count(*) from safety_incidents)::int si, (select count(*) from admin_alerts)::int al, (select count(*) from claims)::int cl,
    (select count(*) from driver_profiles where status='DOCUMENTS_SUBMITTED')::int pend, (select count(*) from bookings where status='IN_PROGRESS')::int live, (select count(*) from partners)::int pa, (select count(*) from payouts where status='REQUESTED')::int po`);
  assert.ok(n.sc >= 16 && n.si >= 4 && n.al >= 5 && n.cl >= 3 && n.pend >= 4 && n.live >= 1 && n.pa >= 2 && n.po >= 3, JSON.stringify(n));
  assert.equal((await t.api('GET', '/admin/support/cases', { token: sa.token })).status, 200);
  // clearing removes every demo row; loading twice does not duplicate
  const again = await t.api('POST', '/admin/demo/load', { token: sa.token, body: { drivers: 6, riders: 12, days: 2 } });
  assert.equal(again.status, 200); assert.equal(again.json.status.drivers, 14);
  const cl = await t.api('POST', '/admin/demo/clear', { token: sa.token });
  assert.equal(cl.status, 200, JSON.stringify(cl.json)); assert.equal(cl.json.status.loaded, false); assert.equal(cl.json.ledger_removed, true);
  const left = await q1<any>("select (select count(*) from users where device_fingerprint='demo')::int u, (select count(*) from ledger_entries where memo like 'demo:%')::int l, (select count(*) from bookings where ref like 'DM-%')::int b, (select count(*) from support_cases)::int sc, (select count(*) from promotions where code like 'DEMO-%')::int pr, (select count(*) from admin_alerts where kind='mass_view')::int al, (select count(*) from partners where created_by is not null and name like 'Hotel Serena%')::int pa");
  assert.deepEqual([left.u, left.l, left.b, left.pa, left.pr, left.al], [0, 0, 0, 0, 0, 0]);
  const bal2 = await q1<any>('select coalesce(sum(debit),0)::bigint d, coalesce(sum(credit),0)::bigint c from ledger_entries');
  assert.equal(String(bal2.d), String(bal2.c));
  assert.equal(await q('select 1 from audit_logs where action=$1', ['demo_load']).then((x) => x.length > 0), true);
});
