import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockOnColdStart, shouldLockAfterBackground } from '../src/lib/lock.ts';

test('lock after N minutes in background', () => {
  assert.equal(shouldLockAfterBackground(1000, 1000 + 59_000, 1), false);
  assert.equal(shouldLockAfterBackground(1000, 1000 + 60_000, 1), true);
  assert.equal(shouldLockAfterBackground(1000, 1001, 0), true, '0 = immediately');
  assert.equal(shouldLockAfterBackground(null, 5, 15), true, 'unknown = lock (fail safe)');
  assert.equal(shouldLockAfterBackground(0, 14 * 60_000, 15), false);
});
test('cold start never locks a user who can no longer authenticate', () => {
  assert.equal(lockOnColdStart(true, 'ready'), true); assert.equal(lockOnColdStart(true, 'none_enrolled'), false);
  assert.equal(lockOnColdStart(true, 'unavailable'), false); assert.equal(lockOnColdStart(false, 'ready'), false);
});
