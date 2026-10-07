import { q, q1 } from '../db.js';
import { config } from '../config.js';

/**
 * Push delivery adapter. Default `PUSH_PROVIDER=none` is log-only / SIMULATED (nothing leaves the server).
 * `PUSH_PROVIDER=expo` posts to the Expo Push API (works for Expo push tokens, which wrap FCM and APNs).
 * Tokens are revoked when Expo reports DeviceNotRegistered, either in the send ticket or in the later receipt.
 */
export type PushMessage = { to: string; title: string; body: string; data?: Record<string, unknown>; priority?: 'high' | 'default'; channelId?: string };
export type PushTicket = { status: 'ok'; id?: string } | { status: 'error'; message?: string; error?: string };
export type PushReceipt = { status: 'ok' | 'error'; message?: string; error?: string };
export interface PushAdapter {
  readonly name: string;
  send(msgs: PushMessage[]): Promise<PushTicket[]>;                       // same order and length as the input
  receipts(ids: string[]): Promise<Record<string, PushReceipt>>;
}

export const EXPO_BATCH = 100;   // Expo accepts at most 100 messages per request

/** Log-only adapter: records messages in memory (tests, dev) and never touches the network. */
export const pushOutbox: PushMessage[] = [];
export const simulatedPush: PushAdapter = {
  name: 'simulated',
  async send(msgs) {
    for (const m of msgs) {
      pushOutbox.push(m);
      if (pushOutbox.length > 200) pushOutbox.shift();
      if (process.env.NODE_ENV !== 'production' && process.env.QUIET !== '1') console.log(`[push:dev] -> ${m.to.slice(0, 18)}...: ${m.title}`);
    }
    return msgs.map(() => ({ status: 'ok' as const }));
  },
  async receipts() { return {}; },
};

export const expoPush: PushAdapter = {
  name: 'expo',
  async send(msgs) {
    const out: PushTicket[] = [];
    for (let i = 0; i < msgs.length; i += EXPO_BATCH) {
      const batch = msgs.slice(i, i + EXPO_BATCH);
      const r = await fetch(`${config.expoPushUrl}/push/send`, {
        method: 'POST', headers: expoHeaders(), body: JSON.stringify(batch.map((m) => ({ sound: 'default', priority: 'high', ...m }))),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`expo push ${r.status}`);
      const j: any = await r.json();
      const data: any[] = Array.isArray(j?.data) ? j.data : [];
      if (data.length !== batch.length) throw new Error('expo push: ticket count mismatch');
      for (const t of data) out.push(t.status === 'ok' ? { status: 'ok', id: t.id } : { status: 'error', message: t.message, error: t.details?.error });
    }
    return out;
  },
  async receipts(ids) {
    const out: Record<string, PushReceipt> = {};
    for (let i = 0; i < ids.length; i += 300) {
      const r = await fetch(`${config.expoPushUrl}/push/getReceipts`, { method: 'POST', headers: expoHeaders(), body: JSON.stringify({ ids: ids.slice(i, i + 300) }), signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`expo receipts ${r.status}`);
      const j: any = await r.json();
      for (const [id, v] of Object.entries<any>(j?.data ?? {})) out[id] = { status: v.status, message: v.message, error: v.details?.error };
    }
    return out;
  },
};
const expoHeaders = (): Record<string, string> => ({
  'content-type': 'application/json', accept: 'application/json',
  ...(config.expoAccessToken ? { authorization: `Bearer ${config.expoAccessToken}` } : {}),
});

let adapter: PushAdapter = config.pushProvider === 'expo' ? expoPush : simulatedPush;
export const getPushAdapter = () => adapter;
/** Tests inject a fake adapter here; returns the previous one so it can be restored. */
export function setPushAdapter(a: PushAdapter): PushAdapter { const p = adapter; adapter = a; return p; }

export const isExpoToken = (t: string) => /^(Exponent|Expo)PushToken\[[^\]]+\]$/.test(t);

// ---- token registry ----
export async function registerToken(userId: string, token: string, platform: string, deviceId?: string | null) {
  // Upsert on the unique token: a token that moves to another account (shared device) is re-assigned and re-activated.
  const r = await q1<{ id: string }>(
    `insert into push_tokens(user_id, token, platform, device_id) values ($1,$2,$3,$4)
     on conflict (token) do update set user_id=excluded.user_id, platform=excluded.platform, device_id=coalesce(excluded.device_id, push_tokens.device_id), last_seen_at=now(), revoked_at=null
     returning id`, [userId, token, platform, deviceId ?? null]);
  return r!.id;
}
/** Logout: revoke one token, else this device's tokens (x-device-id), else all of the user's tokens. */
export async function revokeUserTokens(userId: string, token?: string, deviceId?: string) {
  const r = await q("update push_tokens set revoked_at=now() where user_id=$1 and revoked_at is null and ($2::text is null or token=$2) and ($2::text is not null or $3::text is null or device_id=$3) returning id", [userId, token ?? null, deviceId ?? null]);
  return r.length;
}

const MAX_ATTEMPTS = 5;
/** Worker: deliver queued push notifications (retry like SMS, give up after 5 attempts). */
export async function flushPush(limit = 50) {
  const rows = await q<any>(
    `select id, user_id, title, body, template_key, params from notifications where channel='push' and status='queued' order by created_at limit $1`, [limit]);
  const a = getPushAdapter();
  for (const n of rows) {
    const tokens = await q<{ id: string; token: string }>('select id, token from push_tokens where user_id=$1 and revoked_at is null', [n.user_id]);
    if (!tokens.length) { await q("update notifications set status='skipped', error='no_push_token' where id=$1", [n.id]); continue; }
    const data: Record<string, unknown> = { template_key: n.template_key, ...(n.params?.ref ? { ref: n.params.ref } : {}) };
    try {
      const tickets = await a.send(tokens.map((t) => ({ to: t.token, title: n.title, body: n.body, data, priority: 'high' as const, channelId: 'trips' })));
      let ok = 0, transient = 0;
      for (let i = 0; i < tokens.length; i++) {
        const t = tickets[i];
        if (t?.status === 'ok') {
          ok++;
          if (t.id) await q('insert into push_tickets(ticket_id, token_id, notification_id) values ($1,$2,$3) on conflict do nothing', [t.id, tokens[i].id, n.id]);
        } else if (t?.status === 'error' && t.error === 'DeviceNotRegistered') {
          await q('update push_tokens set revoked_at=now() where id=$1', [tokens[i].id]);
        } else transient++;
      }
      if (ok > 0) await q("update notifications set status='sent', sent_at=now(), attempts=attempts+1 where id=$1", [n.id]);
      else if (transient === 0) await q("update notifications set status='skipped', attempts=attempts+1, error='device_not_registered' where id=$1", [n.id]);
      else await retryOrFail(n.id, 'push_ticket_error');
    } catch (e: any) { await retryOrFail(n.id, String(e.message)); }
  }
  return rows.length;
}
const retryOrFail = (id: string, err: string) => q(
  `update notifications set attempts=attempts+1, error=$2, status = case when attempts+1 >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end where id=$1`, [id, err.slice(0, 200)]);

/** Worker: read delivery receipts for tickets older than a minute; revoke tokens reported DeviceNotRegistered. */
export async function checkPushReceipts(limit = 300) {
  const rows = await q<{ ticket_id: string; token_id: string }>(
    "select ticket_id, token_id from push_tickets where checked_at is null and created_at < now() - interval '1 minute' order by created_at limit $1", [limit]);
  if (!rows.length) return 0;
  let rec: Record<string, PushReceipt>;
  try { rec = await getPushAdapter().receipts(rows.map((r) => r.ticket_id)); } catch { return 0; }   // retried next run
  let revoked = 0;
  for (const r of rows) {
    const x = rec[r.ticket_id];
    if (!x) continue;                                                // not ready yet
    if (x.status === 'error' && x.error === 'DeviceNotRegistered' && r.token_id) { await q('update push_tokens set revoked_at=now() where id=$1', [r.token_id]); revoked++; }
    await q('update push_tickets set checked_at=now() where ticket_id=$1', [r.ticket_id]);
  }
  await q("delete from push_tickets where created_at < now() - interval '2 days'");   // Expo keeps receipts ~24h
  return revoked;
}
