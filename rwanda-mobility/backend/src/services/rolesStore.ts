import { q, q1, tx } from '../db.js';
import { ROLE_PERMISSIONS, STAFF_ROLES, setRbacSnapshot, type RbacSnapshot } from '../rbac.js';

// Role -> permission maps live in the database (roles, role_permissions). This module keeps a short in-process cache and refreshes it
// the moment anything changes (invalidateRbac). Other server instances pick a change up within TTL_MS. Failure to read the tables
// falls back to the built-in defaults in rbac.ts, so the console can always be reached to repair things.
const TTL_MS = Number(process.env.RBAC_CACHE_MS ?? 15_000);
let loadedAt = 0;
let inflight: Promise<void> | null = null;

export type RoleRow = { name: string; label: string | null; description: string | null; builtin: boolean; is_staff: boolean; customized: boolean };

/** Pure: builds the snapshot from database rows (exported for tests). */
export function buildSnapshot(roles: RoleRow[], rolePerms: { role: string; permission: string }[]): RbacSnapshot {
  const fromDb = new Map<string, string[]>();
  for (const rp of rolePerms) { const l = fromDb.get(rp.role) ?? []; l.push(rp.permission); fromDb.set(rp.role, l); }
  const perms = new Map<string, string[]>(), staff = new Set<string>(STAFF_ROLES);
  for (const [name, def] of Object.entries(ROLE_PERMISSIONS)) perms.set(name, def);   // built-in defaults first
  for (const r of roles) {
    if (r.name === 'super_admin') { perms.set('super_admin', ['*']); continue; }    // immutable: always everything
    if (r.builtin || name_isBuiltin(r.name)) { if (r.customized) perms.set(r.name, fromDb.get(r.name) ?? []); }
    else { perms.set(r.name, fromDb.get(r.name) ?? []); if (r.is_staff) staff.add(r.name); }
  }
  return { perms, staff };
}
const name_isBuiltin = (n: string) => n in ROLE_PERMISSIONS;

async function reload() {
  try {
    const [roles, rp] = await Promise.all([
      q<RoleRow>('select name, label, description, builtin, is_staff, customized from roles'),
      q<{ role: string; permission: string }>('select role, permission from role_permissions')]);
    setRbacSnapshot(buildSnapshot(roles, rp));
  } catch { setRbacSnapshot(null); }   // tables unreadable: static defaults
  loadedAt = Date.now();
}

/** Called before every permission decision on a request path. Cheap: one timestamp compare unless the cache is older than the TTL. */
export async function ensureRbac(): Promise<void> {
  if (loadedAt && Date.now() - loadedAt < TTL_MS) return;
  inflight ||= reload().finally(() => { inflight = null; });
  await inflight;
}
/** After any change to roles, role_permissions or role assignment: reload now in this process; other processes follow within the TTL. */
export async function invalidateRbac(): Promise<void> { loadedAt = 0; inflight = null; await ensureRbac(); }

export async function getRole(name: string) {
  return q1<RoleRow & { updated_at: Date }>('select name, label, description, builtin, is_staff, customized, updated_at from roles where name=$1', [name]);
}

/** Writes a role's permission set in one transaction (replace semantics). */
export async function setRolePermissions(role: string, perms: string[], opts: { customized?: boolean; actor?: string } = {}) {
  await tx(async (c) => {
    await q('delete from role_permissions where role=$1', [role], c);
    for (const p of [...new Set(perms)]) await q('insert into role_permissions(role, permission) values ($1,$2)', [role, p], c);
    await q('update roles set updated_at=now(), updated_by=$2, customized=coalesce($3, customized) where name=$1', [role, opts.actor ?? null, opts.customized ?? null], c);
  });
}
