import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

/** Applies numbered migrations once each. An advisory lock makes concurrent starts (two instances deploying together) safe. */
export async function migrate(log = true) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const c = await pool.connect();
  try {
    await c.query('select pg_advisory_lock(727001)');
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())');
    const done = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name));
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      try {
        await c.query('begin');
        await c.query('set local statement_timeout = 0');   // DDL on large tables may legitimately run long
        await c.query(readFileSync(join(dir, f), 'utf8'));
        await c.query('insert into schema_migrations(name) values ($1)', [f]);
        await c.query('commit');
        if (log) console.log('applied', f);
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      }
    }
  } finally {
    await c.query('select pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
