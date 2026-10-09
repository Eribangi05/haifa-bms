import { q, q1 } from '../db.js';
import { SETTING_DEFAULTS } from '../config.js';

type Key = keyof typeof SETTING_DEFAULTS;
export async function getSetting<K extends Key>(key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const row = await q1<{ value: any }>('select value from system_settings where key=$1', [key]);
  return (row ? row.value : SETTING_DEFAULTS[key]) as any;
}
export async function allSettings(): Promise<Record<string, unknown>> {
  const rows = await q<{ key: string; value: unknown }>('select key, value from system_settings');
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
export async function setSetting(key: string, value: unknown, actor: string | null) {
  // Known keys, or legacy keys that already have a stored row (shown under "Advanced"), may be edited; brand-new arbitrary keys may not.
  if (!(key in SETTING_DEFAULTS) && !(await q1('select 1 from system_settings where key=$1', [key]))) throw new Error(`unknown setting ${key}`);
  await q(
    `insert into system_settings(key,value,updated_by,updated_at) values ($1,$2,$3,now())
     on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()`,
    [key, JSON.stringify(value), actor],
  );
}
import { createHash } from 'node:crypto';
/** Stable 0-99 bucket for (flag, user): the same person always lands in the same bucket, so a 10% rollout is the same 10% every time. */
export const rolloutBucket = (key: string, userId: string) => parseInt(createHash('sha256').update(`${key}:${userId}`).digest('hex').slice(0, 8), 16) % 100;
/** Is a feature on for this person? Off when the flag is off; on for everyone at 100%; otherwise only for the people whose bucket is below the rollout percentage. */
export async function flagFor(key: string, userId: string | null | undefined): Promise<boolean> {
  const r = await q1<{ enabled: boolean; rollout_pct: number }>('select enabled, rollout_pct from feature_flags where key=$1', [key]);
  if (!r?.enabled) return false;
  if (r.rollout_pct >= 100) return true;
  if (r.rollout_pct <= 0 || !userId) return false;
  return rolloutBucket(key, userId) < r.rollout_pct;
}
/** Global check (no person known): on only at 100%. Use flagFor wherever a user is known so a partial rollout can apply. */
export async function flag(key: string): Promise<boolean> {
  const r = await q1<{ enabled: boolean; rollout_pct: number }>('select enabled, rollout_pct from feature_flags where key=$1', [key]);
  return !!r?.enabled && r.rollout_pct >= 100;
}
export async function resetSetting(key: string) { await q('delete from system_settings where key=$1', [key]); }
