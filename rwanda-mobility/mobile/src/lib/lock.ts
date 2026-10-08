// App-lock timing rules. Platform-free (unit-tested in tests/lock.test.ts).
/** Lock again after the app was in the background for `minutes` or more (0 = every time it comes back). Unknown background time = lock (fail safe). */
export function shouldLockAfterBackground(backgroundedAt: number | null, now: number, minutes: number): boolean {
  if (backgroundedAt == null) return true;
  if (minutes <= 0) return true;
  return now - backgroundedAt >= minutes * 60_000;
}
/** Cold start: lock when the lock is enabled and the device can still authenticate. If it cannot (biometrics removed, no PIN) never trap the user: stay unlocked and let Settings explain. */
export const lockOnColdStart = (enabled: boolean, support: 'ready' | 'none_enrolled' | 'unavailable') => enabled && support === 'ready';
/** After this many failed or cancelled attempts the lock screen stresses the sign-out way out (it is always visible anyway). */
export const STRESS_SIGNOUT_AFTER = 3;
