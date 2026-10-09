import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshIds, shouldRing, increased } from '../src/lib/alertLogic.ts';
import { voiceCue } from '../src/lib/nav.ts';
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

test('voiceCue announces a turn at about 500 m, 150 m and at the turn, once each, and starts again for the next turn', () => {
  let st = { key: '', level: 0 }; const said: (string | null)[] = [];
  for (const d of [900, 480, 470, 140, 100, 30, 20]) { const r = voiceCue(st, 'a', d, false, false); st = r.state; said.push(r.cue); }
  assert.deepEqual(said, [null, 'far', null, 'near', null, 'now', null]);
  assert.equal(voiceCue(st, 'b', 450, false, false).cue, 'far', 'next manoeuvre starts again');
  const last = voiceCue({ key: '', level: 0 }, 'z', 30, false, true); assert.equal(last.cue, 'arrive');
  const arr = voiceCue({ key: 'z', level: 1 }, 'z', 5, true, true); assert.equal(arr.cue, 'arrive'); assert.equal(voiceCue(arr.state, 'z', 3, true, true).cue, null);
});

import { photoProblem } from '../src/lib/photoCheck.ts';
test('photoProblem sends back small and nearly empty document photos, and lets unknown sizes and PDFs through', () => {
  assert.equal(photoProblem({ type: 'image/jpeg', width: 400, height: 300, size: 90_000 }), 'small');
  assert.equal(photoProblem({ type: 'image/jpeg', width: 1600, height: 1200, size: 40_000 }), 'blurry');
  assert.equal(photoProblem({ type: 'image/jpeg', width: 1600, height: 1200, size: 600_000 }), null);
  assert.equal(photoProblem({ type: 'application/pdf' }), null); assert.equal(photoProblem({ type: 'image/png' }), null);
});
