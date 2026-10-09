import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRwPhone, checkGuest, guestBody, isGuestError, toggleDay, stepTime, validTime, kigaliDate, checkRepeat, scheduleWarning, lastRun, optKey, ringQuarters, clampPct, newlyCompleted, timeLeft, sortQuests, heatColor, heatHintKey, heatCenter, topCells, type Schedule, type Quest } from '../src/lib/growthApi.ts';

test('guest phone and form', () => {
  assert.equal(normalizeRwPhone('0788 123-456'), '+250788123456'); assert.equal(normalizeRwPhone('+250788123456'), '+250788123456'); assert.equal(normalizeRwPhone('250788123456'), '+250788123456'); assert.equal(normalizeRwPhone('0712345678'), null); assert.equal(normalizeRwPhone('abc'), null);
  assert.deepEqual(checkGuest({ name: 'Bob Mugabo', phone: '0788123456', language: 'fr' }, '+250788999999'), { ok: true });
  assert.equal(checkGuest({ name: 'B', phone: '0788123456', language: 'fr' }).name, 'name_short');
  assert.equal(checkGuest({ name: 'Bob', phone: '0788123456', language: 'fr' }, '0788123456').phone, 'phone_own');
  assert.equal(checkGuest({ name: 'Bob', phone: '12', language: 'fr' }).phone, 'phone_invalid');
  assert.deepEqual(guestBody({ name: ' Bob ', phone: '0788123456', language: 'rw' }), { name: 'Bob', phone: '+250788123456', language: 'rw' });
  assert.ok(isGuestError('guest_limit_daily') && isGuestError('invalid_phone') && !isGuestError('quote_expired') && !isGuestError());
});
test('weekday and time helpers', () => {
  assert.deepEqual(toggleDay([1, 2], 0), [1, 2, 0]); assert.deepEqual(toggleDay([1, 0], 1), [0]); assert.deepEqual(toggleDay([], 6), [6]);
  assert.equal(stepTime('07:30', 15), '07:45'); assert.equal(stepTime('23:50', 15), '00:05'); assert.equal(stepTime('00:05', -15), '23:50'); assert.equal(stepTime('xx', 0), '07:30');
  assert.ok(validTime('07:30') && validTime('23:59') && !validTime('24:00') && !validTime('7:30'));
  assert.equal(kigaliDate(new Date('2026-10-12T23:30:00Z')), '2026-10-13'); assert.equal(kigaliDate(new Date('2026-10-12T10:00:00Z'), 1), '2026-10-13');
});
test('repeat form checks', () => {
  const now = new Date('2026-10-12T08:00:00Z');
  assert.ok(checkRepeat({ days: [1], time: '07:30', start: '2026-10-13', end: '' }, now).ok);
  assert.ok(checkRepeat({ days: [], time: '07:30', start: '2026-10-13', end: '' }, now).days);
  assert.ok(checkRepeat({ days: [1], time: '7', start: '2026-10-13', end: '' }, now).time);
  assert.ok(checkRepeat({ days: [1], time: '07:30', start: '2026-10-11', end: '' }, now).start);
  assert.ok(checkRepeat({ days: [1], time: '07:30', start: '2026-02-31', end: '' }, now).start);
  assert.ok(checkRepeat({ days: [1], time: '07:30', start: '2026-10-13', end: '2026-10-12' }, now).end);
});
const base: Schedule = { id: 's', service_id: 'moto', status: 'active', days_of_week: [1], local_time: '07:30', start_date: '2026-10-12', payment_method: 'cash' };
test('schedule warnings and last run', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  assert.equal(scheduleWarning(base, now), null);
  const w = scheduleWarning({ ...base, recent_runs: [{ date: '2026-10-13', scheduled_for: '2026-10-13T05:30:00Z', status: 'price_changed', quoted_total: 2000 }, { date: '2026-10-12', scheduled_for: '2026-10-12T05:30:00Z', status: 'no_coverage' }] }, now);
  assert.deepEqual(w, { kind: 'price_changed', total: 2000, date: '2026-10-13' });
  assert.equal(scheduleWarning({ ...base, recent_runs: [{ date: '2026-10-12', scheduled_for: '2026-10-12T05:30:00Z', status: 'no_coverage' }] }, now), null);   // ride time passed
  assert.equal(scheduleWarning({ ...base, status: 'ended', recent_runs: [{ date: '2026-10-13', scheduled_for: '2026-10-13T05:30:00Z', status: 'no_coverage' }] }, now), null);
  assert.equal(lastRun({ ...base, recent_runs: [{ date: '2026-10-13', scheduled_for: '2026-10-13T05:30:00Z', status: 'pending' }, { date: '2026-10-12', scheduled_for: '2026-10-12T05:30:00Z', status: 'booked' }] }, now)?.status, 'booked');
  assert.equal(lastRun(base), null);
});
test('fixed price option key', () => { assert.notEqual(optKey({ service_id: 'standard' }), optKey({ service_id: 'standard', fixed_price: true })); assert.equal(optKey({ service_id: 'moto' }), 'moto'); });
const q = (o: Partial<Quest>): Quest => ({ id: 'q', kind: 'trips', window: 'daily', target: 5, reward: 1500, period: { key: 'D:2026-10-12', starts_at: '2026-10-11T22:00:00Z', ends_at: '2026-10-12T22:00:00Z' }, progress: 3, percent: 60, completed: false, ...o });
test('quest helpers', () => {
  assert.equal(ringQuarters(0), 0); assert.equal(ringQuarters(1), 1); assert.equal(ringQuarters(60), 3); assert.equal(ringQuarters(100), 4); assert.equal(ringQuarters(250), 4);
  assert.equal(clampPct(-5), 0); assert.equal(clampPct(NaN), 0); assert.equal(clampPct(99.6), 100);
  const done = q({ id: 'a', completed: true, percent: 100 }); const seen = new Set<string>();
  assert.deepEqual(newlyCompleted([done, q({ id: 'b' })], seen).map((x) => x.id), ['a']);
  seen.add('a|D:2026-10-12'); assert.equal(newlyCompleted([done], seen).length, 0);
  assert.equal(newlyCompleted([{ ...done, period: { ...done.period, key: 'D:2026-10-13' } }], seen).length, 1);
  assert.deepEqual(timeLeft('2026-10-14T12:00:00Z', new Date('2026-10-12T10:00:00Z')), { days: 2, hours: 2 }); assert.equal(timeLeft('2026-10-12T09:00:00Z', new Date('2026-10-12T10:00:00Z')), null);
  assert.deepEqual(sortQuests([q({ id: 'x', completed: true, percent: 100 }), q({ id: 'y', percent: 20 }), q({ id: 'z', percent: 80 })]).map((x) => x.id), ['z', 'y', 'x']);
});
test('heat map helpers', () => {
  assert.equal(heatColor(0.1), '#F1C40F'); assert.equal(heatColor(0.5), '#E67E22'); assert.equal(heatColor(1), '#C0392B');
  assert.equal(heatHintKey('heat.unserved'), 'heat.unserved'); assert.equal(heatHintKey('weird'), 'heat.some');
  assert.deepEqual(heatCenter([], { lat: 1, lng: 2 }), { lat: 1, lng: 2 }); assert.deepEqual(heatCenter([{ lat: 0, lng: 0 }, { lat: 2, lng: 4 }], { lat: 9, lng: 9 }), { lat: 1, lng: 2 });
  assert.deepEqual(topCells([{ lat: 0, lng: 0, intensity: 0.2, hint: 'a' }, { lat: 1, lng: 1, intensity: 1, hint: 'b' }], 1).map((c) => c.hint), ['b']);
});
