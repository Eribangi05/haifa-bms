import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requirePerm, requireAnyPerm, actorOf } from '../guards.js';
import { q, q1, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { ROLE_PERMISSIONS, permsOfRole, staffRoleNames, effectivePermissions } from '../rbac.js';
import { PERMISSION_CATALOGUE, PERMISSION_GROUPS, PERMISSION_KEYS } from '../permissions.js';
import { audit } from '../services/audit.js';
import { invalidateRbac, setRolePermissions } from '../services/rolesStore.js';
import { assertCanGrantRoles, canGrantPermission, isSuperReq, revokeAllSessions } from '../services/staffAdmin.js';
import { roleSummaries } from './adminStaff.js';

const reason = z.string().trim().min(5).max(300);
const nameRe = /^[a-z][a-z0-9_]{2,29}$/;
const permList = z.array(z.string().min(1).max(60)).max(80);
/** Roles whose permissions are fixed by the system. */
const IMMUTABLE = new Set(['super_admin', 'partner_manager']);
const NON_STAFF_BUILTIN = new Set(['passenger', 'driver', 'fleet_manager', 'corporate_admin', 'corporate_booker']);

export async function adminRoleRoutes(app: FastifyInstance) {
  const view = { preHandler: requireAnyPerm('roles.manage', 'users.manage') };
  const manage = { preHandler: requirePerm('roles.manage') };

  app.get('/admin/permissions', view, async () => ({
    groups: PERMISSION_GROUPS.map((g) => ({ group: g, permissions: PERMISSION_CATALOGUE.filter((p) => p.group === g) })),
    catalogue: PERMISSION_CATALOGUE,
  }));
  app.get('/admin/roles', view, async (req) => {
    const roles = await roleSummaries();
    const mine = effectivePermissions(req.auth!.roles);
    return { roles: roles.map((r) => ({ ...r, editable: canEditRole(req, r) })), my_permissions: mine };
  });

  function canEditRole(req: any, r: { name: string; builtin: boolean }): boolean {
    if (IMMUTABLE.has(r.name)) return false;
    if (r.builtin) return isSuperReq(req);
    return isSuperReq(req) || !req.auth!.roles.includes(r.name);
  }
  /** Validates a permission list for the caller: known keys only, no wildcard, no partner portal, nothing the caller may not hand out. */
  function checkPerms(req: any, perms: string[], currentlyHeld: string[] = []) {
    for (const p of perms) {
      if (p === '*') throw badRequest('wildcard_not_allowed', 'Only the super admin role holds every permission');
      if (!PERMISSION_KEYS.has(p)) throw badRequest('unknown_permission', `Unknown permission: ${p}`);
      if (p === 'partner.portal') throw badRequest('partner_portal_locked', 'The venue partner permission belongs to the venue partner role only');
      if (!currentlyHeld.includes(p) && !canGrantPermission(req, p)) throw forbidden(`You cannot grant ${p}: ${isSuperReq(req) ? '' : 'you do not hold it yourself, or only a super admin may grant it'}`);
    }
  }
  function assertNotWiderThanMe(req: any, perms: string[], verb: string) {
    if (isSuperReq(req)) return;
    const mine = new Set(effectivePermissions(req.auth!.roles));
    if (!mine.has('*') && !perms.every((p) => mine.has(p))) throw forbidden(`You cannot ${verb} a role that allows more than you do`);
  }
  const detail = async (name: string) => (await roleSummaries()).find((r) => r.name === name);

  // ---------- create (optionally cloned) ----------
  app.post('/admin/roles', manage, async (req) => {
    const b = parse(z.object({ name: z.string().regex(nameRe, 'Use lowercase letters, digits and underscores (3 to 30 characters, starting with a letter)'), label: z.string().trim().min(2).max(60), description: z.string().trim().max(200).optional(), permissions: permList.default([]), clone_from: z.string().max(40).optional() }), req.body);
    if (b.name in ROLE_PERMISSIONS || await q1('select 1 from roles where name=$1', [b.name])) throw conflict('role_exists', 'A role with this name already exists');
    if ((await q1<{ n: number }>("select count(*)::int n from roles where not builtin"))!.n >= 50) throw conflict('too_many_roles', 'At most 50 custom roles');
    let perms = b.permissions;
    if (b.clone_from) {
      if (!staffRoleNames().includes(b.clone_from)) throw badRequest('unknown_role', 'Cannot clone that role');
      const src = permsOfRole(b.clone_from);
      const base = src.includes('*') ? PERMISSION_CATALOGUE.map((p) => p.key) : src;
      perms = [...new Set([...base.filter((p) => p !== 'partner.portal'), ...b.permissions])];
    }
    checkPerms(req, perms);
    await tx(async (c) => {
      await q('insert into roles(name, label, description, builtin, is_staff, created_by) values ($1,$2,$3,false,true,$4)', [b.name, b.label, b.description ?? null, req.auth!.id], c);
      for (const p of perms) await q('insert into role_permissions(role, permission) values ($1,$2)', [b.name, p], c);
      await audit(actorOf(req), 'role.created', 'role', b.name, undefined, { label: b.label, permissions: perms, clone_from: b.clone_from ?? null }, c);
    });
    await invalidateRbac();
    return { ok: true, role: await detail(b.name) };
  });

  // ---------- edit name / description / permissions ----------
  app.patch('/admin/roles/:name', manage, async (req) => {
    const { name } = parse(z.object({ name: z.string().max(40) }), req.params);
    const b = parse(z.object({ label: z.string().trim().min(2).max(60).optional(), description: z.string().trim().max(200).nullable().optional(), permissions: permList.optional(), reason: reason.optional() }), req.body);
    const role = await q1<any>('select * from roles where name=$1', [name]);
    if (!role) throw notFound('role');
    if (IMMUTABLE.has(name)) throw conflict('role_immutable', name === 'super_admin' ? 'The super admin role always has every permission and cannot be edited' : 'The venue partner role is fixed by the system');
    if (NON_STAFF_BUILTIN.has(name)) throw conflict('role_immutable', 'This is an app-user role, not a staff role');
    if (role.builtin && !isSuperReq(req)) throw forbidden('Only a super admin can edit built-in roles');
    if (!role.builtin && !isSuperReq(req) && req.auth!.roles.includes(name)) throw forbidden('You cannot edit a role you hold yourself');
    const before = { label: role.label, description: role.description, permissions: permsOfRole(name) };
    if (!role.builtin) assertNotWiderThanMe(req, before.permissions, 'edit');
    if (b.permissions) {
      if (!b.reason) throw badRequest('reason_required', 'Give a reason for changing permissions (at least 5 characters)');
      checkPerms(req, b.permissions, before.permissions);
    }
    await tx(async (c) => {
      if (b.label !== undefined || b.description !== undefined) await q('update roles set label=coalesce($2,label), description=case when $4 then $3 else description end, updated_at=now(), updated_by=$5 where name=$1', [name, b.label ?? null, b.description ?? null, b.description !== undefined, req.auth!.id], c);
      if (b.permissions) {
        await q('delete from role_permissions where role=$1', [name], c);
        for (const p of [...new Set(b.permissions)]) await q('insert into role_permissions(role, permission) values ($1,$2)', [name, p], c);
        await q('update roles set updated_at=now(), updated_by=$2, customized=case when builtin then true else customized end where name=$1', [name, req.auth!.id], c);
      }
      await audit(actorOf(req), 'role.updated', 'role', name, before, { label: b.label ?? before.label, description: b.description === undefined ? before.description : b.description, permissions: b.permissions ?? before.permissions, reason: b.reason }, c);
    });
    await invalidateRbac();   // takes effect on the very next request of every holder (roles are re-read on each request)
    return { ok: true, role: await detail(name) };
  });

  // ---------- reset a built-in role to the code defaults ----------
  app.post('/admin/roles/:name/reset', manage, async (req) => {
    const { name } = parse(z.object({ name: z.string().max(40) }), req.params);
    const b = parse(z.object({ reason }), req.body);
    const role = await q1<any>('select * from roles where name=$1', [name]);
    if (!role) throw notFound('role');
    if (!role.builtin || IMMUTABLE.has(name) || NON_STAFF_BUILTIN.has(name)) throw conflict('not_resettable', 'Only editable built-in staff roles can be reset to their defaults');
    if (!isSuperReq(req)) throw forbidden('Only a super admin can reset built-in roles');
    const before = permsOfRole(name);
    await setRolePermissions(name, ROLE_PERMISSIONS[name] ?? [], { customized: false, actor: req.auth!.id });
    await audit(actorOf(req), 'role.reset', 'role', name, { permissions: before }, { permissions: ROLE_PERMISSIONS[name], reason: b.reason });
    await invalidateRbac();
    return { ok: true, role: await detail(name) };
  });

  // ---------- delete a custom role (blocked while assigned; optional reassignment) ----------
  app.delete('/admin/roles/:name', manage, async (req) => {
    const { name } = parse(z.object({ name: z.string().max(40) }), req.params);
    const b = parse(z.object({ reason, reassign_to: z.string().max(40).optional() }), req.body);
    const role = await q1<any>('select * from roles where name=$1', [name]);
    if (!role) throw notFound('role');
    if (role.builtin) throw conflict('role_builtin', 'Built-in roles cannot be deleted. You can reset them to their defaults.');
    if (!isSuperReq(req) && req.auth!.roles.includes(name)) throw forbidden('You cannot delete a role you hold yourself');
    assertNotWiderThanMe(req, permsOfRole(name), 'delete');
    if (b.reassign_to) {
      if (b.reassign_to === name) throw badRequest('bad_reassign', 'Choose a different role');
      assertCanGrantRoles(req, [b.reassign_to]);
    }
    const out = await tx(async (c) => {
      const members = await q<{ user_id: string; status: string }>("select ur.user_id, u.status from user_roles ur join users u on u.id=ur.user_id where ur.role=$1 for update of ur", [name], c);
      const live = members.filter((m) => m.status !== 'removed');
      if (live.length && !b.reassign_to) throw conflict('role_in_use', `${live.length} ${live.length === 1 ? 'person holds' : 'people hold'} this role. Move them to another role first, or choose a role to move them to.`, { members: live.length });
      for (const m of live) {
        await q('insert into user_roles(user_id, role) values ($1,$2) on conflict do nothing', [m.user_id, b.reassign_to], c);
        await revokeAllSessions(c, m.user_id);
      }
      await q('delete from user_roles where role=$1', [name], c);
      await q('update staff_invites set revoked_at=now() where role=$1 and used_at is null and revoked_at is null', [name], c);
      await q('delete from roles where name=$1', [name], c);   // role_permissions cascade
      await audit(actorOf(req), 'role.deleted', 'role', name, { label: role.label, permissions: permsOfRole(name) }, { reassigned_to: b.reassign_to ?? null, people: live.length, reason: b.reason }, c);
      return { moved: live.length };
    });
    await invalidateRbac();
    return { ok: true, ...out };
  });
}
