import { q, q1, type Db, pool } from '../db.js';
import { getSetting } from './settings.js';

export type AlertIn = { kind: string; severity?: 'info' | 'warning' | 'critical'; title: string; detail?: Record<string, unknown>; actorId?: string | null; dedupe?: string };

/** Raise an alert for staff. One open alert per dedupe key: repeats while it is still open are ignored. Never throws (alerting must not break the action). */
export async function raiseAlert(a: AlertIn, db: Db = pool): Promise<void> {
  try {
    await q(`insert into admin_alerts(severity, kind, title, detail, actor_id, dedupe_key) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
      [a.severity ?? 'warning', a.kind, a.title, JSON.stringify(a.detail ?? {}), a.actorId ?? null, a.dedupe ?? null], db);
  } catch { /* best effort */ }
}

const PRIVILEGED = /^(staff\.|role\.|setting\.|flag\.|credit\.|wallet\.|payout\.|refund|driver\.(approved|suspended)|user\.(deactivate|anonymi))/;
const hourKigali = () => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Kigali' }).format(new Date())) % 24;
const dayKey = () => new Date().toISOString().slice(0, 13);

/**
 * Watches the audit trail for suspicious staff behaviour. Called after every audited action (best effort, never blocks it):
 *  - failed staff sign-ins piling up on one account   - privileged actions at night (Kigali time)
 *  - a staff member opening a very large number of customer records (possible data scraping)   - unusually large credit changes
 *  - repeated refresh-token reuse (a stolen session)
 */
export async function auditWatch(actor: { id: string | null; role?: string | null }, action: string, entityType: string, entityId: string | null, after?: unknown) {
  try {
    if (action === 'auth.staff_login_failed' && entityId) {
      const limit = await getSetting('alerts.failed_logins');
      const n = await q1<{ n: number }>("select count(*)::int n from audit_logs where action='auth.staff_login_failed' and entity_id=$1 and created_at > now() - interval '15 minutes'", [entityId]);
      if ((n?.n ?? 0) >= limit) await raiseAlert({ kind: 'failed_logins', severity: 'critical', title: `${n!.n} failed staff sign-ins in 15 minutes`, detail: { user_id: entityId }, actorId: entityId, dedupe: `failed_logins:${entityId}` });
      return;
    }
    if (action === 'auth.refresh_reuse_detected') {
      await raiseAlert({ kind: 'token_reuse', severity: 'critical', title: 'A sign-in token was reused (possible stolen session)', detail: { session: entityId }, actorId: actor.id, dedupe: `token_reuse:${actor.id}:${dayKey()}` });
      return;
    }
    if (!actor.id) return;
    const isStaff = !!actor.role && actor.role !== 'driver' && actor.role !== 'passenger';
    if (isStaff && /(\.viewed|\.view|\.exported|\.export)$/.test(action)) {
      const limit = await getSetting('alerts.staff_views_per_10min');
      const n = await q1<{ n: number }>("select count(*)::int n from audit_logs where actor_id=$1 and action ~ '\\.(viewed|view|exported|export)$' and created_at > now() - interval '10 minutes'", [actor.id]);
      if ((n?.n ?? 0) >= limit) await raiseAlert({ kind: 'mass_views', severity: 'critical', title: `Staff member opened ${n!.n} records in 10 minutes`, detail: { actor: actor.id, role: actor.role }, actorId: actor.id, dedupe: `mass_views:${actor.id}:${dayKey()}` });
    }
    if (isStaff && PRIVILEGED.test(action)) {
      const [start, end] = await Promise.all([getSetting('alerts.off_hours_start'), getSetting('alerts.off_hours_end')]);
      const h = hourKigali();
      const night = start > end ? h >= start || h < end : h >= start && h < end;
      if (night) await raiseAlert({ kind: 'off_hours', severity: 'warning', title: `Privileged action at night: ${action}`, detail: { actor: actor.id, role: actor.role, action, entity: `${entityType}:${entityId}`, hour: h }, actorId: actor.id, dedupe: `off_hours:${actor.id}:${action}:${dayKey()}` });
    }
    if (/^(credit\.|wallet\.)/.test(action) && after && typeof after === 'object') {
      const amt = Math.abs(Number((after as any).amount ?? 0)), lim = await getSetting('alerts.credit_adjust_threshold');
      if (amt >= lim) await raiseAlert({ kind: 'large_credit', severity: 'warning', title: `Large credit change: ${amt} RWF`, detail: { actor: actor.id, action, amount: amt, entity: `${entityType}:${entityId}` }, actorId: actor.id, dedupe: `large_credit:${actor.id}:${action}:${entityId}:${dayKey()}` });
    }
  } catch { /* best effort */ }
}

export async function listAlerts(status: 'open' | 'acknowledged' | 'all' = 'open', limit = 100) {
  return q(`select a.id, a.severity, a.kind, a.title, a.detail, a.status, a.created_at, a.acknowledged_at, u.display_name actor_name, au.display_name acknowledged_by_name
            from admin_alerts a left join users u on u.id=a.actor_id left join users au on au.id=a.acknowledged_by
            where ($1='all' or a.status=$1) order by (a.severity='critical') desc, a.created_at desc limit $2`, [status, limit]);
}
