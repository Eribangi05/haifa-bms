import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshIds, shouldRing, increased } from '../src/lib/alertLogic.ts';
import { parsePrefs, DEFAULT_PREFS } from '../src/lib/prefs.ts';

test('new requests are the ids not seen before; an answered request frees its place', () => {
  const seen = new Set(['a']);
  assert.deepEqual(freshIds(seen, ['a', 'b', 'c']), ['b', 'c']);
  assert.deepEqual(freshIds(seen, []), []);
  assert.deepEqual(freshIds(new Set(), ['x']), ['x']);
});
test('the phone rings only for a waiting request while online and free', () => {
  assert.equal(shouldRing({ pending: 1, online: true, onTrip: false }), true);
  assert.equal(shouldRing({ pending: 0, online: true, onTrip: false }), false);
  assert.equal(shouldRing({ pending: 2, online: false, onTrip: false }), false);
  assert.equal(shouldRing({ pending: 2, online: true, onTrip: true }), false);
});
test('a ping needs a rise, never the first value', () => {
  assert.equal(increased(undefined, 3), false); assert.equal(increased(0, 1), true); assert.equal(increased(2, 2), false); assert.equal(increased(3, 0), false); assert.equal(increased(1, undefined), false);
});
test('sound preferences default to ON and only an explicit false turns them off', () => {
  assert.equal(DEFAULT_PREFS.offerSound, true); assert.equal(DEFAULT_PREFS.chatSound, true);
  assert.equal(parsePrefs(null).offerSound, true); assert.equal(parsePrefs('{}').chatSound, true);
  assert.equal(parsePrefs('{"offerSound":false}').offerSound, false); assert.equal(parsePrefs('{"offerSound":false}').chatSound, true);
  assert.equal(parsePrefs('{"offerSound":"no"}').offerSound, true, 'junk keeps the safe default');
});
