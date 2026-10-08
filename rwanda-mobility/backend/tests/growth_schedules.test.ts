import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx, KCC, KIMIRONKO } from './helpers.ts';

let t: Ctx; let run: (now?: Date) => Promise<any>;
before(async () => { t = await boot(); run = (await import('../src/services/rideSchedules.ts')).runSchedules; });
after(async () => { await t.close(); });

const kigali = (ms: number) => new Date(ms + 2 * 3600e3).toISOString();
const HOUR = 3600e3;
const body = (extra: any = {}) => {
  const at = Date.now() + 3 * HOUR;
  return { label: 'Commute', service_id: 'moto', pickup: { ...KCC, name: 'KCC' }, dest: { ...KIMIRONKO, name: 'Kimironko' }, days_of_week: [0, 1, 2, 3, 4, 5, 6], local_time: kigali(at).slice(11, 16), start_date: kigali(at).slice(0, 10), ...extra };
};
const count = async (sql: string, p: any[] = []) => (await t.db.q<any>(sql, p))[0].n;

test('recurring ride: CRUD, job books the real SCHEDULED booking once, idempotent after a lost claim, time travel', async () => {
  await t.reset(); await t.db.q('delete from ride_schedules'); await t.driver({ at: KCC });
  const u = await t.register('passenger');
  const c = await t.api('POST', '/ride-schedules', { token: u.token, body: body() });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.ok(c.json.expected_total > 0); assert.ok(c.json.next_occurrence);
  const id = c.json.id;
  assert.equal((await t.api('GET', '/ride-schedules', { token: u.token })).json.schedules.length, 1);
  // job
  const r1 = await run();
  assert.equal(r1.booked, 1);
  const bk = (await t.db.q<any>("select * from bookings where passenger_id=$1", [u.id]))[0];
  assert.equal(bk.status, 'SCHEDULED'); assert.ok(bk.scheduled_for);
  assert.equal(new Date(bk.scheduled_for).toISOString().slice(11, 16), (() => { const h = Number(body().local_time.slice(0, 2)); return String((h + 22) % 24).padStart(2, '0') + ':' + body().local_time.slice(3); })());
  assert.equal((await run()).booked, 0);                               // second tick: nothing new
  assert.equal(await count('select count(*)::int n from bookings where passenger_id=$1', [u.id]), 1);
  await t.db.q('delete from ride_schedule_runs');                      // crash simulation: the claim row is lost
  await run();
  assert.equal(await count('select count(*)::int n from bookings where passenger_id=$1', [u.id]), 1);
  assert.equal(await count("select count(*)::int n from ride_schedule_runs where status='booked'"), 1);
  // concurrent ticks never duplicate
  await Promise.all([run(new Date(Date.now() + 24 * HOUR)), run(new Date(Date.now() + 24 * HOUR)), run(new Date(Date.now() + 24 * HOUR))]);
  assert.equal(await count('select count(*)::int n from bookings where passenger_id=$1', [u.id]), 2);
  // time travel: +72 h books the days in the new window
  await run(new Date(Date.now() + 72 * HOUR));
  assert.equal(await count('select count(*)::int n from bookings where passenger_id=$1', [u.id]), 3);
  // another user cannot see or change it
  const o = await t.register('passenger');
  assert.equal((await t.api('GET', `/ride-schedules/${id}`, { token: o.token })).status, 404);
  assert.equal((await t.api('POST', `/ride-schedules/${id}/pause`, { token: o.token })).status, 404);
  assert.equal((await t.api('GET', '/ride-schedules', { token: o.token })).json.schedules.length, 0);
});

test('pause / resume / skip-next / end date / dates validation', async () => {
  await t.reset(); await t.db.q('delete from ride_schedules'); await t.driver({ at: KCC });
  const u = await t.register('passenger');
  const id = (await t.api('POST', '/ride-schedules', { token: u.token, body: body() })).json.id;
  assert.equal((await t.api('POST', `/ride-schedules/${id}/pause`, { token: u.token })).json.status, 'paused');
  await run(); assert.equal(await count('select count(*)::int n from bookings where passenger_id=$1', [u.id]), 0);
  assert.equal((await t.api('POST', `/ride-schedules/${id}/resume`, { token: u.token })).json.status, 'active');
  await run(); assert.equal(await count('select count(*)::int n from bookings where passenger_id=$1', [u.id]), 1);
  const sk = await t.api('POST', `/ride-schedules/${id}/skip-next`, { token: u.token });
  assert.equal(sk.status, 200); assert.equal(sk.json.booking_cancelled, true);
  assert.equal(await count("select count(*)::int n from bookings where passenger_id=$1 and status='CANCELLED_BY_PASSENGER'", [u.id]), 1);
  assert.equal((await t.db.q<any>('select cancel_fee from bookings where passenger_id=$1', [u.id]))[0].cancel_fee, 0);
  await run(); assert.equal(await count("select count(*)::int n from bookings where passenger_id=$1 and status='SCHEDULED'", [u.id]), 0, 'skipped date is not rebooked');
  // end date in the past ends the plan
  await t.db.q("update ride_schedules set end_date = current_date - 2 where id=$1", [id]);
  await run(); assert.equal((await t.api('GET', `/ride-schedules/${id}`, { token: u.token })).json.status, 'ended');
  assert.equal((await t.api('POST', `/ride-schedules/${id}/resume`, { token: u.token })).json.error.code, 'schedule_ended');
  // validation
  const bad = await t.api('POST', '/ride-schedules', { token: u.token, body: body({ end_date: '2020-01-01' }) });
  assert.equal(bad.json.error.code, 'schedule_dates');
  assert.equal((await t.api('POST', '/ride-schedules', { token: u.token, body: body({ local_time: '25:00' }) })).status, 400);
  assert.equal((await t.api('POST', '/ride-schedules', { token: u.token, body: body({ days_of_week: [] }) })).status, 400);
  assert.equal((await t.api('POST', '/ride-schedules', { token: u.token, body: body({ end_date: new Date(Date.now() - 86400e3).toISOString().slice(0, 10), start_date: new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10) }) })).json.error.code, 'schedule_no_occurrence');
});

test('price change beyond tolerance or no coverage: rider is notified, nothing is booked blindly', async () => {
  await t.reset(); await t.db.q('delete from ride_schedules'); const drv = await t.driver({ at: KCC });
  const u = await t.register('passenger');
  await t.db.q("update users set preferred_language='fr' where id=$1", [u.id]);
  const id = (await t.api('POST', '/ride-schedules', { token: u.token, body: body() })).json.id;
  await t.db.q('update ride_schedules set expected_total = expected_total * 2 where id=$1', [id]);          // the re-quote is now ~50 % cheaper
  const r = await run();
  assert.equal(r.price_changed, 1); assert.equal(await count('select count(*)::int n from bookings where passenger_id=$1', [u.id]), 0);
  const n = (await t.db.q<any>("select body, lang from notifications where user_id=$1 and template_key='schedule_price_changed' and channel='in_app'", [u.id]))[0];
  assert.equal(n.lang, 'fr'); assert.match(n.body, /n'a PAS été réservée/); assert.ok(!/NOT booked/.test(n.body));
  await run(); assert.equal(await count("select count(*)::int n from notifications where user_id=$1 and template_key='schedule_price_changed' and channel='in_app'", [u.id]), 1, 'notified once');
  const acc = await t.api('POST', `/ride-schedules/${id}/accept-price`, { token: u.token });
  assert.equal(acc.status, 200);
  assert.equal((await run()).booked, 1);
  // within tolerance: small drift books normally; no coverage notifies once and retries
  await t.db.q('delete from bookings where passenger_id=$1', [u.id]); await t.db.q('delete from ride_schedule_runs');
  await t.db.q("update ride_schedules set expected_total = (expected_total * 1.05)::int where id=$1", [id]);
  assert.equal((await run()).booked, 1);
  await t.db.q('delete from bookings where passenger_id=$1', [u.id]); await t.db.q('delete from ride_schedule_runs');
  await t.db.q("update driver_profiles set status='SUSPENDED' where status='APPROVED'");
  assert.equal((await run()).no_coverage, 1); await run();
  assert.equal(await count("select count(*)::int n from notifications where user_id=$1 and template_key='schedule_no_coverage' and channel='in_app'", [u.id]), 1);
  await t.db.q("update driver_profiles set status='APPROVED' where status='SUSPENDED'");
  assert.equal((await run()).booked, 1);
});
