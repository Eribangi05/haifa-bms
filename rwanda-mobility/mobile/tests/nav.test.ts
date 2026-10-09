import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progress, locate, shouldReroute, fmtDist, arrowFor, distM, type NavRoute } from '../src/lib/nav.ts';

// A straight road going north (about 1.1 km), then east (about 0.9 km): two manoeuvres, start and arrival.
const geometry: [number, number][] = [[-1.960, 30.060], [-1.955, 30.060], [-1.950, 30.060], [-1.950, 30.065], [-1.950, 30.068]];
const route: NavRoute = {
  distance_m: 1900, duration_s: 380, geometry,
  steps: [
    { maneuver: 'depart', name: 'KN 5 Rd', distance_m: 1110, duration_s: 220, at: { lat: -1.960, lng: 30.060 }, bearing: 0 },
    { maneuver: 'turn', modifier: 'right', name: 'KG 11 Ave', distance_m: 780, duration_s: 160, at: { lat: -1.950, lng: 30.060 }, bearing: 90 },
    { maneuver: 'arrive', name: 'KG 11 Ave', distance_m: 0, duration_s: 0, at: { lat: -1.950, lng: 30.068 }, bearing: 90 },
  ],
};

test('locate: position on the road is 0 m off; a point 100 m to the side is about 100 m off', () => {
  const on = locate(geometry, { lat: -1.955, lng: 30.060 }); assert.ok(on.off < 1); assert.ok(Math.abs(on.along - 556) < 20);
  const side = locate(geometry, { lat: -1.955, lng: 30.0609 }); assert.ok(side.off > 80 && side.off < 120);
});

test('progress: next manoeuvre, distance to it, remaining distance and time', () => {
  const p = progress(route, { lat: -1.9525, lng: 30.060 });
  assert.equal(p.step.maneuver, 'turn'); assert.equal(p.stepIndex, 1);
  assert.ok(p.toNextM > 250 && p.toNextM < 310, `about 280 m to the turn (${p.toNextM})`);
  assert.ok(p.remainingM > 1100 && p.remainingM < 1230);
  assert.ok(p.remainingS > 200 && p.remainingS < 245);
  assert.equal(p.arrived, false); assert.ok(p.offRouteM < 5);
  const after = progress(route, { lat: -1.950, lng: 30.063 });
  assert.equal(after.step.maneuver, 'arrive'); assert.ok(after.toNextM > 400 && after.toNextM < 650);
  const done = progress(route, { lat: -1.950, lng: 30.0679 });
  assert.equal(done.arrived, true);
});

test('shouldReroute: only when far from the road and not asked a moment ago', () => {
  assert.equal(shouldReroute(20, 0, 100_000), false);
  assert.equal(shouldReroute(90, 95_000, 100_000), false, 'asked 5 s ago');
  assert.equal(shouldReroute(90, 50_000, 100_000), true);
});

test('formatting helpers', () => {
  assert.equal(fmtDist(42), '40 m'); assert.equal(fmtDist(480), '480 m'); assert.equal(fmtDist(1840), '1.8 km'); assert.equal(fmtDist(23_400), '23 km');
  assert.equal(arrowFor('turn', 'left'), '←'); assert.equal(arrowFor('turn', 'slight_right'), '↗'); assert.equal(arrowFor('arrive'), '⚑'); assert.equal(arrowFor('depart'), '↑');
  assert.ok(Math.abs(distM({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }) - 111) < 2);
});
