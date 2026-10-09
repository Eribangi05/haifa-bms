import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byMonth, dayPart, driverToday, filterTrips, tripStats, type TripLike } from '../src/lib/stats.ts';

const b = (status: string, over: Partial<TripLike> = {}): TripLike => ({ status, requested_at: '2026-10-05T08:00:00Z', final_fare: 2000, distance_m: 4200, duration_s: 600, payment_method: 'cash', ...over });

test('tripStats counts only finished trips and splits the payment mix', () => {
  const s = tripStats([b('PAYMENT_COMPLETED'), b('COMPLETED', { payment_method: 'mtn_momo', final_fare: 3000 }), b('PAYMENT_COMPLETED', { payment_method: 'wallet_partial', final_fare: 1000 }), b('CANCELLED_BY_PASSENGER'), b('IN_PROGRESS'), b('SEARCHING_DRIVER')]);
  assert.equal(s.trips, 3); assert.equal(s.cancelled, 1); assert.equal(s.spent, 6000); assert.equal(s.avgFare, 2000);
  assert.deepEqual([s.cash, s.momo, s.credit], [2000, 3000, 1000]); assert.equal(s.km, 12.6); assert.equal(s.minutes, 30);
});
test('tripStats of nothing is all zeros (no NaN)', () => { const s = tripStats([]); assert.equal(s.trips, 0); assert.equal(s.avgFare, 0); assert.equal(s.km, 0); });
test('a missing final fare counts as zero, never NaN', () => { assert.equal(tripStats([b('COMPLETED', { final_fare: null })]).spent, 0); });
test('byMonth groups by Kigali month, newest first, and respects the limit', () => {
  const rows = byMonth([b('COMPLETED', { requested_at: '2026-10-31T23:30:00Z' }), b('COMPLETED', { requested_at: '2026-09-10T08:00:00Z' }), b('COMPLETED', { requested_at: '2026-08-10T08:00:00Z' }), b('CANCELLED_BY_PASSENGER')], 2);
  assert.deepEqual(rows.map((r) => r.key), ['2026-11', '2026-09']);   // 23:30Z on the 31st is already 01:30 on 1 November in Kigali
  assert.equal(rows[0].spent, 2000);
});
test('filterTrips', () => {
  const l = [b('PAYMENT_COMPLETED'), b('CANCELLED_BY_DRIVER'), b('NO_DRIVER_FOUND'), b('SCHEDULED'), b('IN_PROGRESS')];
  assert.equal(filterTrips(l, 'all').length, 5); assert.equal(filterTrips(l, 'done').length, 1); assert.equal(filterTrips(l, 'cancelled').length, 2); assert.equal(filterTrips(l, 'upcoming').length, 2);
});
test('dayPart uses Kigali time', () => {
  assert.equal(dayPart(new Date('2026-10-05T04:00:00Z')), 'morning');     // 06:00 Kigali
  assert.equal(dayPart(new Date('2026-10-05T10:30:00Z')), 'afternoon');   // 12:30 Kigali
  assert.equal(dayPart(new Date('2026-10-05T17:00:00Z')), 'evening');     // 19:00 Kigali
  assert.equal(dayPart(new Date('2026-10-05T22:30:00Z')), 'morning');     // 00:30 next day Kigali
});
test('driverToday counts only finished trips of the Kigali day', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const d = driverToday([b('PAYMENT_COMPLETED', { completed_at: '2026-10-05T09:00:00Z', estimated_driver_net: 1500 }), b('PAYMENT_COMPLETED', { completed_at: '2026-10-04T09:00:00Z' }), b('CANCELLED_BY_DRIVER', { completed_at: '2026-10-05T09:00:00Z' })], now);
  assert.deepEqual(d, { trips: 1, fares: 2000, net: 1500 });
});
