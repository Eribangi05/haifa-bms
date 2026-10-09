import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, addMonths, addDays, parseIso, longDate, showHM, minuteChoices, splitInstant, joinInstant, instantAllowed, dayAllowed, clampIso, joinHM } from '../src/lib/calendar.ts';

test('monthGrid lays October 2026 out Monday-first and Sunday-first', () => {
  const mon = monthGrid(2026, 10, 1); assert.equal(mon[0].indexOf(1), 3, '1 Oct 2026 is a Thursday'); assert.equal(mon.flat().filter((x) => x).length, 31); assert.ok(mon.every((r) => r.length === 7));
  assert.equal(monthGrid(2026, 10, 0)[0].indexOf(1), 4);
  assert.equal(monthGrid(2028, 2, 1).flat().filter((x) => x).length, 29, 'leap year');
});
test('month and day arithmetic, parsing and names', () => {
  assert.deepEqual(addMonths(2026, 12, 1), { y: 2027, m: 1 }); assert.deepEqual(addMonths(2026, 1, -1), { y: 2025, m: 12 });
  assert.equal(addDays('2026-10-31', 1), '2026-11-01'); assert.equal(parseIso('2026-02-30'), null);
  assert.equal(longDate('2026-10-09', 'rw'), '9 Ukwakira 2026'); assert.equal(longDate('2026-10-09', 'fr'), '9 octobre 2026');
  assert.equal(dayAllowed('2026-10-09', '2026-10-10'), false); assert.equal(clampIso('2026-10-01', '2026-10-10', '2026-10-20'), '2026-10-10');
});
test('time display and minute steps', () => {
  assert.equal(showHM('14:30', '12h'), '2:30 PM'); assert.equal(showHM('00:05', '12h'), '12:05 AM'); assert.equal(showHM('14:30', '24h'), '14:30');
  assert.deepEqual(minuteChoices(15), [0, 15, 30, 45]); assert.equal(minuteChoices(1).length, 60); assert.equal(joinHM(25, 61), '01:01');
});
test('instants split and join in Kigali time, and the allowed window is enforced', () => {
  const iso = joinInstant('2026-10-09', '14:30')!; assert.equal(iso, '2026-10-09T12:30:00.000Z'); assert.deepEqual(splitInstant(iso), { date: '2026-10-09', time: '14:30' });
  const now = new Date('2026-10-09T10:00:00Z');
  assert.equal(instantAllowed('2026-10-09T10:10:00Z', 20, 14, now), false, 'only 10 minutes ahead'); assert.equal(instantAllowed('2026-10-09T11:00:00Z', 20, 14, now), true); assert.equal(instantAllowed('2026-11-09T11:00:00Z', 20, 14, now), false);
});
