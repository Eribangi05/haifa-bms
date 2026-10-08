import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requirePerm, actorOf } from '../guards.js';
import { q, q1, tx, pool } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { staffRoleNames, permsOfRole } from '../rbac.js';
import { audit } from '../services/audit.js';
import { assertCanGrantRoles, assertNotLastSuperAdmin, assertNotSelf, assertOutranks, createLink, isSuperReq, loadStaff, maskEmail, publicStatus, revokeAllSessions } from '../services/staffAdmin.js';

const idp = z.object({ id: z.string().uuid() });
const reason = z.string().trim().min(5).max(300);
const LINK_NOTE = 'Shown once. Send it only to the person it is for. They choose their own credentials on their own device; you will never see them.';

export async function adminStaffRoutes(app: FastifyInstance) {
  const pre = { preHandler: requirePerm('users.manage') };

  // ---------- list / search / filter ----------
  app.get('/admin/staff', pre, async (req) => {
    const b = parse(z.object({ q: z.string().trim().max(80).optional(), role: z.string().max(40).optional(), status: z.enum(['current', 'all', 'active', 'disabled', 'removed']).default('current') }), req.query);
    const rows = await q<any>(`select u.id, u.email, u.display_name, u.status, u.mfa_enabled, u.created_at, u.removed_at, u.anonymised_at,
        array(select role from user_roles r where r.user_id=u.id order by role) roles,
        (select max(a.created_at) from audit_logs a where a.actor_id=u.id and a.action='auth.staff_login') last_login_at,
        (select count(*)::int from sessions s where s.user_id=u.id and s.revoked_at is null and s.expires_at>now()) active_sessions
      from users u
      where (u.removed_at is not null or exists (select 1 from user_roles r where r.user_id=u.id and r.role = any($1)))
        and case $2 when 'removed' then u.status='removed' when 'active' then u.status='active' when 'disabled' then u.status='deactivated' when 'all' then true else u.status<>'removed' end
        and ($3::text is null or u.display_name ilike $3 or u.email ilike $3)
        and ($4::text is null or exists (select 1 from user_roles r where r.user_id=u.id and r.role=$4))
      order by lower(coalesce(u.display_name, u.email)) limit 500`,
      [staffRoleNames(), b.status, b.q ? `%${b.q.replace(/[\\%_]/g, '\\$&')}%` : null, b.role ?? null]);
    return { staff: rows.map((r) => ({ ...r, status: publicStatus(r.status) })), roles: await roleSummaries() };
  });

  // ---------- one person: details, sessions, open links ----------
  app.get('/admin/staff/:id', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const u = await loadStaff(id);
    const [sessions, links, last] = await Promise.all([
      q("select id, ip, device_name, created_at, last_used_at, expires_at from sessions where user_id=$1 and revoked_at is null and expires_at>now() order by last_used_at desc", [id]),
      q("select id, purpose, expires_at, created_at from staff_invites where user_id=$1 and used_at is null and revoked_at is null and expires_at>now() order by created_at desc", [id]),
      q1<any>("select max(created_at) t from audit_logs where actor_id=$1 and action='auth.staff_login'", [id]),
    ]);
    return { staff: { ...u, status: publicStatus(u.status), last_login_at: last?.t ?? null }, sessions, links };
  });

  // ---------- edit: name, email, roles ----------
  app.patch('/admin/staff/:id', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ display_name: z.string().trim().min(2).max(80).optional(), email: z.string().trim().email().max(160).optional(), roles: z.array(z.string().min(2).max(40)).min(1).max(8).optional(), reason: reason.optional() }), req.body);
    const email = b.email?.toLowerCase();
    const out = await tx(async (c) => {
      const u = await loadStaff(id, c, true);
      if (u.status === 'removed') throw conflict('removed', 'A removed account cannot be edited');
      const selfEdit = req.auth!.id === id;
      const valid = new Set(staffRoleNames()), curStaff = u.roles.filter((r) => valid.has(r));   // only staff roles are managed here; other roles the person holds are left alone
      const rolesChanged = !!b.roles && JSON.stringify([...new Set(b.roles)].sort()) !== JSON.stringify([...curStaff].sort());
      const emailChanged = !!email && email !== (u.email ?? '').toLowerCase();
      const nameChanged = !!b.display_name && b.display_name !== u.display_name;
      if ((rolesChanged || emailChanged) && selfEdit) throw forbidden('You cannot change your own roles or email. Ask another administrator.');
      if (rolesChanged || emailChanged) { assertOutranks(req, u.roles); if (!b.reason) throw badRequest('reason_required', 'Give a reason (at least 5 characters)'); }
      else if (nameChanged && !selfEdit) assertOutranks(req, u.roles);
      const changes: Record<string, unknown> = {};
      if (nameChanged) {
        await q('update users set display_name=$2, updated_at=now() where id=$1', [id, b.display_name], c);
        await audit(actorOf(req), 'staff.renamed', 'user', id, { display_name: u.display_name }, { display_name: b.display_name }, c); changes.display_name = true;
      }
      if (emailChanged) {
        if (await q1('select 1 from users where lower(email)=$1 and id<>$2', [email, id], c)) throw conflict('email_in_use', 'That email is already used by another account');
        await q('update users set email=$2, updated_at=now() where id=$1', [id, email], c);
        await q('update staff_invites set revoked_at=now() where user_id=$1 and used_at is null and revoked_at is null', [id], c);   // open reset links named the old address
        await revokeAllSessions(c, id);
        await audit(actorOf(req), 'staff.email_changed', 'user', id, { email: maskEmail(u.email) }, { email: maskEmail(email), reason: b.reason }, c); changes.email = true;
      }
      if (rolesChanged) {
        const next = [...new Set(b.roles!)];
        if (u.roles.includes('partner_manager')) throw conflict('partner_role_locked', 'A venue partner manager keeps that role. Remove the account instead.');
        assertCanGrantRoles(req, next.filter((r) => !curStaff.includes(r)));   // roles already held are kept even if the caller could not grant them
        const dropped = curStaff.filter((r) => !next.includes(r));
        if (!next.some((r) => valid.has(r))) throw badRequest('no_staff_role', 'A staff member needs at least one role');
        if (u.status === 'active' && u.roles.includes('super_admin') && !next.includes('super_admin')) await assertNotLastSuperAdmin(c, id);
        await q('delete from user_roles where user_id=$1 and role = any($2)', [id, dropped], c);
        for (const r of next) await q('insert into user_roles(user_id, role) values ($1,$2) on conflict do nothing', [id, r], c);
        await revokeAllSessions(c, id);   // they sign in again with exactly the new access
        await audit(actorOf(req), 'staff.roles_changed', 'user', id, { roles: curStaff }, { roles: next, reason: b.reason }, c); changes.roles = next;
      }
      return { changes };
    });
    return { ok: true, ...out };
  });

  // ---------- disable / enable ----------
  app.post('/admin/staff/:id/status', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ status: z.enum(['active', 'disabled']), reason }), req.body);
    assertNotSelf(req, id, 'change the status of');
    await tx(async (c) => {
      const u = await loadStaff(id, c, true);
      assertOutranks(req, u.roles);
      if (u.status === 'removed') throw conflict('removed', 'A removed account cannot be changed');
      if (b.status === 'disabled') {
        if (u.status !== 'active') throw conflict('already_disabled', 'Already disabled');
        if (u.roles.includes('super_admin')) await assertNotLastSuperAdmin(c, id);
        await q("update users set status='deactivated', updated_at=now() where id=$1", [id], c);
        await revokeAllSessions(c, id);
      } else {
        if (u.status === 'active') throw conflict('already_active', 'Already active');
        await q("update users set status='active', failed_logins=0, locked_until=null, updated_at=now() where id=$1", [id], c);
      }
      await audit(actorOf(req), b.status === 'disabled' ? 'staff.disabled' : 'staff.enabled', 'user', id, { status: publicStatus(u.status) }, { status: b.status, reason: b.reason }, c);
    });
    return { ok: true };
  });

  // ---------- remove (soft delete) / anonymise ----------
  app.post('/admin/staff/:id/remove', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ reason }), req.body);
    assertNotSelf(req, id, 'remove');
    await tx(async (c) => {
      const u = await loadStaff(id, c, true);
      assertOutranks(req, u.roles);
      if (u.status === 'removed') throw conflict('already_removed', 'Already removed');
      if (u.status === 'active' && u.roles.includes('super_admin')) await assertNotLastSuperAdmin(c, id);
      // The address is renamed so the same person can be invited again; the original is only recoverable from nowhere on purpose.
      const renamed = u.email ? `${u.email}#removed-${id.slice(0, 8)}` : null;
      await q(`update users set status='removed', removed_at=now(), email=$2, password_hash=null, mfa_secret_enc=null, mfa_enabled=false, failed_logins=0, locked_until=null, updated_at=now() where id=$1`, [id, renamed], c);
      await revokeAllSessions(c, id);
      await q('update push_tokens set revoked_at=now() where user_id=$1 and revoked_at is null', [id], c);
      await q('update staff_invites set revoked_at=now() where (user_id=$1 or lower(email)=$2) and used_at is null and revoked_at is null', [id, (u.email ?? '').toLowerCase()], c);
      await audit(actorOf(req), 'staff.removed', 'user', id, { roles: u.roles, status: publicStatus(u.status), email: maskEmail(u.email) }, { status: 'removed', reason: b.reason }, c);
    });
    return { ok: true };
  });
  app.post('/admin/staff/:id/anonymise', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ reason }), req.body);
    assertNotSelf(req, id, 'anonymise');
    await tx(async (c) => {
      const u = await loadStaff(id, c, true);
      assertOutranks(req, u.roles);
      if (u.status !== 'removed') throw conflict('not_removed', 'Remove the person first. Only a removed account can be anonymised.');
      if (u.anonymised_at) throw conflict('already_anonymised', 'Already anonymised');
      await q(`update users set display_name='Former staff member', email=$2, phone=null, photo_key=null, device_fingerprint=null, anonymised_at=now(), updated_at=now() where id=$1`, [id, `anonymised-${id}@removed.invalid`], c);
      await q("update sessions set ip=null, device_id=null, device_name=null where user_id=$1", [id], c);
      await q("update staff_invites set email='anonymised@removed.invalid', display_name='Former staff member' where user_id=$1", [id], c);
      await audit(actorOf(req), 'staff.anonymised', 'user', id, undefined, { reason: b.reason }, c);   // audit rows of this person's own actions are kept (append-only)
    });
    return { ok: true };
  });

  // ---------- sessions ----------
  app.post('/admin/staff/:id/sessions/revoke', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ reason: reason.optional() }), req.body);
    const u = await loadStaff(id);
    if (req.auth!.id !== id) assertOutranks(req, u.roles);
    await revokeAllSessions(pool, id);
    await audit(actorOf(req), 'staff.sessions_revoked', 'user', id, undefined, b.reason ? { reason: b.reason } : undefined); return { ok: true };
  });
  app.delete('/admin/staff/:id/sessions/:sid', pre, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), sid: z.string().uuid() }), req.params);
    const u = await loadStaff(p.id);
    if (req.auth!.id !== p.id) assertOutranks(req, u.roles);
    const r = await q1("update sessions set revoked_at=now() where id=$1 and user_id=$2 and revoked_at is null returning id", [p.sid, p.id]);
    if (!r) throw notFound('session');
    await audit(actorOf(req), 'staff.session_revoked', 'user', p.id, undefined, { session: p.sid }); return { ok: true };
  });

  // ---------- reset links: single-use, issued to the admin, completed by the person ----------
  app.post('/admin/staff/:id/reset', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ kind: z.enum(['password', 'two_factor', 'full']), reason }), req.body);
    assertNotSelf(req, id, 'issue a reset for');
    const purpose = b.kind === 'password' ? 'password_reset' : b.kind === 'two_factor' ? 'mfa_reset' : 'full_reset';
    const out = await tx(async (c) => {
      const u = await loadStaff(id, c, true);
      assertOutranks(req, u.roles);
      if (u.status !== 'active') throw conflict('not_active', u.status === 'removed' ? 'A removed account cannot be reset' : 'Enable the account first');
      if (!u.email) throw conflict('no_email', 'This account has no email');
      const l = await createLink(c, { purpose, email: u.email, name: u.display_name ?? u.email, role: u.roles[0], userId: id, by: req.auth!.id });
      if (b.kind !== 'password') await revokeAllSessions(c, id);   // a lost phone: close open sessions now
      await audit(actorOf(req), 'staff.reset_issued', 'user', id, undefined, { kind: b.kind, reason: b.reason }, c);
      return l;
    });
    return { id: out.id, kind: b.kind, reset_url: out.url, expires_at: out.expires_at, note: LINK_NOTE };
  });

  // ---------- activity: what a person did, and what was done to them ----------
  app.get('/admin/staff/:id/activity', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ view: z.enum(['by', 'about']).default('by'), action: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    await loadStaff(id);
    const col = b.view === 'by' ? 'a.actor_id = $1::uuid' : "(a.entity_type='user' and a.entity_id = $1::text)";
    const logs = await q(`select a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.actor_role, a.before, a.after, a.ip, u.display_name actor_name
      from audit_logs a left join users u on u.id=a.actor_id where ${col} and ($2::text is null or a.action like $2) order by a.id desc limit $3`, [id, b.action ? `${b.action}%` : null, b.limit]);
    return { logs };
  });
}

/** Role summaries for pickers and the roles page (also used by the staff list). */
export async function roleSummaries() {
  const rows = await q<any>(`select r.name, r.label, r.description, r.builtin, r.is_staff, r.customized,
      (select count(distinct ur.user_id)::int from user_roles ur join users u on u.id=ur.user_id where ur.role=r.name and u.status<>'removed') member_count from roles r order by r.builtin desc, r.name`);
  const staff = new Set(staffRoleNames());
  return rows.filter((r) => staff.has(r.name)).map((r) => ({ ...r, permissions: permsOfRole(r.name), immutable: r.name === 'super_admin' || r.name === 'partner_manager' }));
}
