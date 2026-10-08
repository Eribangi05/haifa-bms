import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLive, isOpen, isPayable, statusTone, statusGlyph, tripTitleKey, payUi, STEP, PAY_SLOW_MS } from '../src/lib/trip.ts';
import { errorText } from '../src/lib/errors.ts';
import { ApiError } from '../src/lib/net.ts';

test('status classification', () => {
  assert.ok(isLive('IN_PROGRESS') && !isLive('COMPLETED')); assert.ok(isOpen('PAYMENT_PENDING') && isOpen('SEARCHING_DRIVER') && !isOpen('PAYMENT_COMPLETED') && !isOpen('CANCELLED_BY_DRIVER'));
  assert.ok(isPayable('COMPLETED'));
  assert.equal(statusTone('CANCELLED_BY_PASSENGER'), 'bad'); assert.equal(statusTone('PAYMENT_COMPLETED'), 'ok'); assert.equal(statusTone('IN_PROGRESS'), 'warn'); assert.equal(statusTone('NO_DRIVER_FOUND'), 'bad');
  assert.equal(statusGlyph('PAYMENT_COMPLETED'), '✓'); assert.equal(statusGlyph('CANCELLED_BY_SYSTEM'), '✕');
  assert.equal(STEP.IN_PROGRESS, 3);
});
test('refunded trips are not titled "cancelled"; unknown statuses fall back to cancelled', () => {
  assert.equal(tripTitleKey('REFUNDED'), 'trip.refunded'); assert.equal(tripTitleKey('PARTIALLY_REFUNDED'), 'trip.refunded');
  assert.equal(tripTitleKey('REQUESTED'), 'trip.searching'); assert.equal(tripTitleKey('DRIVER_ARRIVED'), 'trip.arrived'); assert.equal(tripTitleKey('CANCELLED_BY_DRIVER'), 'trip.cancelled');
});
test('MoMo UI state comes from the server status only', () => {
  assert.equal(payUi(undefined, 0), 'idle'); assert.equal(payUi('PENDING', 1000), 'pending'); assert.equal(payUi('PENDING', PAY_SLOW_MS), 'slow');
  assert.equal(payUi('FAILED', 0), 'failed'); assert.equal(payUi('SUCCESS', 0), 'success');
  assert.equal(payUi('PENDING', 10 ** 9), 'slow', 'a long wait never turns into success');
});
test('errorText maps technical errors to localised copy and keeps backend messages', () => {
  const t = (k: string) => `[${k}]`;
  assert.equal(errorText(t as any, new ApiError(0, 'network', 'No connection')), '[err.network]');
  assert.equal(errorText(t as any, new ApiError(0, 'timeout', 'Request timed out')), '[err.timeout]');
  assert.equal(errorText(t as any, new ApiError(401, 'unauthorized', 'Signed out')), '[err.session]');
  assert.equal(errorText(t as any, new ApiError(503, 'x', 'boom')), '[err.server]');
  assert.equal(errorText(t as any, new ApiError(400, 'pin_invalid', 'PIN ikosheje')), 'PIN ikosheje');
  assert.equal(errorText(t as any, new ApiError(404, 'error', 'Request failed (404)')), '[common.error]');
  assert.equal(errorText(t as any, new TypeError('x')), '[common.error]');
});

import { shouldTrack } from '../src/lib/trip.ts';
test('location sharing runs only for an online/on-trip driver in driver mode with consent', () => {
  const base = { mode: 'driver', consent: true, online: true, onTrip: false };
  assert.ok(shouldTrack(base)); assert.ok(shouldTrack({ ...base, online: false, onTrip: true }));
  assert.ok(!shouldTrack({ ...base, mode: 'passenger' })); assert.ok(!shouldTrack({ ...base, consent: false })); assert.ok(!shouldTrack({ ...base, online: false }));
});
