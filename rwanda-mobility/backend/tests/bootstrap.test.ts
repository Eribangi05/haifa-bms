import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';
import { bootstrapAdminIfMissing } from '../src/seed.ts';
import { config } from '../src/config.ts';
import { q1 } from '../src/db.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });

test('bootstrap admin is created once and never overwritten', async () => {
  const old = { ...config } as any;
  (config as any).bootstrapAdminPassword = 'a-long-test-password-1';
  (config as any).bootstrapAdminEmail = 'boot@test.local';
  try {
    const existing = await q1("select 1 from user_roles where role='super_admin' limit 1");
    const lines: string[] = [];
    const first = await bootstrapAdminIfMissing((m) => lines.push(m));
    assert.equal(first, !existing);          // creates only when no super admin exists yet
    const second = await bootstrapAdminIfMissing((m) => lines.push(m));
    assert.equal(second, false);             // a restart must never reset an admin
    if (first) assert.match(lines.join('\n'), /TOTP secret/);
  } finally { Object.assign(config, old); }
});
