import '@fastify/multipart';
import '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from './errors.js';
import { sessionInfo } from './services/auth.js';
import { ensureRbac } from './services/rolesStore.js';
import { can, isStaff } from './rbac.js';

export type AuthUser = { id: string; roles: string[]; sid: string };
declare module 'fastify' { interface FastifyRequest { auth?: AuthUser } }

export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  let p: any;
  try { p = await req.jwtVerify(); } catch { throw unauthorized(); }
  const info = await sessionInfo(p.sid, p.sub);
  if (!info) throw unauthorized('session ended');
  await ensureRbac();   // role -> permission map from the database (short cache, invalidated on every change)
  req.auth = { id: p.sub, roles: info.roles, sid: p.sid };   // roles are re-read from the database, never trusted from the token
}
export const requireRole = (...roles: string[]) => async (req: FastifyRequest, reply: FastifyReply) => {
  await authenticate(req, reply);
  if (!req.auth!.roles.some((r) => roles.includes(r))) throw forbidden();
};
export const requirePerm = (perm: string) => async (req: FastifyRequest, reply: FastifyReply) => {
  await authenticate(req, reply);
  if (!isStaff(req.auth!.roles) || !can(req.auth!.roles, perm)) throw forbidden(`missing permission ${perm}`);
};
/** Passes when the caller holds ANY of the listed permissions. */
export const requireAnyPerm = (...perms: string[]) => async (req: FastifyRequest, reply: FastifyReply) => {
  await authenticate(req, reply);
  if (!isStaff(req.auth!.roles) || !perms.some((p) => can(req.auth!.roles, p))) throw forbidden(`missing permission ${perms.join(' or ')}`);
};
export const anyAuth = authenticate;
export const actorOf = (req: FastifyRequest) => ({ id: req.auth!.id, role: req.auth!.roles[0], ip: req.ip });

/**
 * Rate-limit key for authenticated routes: the (unverified) token subject, else the IP. Unverified is fine because these routes
 * reject forged tokens right after in `authenticate`, before any database work; it only keeps users behind one carrier NAT apart.
 */
export const userRateKey = (req: FastifyRequest): string => {
  try {
    const h = String(req.headers.authorization ?? '');
    if (h.startsWith('Bearer ')) { const sub = JSON.parse(Buffer.from(h.slice(7).split('.')[1] ?? '', 'base64url').toString()).sub; if (typeof sub === 'string') return `u:${sub}`; }
  } catch { /* fall through */ }
  return `ip:${req.ip}`;
};
/** Stricter per-route limit (per user when signed in). `envName` lets operators tune it; tests raise it. */
export const routeLimit = (envName: string, def: number, windowS = 60) =>
  ({ rateLimit: { max: Number(process.env[envName] ?? def), timeWindow: `${windowS} seconds`, keyGenerator: userRateKey } });
