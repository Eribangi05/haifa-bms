import type { FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { q, q1, pool } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { config } from '../config.js';
import { effectivePermissions, permsOfRole, staffRoleNames } from '../rbac.js';
import { SUPER_ONLY_PERMISSIONS } from '../permissions.js';
import { randomToken, sha256 } from '../util/crypto.js';

// Shared rules for everything that changes staff: who may touch whom, role assignment limits, the last-super-admin lock, reset links.
export const LINK_HOURS = 48;
export type LinkPurpose = 'invite' | 'password_reset' | 'mfa_reset' | 'full_reset';

export const isSuperReq = (req: FastifyRequest) => req.auth!.roles.includes('super_admin');
export const maskEmail = (e: string | null | undefined) => { if (!e) return null; const [l, d] = e.split('@'); return `${l.slice(0, 1)}***@${d ?? ''}`; };

/** What the caller may do is bounded by what the caller holds: a non-super-admin can never hand out, or reach, more than they have themselves. */
const holdsAll = (callerRoles: string[], needed: string[]) => {
  const mine = effectivePermissions(callerRoles);
  if (mine.includes('*')) return true;
  const have = new Set(mine);
  return needed.every((p) => have.has(p));
};
export function assertCanGrantRoles(req: FastifyRequest, roles: string[]) {
  const valid = new Set(staffRoleNames());
  for (const r of roles) {
    if (!valid.has(r)) throw badRequest('unknown_role', `Unknown staff role: ${r}`);
    if (r === 'partner_manager') throw badRequest('partner_required', 'A venue partner manager is invited from the partner page');
    if (isSuperReq(req)) continue;
    if (r === 'super_admin') throw forbidden('Only a super admin can give the super admin role');
    const p = permsOfRole(r);
    if (p.includes('*') || !holdsAll(req.auth!.roles, p)) throw forbidden(`You cannot give the role ${r}: it allows things your own roles do not`);
  }
}
/** A non-super-admin may only manage people whose access is no wider than their own; a super admin may manage anyone (except themselves, checked by the caller). */
export function assertOutranks(req: FastifyRequest, targetRoles: string[]) {
  if (isSuperReq(req)) return;
  if (targetRoles.includes('super_admin')) throw forbidden('Only a super admin can manage a super admin');
  const p = effectivePermissions(targetRoles);
  if (p.includes('*') || !holdsAll(req.auth!.roles, p)) throw forbidden('You cannot manage someone with more access than you have');
}
export function assertNotSelf(req: FastifyRequest, targetId: string, what = 'do this to') {
  if (req.auth!.id === targetId) throw forbidden(`You cannot ${what} your own account. Ask another administrator.`);
}
export const canGrantPermission = (req: FastifyRequest, perm: string) => isSuperReq(req) ? true : !SUPER_ONLY_PERMISSIONS.has(perm) && holdsAll(req.auth!.roles, [perm]);

/** Locks every active super admin row, then refuses when `targetId` is the only one left. Call inside the same transaction as the change. */
export async function assertNotLastSuperAdmin(c: Db, targetId: string) {
  const rows = await q<{ id: string }>("select u.id from users u join user_roles r on r.user_id=u.id and r.role='super_admin' where u.status='active' order by u.id for update of u", [], c);
  if (!rows.some((r) => r.id !== targetId)) throw conflict('last_super_admin', 'This is the last active super admin. Make someone else a super admin first.');
}
export const revokeAllSessions = (c: Db, userId: string) => q('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [userId], c);

export async function loadStaff(id: string, c: Db = pool, lock = false) {
  const u = await q1<any>(`select u.id, u.email, u.display_name, u.status, u.mfa_enabled, u.removed_at, u.anonymised_at, u.created_at,
      array(select role from user_roles r where r.user_id=u.id order by role) roles from users u where u.id=$1 ${lock ? 'for update of u' : ''}`, [id], c);
  if (!u) throw notFound('staff member');
  const s = new Set(staffRoleNames());
  if (!u.removed_at && !u.roles.some((r: string) => s.has(r))) throw notFound('staff member');
  return u as { id: string; email: string | null; display_name: string | null; status: string; mfa_enabled: boolean; removed_at: Date | null; anonymised_at: Date | null; created_at: Date; roles: string[] };
}
export const publicStatus = (s: string) => (s === 'deactivated' ? 'disabled' : s);

/** Creates a single-use activation link (new staff, or a password / two-factor / full reset). Earlier open links for the same person are revoked. The token appears only in the returned URL. */
export async function createLink(c: Db, o: { purpose: LinkPurpose; email: string; name: string; role: string; userId?: string | null; partnerId?: string | null; by: string }) {
  if (o.userId) await q('update staff_invites set revoked_at=now() where user_id=$1 and used_at is null and revoked_at is null', [o.userId], c);
  else await q('update staff_invites set revoked_at=now() where lower(email)=$1 and used_at is null and revoked_at is null', [o.email.toLowerCase()], c);
  const token = randomToken(32);
  const expires = new Date(Date.now() + LINK_HOURS * 3600_000);
  const row = await q1<{ id: string }>(
    'insert into staff_invites(email, display_name, role, token_hash, invited_by, expires_at, purpose, user_id, partner_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
    [o.email.toLowerCase(), o.name, o.role, sha256(token), o.by, expires, o.purpose, o.userId ?? null, o.partnerId ?? null], c);
  const base = (config.publicBaseUrl || '').replace(/\/$/, '');
  return { id: row!.id, url: `${base}/admin/#activate=${token}`, expires_at: expires.toISOString() };
}
