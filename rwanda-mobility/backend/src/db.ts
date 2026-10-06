import pg from 'pg';
import { config } from './config.js';

// BIGINT (ledger sums) -> number. Safe: RWF amounts stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export let pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export function useDatabase(url: string) {
  pool = new pg.Pool({ connectionString: url, max: 20 });
  return pool;
}

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
