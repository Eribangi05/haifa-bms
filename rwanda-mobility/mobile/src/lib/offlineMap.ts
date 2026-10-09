import { kv } from './storage';

/** The Kigali area saved on the phone for offline use: west, south, east, north (covers the city and its neighbourhoods) and the map zoom levels kept. */
export const KIGALI_BBOX: [number, number, number, number] = [29.96, -2.06, 30.20, -1.84];
export const OFFLINE_ZOOMS = { min: 8, max: 14 } as const;
export type OfflineInfo = { at: number; failed: number } | null;
export type OfflineProgress = { state: 'idle' | 'running' | 'done' | 'error'; done: number; total: number };
const KEY = 'rm_offline_map';

export async function loadOfflineInfo(): Promise<OfflineInfo> { try { const s = await kv.get(KEY); return s ? (JSON.parse(s) as OfflineInfo) : null; } catch { return null; } }
export const saveOfflineInfo = (i: OfflineInfo) => (i ? kv.set(KEY, JSON.stringify(i)) : kv.del(KEY));
export const prefetchCommand = () => JSON.stringify({ cmd: 'prefetch', bbox: KIGALI_BBOX, minz: OFFLINE_ZOOMS.min, maxz: OFFLINE_ZOOMS.max });
/** 0..1 for a progress bar. */
export const fraction = (p: OfflineProgress) => (p.total ? Math.min(1, p.done / p.total) : 0);
