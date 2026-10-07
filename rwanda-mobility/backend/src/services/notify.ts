import { q, q1, type Db, pool } from '../db.js';
import { DEFAULT_TEMPLATES, render, localizeParams, type Lang } from './i18n.js';
import { sms } from '../providers/sms.js';

type Opts = { critical?: boolean; db?: Db };

/**
 * Queue an in-app notification (always) and an SMS (only if the user allows SMS, or the event is critical).
 * Time-critical kinds (PUSH_EVENTS) also queue a push, delivered by flushPush (Expo adapter when PUSH_PROVIDER=expo, simulated otherwise).
 */
export async function notify(userId: string, key: string, params: Record<string, unknown> = {}, opts: Opts = {}) {
  const db = opts.db ?? pool;
  const u = await q1<{ preferred_language: string; phone: string | null; notif_prefs: any }>(
    'select preferred_language, phone, notif_prefs from users where id=$1', [userId], db);
  if (!u) return;
  const lang = (DEFAULT_TEMPLATES[key]?.[u.preferred_language as Lang] ? u.preferred_language : 'en') as Lang;
  params = localizeParams(params, lang);
  const over = await q1<{ title: string; body: string }>('select title, body from notification_templates where key=$1 and lang=$2', [key, lang], db);
  const tpl = over ?? DEFAULT_TEMPLATES[key]?.[lang];
  if (!tpl) return;
  const title = render(tpl.title, params), body = render(tpl.body, params);
  await q(`insert into notifications(user_id, channel, template_key, params, title, body, lang, critical, status, sent_at)
           values ($1,'in_app',$2,$3,$4,$5,$6,$7,'sent',now())`,
    [userId, key, JSON.stringify(redact(params)), title, body, lang, !!opts.critical], db);
  const wantsSms = u.notif_prefs?.sms !== false || opts.critical;
  if (wantsSms && u.phone && (opts.critical || SMS_EVENTS.has(key))) {
    await q(`insert into notifications(user_id, channel, template_key, params, title, body, lang, critical, status)
             values ($1,'sms',$2,$3,$4,$5,$6,$7,'queued')`,
      [userId, key, JSON.stringify(redact(params)), title, body, lang, !!opts.critical], db);
  }
  if (PUSH_EVENTS.has(key) && (u.notif_prefs?.push !== false || opts.critical)) {
    await q(`insert into notifications(user_id, channel, template_key, params, title, body, lang, critical, status)
             values ($1,'push',$2,$3,$4,$5,$6,$7,'queued')`,
      [userId, key, JSON.stringify(redact(params)), title, body, lang, !!opts.critical], db);
  }
}
/** Time-critical events worth a push: driver offers, driver assigned/arrived, Abasare handover, payment, SOS. */
export const PUSH_EVENTS = new Set(['offer', 'driver_assigned', 'abasare_assigned', 'driver_arrived', 'handover_submitted', 'handover_issue', 'payment_success', 'payment_failed', 'sos_ack']);
const SMS_EVENTS = new Set(['driver_assigned', 'driver_arrived', 'payment_failed', 'no_driver', 'sos_ack', 'doc_expiry']);
const redact = (p: Record<string, unknown>) => { const c = { ...p }; delete c.code; return c; };

/** Worker: deliver queued SMS with retry. Failed critical notifications stay retriable up to 5 attempts. */
export async function flushSms(limit = 50) {
  const rows = await q<any>(
    `select n.id, n.body, u.phone from notifications n join users u on u.id=n.user_id
     where n.channel='sms' and n.status='queued' order by n.created_at limit $1`, [limit]);
  for (const r of rows) {
    try {
      await sms.send(r.phone, r.body);
      await q("update notifications set status='sent', sent_at=now(), attempts=attempts+1 where id=$1", [r.id]);
    } catch (e: any) {
      await q(`update notifications set attempts=attempts+1, error=$2,
               status = case when attempts+1 >= 5 then 'failed' else 'queued' end where id=$1`, [r.id, String(e.message).slice(0, 200)]);
    }
  }
  return rows.length;
}
