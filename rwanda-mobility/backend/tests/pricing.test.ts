import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFare, finalizeFare, type Rule } from '../src/services/pricing.ts';
import { calcCommission } from '../src/services/commission.ts';
import { roundTo, bps } from '../src/util/money.ts';
import { canTransition, TRANSITIONS } from '../src/services/bookingMachine.ts';
import { haversineM, pointInPolygon } from '../src/util/geo.ts';
import { normalizePhone } from '../src/util/phone.ts';
import { totpAt, verifyTotp, newTotpSecret } from '../src/util/crypto.ts';
import { rankScore } from '../src/services/dispatch.ts';

const rule: Rule = {
  id: 'r', service_id: 'moto', zone_id: 'kigali', model: 'platform', base_fare: 400, per_km: 250, per_min: 20, minimum_fare: 800, booking_fee: 0,
  wait_per_min: 20, free_wait_min: 3, airport_fee: 0, scheduled_fee: 0, long_distance_km: null, long_distance_per_km: null, tax_bps: 0, rounding: 50,
  surge_enabled: false, surge_cap_bps: 15000, version: 1,
};

test('fare = base + distance + time, rounded to 50 RWF, integer only', () => {
  const f = computeFare(rule, { distance_m: 4200, duration_s: 600 });   // 400 + 1050 + 200 = 1650
  assert.equal(f.total, 1650);
  assert.ok(Number.isInteger(f.total));
  assert.equal(f.lines.find((l) => l.code === 'base')!.amount, 400);
});

test('rounding to nearest 50 and minimum fare apply', () => {
  assert.equal(computeFare(rule, { distance_m: 4310, duration_s: 600 }).total, 1700);      // 400+1077.5->1078+200 = 1678 -> 1700
  const small = computeFare(rule, { distance_m: 300, duration_s: 60 });                    // 400+75+20 = 495 -> minimum 800
  assert.equal(small.total, 800);
  assert.ok(small.lines.some((l) => l.code === 'minimum'));
  assert.equal(roundTo(1675, 50), 1700); assert.equal(roundTo(1674, 50), 1650); assert.equal(roundTo(1234, 1), 1234);
});

test('promo discount, tax, and passthrough are tracked separately; commissionable excludes pass-through', () => {
  const f = computeFare({ ...rule, tax_bps: 1800 }, { distance_m: 4200, duration_s: 600, promo: { code: 'X', discount: 300 }, extras: [{ code: 'toll', label: 'Toll', amount: 500, passthrough: true }] });
  assert.equal(f.subtotal, 1650 + 500);
  assert.equal(f.discount, 300);
  assert.equal(f.tax, bps(2150 - 300, 1800));
  assert.equal(f.total, 2150 - 300 + f.tax);
  assert.equal(f.passthrough, 500);
  assert.equal(f.commissionable, 1650);
});

test('discount can never exceed the fare and negative extras are rejected', () => {
  assert.equal(computeFare(rule, { distance_m: 4200, duration_s: 600, promo: { code: 'X', discount: 99999 } }).total, 0 + 0);
  assert.throws(() => computeFare(rule, { distance_m: 1000, duration_s: 100, extras: [{ code: 'x', label: 'x', amount: -5 }] }));
});

test('surge is ignored unless the rule enables it, and is capped', () => {
  assert.equal(computeFare(rule, { distance_m: 4200, duration_s: 600, surge_bps: 20000 }).total, 1650);
  const s = computeFare({ ...rule, surge_enabled: true, surge_cap_bps: 12000 }, { distance_m: 4200, duration_s: 600, surge_bps: 30000 });
  assert.equal(s.total, 2000);   // 1650 * 1.2 = 1980 -> 2000
});

test('final fare equals the quote unless waiting beyond the free period or authorised extras apply', () => {
  const q = computeFare(rule, { distance_m: 4200, duration_s: 600 });
  assert.equal(finalizeFare(rule, q, { waiting_min: 3, extras: [] }), q);                       // identical object: no second calculation
  const w = finalizeFare(rule, q, { waiting_min: 8, extras: [] });                              // 5 billable min * 20
  assert.equal(w.total, q.total + 100);
  assert.ok(w.lines.some((l) => l.code === 'waiting'));
});

test('commission: percent, fixed, exemption, never exceeds base', () => {
  assert.equal(calcCommission({ id: 'a', kind: 'percent', percent_bps: 1500, fixed_amount: null, exempt_until: null }, 2000), 300);
  assert.equal(calcCommission({ id: 'a', kind: 'percent', percent_bps: 1200, fixed_amount: null, exempt_until: null }, 1650), 198);
  assert.equal(calcCommission({ id: 'a', kind: 'fixed', percent_bps: null, fixed_amount: 5000, exempt_until: null }, 2000), 2000);
  assert.equal(calcCommission({ id: 'a', kind: 'percent', percent_bps: 1500, fixed_amount: null, exempt_until: new Date(Date.now() + 86400000) }, 2000), 0);
  assert.equal(calcCommission({ id: 'a', kind: 'percent', percent_bps: 1500, fixed_amount: null, exempt_until: new Date(Date.now() - 1000) }, 2000), 300);
});

test('state machine: only declared transitions are legal; terminal states are final', () => {
  assert.ok(canTransition('REQUESTED', 'SEARCHING_DRIVER'));
  assert.ok(canTransition('SEARCHING_DRIVER', 'DRIVER_ASSIGNED'));
  assert.ok(!canTransition('SEARCHING_DRIVER', 'IN_PROGRESS'));      // cannot skip assignment / PIN
  assert.ok(!canTransition('DRIVER_ASSIGNED', 'IN_PROGRESS'));        // cannot skip arrival
  assert.ok(!canTransition('IN_PROGRESS', 'CANCELLED_BY_PASSENGER'));
  assert.ok(!canTransition('COMPLETED', 'IN_PROGRESS'));
  for (const t of ['CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_SYSTEM', 'REFUNDED', 'PAYMENT_REVERSED'] as const) assert.deepEqual(TRANSITIONS[t], []);
});

test('geo: haversine and point-in-polygon', () => {
  const d = haversineM({ lat: -1.954, lng: 30.0927 }, { lat: -1.9496, lng: 30.1262 });
  assert.ok(d > 3500 && d < 3900, `distance ${d}`);
  const ring: [number, number][] = [[29.97, -2.06], [30.22, -2.06], [30.22, -1.84], [29.97, -1.84], [29.97, -2.06]];
  assert.ok(pointInPolygon({ lat: -1.95, lng: 30.1 }, ring));
  assert.ok(!pointInPolygon({ lat: -1.5, lng: 30.1 }, ring));        // outside coverage (e.g. Musanze direction)
});

test('Rwandan phone normalisation', () => {
  assert.equal(normalizePhone('0788123456'), '+250788123456');
  assert.equal(normalizePhone('+250 788 123 456'), '+250788123456');
  assert.equal(normalizePhone('250722123456'), '+250722123456');
  assert.equal(normalizePhone('0712345678'), null);                   // not a Rwandan mobile prefix
  assert.equal(normalizePhone('+254722123456'), null);                // Kenya
  assert.equal(normalizePhone('12345'), null);
});

test('TOTP matches RFC 6238 vector and tolerates one step of drift only', () => {
  // RFC 6238 SHA1 test secret "12345678901234567890" in base32
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpAt(secret, 59_000), '287082');
  assert.equal(totpAt(secret, 1111111109_000), '081804');
  const s = newTotpSecret(); const now = Date.now();
  assert.ok(verifyTotp(s, totpAt(s, now), now));
  assert.ok(verifyTotp(s, totpAt(s, now - 30_000), now));
  assert.ok(!verifyTotp(s, totpAt(s, now - 120_000), now));
});

test('dispatch ranking: ETA first, idle drivers get a small boost, frequent unexcused rejecters a penalty', () => {
  const now = Date.now();
  const fresh = { rejected_count: 0, offers_count: 10, last_trip_at: new Date(now - 40 * 60000) };
  const busy = { rejected_count: 0, offers_count: 10, last_trip_at: new Date(now - 30_000) };
  const flaky = { rejected_count: 8, offers_count: 10, last_trip_at: new Date(now - 40 * 60000) };
  assert.ok(rankScore(300, fresh, now) < rankScore(300, busy, now));
  assert.ok(rankScore(300, fresh, now) < rankScore(300, flaky, now));
  assert.ok(rankScore(100, busy, now) < rankScore(600, fresh, now));   // a much closer driver still wins
});

// ---------------- Abasare (driver for the customer's own car) ----------------
const abasareRule: Rule = { ...rule, id: 'a', service_id: 'abasare', base_fare: 2000, per_km: 300, per_min: 0, minimum_fare: 4000, wait_per_min: 50, free_wait_min: 10, rounding: 100,
  return_per_km: 100, night_start_hour: 22, night_end_hour: 5, night_fee: 1000, billing: 'distance' };
const hourlyRule: Rule = { ...rule, id: 'h', service_id: 'abasare_hourly', base_fare: 0, per_km: 0, per_min: 0, minimum_fare: 0, rounding: 100, billing: 'hourly', hourly_rate: 4000, min_hours: 2, max_hours: 12,
  long_hire_hours: 8, long_hire_rate: 3500, overtime_per_30min: 2500, overtime_grace_min: 10, night_start_hour: 22, night_end_hour: 5, night_fee: 1000 };

import { inNightBand, overtimeBlocks, kigaliHour } from '../src/services/pricing.ts';

test('Abasare point-to-point: base + distance + driver-return allowance, night band disclosed as its own line', () => {
  const day = computeFare(abasareRule, { distance_m: 10_000, duration_s: 1200, local_hour: 14 });
  assert.equal(day.total, 2000 + 3000 + 1000);                               // 6,000
  assert.ok(day.lines.some((l) => l.code === 'return_allowance' && l.amount === 1000));
  assert.ok(!day.lines.some((l) => l.code === 'night_fee'));
  const night = computeFare(abasareRule, { distance_m: 10_000, duration_s: 1200, local_hour: 23 });
  assert.equal(night.total, 7000);                                           // inside the 5,000-7,000 RWF band reported for night trips
  assert.ok(night.lines.some((l) => l.code === 'night_fee' && l.amount === 1000));
  assert.equal(computeFare(abasareRule, { distance_m: 10_000, duration_s: 1200, local_hour: 3 }).total, 7000);   // band wraps midnight
});

test('Abasare minimum fare applies before fees', () => {
  const short = computeFare(abasareRule, { distance_m: 1000, duration_s: 200, local_hour: 12 });   // 2,000 + 300 = 2,300 -> min 4,000, + 100 return
  assert.equal(short.total, 4100);
  assert.ok(short.lines.some((l) => l.code === 'minimum'));
});

test('night band maths: wraps midnight, end exclusive, Kigali is UTC+2', () => {
  assert.ok(inNightBand(22, 22, 5) && inNightBand(23, 22, 5) && inNightBand(0, 22, 5) && inNightBand(4, 22, 5));
  assert.ok(!inNightBand(5, 22, 5) && !inNightBand(21, 22, 5) && !inNightBand(12, 22, 5));
  assert.ok(!inNightBand(3, null, null));
  assert.equal(kigaliHour(new Date('2026-03-01T20:30:00Z')), 22); assert.equal(kigaliHour(new Date('2026-03-01T23:30:00Z')), 1);
});

test('Abasare hourly: packages, long-hire rate, night fee, hour limits', () => {
  assert.equal(computeFare(hourlyRule, { distance_m: 0, duration_s: 0, hours: 2, local_hour: 10 }).total, 8000);
  assert.equal(computeFare(hourlyRule, { distance_m: 0, duration_s: 0, hours: 4, local_hour: 10 }).total, 16000);
  assert.equal(computeFare(hourlyRule, { distance_m: 0, duration_s: 0, hours: 8, local_hour: 10 }).total, 28000);   // long-hire 3,500/h
  assert.equal(computeFare(hourlyRule, { distance_m: 0, duration_s: 0, hours: 2, local_hour: 22 }).total, 9000);    // + night
  assert.throws(() => computeFare(hourlyRule, { distance_m: 0, duration_s: 0, hours: 1 }), /hours/i);
  assert.throws(() => computeFare(hourlyRule, { distance_m: 0, duration_s: 0, hours: 13 }));
  assert.throws(() => computeFare(hourlyRule, { distance_m: 0, duration_s: 0 }));
});

test('Abasare hourly overtime: 30-minute blocks after a grace period, added as a disclosed line', () => {
  assert.equal(overtimeBlocks(hourlyRule, 2, 120), 0);
  assert.equal(overtimeBlocks(hourlyRule, 2, 130), 0);                       // inside the 10-minute grace
  assert.equal(overtimeBlocks(hourlyRule, 2, 131), 1);
  assert.equal(overtimeBlocks(hourlyRule, 2, 160), 1);
  assert.equal(overtimeBlocks(hourlyRule, 2, 161), 2);
  const q = computeFare(hourlyRule, { distance_m: 0, duration_s: 0, hours: 2, local_hour: 10 });
  const f = finalizeFare(hourlyRule, q, { waiting_min: 0, extras: [], overtime_blocks: 2 });
  assert.equal(f.total, 8000 + 5000);
  assert.ok(f.lines.some((l) => l.code === 'overtime' && l.amount === 5000));
  assert.equal(finalizeFare(hourlyRule, q, { waiting_min: 0, extras: [], overtime_blocks: 0 }), q);
});
