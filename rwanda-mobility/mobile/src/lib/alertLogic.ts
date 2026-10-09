// Pure rules for alert sounds (unit-tested; no React Native imports).
/** Which ids are new since the last look. */
export function freshIds(seen: ReadonlySet<string>, current: readonly string[]): string[] { return current.filter((id) => !seen.has(id)); }
/** Should the phone ring? Only while a request waits, the driver is online and free, and the sound is not switched off (vibration still alerts without sound). */
export function shouldRing(o: { pending: number; online: boolean; onTrip: boolean }): boolean { return o.online && !o.onTrip && o.pending > 0; }
/** A counter went up (and this is not the first value we see). */
export function increased(prev: number | undefined, now: number | undefined): boolean { return prev !== undefined && now !== undefined && now > prev; }
