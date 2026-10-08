import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distM, etaMinutes, routeProgress, isIsoDate, fmtDate, fmtTime, groupByDay, fmtRwf, fmtMin } from '../src/lib/format.ts';

test('distM / etaMinutes / routeProgress', () => {
  const a = { lat: -1.9536, lng: 30.0927 }, b = { lat: -1.9496, lng: 30.1262 };
  const d = distM(a, b); assert.ok(d > 3500 && d < 4000, String(d)); assert.equal(distM(a, a), 0);
  assert.equal(etaMinutes(0), 1); assert.ok(etaMinutes(5000) >= 14 && etaMinutes(5000) <= 18);
  assert.equal(routeProgress(a, b, null), 0); assert.equal(routeProgress(a, b, a), 0); assert.equal(routeProgress(a, b, b), 1);
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }; assert.ok(Math.abs(routeProgress(a, b, mid) - 0.5) < 0.05);
  assert.equal(routeProgress(a, a, a), 0, 'degenerate route');
  assert.equal(fmtMin(10), 1); assert.equal(fmtMin(300), 5); assert.equal(fmtRwf(1234567.4), '1,234,567'); assert.equal(fmtRwf(null), '-');
});

test('isIsoDate rejects impossible, malformed and (optionally) future/past dates', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  for (const ok of ['2026-10-07', '2024-02-29', '2000-01-01']) assert.ok(isIsoDate(ok), ok);
  for (const bad of ['2026-02-30', '2025-13-01', '2025-00-10', '2023-02-29', '20261007', '2026-1-7', '', 'abcd-ef-gh']) assert.ok(!isIsoDate(bad), bad);
  assert.ok(!isIsoDate('2026-10-08', { notFuture: true, now })); assert.ok(isIsoDate('2026-10-07', { notFuture: true, now }));
  assert.ok(!isIsoDate('2026-10-06', { future: true, now })); assert.ok(isIsoDate('2027-01-01', { future: true, now }));
});

test('dates are rendered in Kigali time (UTC+2), numerically', () => {
  assert.equal(fmtDate('2026-10-07T22:30:00Z'), '08/10/2026'); assert.equal(fmtTime('2026-10-07T22:30:00Z'), '00:30');
  assert.equal(fmtDate('2026-01-05T08:00:00Z'), '05/01/2026');
});

test('groupByDay: today, yesterday, older; keeps order and groups same-day items', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  const items = [{ t: '2026-10-07T09:00:00Z' }, { t: '2026-10-07T01:00:00Z' }, { t: '2026-10-06T20:00:00Z' }, { t: '2026-10-01T12:00:00Z' }, { t: '2026-10-01T08:00:00Z' }];
  const g = groupByDay(items, (x) => x.t, now);
  assert.deepEqual(g.map((x) => [x.kind, x.items.length]), [['today', 2], ['yesterday', 1], ['date', 2]]);
  assert.equal(g[2].date, '01/10/2026'); assert.deepEqual(groupByDay([], (x: any) => x, now), []);
  // 23:30 UTC on the 6th is already the 7th in Kigali
  assert.equal(groupByDay([{ t: '2026-10-06T23:30:00Z' }], (x) => x.t, now)[0].kind, 'today');
});
