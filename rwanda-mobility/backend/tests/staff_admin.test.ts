import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { boot, type Ctx } from './helpers.ts';

// (src modules are imported after boot(): config reads the environment when first imported)
let t: Ctx, q: typeof import('../src/db.ts').q, q1: typeof import('../src/db.ts').q1, tx: typeof import('../src/db.ts').tx, assertNotLastSuperAdmin: typeof import('../src/services/staffAdmin.ts').assertNotLastSuperAdmin, totpAt: (s: string, t?: number) => string;
before(async () => {
  t = await boot('rwanda_mobility_test');
  ({ q, q1, tx } = await import('../src/db.ts')); ({ assertNotLastSuperAdmin } = await import('../src/services/staffAdmin.ts')); ({ totpAt } = await import('../src/util/crypto.ts'));
});
after(async () => { await t.close(); });

const PW = 'CorrectHorse-Battery-9';
type S = Awaited<ReturnType<Ctx['staff']>>;
const mail = (p = 'p') => `${p}-${randomUUID().slice(0, 8)}@test.local`;
const login = (s: { email: string; password: string; totpSecret: string }, pw = s.password, secret = s.totpSecret) =>
  t.api('POST', '/auth/staff/login', { body: { email: s.email, password: pw, totp: totpAt(secret) } });
const get = (s: S, path: string) => t.api('GET', path, { token: s.token });
const post = (s: S, path: string, body?: any) => t.api('POST', path, { token: s.token, body: body ?? {} });
const patch = (s: S, path: string, body: any) => t.api('PATCH', path, { token: s.token, body });
const audits = (action: string, entityId: string) => q<any>('select * from audit_logs where action=$1 and entity_id=$2 order by id', [action, entityId]);
/** A user-manager who is NOT a super admin: custom role holding users.manage plus the support agent's permissions. */
async function makeHr(sa: S, name = 'hr_' + randomUUID().slice(0, 6)) {
  const r = await t.api('POST', '/admin/roles', { token: sa.token, body: { name, label: 'HR', permissions: ['users.manage', 'bookings.view_all', 'support.handle', 'drivers.view', 'users.view', 'wallet.view', 'claims.view', 'claims.handle', 'analytics.view', 'diagnostics.view', 'codes.view', 'ussd.view'] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { role: name, user: await t.staff(name) };
}

test('list: search, role and status filters; removed people are hidden by default; last login and sessions shown', async () => {
  const sa = await t.staff('super_admin');
  const a = await t.staff('support_agent'); const d = await t.staff('dispatcher');
  const all = await get(sa, '/admin/staff');
  assert.equal(all.status, 200);
  const row = all.json.staff.find((s: any) => s.id === a.id);
  assert.ok(row && row.roles.includes('support_agent') && row.status === 'active');
  assert.ok(row.last_login_at, 'last login is shown'); assert.ok(row.active_sessions >= 1);
  assert.ok(Array.isArray(all.json.roles) && all.json.roles.some((r: any) => r.name === 'dispatcher' && Array.isArray(r.permissions)));
  assert.ok(!JSON.stringify(all.json).includes('password_hash'));
  const byRole = await get(sa, '/admin/staff?role=dispatcher');
  assert.ok(byRole.json.staff.every((s: any) => s.roles.includes('dispatcher')) && byRole.json.staff.some((s: any) => s.id === d.id));
  const byQ = await get(sa, `/admin/staff?q=${encodeURIComponent(a.email.slice(0, 12))}`);
  assert.ok(byQ.json.staff.some((s: any) => s.id === a.id));
  // disable d -> status filter
  assert.equal((await post(sa, `/admin/staff/${d.id}/status`, { status: 'disabled', reason: 'testing filter' })).status, 200);
  assert.ok((await get(sa, '/admin/staff?status=disabled')).json.staff.some((s: any) => s.id === d.id && s.status === 'disabled'));
  assert.ok(!(await get(sa, '/admin/staff?status=active')).json.staff.some((s: any) => s.id === d.id));
  // remove a -> hidden by default, visible under Removed
  assert.equal((await post(sa, `/admin/staff/${a.id}/remove`, { reason: 'left the company' })).status, 200);
  assert.ok(!(await get(sa, '/admin/staff')).json.staff.some((s: any) => s.id === a.id), 'hidden by default');
  const rem = await get(sa, '/admin/staff?status=removed');
  assert.ok(rem.json.staff.some((s: any) => s.id === a.id && s.status === 'removed'));
  // filters need the permission
  assert.equal((await get(await t.staff('finance_officer'), '/admin/staff')).status, 403);
});

test('edit: name, email, roles (several at once); reason mandatory; sessions revoked; audited; duplicate email refused', async () => {
  const sa = await t.staff('super_admin');
  const p = await t.staff('support_agent');
  const other = await t.staff('analyst');
  // name only: no reason needed, sessions kept
  assert.equal((await patch(sa, `/admin/staff/${p.id}`, { display_name: 'Renamed Person' })).status, 200);
  assert.equal((await get(p, '/admin/support/cases')).status, 200, 'still signed in after a rename');
  // email: reason mandatory, unique, revokes sessions, audit written without the full address
  assert.equal((await patch(sa, `/admin/staff/${p.id}`, { email: mail() })).json.error.code, 'reason_required');
  assert.equal((await patch(sa, `/admin/staff/${p.id}`, { email: other.email, reason: 'typo fix please' })).status, 409);
  const ne = mail('new');
  assert.equal((await patch(sa, `/admin/staff/${p.id}`, { email: ne.toUpperCase(), reason: 'name change after marriage' })).status, 200);
  assert.equal((await get(p, '/admin/support/cases')).status, 401, 'sessions revoked after an email change');
  assert.equal((await q1<any>('select email from users where id=$1', [p.id]))!.email, ne);
  assert.equal((await login({ email: ne, password: PW, totpSecret: p.totpSecret })).status, 200, 'signs in with the new email');
  const ea = await audits('staff.email_changed', p.id); assert.equal(ea.length, 1);
  assert.ok(!JSON.stringify(ea[0]).includes(ne), 'full address is not written to the audit log'); assert.match(ea[0].after.reason, /marriage/);
  // roles: several at once, takes effect, sessions revoked
  const p2 = await t.staff('support_agent');
  const r = await patch(sa, `/admin/staff/${p2.id}`, { roles: ['support_agent', 'dispatcher'], reason: 'covering dispatch' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await get(p2, '/admin/live')).status, 401, 'old session revoked');
  const l = await login(p2); assert.equal(l.status, 200);
  assert.deepEqual([...l.json.roles].sort(), ['dispatcher', 'support_agent']);
  assert.ok(l.json.permissions.includes('bookings.dispatch') && l.json.permissions.includes('support.handle'));
  assert.equal((await t.api('GET', '/admin/live', { token: l.json.access_token })).status, 200);
  assert.equal((await audits('staff.roles_changed', p2.id)).length, 1);
  // unknown / non-staff / empty / partner roles refused
  assert.equal((await patch(sa, `/admin/staff/${p2.id}`, { roles: ['no_such_role'], reason: 'testing unknown' })).json.error.code, 'unknown_role');
  assert.equal((await patch(sa, `/admin/staff/${p2.id}`, { roles: ['passenger'], reason: 'testing passenger' })).status, 400);
  assert.equal((await patch(sa, `/admin/staff/${p2.id}`, { roles: [], reason: 'testing empty' })).status, 400);
  assert.equal((await patch(sa, `/admin/staff/${p2.id}`, { roles: ['partner_manager'], reason: 'testing partner' })).status, 400);
  // unknown person
  assert.equal((await patch(sa, `/admin/staff/${randomUUID()}`, { display_name: 'Nobody' })).status, 404);
  assert.equal((await patch(sa, `/admin/staff/${(await t.register()).id}`, { display_name: 'A passenger' })).status, 404, 'a passenger is not staff');
});

test('a role change applies immediately to a token already in use (permissions re-read on every request)', async () => {
  const sa = await t.staff('super_admin');
  const p = await t.staff('support_agent');
  assert.equal((await get(p, '/admin/support/cases')).status, 200);
  // change the role directly in the database WITHOUT revoking sessions: the live token must lose access at once
  await q("delete from user_roles where user_id=$1 and role='support_agent'", [p.id]); await q("insert into user_roles values ($1,'analyst')", [p.id]);
  assert.equal((await get(p, '/admin/support/cases')).status, 403);
  assert.equal((await get(p, '/admin/analytics')).status, 200);
});

test('self-protection: nobody changes their own roles, status or email, removes, resets or anonymises themselves', async () => {
  const sa = await t.staff('super_admin');
  const me = sa.id;
  assert.equal((await patch(sa, `/admin/staff/${me}`, { roles: ['analyst'], reason: 'demote myself' })).status, 403);
  assert.equal((await patch(sa, `/admin/staff/${me}`, { email: mail(), reason: 'change my email' })).status, 403);
  assert.equal((await post(sa, `/admin/staff/${me}/status`, { status: 'disabled', reason: 'disable myself' })).status, 403);
  assert.equal((await post(sa, `/admin/staff/${me}/remove`, { reason: 'remove myself' })).status, 403);
  assert.equal((await post(sa, `/admin/staff/${me}/reset`, { kind: 'password', reason: 'reset myself' })).status, 403);
  assert.equal((await post(sa, `/admin/staff/${me}/anonymise`, { reason: 'anonymise myself' })).status, 403);
  assert.equal((await patch(sa, `/admin/staff/${me}`, { display_name: 'My New Name' })).status, 200, 'own display name is fine');
  assert.equal((await q1<any>('select status from users where id=$1', [me]))!.status, 'active');
});

test('last active super admin can never be removed, disabled or demoted (also under a race)', async () => {
  const a = await t.staff('super_admin'), b = await t.staff('super_admin');
  // unit: with only `a` left active, `a` is protected; with `b` active too, it is not
  await q("update users set status='deactivated' where status='active' and id <> all($1) and id in (select user_id from user_roles where role='super_admin')", [[a.id, b.id]]);
  await tx(async (c) => { await assertNotLastSuperAdmin(c, a.id); });   // b is active: fine
  await q("update users set status='deactivated' where id=$1", [b.id]);
  await assert.rejects(tx(async (c) => { await assertNotLastSuperAdmin(c, a.id); }), (e: any) => e.code === 'last_super_admin');
  await q("update users set status='active' where id=$1", [b.id]);
  // race: each tries to remove the other; exactly one succeeds and one super admin always remains
  const [r1, r2] = await Promise.all([post(a, `/admin/staff/${b.id}/remove`, { reason: 'mutual removal one' }), post(b, `/admin/staff/${a.id}/remove`, { reason: 'mutual removal two' })]);
  const codes = [r1.status, r2.status].sort();
  assert.ok(codes[0] === 200 && codes[1] !== 200, `one removal wins, the other is refused: ${codes}`);
  const left = await q<any>("select u.id from users u join user_roles r on r.user_id=u.id and r.role='super_admin' where u.status='active' and u.id = any($1)", [[a.id, b.id]]);
  assert.equal(left.length, 1, 'one of the two is still an active super admin');
  const loser = [r1, r2].find((r) => r.status !== 200)!;
  assert.ok([409, 401].includes(loser.status), JSON.stringify(loser.json));
  // demotion and disabling are protected by the same lock
  const c2 = await t.staff('super_admin'); const d2 = await t.staff('super_admin');
  await q("update users set status='deactivated' where status='active' and id <> all($1) and id in (select user_id from user_roles where role='super_admin')", [[c2.id, d2.id]]);
  const res = await Promise.all([post(c2, `/admin/staff/${d2.id}/status`, { status: 'disabled', reason: 'race disable one' }), patch(d2, `/admin/staff/${c2.id}`, { roles: ['analyst'], reason: 'race demote two' })]);
  assert.equal(res.filter((r) => r.status === 200).length, 1, JSON.stringify(res.map((r) => r.json)));
  assert.equal((await q1<any>("select count(*)::int n from users u join user_roles r on r.user_id=u.id and r.role='super_admin' where u.status='active'"))!.n >= 1, true);
});

test('only a super admin can create, edit, disable, remove or reset a super admin, or edit built-in roles; others cannot hand out more than they hold', async () => {
  const sa = await t.staff('super_admin'); const other = await t.staff('super_admin');
  const { user: hr } = await makeHr(sa);
  const agent = await t.staff('support_agent');
  assert.equal((await post(hr, '/admin/staff/invites', { email: mail(), name: 'Wannabe Super', role: 'super_admin' })).status, 403);
  assert.equal((await patch(hr, `/admin/staff/${other.id}`, { display_name: 'Hijacked Name' })).status, 403);
  assert.equal((await post(hr, `/admin/staff/${other.id}/status`, { status: 'disabled', reason: 'try to disable' })).status, 403);
  assert.equal((await post(hr, `/admin/staff/${other.id}/remove`, { reason: 'try to remove them' })).status, 403);
  assert.equal((await post(hr, `/admin/staff/${other.id}/reset`, { kind: 'full', reason: 'try to reset them' })).status, 403);
  assert.equal((await post(hr, `/admin/staff/${other.id}/sessions/revoke`)).status, 403);
  assert.equal((await get(hr, `/admin/staff/${other.id}/activity`)).status, 200, 'reading activity is allowed');
  assert.equal((await patch(hr, '/admin/roles/dispatcher', { permissions: ['bookings.view_all'], reason: 'try built-in edit' })).status, 403, 'hr has no roles.manage');
  // within their own reach they can work: an agent may get a role no wider than the HR role itself
  assert.equal((await patch(hr, `/admin/staff/${agent.id}`, { roles: ['support_agent', 'analyst'], reason: 'extra duty' })).status, 200);
  // ... but not roles that exceed it
  assert.equal((await patch(hr, `/admin/staff/${agent.id}`, { roles: ['support_agent', 'finance_approver'], reason: 'escalate please' })).status, 403);
  assert.equal((await post(hr, '/admin/staff/invites', { email: mail(), name: 'Finance Person', role: 'finance_officer' })).status, 403);
  assert.equal((await post(hr, '/admin/staff/invites', { email: mail(), name: 'Analyst Person', role: 'analyst' })).status, 200);
  // and they cannot manage someone wider than themselves
  const fo = await t.staff('finance_officer');
  assert.equal((await post(hr, `/admin/staff/${fo.id}/remove`, { reason: 'try to remove finance' })).status, 403);
});

test('remove: soft delete revokes sessions and credentials, frees the email, keeps the audit history; restore filter; anonymise on request', async () => {
  const sa = await t.staff('super_admin');
  const v = await t.staff('support_lead');
  // the person does something that is audited
  await post(v, '/admin/support/cases/' + randomUUID() + '/update', { status: 'closed' });
  await t.api('GET', '/admin/users?q=zzzzz', { token: v.token });
  const before = (await q<any>('select count(*)::int n from audit_logs where actor_id=$1', [v.id]))[0].n; assert.ok(before >= 1);
  assert.equal((await post(sa, `/admin/staff/${v.id}/remove`, {})).status, 400, 'reason is mandatory');
  assert.equal((await post(sa, `/admin/staff/${v.id}/remove`, { reason: 'ok' })).status, 400, 'reason must be meaningful');
  const rm = await post(sa, `/admin/staff/${v.id}/remove`, { reason: 'left the company in May' });
  assert.equal(rm.status, 200);
  const u = await q1<any>('select status, email, password_hash, mfa_secret_enc, mfa_enabled, removed_at from users where id=$1', [v.id]);
  assert.equal(u.status, 'removed'); assert.equal(u.password_hash, null); assert.equal(u.mfa_secret_enc, null); assert.equal(u.mfa_enabled, false); assert.ok(u.removed_at);
  assert.match(u.email, /#removed-/); assert.ok(u.email.startsWith(v.email));
  assert.equal((await get(v, '/admin/users?q=abcdef')).status, 401, 'token dead');
  assert.equal((await login(v)).status, 401, 'cannot sign in');
  assert.equal((await q1<any>('select count(*)::int n from sessions where user_id=$1 and revoked_at is null', [v.id]))!.n, 0);
  // audit history preserved and the removal itself recorded
  assert.equal((await q<any>('select count(*)::int n from audit_logs where actor_id=$1', [v.id]))[0].n >= before, true);
  const ra = await audits('staff.removed', v.id); assert.equal(ra.length, 1); assert.match(ra[0].after.reason, /May/);
  // email is free again: the same person can be invited
  const inv = await post(sa, '/admin/staff/invites', { email: v.email, name: 'Returning Person', role: 'support_agent' });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  // removed accounts cannot be edited, enabled or reset
  assert.equal((await patch(sa, `/admin/staff/${v.id}`, { display_name: 'Ghost Edit' })).status, 409);
  assert.equal((await post(sa, `/admin/staff/${v.id}/status`, { status: 'active', reason: 'try to revive' })).status, 409);
  assert.equal((await post(sa, `/admin/staff/${v.id}/reset`, { kind: 'password', reason: 'reset a removed one' })).status, 409);
  assert.equal((await post(sa, `/admin/staff/${v.id}/remove`, { reason: 'remove them twice' })).status, 409);
  assert.equal((await post(sa, `/admin/users/${v.id}/status`, { status: 'active', reason: 'sneak through users api' })).status, 409, 'the customer status endpoint cannot revive a removed account');
  // listing
  assert.ok(!(await get(sa, '/admin/staff')).json.staff.some((s: any) => s.id === v.id));
  assert.ok((await get(sa, '/admin/staff?status=removed')).json.staff.some((s: any) => s.id === v.id));
  // anonymise: only for removed people, scrubs personal fields, keeps audit rows
  const w = await t.staff('analyst');
  assert.equal((await post(sa, `/admin/staff/${w.id}/anonymise`, { reason: 'not removed yet' })).status, 409);
  const rows0 = (await q<any>('select count(*)::int n from audit_logs where actor_id=$1 or entity_id=$2', [v.id, v.id]))[0].n;
  assert.equal((await post(sa, `/admin/staff/${v.id}/anonymise`, { reason: 'GDPR style erasure request' })).status, 200);
  const an = await q1<any>('select display_name, email, phone, anonymised_at from users where id=$1', [v.id]);
  assert.equal(an.display_name, 'Former staff member'); assert.ok(an.email.endsWith('@removed.invalid')); assert.ok(!an.email.includes(v.email.split('@')[0]) || an.email.startsWith('anonymised-')); assert.ok(an.anonymised_at);
  assert.ok((await q<any>('select count(*)::int n from audit_logs where actor_id=$1 or entity_id=$2', [v.id, v.id]))[0].n >= rows0, 'audit rows kept');
  assert.equal((await post(sa, `/admin/staff/${v.id}/anonymise`, { reason: 'twice is not possible' })).status, 409);
  assert.ok(JSON.stringify((await get(sa, '/admin/staff?status=removed')).json).includes('Former staff member'));
});

test('disable and enable: disabled staff cannot sign in and lose their sessions at once', async () => {
  const sa = await t.staff('super_admin'); const p = await t.staff('dispatcher');
  assert.equal((await post(sa, `/admin/staff/${p.id}/status`, { status: 'disabled' })).status, 400, 'reason mandatory');
  assert.equal((await post(sa, `/admin/staff/${p.id}/status`, { status: 'disabled', reason: 'investigation ongoing' })).status, 200);
  assert.equal((await get(p, '/admin/live')).status, 401);
  assert.equal((await login(p)).status, 401);
  assert.equal((await post(sa, `/admin/staff/${p.id}/status`, { status: 'disabled', reason: 'again for no reason' })).status, 409);
  assert.equal((await post(sa, `/admin/staff/${p.id}/status`, { status: 'active', reason: 'cleared after review' })).status, 200);
  assert.equal((await login(p)).status, 200);
  assert.equal((await audits('staff.disabled', p.id)).length, 1); assert.equal((await audits('staff.enabled', p.id)).length, 1);
});

test('password reset link: single use, never contains a secret, needs the current authenticator code, signs everyone out', async () => {
  const sa = await t.staff('super_admin'); const p = await t.staff('support_agent');
  assert.equal((await post(sa, `/admin/staff/${p.id}/reset`, { kind: 'password' })).status, 400, 'reason mandatory');
  const r = await post(sa, `/admin/staff/${p.id}/reset`, { kind: 'password', reason: 'forgot the password' });
  assert.equal(r.status, 200);
  const blob = JSON.stringify(r.json).toLowerCase();
  for (const bad of ['secret', 'otpauth', 'qr_svg', 'totp', 'password_hash', p.totpSecret.toLowerCase()]) assert.ok(!blob.includes(bad), `admin response must not contain ${bad}`);
  const token = String(r.json.reset_url).split('#activate=')[1];
  const info = await t.api('GET', `/staff-invite/${token}`); assert.equal(info.json.purpose, 'password_reset'); assert.equal(info.json.email, p.email);
  assert.equal((await t.api('POST', `/staff-invite/${token}/begin`)).status, 400, 'no new authenticator for a password reset');
  const bad = await t.api('POST', `/staff-invite/${token}/activate`, { body: { password: 'A-brand-new-password-1', code: '000000' } });
  assert.equal(bad.status, 400);
  assert.equal((await t.api('POST', `/staff-invite/${token}/activate`, { body: { password: 'short', code: totpAt(p.totpSecret) } })).status, 400);
  assert.equal((await login(p)).status, 200, 'old password still works until the link is used');
  const ok = await t.api('POST', `/staff-invite/${token}/activate`, { body: { password: 'A-brand-new-password-1', code: totpAt(p.totpSecret) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await get(p, '/admin/support/cases')).status, 401, 'old sessions revoked');
  assert.equal((await login(p)).status, 401, 'old password no longer works');
  assert.equal((await login(p, 'A-brand-new-password-1')).status, 200);
  assert.equal((await t.api('GET', `/staff-invite/${token}`)).status, 400, 'single use');
  // a newer link revokes the older one
  const r1 = await post(sa, `/admin/staff/${p.id}/reset`, { kind: 'password', reason: 'second request one' });
  const r2 = await post(sa, `/admin/staff/${p.id}/reset`, { kind: 'password', reason: 'second request two' });
  assert.equal((await t.api('GET', `/staff-invite/${String(r1.json.reset_url).split('#activate=')[1]}`)).status, 400);
  assert.equal((await t.api('GET', `/staff-invite/${String(r2.json.reset_url).split('#activate=')[1]}`)).status, 200);
  assert.equal((await audits('staff.reset_issued', p.id)).length >= 3, true);
  // wrong codes count against the sign-in lock-out
  const t2 = String(r2.json.reset_url).split('#activate=')[1];
  for (let i = 0; i < 5; i++) await t.api('POST', `/staff-invite/${t2}/activate`, { body: { password: 'Another-new-password-2', code: '111111' } });
  assert.equal((await t.api('POST', `/staff-invite/${t2}/activate`, { body: { password: 'Another-new-password-2', code: totpAt(p.totpSecret) } })).status, 423);
});

test('two-factor reset: new authenticator is created by the person, shown only to them; old authenticator stops working; current password required', async () => {
  const sa = await t.staff('super_admin'); const p = await t.staff('driver_verifier');
  const r = await post(sa, `/admin/staff/${p.id}/reset`, { kind: 'two_factor', reason: 'phone was stolen' });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.json).toLowerCase().match(/secret|otpauth|qr_svg/), 'admin never sees the new authenticator key');
  assert.equal((await get(p, '/admin/drivers')).status, 401, 'open sessions closed at once (stolen phone)');
  const token = String(r.json.reset_url).split('#activate=')[1];
  assert.equal((await t.api('GET', `/staff-invite/${token}`)).json.purpose, 'mfa_reset');
  const begin = await t.api('POST', `/staff-invite/${token}/begin`);
  assert.match(begin.json.secret, /^[A-Z2-7]{32}$/); assert.match(begin.json.qr_svg, /<svg/);
  assert.notEqual(begin.json.secret, p.totpSecret);
  const code = totpAt(begin.json.secret);
  assert.equal((await t.api('POST', `/staff-invite/${token}/activate`, { body: { code } })).json.error.code, 'password_required');
  assert.equal((await t.api('POST', `/staff-invite/${token}/activate`, { body: { current_password: 'wrong-password-123', code } })).status, 400);
  assert.equal((await t.api('POST', `/staff-invite/${token}/activate`, { body: { current_password: PW, code: '000000' } })).status, 400);
  assert.equal((await login(p)).status, 200, 'old authenticator still works until the person completes the reset');
  assert.equal((await t.api('POST', `/staff-invite/${token}/activate`, { body: { current_password: PW, code } })).status, 200);
  assert.equal((await login(p)).status, 401, 'old authenticator no longer works');
  assert.equal((await login(p, PW, begin.json.secret)).status, 200, 'new authenticator works');
  assert.equal((await t.api('GET', `/staff-invite/${token}`)).status, 400);
  assert.equal((await audits('staff.mfa_reset_completed', p.id)).length, 1);
  // full reset: new password and authenticator, no old factor needed
  const f = await post(sa, `/admin/staff/${p.id}/reset`, { kind: 'full', reason: 'lost both factors' });
  const ft = String(f.json.reset_url).split('#activate=')[1];
  const fb = await t.api('POST', `/staff-invite/${ft}/begin`);
  assert.equal((await t.api('POST', `/staff-invite/${ft}/activate`, { body: { password: 'Full-reset-password-3', code: totpAt(fb.json.secret) } })).status, 200);
  assert.equal((await login(p, 'Full-reset-password-3', fb.json.secret)).status, 200);
  // disabled accounts cannot be reset, and a link dies if the account is disabled afterwards
  const g = await t.staff('analyst');
  const gl = await post(sa, `/admin/staff/${g.id}/reset`, { kind: 'password', reason: 'link then disable' });
  await post(sa, `/admin/staff/${g.id}/status`, { status: 'disabled', reason: 'disabled after link' });
  assert.equal((await t.api('GET', `/staff-invite/${String(gl.json.reset_url).split('#activate=')[1]}`)).status, 400);
  assert.equal((await post(sa, `/admin/staff/${g.id}/reset`, { kind: 'password', reason: 'reset a disabled one' })).status, 409);
});

test('resend / regenerate an invitation: the old link dies, the new one works, response has no secret', async () => {
  const sa = await t.staff('super_admin');
  const email = mail('inv');
  const inv = await post(sa, '/admin/staff/invites', { email, name: 'Pending Person', role: 'support_agent' });
  const old = String(inv.json.invite_url).split('#activate=')[1];
  const re = await post(sa, `/admin/staff/invites/${inv.json.id}/regenerate`);
  assert.equal(re.status, 200, JSON.stringify(re.json));
  assert.ok(!JSON.stringify(re.json).toLowerCase().includes('secret'));
  const fresh = String(re.json.invite_url).split('#activate=')[1];
  assert.notEqual(fresh, old);
  assert.equal((await t.api('GET', `/staff-invite/${old}`)).status, 400);
  const info = await t.api('GET', `/staff-invite/${fresh}`); assert.equal(info.json.purpose, 'invite'); assert.equal(info.json.role, 'support_agent');
  const list = await get(sa, '/admin/staff/invites');
  assert.equal(list.json.invites.filter((i: any) => i.email === email).length, 1);
  // the new link activates normally
  const b = await t.api('POST', `/staff-invite/${fresh}/begin`);
  assert.equal((await t.api('POST', `/staff-invite/${fresh}/activate`, { body: { password: 'Invited-person-pass-4', code: totpAt(b.json.secret) } })).status, 200);
  assert.equal((await t.api('POST', `/admin/staff/invites/${re.json.id}/regenerate`, { token: sa.token })).status, 404, 'a used invitation cannot be regenerated');
  assert.equal((await audits('staff.invite_regenerated', re.json.id)).length, 1);
});

test('sessions: detail shows active sessions and last login; revoke one or all; activity shows what they did and what was done to them', async () => {
  const sa = await t.staff('super_admin'); const p = await t.staff('dispatcher');
  await login(p);
  const d = await get(sa, `/admin/staff/${p.id}`);
  assert.equal(d.status, 200); assert.ok(d.json.sessions.length >= 2); assert.ok(d.json.staff.last_login_at);
  assert.ok(!JSON.stringify(d.json).includes('refresh'));
  const one = d.json.sessions[0].id;
  assert.equal((await t.api('DELETE', `/admin/staff/${p.id}/sessions/${one}`, { token: sa.token })).status, 200);
  assert.equal((await t.api('DELETE', `/admin/staff/${p.id}/sessions/${one}`, { token: sa.token })).status, 404);
  assert.equal((await post(sa, `/admin/staff/${p.id}/sessions/revoke`)).status, 200);
  assert.equal((await get(p, '/admin/live')).status, 401);
  assert.equal((await get(sa, `/admin/staff/${p.id}`)).json.sessions.length, 0);
  const by = await get(sa, `/admin/staff/${sa.id}/activity?view=by&action=staff.`);
  assert.ok(by.json.logs.length >= 1 && by.json.logs.every((l: any) => l.action.startsWith('staff.')));
  const about = await get(sa, `/admin/staff/${p.id}/activity?view=about`);
  assert.ok(about.json.logs.some((l: any) => l.action === 'staff.sessions_revoked'));
});

test('invites for custom roles; every admin response about links is secret-free; unknown role refused', async () => {
  const sa = await t.staff('super_admin');
  const rn = 'cust_' + randomUUID().slice(0, 6);
  await t.api('POST', '/admin/roles', { token: sa.token, body: { name: rn, label: 'Custom', permissions: ['support.handle'] } });
  const inv = await post(sa, '/admin/staff/invites', { email: mail('c'), name: 'Custom Person', role: rn });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  assert.ok(!JSON.stringify(inv.json).toLowerCase().includes('secret'));
  assert.equal((await post(sa, '/admin/staff/invites', { email: mail('c'), name: 'Nope Nope', role: 'no_such' })).status, 400);
  assert.equal((await post(sa, '/admin/staff/invites', { email: mail('c'), name: 'Nope Nope', role: 'passenger' })).status, 400);
});
