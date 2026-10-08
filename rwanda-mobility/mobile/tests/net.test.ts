import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createOutbox, ApiError, backoffMs, uuid, type KV, type Tokens } from '../src/lib/net.ts';

const mem = (): KV & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), del: async (k) => void data.delete(k) }; };
const tokenStore = (t: Tokens | null) => { let cur = t; return { get: async () => cur, set: async (n: Tokens | null) => { cur = n; }, peek: () => cur }; };
const res = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
const mk = (fetchImpl: any, ts = tokenStore({ access_token: 'a1', refresh_token: 'r1' }), extra = {}) =>
  ({ ts, c: createClient({ baseUrl: 'http://x', tokens: ts, deviceId: 'd', lang: () => 'rw', fetchImpl, sleep: async () => {}, random: () => 0.5, ...extra }) });

test('GET retries on network errors and 503 with backoff, then succeeds', async () => {
  let n = 0; const sleeps: number[] = [];
  const { c } = mk(async () => { n++; if (n === 1) throw new TypeError('network'); if (n === 2) return res(503, {}); return res(200, { ok: 1 }); }, undefined, { sleep: async (ms: number) => void sleeps.push(ms) });
  assert.deepEqual(await c.get('/x'), { ok: 1 });
  assert.equal(n, 3); assert.equal(sleeps.length, 2); assert.ok(sleeps[1] > sleeps[0], 'exponential');
});

test('POST without an idempotency key is never retried (no accidental duplicates)', async () => {
  let n = 0; const { c } = mk(async () => { n++; throw new TypeError('network'); });
  await assert.rejects(() => c.post('/bookings', {}), (e: any) => e instanceof ApiError && e.isNetwork);
  assert.equal(n, 1);
});

test('POST with an idempotency key is retried and carries the same key every time', async () => {
  const keys: string[] = []; let n = 0;
  const { c } = mk(async (_u: string, init: any) => { keys.push(init.headers['idempotency-key']); if (++n < 3) throw new TypeError('network'); return res(201, { id: 'b1' }); });
  assert.deepEqual(await c.post('/bookings', { q: 1 }, { idempotencyKey: 'key-123456' }), { id: 'b1' });
  assert.deepEqual(keys, ['key-123456', 'key-123456', 'key-123456']);
});

test('4xx errors are not retried and expose code, message and details', async () => {
  let n = 0; const { c } = mk(async () => { n++; return res(409, { error: { code: 'quote_expired', message: 'Fare expired', details: { x: 1 } } }); });
  await assert.rejects(() => c.get('/x'), (e: any) => e.status === 409 && e.code === 'quote_expired' && e.message === 'Fare expired');
  assert.equal(n, 1);
});

test('401 triggers exactly one refresh even for parallel requests, then replays with the new token', async () => {
  let refreshCalls = 0; const seen: string[] = [];
  const f = async (url: string, init: any) => {
    if (url.endsWith('/auth/refresh')) { refreshCalls++; return res(200, { access_token: 'a2', refresh_token: 'r2' }); }
    seen.push(init.headers.authorization);
    return init.headers.authorization === 'Bearer a2' ? res(200, { ok: true }) : res(401, { error: { code: 'unauthorized', message: 'expired' } });
  };
  const { c, ts } = mk(f);
  const out = await Promise.all([c.get('/a'), c.get('/b'), c.get('/c')]);
  assert.equal(out.length, 3); assert.equal(refreshCalls, 1);
  assert.equal(ts.peek()!.refresh_token, 'r2');
});

test('refresh rejected by the server signs the user out; refresh failing offline keeps the session', async () => {
  let lost = 0;
  const bad = async (url: string) => url.endsWith('/auth/refresh') ? res(401, {}) : res(401, {});
  const a = mk(bad, undefined, { onAuthLost: () => lost++ });
  await assert.rejects(() => a.c.get('/x'), (e: any) => e.status === 401);
  assert.equal(lost, 1); assert.equal(a.ts.peek(), null);
  const offline = async (url: string) => { if (url.endsWith('/auth/refresh')) throw new TypeError('offline'); return res(401, {}); };
  const b = mk(offline, undefined, { onAuthLost: () => lost++ });
  await assert.rejects(() => b.c.get('/x'));
  assert.equal(lost, 1, 'offline refresh must not log the user out'); assert.ok(b.ts.peek());
});

test('timeouts surface as a network error', async () => {
  const f = (_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  const { c } = mk(f, undefined, { timeoutMs: 20, maxRetries: 0 });
  await assert.rejects(() => c.get('/slow'), (e: any) => e.isNetwork && /timed out/.test(e.message));
});

test('outbox: items survive restarts, keep order when offline, flush when back, and never duplicate', async () => {
  const kv = mem(); let online = false; const sent: string[] = [];
  const f = async (_u: string, init: any) => { if (!online) throw new TypeError('offline'); sent.push(init.headers['idempotency-key']); return res(200, { ok: true }); };
  const { c } = mk(f, undefined, { maxRetries: 0 });
  const box = createOutbox(kv, c);
  await box.enqueue({ id: 'rate-1', kind: 'rating', path: '/bookings/1/ratings', body: { score: 5 }, key: 'k-rate-1111' });
  await box.enqueue({ id: 'rate-1', kind: 'rating', path: '/bookings/1/ratings', body: { score: 5 }, key: 'k-rate-1111' });   // duplicate enqueue ignored
  await box.enqueue({ id: 'msg-1', kind: 'msg', path: '/support/cases/1/messages', body: { body: 'hi' }, key: 'k-msg-11111' });
  await box.flush(); assert.equal((await box.list()).length, 2, 'offline: kept');
  const restarted = createOutbox(kv, c);                                  // new process, same storage
  assert.equal((await restarted.list()).length, 2);
  online = true; await Promise.all([restarted.flush(), restarted.flush()]);   // concurrent flushes are single-flight
  assert.deepEqual(sent, ['k-rate-1111', 'k-msg-11111']); assert.equal((await restarted.list()).length, 0);
});

test('outbox: a definitive server rejection drops the item (no infinite retry); conflicts can count as done', async () => {
  const kv = mem(); const results: any[] = [];
  const f = async (u: string) => u.includes('dup') ? res(409, { error: { code: 'already_rated', message: 'x' } }) : res(400, { error: { code: 'validation_error', message: 'bad' } });
  const { c } = mk(f, undefined, { maxRetries: 0 }); const box = createOutbox(kv, c);
  await box.enqueue({ id: '1', kind: 'rating', path: '/dup', body: {}, key: 'k-1-111111', treatConflictAsDone: true });
  await box.enqueue({ id: '2', kind: 'rating', path: '/bad', body: {}, key: 'k-2-111111' });
  await box.flush((i, r) => results.push([i.id, r.ok]));
  assert.deepEqual(results, [['1', true], ['2', false]]); assert.equal((await box.list()).length, 0);
});

test('uuid and backoff helpers', () => {
  assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(uuid(), uuid());
  assert.ok(backoffMs(0, () => 0.5) < backoffMs(3, () => 0.5)); assert.ok(backoffMs(20, () => 1) <= 8000);
});

test('timeouts carry the timeout code; refresh failing offline surfaces as a network error, not "signed out"', async () => {
  const f = (_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  const { c } = mk(f, undefined, { timeoutMs: 20, maxRetries: 0 });
  await assert.rejects(() => c.get('/slow'), (e: any) => e.isTimeout && e.isNetwork);
  const offline = async (url: string) => { if (url.endsWith('/auth/refresh')) throw new TypeError('offline'); return res(401, {}); };
  const b = mk(offline);
  await assert.rejects(() => b.c.get('/x'), (e: any) => e.isNetwork && e.status === 0);
});

test('per-request maxRetries overrides the client default', async () => {
  let n = 0; const { c } = mk(async () => { n++; throw new TypeError('x'); });
  await assert.rejects(() => c.get('/x', { maxRetries: 0 })); assert.equal(n, 1);
});

test('outbox: an item enqueued while a flush is waiting on the network is not lost', async () => {
  const kv = mem(); let release!: () => void; const gate = new Promise<void>((r) => { release = r; }); const sent: string[] = [];
  const f = async (_u: string, init: any) => { sent.push(init.headers['idempotency-key']); if (sent.length === 1) await gate; return res(200, { ok: true }); };
  const { c } = mk(f, undefined, { maxRetries: 0 }); const box = createOutbox(kv, c);
  await box.enqueue({ id: 'a', kind: 'x', path: '/a', body: {}, key: 'key-aaaaaaaa' });
  const fl = box.flush();
  await new Promise((r) => setTimeout(r, 10));
  await box.enqueue({ id: 'b', kind: 'x', path: '/b', body: {}, key: 'key-bbbbbbbb' });   // lands mid-flush
  release(); await fl;
  assert.deepEqual(sent, ['key-aaaaaaaa', 'key-bbbbbbbb']); assert.equal((await box.list()).length, 0);
});

test('outbox: 401 keeps the item (user is signed out, not rejected); clear() empties the queue', async () => {
  const kv = mem(); const { c } = mk(async (u: string) => (u.endsWith('/auth/refresh') ? res(401, {}) : res(401, {})), undefined, { maxRetries: 0 }); const box = createOutbox(kv, c);
  await box.enqueue({ id: 'a', kind: 'x', path: '/a', body: {}, key: 'key-aaaaaaaa' }); await box.flush();
  assert.equal((await box.list()).length, 1); await box.clear(); assert.equal((await box.list()).length, 0);
});
