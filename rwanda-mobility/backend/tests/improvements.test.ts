import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, KCC, type Ctx } from './helpers.ts';
import type { Rule } from '../src/services/pricing.ts';

let t: Ctx, q: typeof import('../src/db.ts').q, q1: typeof import('../src/db.ts').q1, computeFare: typeof import('../src/services/pricing.ts').computeFare;
before(async () => { t = await boot('rwanda_mobility_test'); ({ q, q1 } = await import('../src/db.ts')); ({ computeFare } = await import('../src/services/pricing.ts')); });
after(async () => { await t.close(); });

const rule = (o: Partial<Rule> = {}): Rule => ({ id: 'x', service_id: 'standard', zone_id: null, model: 'platform', base_fare: 0, per_km: 1000, per_min: 0, minimum_fare: 2000, booking_fee: 0, wait_per_min: 0, free_wait_min: 3, airport_fee: 0, scheduled_fee: 0,
  long_distance_km: null, long_distance_per_km: null, tax_bps: 0, rounding: 50, surge_enabled: false, surge_cap_bps: 15000, version: 1, ...o } as Rule);

test('price per kilometre: the fare is the rate times the distance, shown with the rate, and never below the minimum', () => {
  const a = computeFare(rule(), { distance_m: 4200, duration_s: 900 });
  assert.equal(a.total, 4200, 'no base fare and no per-minute charge');
  assert.match(a.lines.find((l) => l.code === 'distance')!.label_en, /4\.2 km x 1000 RWF/);
  assert.match(a.lines.find((l) => l.code === 'distance')!.label_rw, /4\.2 km x 1000 RWF/);
  assert.equal(computeFare(rule(), { distance_m: 800, duration_s: 200 }).total, 2000, 'minimum fare');
  assert.equal(computeFare(rule(), { distance_m: 4200, duration_s: 99999 }).total, 4200, 'a slow trip does not cost more');
});

test('long pickup charge: off by default, charged only beyond the free distance, capped, and shown as its own line', () => {
  const base = { distance_m: 5000, duration_s: 600 };
  assert.equal(computeFare(rule(), { ...base, pickup_m: 9000 }).total, 5000, 'off when the rate is 0');
  const r = rule({ pickup_free_km: 2, pickup_per_km: 300, pickup_max: 1000 });
  assert.equal(computeFare(r, { ...base, pickup_m: 1500 }).total, 5000, 'inside the free distance');
  const b = computeFare(r, { ...base, pickup_m: 3000 });
  assert.equal(b.total, 5300); assert.equal(b.lines.find((l) => l.code === 'pickup')!.amount, 300);
  assert.equal(computeFare(r, { ...base, pickup_m: 20000 }).total, 6000, 'capped at the maximum');
  assert.equal(computeFare(r, base).total, 5000, 'unknown pickup distance adds nothing');
});

test('seeded prices are per kilometre only, and the estimate says so', async () => {
  const p = await t.register('passenger'); await t.reset(); await t.driver({ vehicle: 'car' });
  const e = await t.estimate(p.token, { service_id: 'standard' });
  const o = e.json.options.find((x: any) => x.service_id === 'standard');
  assert.ok(o.per_km > 0 && o.per_km_only === true, JSON.stringify(o));
  assert.ok(!o.fare.lines.some((l: any) => l.code === 'time' || l.code === 'base' && l.amount > 0));
});

test('a driver can rate a passenger with passenger tags; the average reaches the next offer; riders cannot use passenger tags', async () => {
  await t.reset();
  const p = await t.register('passenger'), d = await t.driver();
  const { res } = await t.book(p.token, 'moto'); assert.equal(res.status, 201, JSON.stringify(res.json));
  const id = res.json.booking.id as string;
  const offers = await t.api('GET', '/drivers/me/offers', { token: d.token });
  assert.ok(offers.json.offers.some((o: any) => o.booking_id === id && 'passenger_rating' in o), JSON.stringify(offers.json));
  await t.runTrip(p, d, id);
  await q("update bookings set status='PAYMENT_COMPLETED' where id=$1", [id]);
  assert.equal((await t.api('POST', `/bookings/${id}/ratings`, { token: d.token, body: { score: 4, tags: ['clear_directions', 'helmet_worn'] } })).status, 200);
  const u = await q1<any>('select passenger_rating_avg, passenger_rating_count from users where id=$1', [p.id]);
  assert.equal(Number(u.passenger_rating_avg), 4); assert.equal(u.passenger_rating_count, 1);
  assert.equal((await t.api('POST', `/bookings/${id}/ratings`, { token: d.token, body: { score: 5 } })).status, 409, 'once per trip');
  // passengers still use the driver tags; passenger tags are refused for them
  const pr = await t.api('POST', `/bookings/${id}/ratings`, { token: p.token, body: { score: 5, tags: ['helmet_worn'] } });
  assert.equal(pr.status, 400);
  assert.equal((await t.api('POST', `/bookings/${id}/ratings`, { token: p.token, body: { score: 5, tags: ['polite'] } })).status, 200);
  const cfg = await t.api('GET', '/config', { token: p.token });
  assert.ok(cfg.json.rating_tags.passenger.length >= 6);
  // the driver's own average is untouched by the passenger rating
  const dp = await q1<any>('select rating_count from driver_profiles where user_id=$1', [d.id]); assert.equal(dp.rating_count, 1);
  void KCC;
});

test('proposed fares: off by default; rider proposes, driver accepts at the proposal or counters once, rider answers; the agreed price flows into the fare, earnings and receipt', async () => {
  await t.reset();
  const p = await t.register('passenger');
  const d = await t.driver({ vehicle: 'car' });
  // off by default
  const e0 = await t.estimate(p.token, { service_id: 'standard' }); const o0 = e0.json.options.find((x: any) => x.service_id === 'standard');
  const full = o0.fare.total as number;
  const post = (token: string, quote_id: string, extra: any) => t.api('POST', '/bookings', { token, headers: { 'idempotency-key': 'k-' + Math.random().toString(36).slice(2, 12) }, body: { quote_id, payment_method: 'cash', ...extra } });
  assert.equal((await post(p.token, o0.quote_id, { proposed_fare: full - 500 })).status, 400, 'flag off');
  await q("update feature_flags set enabled=true where key='pricing.negotiated'");
  const cfg = await t.api('GET', '/config'); assert.equal(cfg.json.negotiation.enabled, true);

  const quote = async () => (await t.estimate(p.token, { service_id: 'standard' })).json.options.find((x: any) => x.service_id === 'standard');
  const tooLow = await quote(); assert.equal((await post(p.token, tooLow.quote_id, { proposed_fare: 100 })).status, 400, 'below the allowed discount');
  const tooHigh = await quote(); assert.equal((await post(p.token, tooHigh.quote_id, { proposed_fare: tooHigh.fare.total + 50 })).status, 400, 'above the platform price');

  // (a) driver accepts the proposal
  const o1 = await quote(); const prop = Math.ceil((o1.fare.total * 0.9) / 50) * 50;
  const r1 = await post(p.token, o1.quote_id, { proposed_fare: prop }); assert.equal(r1.status, 201, JSON.stringify(r1.json));
  const b1 = r1.json.booking.id as string;
  assert.equal(r1.json.booking.negotiation.proposed_fare, prop);
  const off = (await t.api('GET', '/drivers/me/offers', { token: d.token })).json.offers.find((o: any) => o.booking_id === b1);
  assert.equal(off.proposed_fare, prop); assert.ok(off.driver_net < o1.fare.total && off.driver_net > 0);
  const trip = await t.runTrip(p, d, b1);
  const pv = (await t.api('GET', `/bookings/${b1}`, { token: p.token })).json;
  assert.equal(pv.negotiation.agreed_fare, prop); assert.equal(pv.final_fare, prop, 'final = agreed, not the platform price');
  assert.ok(pv.fare_breakdown.lines.some((l: any) => l.code === 'negotiated' && l.amount === prop - o1.fare.total));
  assert.equal(trip.final_fare ?? prop, prop);
  const ev = await q("select type from booking_events where booking_id=$1 and type in ('fare_proposed','fare_agreed')", [b1]); assert.equal(ev.length, 2);

  // (b) driver counters, rider declines, then a second driver accepts; and a rider-accepted counter
  await t.reset();
  const d2 = await t.driver({ vehicle: 'car' });
  const o2 = await quote(); const prop2 = Math.ceil((o2.fare.total * 0.85) / 50) * 50;
  const r2 = await post(p.token, o2.quote_id, { proposed_fare: prop2 }); const b2 = r2.json.booking.id as string;
  const mid = Math.ceil((prop2 + o2.fare.total) / 2 / 50) * 50;
  assert.equal((await t.api('POST', `/bookings/${b2}/counter`, { token: p.token, body: { amount: mid } })).status, 403, 'riders cannot counter');
  assert.equal((await t.api('POST', `/bookings/${b2}/counter`, { token: d2.token, body: { amount: prop2 } })).status, 400, 'a counter must be above the proposal');
  assert.equal((await t.api('POST', `/bookings/${b2}/counter`, { token: d2.token, body: { amount: o2.fare.total + 50 } })).status, 400, 'and not above the platform price');
  const c1 = await t.api('POST', `/bookings/${b2}/counter`, { token: d2.token, body: { amount: mid } }); assert.equal(c1.status, 200, JSON.stringify(c1.json));
  assert.equal((await t.api('POST', `/bookings/${b2}/counter`, { token: d2.token, body: { amount: mid + 50 } })).status, 409, 'one counter per offer');
  const seen = (await t.api('GET', `/bookings/${b2}`, { token: p.token })).json.negotiation;
  assert.equal(seen.counters.length, 1); assert.equal(seen.counters[0].amount, mid);
  assert.equal((await t.api('POST', `/bookings/${b2}/counters/${c1.json.counter_id}/accept`, { token: (await t.register('passenger')).token })).status, 404, 'another rider cannot answer');
  const acc = await t.api('POST', `/bookings/${b2}/counters/${c1.json.counter_id}/accept`, { token: p.token }); assert.equal(acc.status, 200, JSON.stringify(acc.json));
  const v2 = (await t.api('GET', `/bookings/${b2}`, { token: p.token })).json;
  assert.equal(v2.status, 'DRIVER_ASSIGNED'); assert.equal(v2.negotiation.agreed_fare, mid); assert.equal(v2.negotiation.agreed_by, 'passenger_accepted_counter'); assert.equal(v2.estimated_fare, mid);
  assert.equal((await t.api('POST', `/bookings/${b2}/counters/${c1.json.counter_id}/accept`, { token: p.token })).status, 409, 'answered once');
  await q("update feature_flags set enabled=false where key='pricing.negotiated'");
});
