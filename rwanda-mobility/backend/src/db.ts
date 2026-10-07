import pg from 'pg';
import { config } from './config.js';

// BIGINT (ledger sums) -> number. Safe: RWF amounts stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

/**
 * Pool limits: a bounded wait for a free connection (fail fast instead of piling up requests), a server-side statement timeout so one slow
 * query cannot hold a connection forever, and an idle-in-transaction timeout so a crashed handler cannot hold row locks.
 * All three can be tuned per deployment; migrations disable the statement timeout for themselves.
 */
const POOL_MAX = Math.max(16, Number(process.env.DB_POOL_MAX ?? 20));   // never below 16: each of the 8 background jobs briefly holds one connection for its cluster-wide lock
const poolOpts = (url: string): pg.PoolConfig => ({
  connectionString: url,
  max: POOL_MAX,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 5000),
  idleTimeoutMillis: 30_000,
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000),
  idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TX_TIMEOUT_MS ?? 30_000),
  application_name: 'abasare-api',
});

/** An idle client that loses its connection (DB restart, failover) emits 'error' on the pool; unhandled, that would crash the process. */
function makePool(url: string) {
  const p = new pg.Pool(poolOpts(url));
  p.on('error', (e) => { if (process.env.QUIET !== '1') console.error('[db] idle client error:', e.message); });
  return p;
}

export const pool = makePool(config.databaseUrl);

/** Pool saturation, for the system-health endpoint. */
export const poolStats = () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: POOL_MAX });

export type Db = Pick<pg.PoolClient, 'query'>;

export async function q<T = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(text, params as any[]);
  return r.rows as T[];
}
export async function q1<T = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  return (await q<T>(text, params, db))[0];
}

/** Run fn in a transaction. Serialization/deadlock errors are retried. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e: any) {
      await c.query('rollback').catch(() => {});
      if ((e.code === '40001' || e.code === '40P01') && attempt < retries) continue;
      throw e;
    } finally {
      c.release();
    }
  }
}
