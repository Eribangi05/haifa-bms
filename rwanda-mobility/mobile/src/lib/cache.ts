import { kv } from './storage';

/**
 * Offline cache for read-only screens (history, credit, profile, earnings...). Each entry is stored per signed-in person with the time it was saved, so a
 * screen can show the last known data instantly (and when the phone has no signal), then replace it with fresh data. Cleared at sign-out.
 */
const INDEX = 'rm_cache_index';
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;      // older than two weeks is not shown
export type Cached<T> = { at: number; d: T };

const keyOf = (userId: string, key: string) => `rm_cache:${userId}:${key}`;

export async function cacheLoad<T>(userId: string, key: string): Promise<Cached<T> | null> {
  try {
    const s = await kv.get(keyOf(userId, key)); if (!s) return null;
    const v = JSON.parse(s) as Cached<T>;
    return v && typeof v.at === 'number' && Date.now() - v.at < MAX_AGE_MS ? v : null;
  } catch { return null; }
}
export async function cacheSave<T>(userId: string, key: string, d: T): Promise<void> {
  try {
    const k = keyOf(userId, key); await kv.set(k, JSON.stringify({ at: Date.now(), d }));
    const idx: string[] = JSON.parse((await kv.get(INDEX)) ?? '[]');
    if (!idx.includes(k)) { idx.push(k); await kv.set(INDEX, JSON.stringify(idx.slice(-200))); }
  } catch { /* storage full or unavailable: the screen simply works online only */ }
}
export async function cacheClear(): Promise<void> {
  try {
    const idx: string[] = JSON.parse((await kv.get(INDEX)) ?? '[]');
    for (const k of idx) await kv.del(k);
    await kv.del(INDEX);
  } catch { /* ignore */ }
}
/** "5 min ago", "yesterday"... in plain numbers: the caller turns it into a translated sentence. */
export function ageOf(at: number): { unit: 'min' | 'h' | 'd'; n: number } {
  const m = Math.max(1, Math.round((Date.now() - at) / 60000));
  return m < 60 ? { unit: 'min', n: m } : m < 24 * 60 ? { unit: 'h', n: Math.round(m / 60) } : { unit: 'd', n: Math.round(m / 1440) };
}
