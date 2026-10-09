import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeKey, checkTip, shouldResyncEta, etaRemaining, expiryLeft, fmtCountdown, navFallbacks, navLinks, orderTags, parseAmount, rankTags, safetyPending, safetyRoute, safetySecondsLeft, sortBadges, tagLabel, tipPresets } from '../src/lib/trustApi.ts';

const T = (id: string, kind: 'positive' | 'negative') => ({ id, kind, scope: 'ride' as const, label: { rw: id + '-rw', fr: id + '-fr', en: id + '-en' } });

test('tags: matching group first, labels in the chosen language', () => {
  const tags = [T('rude', 'negative'), T('polite', 'positive'), T('late', 'negative')];
  assert.deepEqual(orderTags(tags, 5).map((x) => x.id), ['polite', 'rude', 'late']);
  assert.deepEqual(orderTags(tags, 2).map((x) => x.id), ['rude', 'late', 'polite']);
  assert.equal(tagLabel(tags[1], 'fr'), 'polite-fr'); assert.equal(tagLabel({ label: { rw: '', fr: '', en: 'x' } }, 'rw'), 'x');
});
test('tips: presets respect min/max, validation, parsing', () => {
  assert.deepEqual(tipPresets(100, 20000), [500, 1000, 2000, 5000]); assert.deepEqual(tipPresets(1000, 2000), [1000, 2000]); assert.deepEqual(tipPresets(6000, 7000), []);
  assert.equal(checkTip(50, 100, 20000), 'low'); assert.equal(checkTip(25000, 100, 20000), 'high'); assert.equal(checkTip(null, 100, 20000), 'empty'); assert.equal(checkTip(100, 100, 20000), 'ok'); assert.equal(checkTip(0, 100, 20000), 'empty');
  assert.equal(parseAmount('1 500 RWF'), 1500); assert.equal(parseAmount('abc'), null);
});
test('driver ETA countdown ticks down from the poll time and resets on a new poll', () => {
  assert.equal(etaRemaining(420, 1000, 1000), 420); assert.equal(etaRemaining(420, 1000, 61_000), 360); assert.equal(etaRemaining(30, 0, 99_000), 0); assert.equal(etaRemaining(null, 0, 5), null);
  assert.equal(fmtCountdown(75), '1:15'); assert.equal(fmtCountdown(5), '0:05'); assert.equal(fmtCountdown(3900), '1h 05');
});
test('share expiry', () => {
  const now = Date.parse('2026-10-08T10:00:00Z');
  assert.deepEqual(expiryLeft('2026-10-08T10:30:00Z', null, now), { kind: 'min', n: 30 });
  assert.deepEqual(expiryLeft('2026-10-08T14:00:00Z', null, now), { kind: 'hours', n: 4 });
  assert.equal(expiryLeft('2026-10-08T09:00:00Z', null, now).kind, 'expired'); assert.equal(expiryLeft('2026-10-08T14:00:00Z', '2026-10-08T09:00:00Z', now).kind, 'revoked'); assert.equal(expiryLeft(null, null, now).kind, 'open');
});
test('safety check state and push routing', () => {
  const o = { id: 'a', kind: 'route_deviation', status: 'asked', asked_at: '2026-10-08T10:00:00Z', respond_by: '2026-10-08T10:03:00Z' };
  assert.equal(safetyPending(o), true); assert.equal(safetyPending(null), false); assert.equal(safetyPending({ ...o, status: 'escalated' }), false);
  assert.equal(safetySecondsLeft(o, Date.parse('2026-10-08T10:01:00Z')), 120); assert.equal(safetySecondsLeft(o, Date.parse('2026-10-08T11:00:00Z')), 0);
  assert.deepEqual(safetyRoute({ template_key: 'safety_check_stop' }), { name: 'track', params: { safety: true } });
  assert.deepEqual(safetyRoute({ type: 'safety_check_deviation', booking_id: 'b1' }), { name: 'track', params: { id: 'b1', safety: true } });
  assert.equal(safetyRoute({ template_key: 'driver_assigned' }), null); assert.equal(safetyRoute(null), null);
});
test('navigation links: server links preferred, built from coordinates otherwise, web fallback last', () => {
  const n = { lat: -1.95, lng: 30.09, waze: 'https://waze.com/ul?ll=1,2&navigate=yes' };
  const l = navLinks(n); assert.equal(l[1].url, n.waze); assert.match(l[0].url, /google\.com\/maps\/dir\/\?api=1&destination=-1\.95,30\.09/); assert.match(l[2].url, /^geo:-1\.95,30\.09/);
  assert.deepEqual(navFallbacks(n, 'geo').length, 2); assert.equal(navFallbacks(n, 'google').length, 1); assert.deepEqual(navLinks(undefined), []);
});
test('badges sort and keys; tag ranking', () => {
  const b = [{ id: 'top_rated', label: { rw: '', fr: '', en: '' } }, { id: 'trips_completed', tier: 100, label: { rw: '', fr: '', en: '' } }, { id: 'licence_verified', label: { rw: '', fr: '', en: '' } }, { id: 'trips_completed', tier: 25, label: { rw: '', fr: '', en: '' } }];
  assert.deepEqual(sortBadges(b).map(badgeKey), ['licence_verified', 'trips_completed.25', 'trips_completed.100', 'top_rated']);
  assert.deepEqual(rankTags({ polite: 4, clean_car: 4, safe: 9 }), [{ id: 'safe', n: 9 }, { id: 'clean_car', n: 4 }, { id: 'polite', n: 4 }]);
});
test('ETA re-sync only when the server disagrees with our own countdown', () => {
  assert.equal(shouldResyncEta(400, 405), false); assert.equal(shouldResyncEta(400, 300), true); assert.equal(shouldResyncEta(null, 300), true); assert.equal(shouldResyncEta(0, 429), true); assert.equal(shouldResyncEta(100, null), false);
});
