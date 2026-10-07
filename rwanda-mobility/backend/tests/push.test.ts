import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';
import type { PushAdapter, PushMessage, PushTicket } from '../src/services/push.ts';

let t: Ctx;
let setPushAdapter: typeof import('../src/services/push.ts').setPushAdapter, flushPush: typeof import('../src/services/push.ts').flushPush,
  checkPushReceipts: typeof import('../src/services/push.ts').checkPushReceipts, expoPush: typeof import('../src/services/push.ts').expoPush, notify: typeof import('../src/services/notify.ts').notify;
before(async () => {
  t = await boot('rwanda_mobility_test');   // sets env first; services are imported afterwards
  ({ setPushAdapter, flushPush, checkPushReceipts, expoPush } = await import('../src/services/push.ts'));
  ({ notify } = await import('../src/services/notify.ts'));
});
after(async () => { await t.close(); });

const TOKEN = () => `ExponentPushToken[${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}]`;
function fake(script: (m: PushMessage, i: number) => PushTicket = () => ({ status: 'ok', id: `tk-${Math.random().toString(36).slice(2)}` })) {
  const sent: PushMessage[] = []; let receipts: Record<string, any> = {};
  const a: PushAdapter & { sent: PushMessage[]; setReceipts(r: Record<string, any>): void; fail: boolean } = {
    name: 'fake', sent, fail: false, setReceipts(r) { receipts = r; },
    async send(msgs) { if (a.fail) throw new Error('network down'); sent.push(...msgs); return msgs.map(script); },
    async receipts() { return receipts; },
  };
  return a;
}
const drain = async () => { await t.db.q("update notifications set status='skipped' where channel='push' and status='queued'"); };

test('push token endpoints: upsert is idempotent, validated, authenticated; DELETE revokes', async () => {
  const u = await t.register(); const tok = TOKEN();
  assert.equal((await t.api('POST', '/users/me/push-token', { body: { token: tok, platform: 'android' } })).status, 401);
  assert.equal((await t.api('POST', '/users/me/push-token', { token: u.token, body: { token: tok, platform: 'blackberry' } })).status, 400);
  assert.equal((await t.api('POST', '/users/me/push-token', { token: u.token, body: { token: 'short', platform: 'ios' } })).status, 400);
  for (let i = 0; i < 2; i++) assert.equal((await t.api('POST', '/users/me/push-token', { token: u.token, body: { token: tok, platform: 'android' } })).status, 200);
  assert.equal((await t.db.q('select 1 from push_tokens where token=$1', [tok])).length, 1);
  // the same token on another account (shared phone) moves to the new user
  const v = await t.register();
  await t.api('POST', '/users/me/push-token', { token: v.token, body: { token: tok, platform: 'android' } });
  assert.equal((await t.db.q1<any>('select user_id from push_tokens where token=$1', [tok])).user_id, v.id);
  const del = await t.api('DELETE', '/users/me/push-token', { token: v.token, body: { token: tok } });
  assert.equal(del.status, 200); assert.equal(del.json.revoked, 1);
  assert.ok((await t.db.q1<any>('select revoked_at from push_tokens where token=$1', [tok])).revoked_at);
  await t.api('POST', '/users/me/push-token', { token: v.token, body: { token: tok, platform: 'android' } });
  assert.equal((await t.db.q1<any>('select revoked_at from push_tokens where token=$1', [tok])).revoked_at, null, 're-registering re-activates');
  const all = await t.api('DELETE', '/users/me/push-token', { token: v.token });
  assert.equal(all.json.revoked, 1);
});

test('time-critical notifications queue a localised push; others do not; opt-out is respected', async () => {
  const u = await t.register(); const tok = TOKEN();
  await t.api('POST', '/users/me/push-token', { token: u.token, body: { token: tok, platform: 'android' } });
  await t.db.q("update users set preferred_language='fr' where id=$1", [u.id]);
  const prev = setPushAdapter(fake()); const a = fake(); setPushAdapter(a);
  try {
    await drain();
    await notify(u.id, 'driver_assigned', { driver: 'Eric', plate: 'RAB 123 C' }, { critical: true });
    await notify(u.id, 'booking_confirmed', { ref: 'AB123' });
    const queued = await t.db.q<any>("select template_key, lang, title from notifications where user_id=$1 and channel='push'", [u.id]);
    assert.deepEqual(queued.map((r: any) => r.template_key), ['driver_assigned']);
    await flushPush();
    assert.equal(a.sent.length, 1);
    assert.equal(a.sent[0].to, tok); assert.equal(a.sent[0].title, 'Chauffeur trouvé'); assert.match(a.sent[0].body, /Eric.*RAB 123 C.*en route/);
    assert.equal((await t.db.q1<any>("select status from notifications where user_id=$1 and channel='push'", [u.id])).status, 'sent');
    // Kinyarwanda user gets Kinyarwanda only
    await t.db.q("update users set preferred_language='rw' where id=$1", [u.id]);
    await notify(u.id, 'payment_success', { amount: 1500, ref: 'AB123' }); await flushPush();
    assert.equal(a.sent[1].title, 'Kwishyura byakiriwe');
    // push opt-out: skipped unless critical
    await t.api('PATCH', '/users/me', { token: u.token, body: { notif_prefs: { push: false } } });
    await notify(u.id, 'payment_success', { amount: 1500, ref: 'AB124' });
    assert.equal((await t.db.q("select 1 from notifications where user_id=$1 and channel='push' and params->>'ref'='AB124'", [u.id])).length, 0);
    await notify(u.id, 'sos_ack', { ref: 'SOS1' }, { critical: true });
    assert.equal((await t.db.q("select 1 from notifications where user_id=$1 and channel='push' and template_key='sos_ack'", [u.id])).length, 1);
  } finally { setPushAdapter(prev); }
});

test('ticket and receipt errors revoke tokens; users without tokens are skipped; failures retry then give up', async () => {
  const u = await t.register(); const dead = TOKEN(), live = TOKEN();
  await t.api('POST', '/users/me/push-token', { token: u.token, body: { token: dead, platform: 'android' } });
  await t.api('POST', '/users/me/push-token', { token: u.token, body: { token: live, platform: 'ios' } });
  const a = fake((m) => m.to === dead ? { status: 'error', error: 'DeviceNotRegistered', message: 'gone' } : { status: 'ok', id: 'ticket-live-1' });
  const prev = setPushAdapter(a);
  try {
    await drain();
    await notify(u.id, 'driver_arrived', { plate: 'RAB 1' }, { critical: true }); await flushPush();
    assert.ok((await t.db.q1<any>('select revoked_at from push_tokens where token=$1', [dead])).revoked_at, 'DeviceNotRegistered ticket revokes the token');
    assert.equal((await t.db.q1<any>('select revoked_at from push_tokens where token=$1', [live])).revoked_at, null);
    assert.equal((await t.db.q1<any>("select status from notifications where user_id=$1 and channel='push'", [u.id])).status, 'sent');
    // receipts: the later receipt reveals the live token is dead too
    await t.db.q("update push_tickets set created_at = now() - interval '5 minutes' where ticket_id='ticket-live-1'");
    a.setReceipts({ 'ticket-live-1': { status: 'error', error: 'DeviceNotRegistered' } });
    assert.equal(await checkPushReceipts(), 1);
    assert.ok((await t.db.q1<any>('select revoked_at from push_tokens where token=$1', [live])).revoked_at);
    assert.ok((await t.db.q1<any>("select checked_at from push_tickets where ticket_id='ticket-live-1'")).checked_at);
    // nothing left to deliver to
    await notify(u.id, 'payment_failed', { ref: 'AB1' }); await flushPush();
    assert.equal((await t.db.q1<any>("select status, error from notifications where user_id=$1 and template_key='payment_failed' and channel='push'", [u.id])).status, 'skipped');
  } finally { setPushAdapter(prev); }

  // provider outage: stays queued, 5th failed attempt is final
  const w = await t.register(); await t.api('POST', '/users/me/push-token', { token: w.token, body: { token: TOKEN(), platform: 'web' } });
  const down = fake(); down.fail = true; setPushAdapter(down);
  try {
    await drain(); await notify(w.id, 'offer', { km: '1.2', net: 900 });
    const wake = () => t.db.q("update notifications set next_attempt_at = null where user_id=$1 and channel='push'", [w.id]);   // pretend the back-off has elapsed
    for (let i = 1; i <= 4; i++) { await wake(); await flushPush(); assert.equal((await t.db.q1<any>("select status from notifications where user_id=$1 and channel='push'", [w.id])).status, 'queued', `attempt ${i}`); }
    const attempts = async () => (await t.db.q1<any>("select attempts from notifications where user_id=$1 and channel='push'", [w.id])).attempts;
    const before = await attempts();
    await flushPush();                                                           // back-off: a failed message is not retried on the very next tick
    assert.equal(await attempts(), before, 'no immediate retry while the back-off runs');
    await wake(); await flushPush();
    const f = await t.db.q1<any>("select status, attempts from notifications where user_id=$1 and channel='push'", [w.id]);
    assert.equal(f.status, 'failed'); assert.equal(f.attempts, 5);
  } finally { setPushAdapter(prev); }
});

test('expo adapter batches 100 messages per request and parses tickets and receipts', async () => {
  const realFetch = globalThis.fetch; const calls: { url: string; n: number }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith('/push/send')) {
      calls.push({ url: String(url), n: body.length });
      return new Response(JSON.stringify({ data: body.map((_m: any, i: number) => i === 0 ? { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `id-${i}` }) }));
    }
    return new Response(JSON.stringify({ data: Object.fromEntries(body.ids.map((id: string) => [id, { status: 'error', message: 'm', details: { error: 'DeviceNotRegistered' } }])) }));
  }) as any;
  try {
    const msgs = Array.from({ length: 250 }, (_, i) => ({ to: `ExponentPushToken[t${i}]`, title: 'T', body: 'B' }));
    const tickets = await expoPush.send(msgs);
    assert.deepEqual(calls.map((c) => c.n), [100, 100, 50]);
    assert.equal(tickets.length, 250); assert.equal((tickets[0] as any).error, 'DeviceNotRegistered'); assert.equal((tickets[1] as any).id, 'id-1');
    const r = await expoPush.receipts(['a', 'b']);
    assert.equal(r.a.error, 'DeviceNotRegistered');
  } finally { globalThis.fetch = realFetch; }
});
