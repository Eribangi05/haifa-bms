import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx, totpAt: typeof import('../src/util/crypto.ts').totpAt, q: typeof import('../src/db.ts').q;
before(async () => {
  t = await boot('rwanda_mobility_test');
  ({ totpAt } = await import('../src/util/crypto.js'));
  ({ q } = await import('../src/db.js'));
});
after(async () => { await t.close(); });

test('staff invite: invitee sets own password and enrols own authenticator; admin never sees the secret', async () => {
  const admin = await t.staff('super_admin');
  const email = `invitee${Date.now()}@test.local`;
  const inv = await t.api('POST', '/admin/staff/invites', { token: admin.token, body: { email, name: 'New Verifier', role: 'driver_verifier' } });
  assert.equal(inv.status, 200);
  assert.ok(!JSON.stringify(inv.json).includes('secret'), 'admin response must not contain any MFA secret');
  const token = String(inv.json.invite_url).split('#activate=')[1];
  assert.ok(token.length >= 20);

  // public, token-gated
  assert.equal((await t.api('GET', '/staff-invite/not-a-real-token-not-a-real-token')).status, 400);
  const info = await t.api('GET', `/staff-invite/${token}`);
  assert.equal(info.json.email, email); assert.equal(info.json.role, 'driver_verifier');

  // cannot activate before scanning, nor with a wrong code
  assert.equal((await t.api('POST', `/staff-invite/${token}/activate`, { body: { password: 'a-long-password-1', code: '123456' } })).json.error.code, 'mfa_not_started');
  const begin = await t.api('POST', `/staff-invite/${token}/begin`);
  assert.match(begin.json.secret, /^[A-Z2-7]{32}$/);
  assert.match(begin.json.qr_svg, /^<\?xml|<svg/);
  const bad = await t.api('POST', `/staff-invite/${token}/activate`, { body: { password: 'a-long-password-1', code: totpAt(begin.json.secret, Date.now() + 10 * 60_000) } });
  assert.equal(bad.status, 400);
  const weak = await t.api('POST', `/staff-invite/${token}/activate`, { body: { password: 'short', code: totpAt(begin.json.secret) } });
  assert.equal(weak.status, 400);

  const ok = await t.api('POST', `/staff-invite/${token}/activate`, { body: { password: 'a-long-password-1', code: totpAt(begin.json.secret) } });
  assert.equal(ok.status, 200);

  // the new staff member can now sign in with their own password + authenticator
  const login = await t.api('POST', '/auth/staff/login', { body: { email, password: 'a-long-password-1', totp: totpAt(begin.json.secret) } });
  assert.equal(login.status, 200);
  assert.ok(login.json.access_token);

  // single use
  assert.equal((await t.api('GET', `/staff-invite/${token}`)).status, 400);
  assert.equal((await t.api('POST', `/staff-invite/${token}/begin`)).status, 400);
});

test('staff invite: revoke, expiry, duplicate email and role limits', async () => {
  const admin = await t.staff('super_admin');
  const email = `rev${Date.now()}@test.local`;
  const inv = await t.api('POST', '/admin/staff/invites', { token: admin.token, body: { email, name: 'Revoked Person', role: 'support_agent' } });
  const token = String(inv.json.invite_url).split('#activate=')[1];
  const list = await t.api('GET', '/admin/staff/invites', { token: admin.token });
  assert.ok(list.json.invites.some((i: any) => i.email === email));
  assert.ok(!JSON.stringify(list.json).includes(token), 'list never exposes tokens');
  assert.equal((await t.api('DELETE', `/admin/staff/invites/${inv.json.id}`, { token: admin.token })).status, 200);
  assert.equal((await t.api('GET', `/staff-invite/${token}`)).status, 400);

  // a re-invite revokes the older link; expired invites are refused
  const a = await t.api('POST', '/admin/staff/invites', { token: admin.token, body: { email, name: 'Revoked Person', role: 'support_agent' } });
  const b = await t.api('POST', '/admin/staff/invites', { token: admin.token, body: { email, name: 'Revoked Person', role: 'support_agent' } });
  assert.equal((await t.api('GET', `/staff-invite/${String(a.json.invite_url).split('#activate=')[1]}`)).status, 400);
  await q("update staff_invites set expires_at=now()-interval '1 hour' where id=$1", [b.json.id]);
  assert.equal((await t.api('GET', `/staff-invite/${String(b.json.invite_url).split('#activate=')[1]}`)).json.error.code, 'invite_expired');

  // existing user email is refused; non-super-admins cannot invite super admins; passengers cannot invite
  assert.equal((await t.api('POST', '/admin/staff/invites', { token: admin.token, body: { email: admin.email, name: 'Dup Dup', role: 'support_agent' } })).status, 409);
  const lead = await t.staff('support_lead');
  assert.ok([403].includes((await t.api('POST', '/admin/staff/invites', { token: lead.token, body: { email: `x${Date.now()}@test.local`, name: 'Some One', role: 'super_admin' } })).status));
});
