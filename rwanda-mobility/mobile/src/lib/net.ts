// Platform-agnostic API client: timeouts, retry with exponential backoff + jitter, single-flight token refresh,
// idempotency keys, and a persistent outbox for actions that must survive flaky networks and app restarts.
// No React Native imports here so it can be unit-tested in plain Node.

export type Tokens = { access_token: string; refresh_token: string };
export interface KV { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void> }
export interface TokenStore { get(): Promise<Tokens | null>; set(t: Tokens | null): Promise<void> }

export class ApiError extends Error {
  status: number; code: string; details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) { super(message); this.status = status; this.code = code; this.details = details; }
  get isNetwork() { return this.status === 0; }
  get isTimeout() { return this.code === 'timeout'; }
}

export type ClientOpts = {
  baseUrl: string; tokens: TokenStore; deviceId: string | (() => string); lang: () => string;
  fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number;
  timeoutMs?: number; maxRetries?: number; onAuthLost?: () => void;
  /** Low-data mode: when it returns true every request carries `x-lite: 1` and GETs use ETag / If-None-Match (a 304 re-uses the cached body). Read per request, so the switch applies immediately. */
  lowData?: () => boolean;
};
export type ReqOpts = { body?: unknown; idempotencyKey?: string; retry?: boolean; auth?: boolean; timeoutMs?: number; form?: FormData; maxRetries?: number };

const RETRY_STATUS = new Set([502, 503, 504]);
export const backoffMs = (attempt: number, rnd = Math.random) => Math.min(8000, 400 * 2 ** attempt) * (0.5 + rnd() / 2);

export function createClient(o: ClientOpts) {
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rnd = o.random ?? Math.random;
  const maxRetries = o.maxRetries ?? 3;
  type Refreshed = 'ok' | 'lost' | 'offline';
  let refreshing: Promise<Refreshed> | null = null;
  const etags = new Map<string, { etag: string; json: any }>();   // low-data only; bounded, dropped on sign-out
  const ETAG_MAX = 60;

  /** 'ok' = new tokens stored; 'lost' = the server rejected the refresh token (signed out); 'offline' = could not reach the server (tokens kept). */
  async function refreshOnce(): Promise<Refreshed> {
    if (refreshing) return refreshing;           // single flight: parallel 401s trigger one refresh
    refreshing = (async (): Promise<Refreshed> => {
      const t = await o.tokens.get();
      if (!t) return 'lost';
      try {
        const r = await f(o.baseUrl + '/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: t.refresh_token }) });
        if (!r.ok) { if (r.status === 401 || r.status === 403) { await o.tokens.set(null); o.onAuthLost?.(); return 'lost'; } return 'offline'; }   // 5xx: keep the session, retry later
        const j: any = await r.json();
        await o.tokens.set({ access_token: j.access_token, refresh_token: j.refresh_token });
        return 'ok';
      } catch { return 'offline'; }              // offline: keep the tokens, try again later
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  const doRefresh = async () => (await refreshOnce()) === 'ok';

  async function once(method: string, path: string, ro: ReqOpts, token: string | null): Promise<{ status: number; json: any }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ro.timeoutMs ?? o.timeoutMs ?? 12000);
    try {
      const headers: Record<string, string> = { 'accept-language': o.lang(), 'x-device-id': typeof o.deviceId === 'function' ? o.deviceId() : o.deviceId };
      if (ro.body !== undefined) headers['content-type'] = 'application/json';
      if (token) headers.authorization = 'Bearer ' + token;
      if (ro.idempotencyKey) headers['idempotency-key'] = ro.idempotencyKey;
      const lite = !!o.lowData?.();
      const ckey = lite && method === 'GET' ? (token ? token.slice(-12) : '-') + '|' + path : null;
      if (lite) headers['x-lite'] = '1';
      const cached = ckey ? etags.get(ckey) : undefined;
      if (cached) headers['if-none-match'] = cached.etag;
      const r = await f(o.baseUrl + '/api/v1' + path, { method, headers, body: ro.form ?? (ro.body !== undefined ? JSON.stringify(ro.body) : undefined), signal: ctl.signal });
      if (r.status === 304 && cached) return { status: 200, json: cached.json };
      let json: any = null;
      try { json = await r.json(); } catch { /* empty body */ }
      const tag = ckey && r.status === 200 ? (r as any).headers?.get?.('etag') : null;
      if (ckey) { if (tag) { if (etags.size >= ETAG_MAX) etags.delete(etags.keys().next().value as string); etags.set(ckey, { etag: tag, json }); } else if (r.status === 200) etags.delete(ckey); }
      return { status: r.status, json };
    } finally { clearTimeout(timer); }
  }

  async function request<T = any>(method: string, path: string, ro: ReqOpts = {}): Promise<T> {
    const safeToRetry = method === 'GET' || ro.retry === true || !!ro.idempotencyKey;
    const retries = ro.maxRetries ?? maxRetries;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let res: { status: number; json: any };
      try {
        const t = ro.auth === false ? null : (await o.tokens.get())?.access_token ?? null;
        res = await once(method, path, ro, t);
      } catch (e: any) {
        if (safeToRetry && attempt < retries) { await sleep(backoffMs(attempt, rnd)); continue; }
        throw e?.name === 'AbortError' ? new ApiError(0, 'timeout', 'Request timed out') : new ApiError(0, 'network', 'No connection', { cause: String(e?.message ?? e).slice(0, 120) });      // the platform's own wording (for example "Network request failed") travels with the error, for support and error reports
      }
      if (res.status === 401 && ro.auth !== false && !refreshed) {
        refreshed = true;
        const r = await refreshOnce();
        if (r === 'ok') continue;
        if (r === 'offline') throw new ApiError(0, 'network', 'No connection');   // not signed out: just cannot reach the server right now
        throw new ApiError(401, 'unauthorized', res.json?.error?.message ?? 'Signed out');
      }
      if (RETRY_STATUS.has(res.status) && safeToRetry && attempt < retries) { await sleep(backoffMs(attempt, rnd)); continue; }
      if (res.status >= 200 && res.status < 300) return res.json as T;
      const e = res.json?.error;
      throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, e?.details);
    }
  }
  return {
    request, refresh: doRefresh, clearCache: () => etags.clear(), get: <T = any>(p: string, ro: ReqOpts = {}) => request<T>('GET', p, ro),
    post: <T = any>(p: string, body?: unknown, ro: ReqOpts = {}) => request<T>('POST', p, { ...ro, body: body ?? (ro.form ? undefined : {}) }),
    patch: <T = any>(p: string, body?: unknown) => request<T>('PATCH', p, { body: body ?? {} }),
    del: <T = any>(p: string) => request<T>('DELETE', p),
  };
}
export type Client = ReturnType<typeof createClient>;

// ---------------- outbox ----------------
export type OutboxItem = { id: string; kind: string; path: string; body: unknown; key: string; createdAt: number; attempts: number; error?: string; treatConflictAsDone?: boolean };
const OUTBOX_KEY = 'rm_outbox_v1';

export function createOutbox(kv: KV, client: Client, now: () => number = Date.now) {
  let flushing: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const load = async (): Promise<OutboxItem[]> => { try { return JSON.parse((await kv.get(OUTBOX_KEY)) ?? '[]'); } catch { return []; } };
  // Every read-modify-write goes through one queue, so an enqueue that lands while a flush is awaiting the network can never be overwritten by the flush.
  let chain: Promise<unknown> = Promise.resolve();
  const mutate = <T,>(fn: (items: OutboxItem[]) => T | Promise<T>): Promise<T> => {
    const run = chain.then(async () => { const items = await load(); const out = await fn(items); await kv.set(OUTBOX_KEY, JSON.stringify(items)); listeners.forEach((l) => l()); return out; });
    chain = run.catch(() => undefined); return run;
  };

  async function enqueue(item: Omit<OutboxItem, 'createdAt' | 'attempts'>) {
    await mutate((items) => { if (!items.some((i) => i.id === item.id)) items.push({ ...item, createdAt: now(), attempts: 0 }); });   // enqueue is idempotent
  }
  const drop = (id: string) => mutate((items) => { const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1); });
  /** Sends queued items in order. Network failure, 5xx and 401 (signed out) keep them; any other definitive server answer (2xx, 4xx) removes them. Items queued while flushing are picked up in the same run. */
  function flush(onResult?: (item: OutboxItem, result: { ok: boolean; data?: any; error?: ApiError }) => void): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      const tried = new Set<string>();
      for (;;) {
        const it = (await load()).find((x) => !tried.has(x.id)); if (!it) break;
        tried.add(it.id);
        try {
          const data = await client.request('POST', it.path, { body: it.body, idempotencyKey: it.key });
          await drop(it.id); onResult?.(it, { ok: true, data });
        } catch (e: any) {
          const err = e as ApiError;
          if (err.isNetwork || err.status >= 500 || err.status === 401) { await mutate((items) => { const x = items.find((y) => y.id === it.id); if (x) { x.attempts++; x.error = err.message; } }); break; }          // stop; retry later, keep order
          const done = !!it.treatConflictAsDone && err.status === 409;
          await drop(it.id); onResult?.(it, { ok: done, error: err });
        }
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }
  return { enqueue, flush, list: load, onChange: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); }, remove: drop, clear: () => mutate((items) => { items.length = 0; }) };
}
export type Outbox = ReturnType<typeof createOutbox>;

export function uuid(): string {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);   // idempotency keys need uniqueness, not secrecy
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
