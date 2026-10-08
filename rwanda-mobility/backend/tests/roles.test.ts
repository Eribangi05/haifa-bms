import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx, q: typeof import('../src/db.ts').q, q1: typeof import('../src/db.ts').q1, totpAt: (s: string, t?: number) => string;
let R: typeof import('../src/rbac.ts'), P: typeof import('../src/permissions.ts'), RS: typeof import('../src/services/rolesStore.ts');
before(async () => {
  t = await boot('rwanda_mobility_test');
  ({ q, q1 } = await import('../src/db.ts')); ({ totpAt } = await import('../src/util/crypto.ts'));
  R = await import('../src/rbac.ts'); P = await import('../src/permissions.ts'); RS = await import('../src/services/rolesStore.ts');
});
after(async () => { await t.close(); });

type S = Awaited<ReturnType<Ctx['staff']>>;
const get = (s: { token: string }, path: string) => t.api('GET', path, { token: s.token });
const post = (s: { token: string }, path: string, body?: any) => t.api('POST', path, { token: s.token, body: body ?? {} });
const patch = (s: { token: string }, path: string, body: any) => t.api('PATCH', path, { token: s.token, body });
const del = (s: { token: string }, path: string, body?: any) => t.api('DELETE', path, { token: s.token, body });
const rn = () => 'role_' + randomUUID().slice(0, 6);
const login = (s: S) => t.api('POST', '/auth/staff/login', { body: { email: s.email, password: s.password, totp: totpAt(s.totpSecret) } });

test('permission catalogue: grouped, described, and covers every permission a built-in role holds', async () => {
  const sa = await t.staff('super_admin');
  const r = await get(sa, '/admin/permissions');
  assert.equal(r.status, 200);
  const keys = r.json.catalogue.map((p: any) => p.key);
  assert.equal(new Set(keys).size, keys.length, 'no duplicates');
  for (const p of r.json.catalogue) { assert.ok(p.label.length > 3 && p.description.length > 10 && p.group, `description for ${p.key}`); }
  for (const perms of Object.values(R.ROLE_PERMISSIONS)) for (const p of perms) assert.ok(p === '*' || keys.includes(p), p);
  assert.ok(r.json.groups.length >= 5 && r.json.groups.every((g: any) => g.permissions.length));
  assert.equal((await get(await t.staff('finance_officer'), '/admin/permissions')).status, 403);
});

test('roles list: built-in and custom, counts, immutability flags; login and /users/me carry the effective permissions', async () => {
  const sa = await t.staff('super_admin');
  const list = await get(sa, '/admin/roles');
  assert.equal(list.status, 200);
  const sup = list.json.roles.find((r: any) => r.name === 'super_admin');
  assert.deepEqual(sup.permissions, ['*']); assert.equal(sup.immutable, true); assert.equal(sup.editable, false);
  assert.ok(list.json.roles.find((r: any) => r.name === 'dispatcher').editable);
  assert.ok(!list.json.roles.some((r: any) => r.name === 'passenger'), 'app-user roles are not staff roles');
  // the server tells the console what each signed-in role may do (replaces the static mirror)
  for (const role of R.STAFF_ROLES) {
    const s = await t.staff(role);
    const l = await login(s);
    assert.deepEqual(l.json.permissions, R.effectivePermissions([role]), `login permissions for ${role}`);
    const me = await get(s, '/users/me');
    assert.deepEqual(me.json.permissions, R.effectivePermissions([role]));
  }
  const p = await t.register();
  assert.equal((await get(p, '/users/me')).json.permissions, undefined, 'customers get no staff permission list');
  // the console no longer ships a copy of the role table
  const core = readFileSync(new URL('../../admin-web/core.js', import.meta.url), 'utf8');
  assert.ok(!core.includes('rbac-mirror') && !core.includes('"dispatcher":['), 'core.js has no static role->permission mirror');
  assert.ok(core.includes('S.perms'));
});

test('custom role: create (with and without cloning), validation, assignment and live gating on real routes', async () => {
  const sa = await t.staff('super_admin');
  const name = rn();
  assert.equal((await post(sa, '/admin/roles', { name: 'Bad Name', label: 'x y', permissions: [] })).status, 400);
  assert.equal((await post(sa, '/admin/roles', { name: rn(), label: 'Bad', permissions: ['not.a.permission'] })).json.error.code, 'unknown_permission');
  assert.equal((await post(sa, '/admin/roles', { name: rn(), label: 'Bad', permissions: ['*'] })).json.error.code, 'wildcard_not_allowed');
  assert.equal((await post(sa, '/admin/roles', { name: rn(), label: 'Bad', permissions: ['partner.portal'] })).status, 400);
  assert.equal((await post(sa, '/admin/roles', { name: 'dispatcher', label: 'Clash', permissions: [] })).status, 409);
  const c = await post(sa, '/admin/roles', { name, label: 'Support only', description: 'Only support', permissions: ['support.handle', 'bookings.view_all'] });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.role.builtin, false); assert.deepEqual([...c.json.role.permissions].sort(), ['bookings.view_all', 'support.handle']);
  const u = await t.staff(name);   // a person holding only the custom role
  // a role with only support.* cannot call finance routes
  assert.equal((await get(u, '/admin/support/cases')).status, 200);
  assert.equal((await get(u, '/admin/finance/payments')).status, 403);
  assert.equal((await get(u, '/admin/finance/position')).status, 403);
  assert.equal((await get(u, '/admin/settings')).status, 403);
  assert.equal((await get(u, '/admin/staff')).status, 403);
  // granting takes effect immediately for the SAME token, revoking too
  assert.equal((await patch(sa, `/admin/roles/${name}`, { permissions: ['support.handle', 'bookings.view_all', 'finance.view'], reason: 'needs payment lookups' })).status, 200);
  assert.equal((await get(u, '/admin/finance/payments')).status, 200);
  assert.equal((await patch(sa, `/admin/roles/${name}`, { permissions: ['support.handle', 'bookings.view_all'], reason: 'payment access ended' })).status, 200);
  assert.equal((await get(u, '/admin/finance/payments')).status, 403);
  assert.equal((await get(u, '/admin/support/cases')).status, 200, 'unchanged permissions still work');
  // the new permissions reach the console at the next sign-in / refresh
  const l = await login(u); assert.deepEqual([...l.json.permissions].sort(), ['bookings.view_all', 'support.handle']);
  // reason is mandatory for permission changes; audit has before and after
  assert.equal((await patch(sa, `/admin/roles/${name}`, { permissions: ['support.handle'] })).json.error.code, 'reason_required');
  const au = await q('select * from audit_logs where action=$1 and entity_id=$2 order by id', ['role.updated', name]);
  assert.equal(au.length, 2); assert.ok(au[0].before.permissions.length === 2 && au[0].after.permissions.includes('finance.view') && au[0].after.reason);
  // rename / describe without touching permissions
  assert.equal((await patch(sa, `/admin/roles/${name}`, { label: 'Support (renamed)', description: 'New text' })).status, 200);
  assert.equal((await get(sa, '/admin/roles')).json.roles.find((r: any) => r.name === name).label, 'Support (renamed)');
  // clone from a built-in role
  const cl = rn();
  const cr = await post(sa, '/admin/roles', { name: cl, label: 'Finance clone', clone_from: 'finance_officer', permissions: ['audit.view'] });
  assert.equal(cr.status, 200, JSON.stringify(cr.json));
  assert.ok(R.ROLE_PERMISSIONS.finance_officer.every((p) => cr.json.role.permissions.includes(p)) && cr.json.role.permissions.includes('audit.view'));
  const cs = rn();
  const cs1 = await post(sa, '/admin/roles', { name: cs, label: 'Everything clone', clone_from: 'super_admin' });
  assert.equal(cs1.status, 200); assert.ok(!cs1.json.role.permissions.includes('*') && cs1.json.role.permissions.length > 30 && !cs1.json.role.permissions.includes('partner.portal'));
});

test('built-in roles: only super admin edits them; changes apply at once; reset to defaults; super_admin is immutable', async () => {
  const sa = await t.staff('super_admin'); const an = await t.staff('analyst');
  assert.equal((await get(an, '/admin/analytics')).status, 200, 'analyst reaches reports by default');
  const url = '/admin/live';
  assert.equal((await get(an, url)).status, 403);
  // not super admin -> forbidden (even with roles.manage)
  const mgr = rn(); await post(sa, '/admin/roles', { name: mgr, label: 'Role editor', permissions: ['bookings.view_all'] }); // gets roles.manage below via SQL (only a super admin may grant it through the API)
  await q("insert into role_permissions(role, permission) values ($1,'roles.manage')", [mgr]); await RS.invalidateRbac();
  const ed = await t.staff(mgr);
  assert.equal((await patch(ed, '/admin/roles/analyst', { permissions: ['analytics.view'], reason: 'trying built-in' })).status, 403);
  assert.equal((await post(ed, '/admin/roles/analyst/reset', { reason: 'trying reset' })).status, 403);
  assert.equal((await patch(sa, '/admin/roles/super_admin', { permissions: ['analytics.view'], reason: 'strip the super admin' })).json.error.code, 'role_immutable');
  assert.equal((await patch(sa, '/admin/roles/partner_manager', { permissions: [], reason: 'partner is fixed' })).status, 409);
  assert.equal((await patch(sa, '/admin/roles/passenger', { permissions: [], reason: 'not a staff role' })).status, 409);
  assert.equal((await del(sa, '/admin/roles/dispatcher', { reason: 'cannot delete built-in' })).status, 409);
  // super admin edits analyst: gains live map, applies to the token already held
  const e = await patch(sa, '/admin/roles/analyst', { permissions: [...R.ROLE_PERMISSIONS.analyst, 'bookings.view_all'], reason: 'analysts watch the live map' });
  assert.equal(e.status, 200, JSON.stringify(e.json)); assert.equal(e.json.role.customized, true);
  assert.equal((await get(an, url)).status, 200);
  // customised built-ins survive a re-seed (seedCore must not overwrite admin edits)
  const seed = await import('../src/seed.ts'); await seed.seedCore(); await RS.invalidateRbac();
  assert.equal((await get(an, url)).status, 200, 'customisation survives seeding');
  // reset to defaults
  const rs = await post(sa, '/admin/roles/analyst/reset', { reason: 'back to standard' });
  assert.equal(rs.status, 200); assert.equal(rs.json.role.customized, false); assert.deepEqual(rs.json.role.permissions, R.ROLE_PERMISSIONS.analyst);
  assert.equal((await get(an, url)).status, 403);
  // emptying a built-in role is allowed and honoured (it is NOT silently replaced by the defaults)
  assert.equal((await patch(sa, '/admin/roles/dispatcher', { permissions: [], reason: 'temporarily empty' })).status, 200);
  const di = await t.staff('dispatcher'); assert.equal((await get(di, '/admin/live')).status, 403);
  await post(sa, '/admin/roles/dispatcher/reset', { reason: 'restore dispatcher' });
  assert.equal((await get(di, '/admin/live')).status, 200);
});

test('escalation guards: a role editor cannot grant what they lack, super-only permissions, edit their own role, or reach beyond their own access', async () => {
  const sa = await t.staff('super_admin');
  const mgr = rn(); await post(sa, '/admin/roles', { name: mgr, label: 'Role editor 2', permissions: ['bookings.view_all', 'support.handle'] });
  await q("insert into role_permissions(role, permission) values ($1,'roles.manage'),($1,'users.manage')", [mgr]); await RS.invalidateRbac();
  const ed = await t.staff(mgr);
  assert.equal((await post(ed, '/admin/roles', { name: rn(), label: 'Escalate', permissions: ['finance.view'] })).status, 403, 'does not hold finance.view');
  assert.equal((await post(ed, '/admin/roles', { name: rn(), label: 'Escalate', permissions: ['users.manage'] })).status, 403, 'users.manage is super-admin-only to hand out');
  assert.equal((await post(ed, '/admin/roles', { name: rn(), label: 'Escalate', permissions: ['roles.manage'] })).status, 403);
  const ok = await post(ed, '/admin/roles', { name: rn(), label: 'Within reach', permissions: ['support.handle'] });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await patch(ed, `/admin/roles/${mgr}`, { permissions: ['bookings.view_all', 'support.handle', 'roles.manage', 'users.manage', 'drivers.view'], reason: 'self promotion try' })).status, 403, 'cannot edit own role');
  // a role that allows more than the editor holds cannot be edited by them
  const wide = rn(); await post(sa, '/admin/roles', { name: wide, label: 'Wide', permissions: ['finance.view', 'support.handle'] });
  assert.equal((await patch(ed, `/admin/roles/${wide}`, { label: 'Renamed by a narrower editor' })).status, 403);
  assert.equal((await del(ed, `/admin/roles/${wide}`, { reason: 'try to delete wider role' })).status, 403);
  // super admin may edit anything custom
  assert.equal((await patch(sa, `/admin/roles/${wide}`, { label: 'Wide (renamed)' })).status, 200);
});

test('delete a custom role: blocked while assigned, reassignment moves people and ends their sessions', async () => {
  const sa = await t.staff('super_admin');
  const name = rn(); await post(sa, '/admin/roles', { name, label: 'Temp role', permissions: ['support.handle'] });
  const u1 = await t.staff(name), u2 = await t.staff(name);
  const blocked = await del(sa, `/admin/roles/${name}`, { reason: 'cleanup old role' });
  assert.equal(blocked.status, 409); assert.equal(blocked.json.error.code, 'role_in_use'); assert.equal(blocked.json.error.details.members, 2);
  assert.equal((await get(u1, '/admin/support/cases')).status, 200);
  assert.equal((await del(sa, `/admin/roles/${name}`, { reason: 'cleanup old role', reassign_to: 'ghost_role' })).status, 400);
  assert.equal((await del(sa, `/admin/roles/${name}`, { reason: 'cleanup old role', reassign_to: 'support_agent' })).status, 200);
  assert.equal((await get(u1, '/admin/support/cases')).status, 401, 'sessions of moved people ended');
  const l = await login(u2); assert.deepEqual(l.json.roles, ['support_agent']);
  assert.equal(await q1('select 1 from roles where name=$1', [name]), undefined);
  assert.equal((await q('select 1 from role_permissions where role=$1', [name])).length, 0);
  assert.equal((await q('select 1 from audit_logs where action=$1 and entity_id=$2', ['role.deleted', name])).length, 1);
  // an unassigned role deletes without reassignment; the reason is mandatory
  const empty = rn(); await post(sa, '/admin/roles', { name: empty, label: 'Empty role', permissions: [] });
  assert.equal((await del(sa, `/admin/roles/${empty}`, {})).status, 400);
  assert.equal((await del(sa, `/admin/roles/${empty}`, { reason: 'never used' })).status, 200);
  // a pending invitation for a deleted role is revoked
  const r3 = rn(); await post(sa, '/admin/roles', { name: r3, label: 'Invite role', permissions: ['support.handle'] });
  const inv = await post(sa, '/admin/staff/invites', { email: `x${Date.now()}@test.local`, name: 'Pending One', role: r3 });
  await del(sa, `/admin/roles/${r3}`, { reason: 'removing invite role' });
  assert.equal((await t.api('GET', `/staff-invite/${String(inv.json.invite_url).split('#activate=')[1]}`)).status, 400);
});

test('cache: explicit invalidation is immediate, defaults are the fallback, unreadable tables fall back safely', async () => {
  // pure: no rows at all -> exactly the static defaults (first run before the roles table is filled)
  const empty = RS.buildSnapshot([], []);
  for (const [r, p] of Object.entries(R.ROLE_PERMISSIONS)) assert.deepEqual(empty.perms.get(r), p);
  assert.deepEqual([...empty.staff].sort(), [...R.STAFF_ROLES].sort());
  // rows exist but a built-in role is not customised -> defaults still win; customised -> rows win; super_admin always '*'
  const snap = RS.buildSnapshot(
    [{ name: 'analyst', label: null, description: null, builtin: true, is_staff: true, customized: false }, { name: 'dispatcher', label: null, description: null, builtin: true, is_staff: true, customized: true },
     { name: 'super_admin', label: null, description: null, builtin: true, is_staff: true, customized: true }, { name: 'ops_x', label: null, description: null, builtin: false, is_staff: true, customized: false }],
    [{ role: 'analyst', permission: 'finance.view' }, { role: 'dispatcher', permission: 'drivers.view' }, { role: 'super_admin', permission: 'x' }, { role: 'ops_x', permission: 'users.view' }]);
  assert.deepEqual(snap.perms.get('analyst'), R.ROLE_PERMISSIONS.analyst);
  assert.deepEqual(snap.perms.get('dispatcher'), ['drivers.view']); assert.deepEqual(snap.perms.get('super_admin'), ['*']);
  assert.deepEqual(snap.perms.get('ops_x'), ['users.view']); assert.ok(snap.staff.has('ops_x'));
  // live: change a custom role directly in SQL; the cached view is stale until invalidated
  const sa = await t.staff('super_admin'); const name = rn();
  await post(sa, '/admin/roles', { name, label: 'Cache role', permissions: ['support.handle'] });
  const u = await t.staff(name);
  assert.equal((await get(u, '/admin/support/cases')).status, 200);
  await q('delete from role_permissions where role=$1', [name]);
  assert.equal((await get(u, '/admin/support/cases')).status, 200, 'short cache: not re-read yet');
  await RS.invalidateRbac();
  assert.equal((await get(u, '/admin/support/cases')).status, 403, 'explicit invalidation applies at once');
});

test('removing a role from a person (or a custom role from the system) never leaves a staff session with stale rights; non-staff custom role is not staff', async () => {
  const sa = await t.staff('super_admin');
  const name = rn(); await post(sa, '/admin/roles', { name, label: 'Plain', permissions: ['analytics.view'] });
  const u = await t.staff('analyst');
  assert.equal((await patch(sa, `/admin/staff/${u.id}`, { roles: [name], reason: 'moved to custom role' })).status, 200);
  const l = await login(u); assert.deepEqual(l.json.roles, [name]); assert.deepEqual(l.json.permissions, ['analytics.view']);
  // a role row flagged non-staff never grants console access
  await q('update roles set is_staff=false where name=$1', [name]); await RS.invalidateRbac();
  assert.equal((await t.api('GET', '/admin/analytics', { token: l.json.access_token })).status, 403);
});
