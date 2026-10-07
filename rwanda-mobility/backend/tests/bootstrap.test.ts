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

test('MFA reset: new valid 32-char secret, once per token, staff only', async () => {
  const { verifyTotp, decrypt, totpAt } = await import('../src/util/crypto.ts');
  const { resetStaffMfaIfRequested } = await import('../src/seed.ts');
  const email = (await q1<{ email: string }>("select u.email from users u join user_roles r on r.user_id=u.id where r.role='super_admin' limit 1"))?.email;
  assert.ok(email);
  const c = config as any; const old = { e: c.adminMfaResetEmail, t: c.adminMfaResetToken };
  try {
    c.adminMfaResetEmail = email; c.adminMfaResetToken = 'reset-token-' + Date.now();
    const lines: string[] = [];
    assert.equal(await resetStaffMfaIfRequested((m) => lines.push(m)), true);
    const secret = lines.join('').match(/shown once\): ([A-Z2-7]+)/)![1];
    assert.equal(secret.length, 32);
    const row = await q1<{ mfa_secret_enc: string }>('select mfa_secret_enc from users where email=$1', [email]);
    assert.equal(decrypt(row!.mfa_secret_enc), secret);
    assert.ok(verifyTotp(secret, totpAt(secret)));
    assert.equal(await resetStaffMfaIfRequested((m) => lines.push(m)), false);   // same token: no second reset
    c.adminMfaResetEmail = 'passenger@nobody.local';
    c.adminMfaResetToken = 'another-token-' + Date.now();
    assert.equal(await resetStaffMfaIfRequested(() => undefined), false);        // unknown / non-staff
  } finally { c.adminMfaResetEmail = old.e; c.adminMfaResetToken = old.t; }
});
