/**
 * Instant updates over a held HTTP request (long poll). In-process, per user: `emit` records "something changed for this user" and wakes
 * any request that is waiting; `waitFor` answers at once if a change happened after the caller's cursor, otherwise parks until one does
 * or the time is up. Nothing here is the source of truth (the apps re-read the real state), so a lost nudge only costs one normal poll.
 * Single instance only: running several API instances needs a shared bus (Postgres LISTEN/NOTIFY or Redis) behind `emit`.
 */
type Entry = { seq: number; kinds: Set<string>; at: number };
type Waiter = { since: number; done: (r: { cursor: number; events: string[] }) => void };

let seq = 0;
const last = new Map<string, Entry>();
const waiters = new Map<string, Set<Waiter>>();
const MAX_WAITERS_PER_USER = 3, KEEP_MS = 10 * 60_000;

export const cursor = () => seq;

const answer = (userId: string, since: number) => {
  const e = last.get(userId);
  return e && e.seq > since ? { cursor: seq, events: [...e.kinds] } : null;
};

/** Nudge a user. Delayed slightly so a nudge sent inside a database transaction is read after it commits. */
export function emit(userId: string | null | undefined, kind: string) {
  if (!userId) return;
  const t = setTimeout(() => {
    seq++;
    const e = last.get(userId);
    if (e && Date.now() - e.at < 2000) { e.seq = seq; e.kinds.add(kind); e.at = Date.now(); } else last.set(userId, { seq, kinds: new Set([kind]), at: Date.now() });
    const ws = waiters.get(userId);
    if (ws) for (const w of [...ws]) { const a = answer(userId, w.since); if (a) { ws.delete(w); w.done(a); } }
  }, 150);
  t.unref?.();
}

export function waitFor(userId: string, since: number, timeoutMs: number, onClose: (cb: () => void) => void): Promise<{ cursor: number; events: string[] }> {
  const now = answer(userId, since);
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    let ws = waiters.get(userId); if (!ws) waiters.set(userId, ws = new Set());
    while (ws.size >= MAX_WAITERS_PER_USER) { const old = ws.values().next().value as Waiter; ws.delete(old); old.done({ cursor: seq, events: [] }); }   // a stuck old request never starves a new one
    const w: Waiter = { since, done: (r) => { clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { ws!.delete(w); if (!ws!.size) waiters.delete(userId); resolve({ cursor: seq, events: [] }); }, timeoutMs);
    ws.add(w);
    onClose(() => { clearTimeout(timer); ws!.delete(w); if (!ws!.size) waiters.delete(userId); });
  });
}

const sweep = setInterval(() => { const cut = Date.now() - KEEP_MS; for (const [k, e] of last) if (e.at < cut) last.delete(k); }, 60_000);
sweep.unref?.();
export const _stats = () => ({ users: last.size, waiting: [...waiters.values()].reduce((n, s) => n + s.size, 0) });
