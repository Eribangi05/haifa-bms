import { q, q1 } from '../db.js';
import { notify } from './notify.js';
import { kigaliDow, kigaliHour } from './pricing.js';

/**
 * Monday morning (Kigali), once per week: every driver who earned something last week gets one push with the totals.
 * The marker row keeps a restart or a second instance from sending it twice. The full statement is in the app (Earnings).
 */
export async function weeklyDriverDigest(now = new Date()): Promise<number> {
  if (kigaliDow(now) !== 1 || kigaliHour(now) < 7 || kigaliHour(now) > 11) return 0;
  const win = (await q1<any>(`select to_char(d, 'YYYY-MM-DD') mon, ((d - 7)::timestamp at time zone 'Africa/Kigali') a, (d::timestamp at time zone 'Africa/Kigali') b
      from (select date_trunc('week', ($1::timestamptz) at time zone 'Africa/Kigali')::date d) x`, [now]))!;
  const claimed = await q1("insert into system_settings(key, value) values ('jobs.weekly_digest_week', to_jsonb($1::text)) on conflict (key) do update set value=excluded.value where system_settings.value <> excluded.value returning key", [win.mon]);
  if (!claimed) return 0;
  const rows = await q<{ driver_id: string; trips: number; net: number }>(
    'select driver_id, count(*)::int trips, coalesce(sum(net),0)::int net from driver_earnings where created_at >= $1 and created_at < $2 group by driver_id having count(*) > 0', [win.a, win.b]);
  for (const r of rows) await notify(r.driver_id, 'weekly_statement', { trips: r.trips, net: r.net });
  return rows.length;
}
