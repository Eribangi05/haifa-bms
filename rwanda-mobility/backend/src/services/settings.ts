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
  if (!(key in SETTING_DEFAULTS)) throw new Error(`unknown setting ${key}`);
  await q(
    `insert into system_settings(key,value,updated_by,updated_at) values ($1,$2,$3,now())
     on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()`,
    [key, JSON.stringify(value), actor],
  );
}
export async function flag(key: string): Promise<boolean> {
  const r = await q1<{ enabled: boolean }>('select enabled from feature_flags where key=$1', [key]);
  return r?.enabled ?? false;
}
