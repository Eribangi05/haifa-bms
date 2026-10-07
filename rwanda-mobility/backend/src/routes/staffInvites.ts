import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { parse } from '../util/validate.js';
import { requirePerm, actorOf, routeLimit } from '../guards.js';
import { q, q1, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { ROLE_PERMISSIONS, STAFF_ROLES } from '../rbac.js';
import { config } from '../config.js';
import { audit } from '../services/audit.js';
import { decrypt, encrypt, hashPassword, newTotpSecret, randomToken, sha256, totpUri, verifyTotp } from '../util/crypto.js';

const INVITE_HOURS = 48;
const tokenp = z.object({ token: z.string().min(20).max(80) });

async function loadInvite(token: string) {
  const inv = await q1<any>('select * from staff_invites where token_hash=$1', [sha256(token)]);
  if (!inv || inv.used_at || inv.revoked_at) throw badRequest('invite_invalid', 'This invitation is not valid');
  if (new Date(inv.expires_at).getTime() < Date.now()) throw badRequest('invite_expired', 'This invitation has expired');
  return inv;
}

export async function staffInviteRoutes(app: FastifyInstance) {
  // ---- admin side: create / list / revoke. The admin gets a link, never the invitee's authenticator secret ----
  app.post('/admin/staff/invites', { preHandler: requirePerm('users.manage') }, async (req) => {
    const b = parse(z.object({ email: z.string().email(), name: z.string().min(2).max(80), role: z.enum(STAFF_ROLES as [string, ...string[]]) }), req.body);
    if (b.role === 'super_admin' && !req.auth!.roles.includes('super_admin')) throw forbidden();
    const email = b.email.trim().toLowerCase();
    if (await q1('select 1 from users where lower(email)=$1', [email])) throw conflict('email_in_use', 'Email already registered');
    await q("update staff_invites set revoked_at=now() where lower(email)=$1 and used_at is null and revoked_at is null", [email]);
    const token = randomToken(32);
    const expires = new Date(Date.now() + INVITE_HOURS * 3600_000);
    const inv = await q1<{ id: string }>(
      'insert into staff_invites(email, display_name, role, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5,$6) returning id',
      [email, b.name, b.role, sha256(token), req.auth!.id, expires]);
    await audit(actorOf(req), 'staff.invited', 'staff_invite', inv!.id, undefined, { email, role: b.role });
    const base = (config.publicBaseUrl || '').replace(/\/$/, '');
    return { id: inv!.id, invite_url: `${base}/admin/#activate=${token}`, expires_at: expires.toISOString(), note: 'Shown once. Send it only to the invitee. They set their own password and scan their own authenticator QR code; you will never see it.' };
  });
  app.get('/admin/staff/invites', { preHandler: requirePerm('users.manage') }, async () => ({
    invites: await q("select id, email, display_name, role, expires_at, created_at from staff_invites where used_at is null and revoked_at is null and expires_at > now() order by created_at desc"),
  }));
  app.delete('/admin/staff/invites/:id', { preHandler: requirePerm('users.manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await q1("update staff_invites set revoked_at=now() where id=$1 and used_at is null and revoked_at is null returning id", [id]);
    if (!r) throw notFound('invitation');
    await audit(actorOf(req), 'staff.invite_revoked', 'staff_invite', id); return { ok: true };
  });

  // ---- invitee side (public, token-gated, rate limited) ----
  const limit = routeLimit('INVITE_RATE_MAX', 15).rateLimit;
  app.get('/staff-invite/:token', { config: { rateLimit: limit } }, async (req) => {
    const inv = await loadInvite(parse(tokenp, req.params).token);
    return { email: inv.email, name: inv.display_name, role: inv.role };
  });
  // Generates the invitee's own authenticator secret and returns it (as QR + text) to the invitee's browser only.
  app.post('/staff-invite/:token/begin', { config: { rateLimit: limit } }, async (req) => {
    const inv = await loadInvite(parse(tokenp, req.params).token);
    const secret = newTotpSecret();
    await q('update staff_invites set pending_mfa_enc=$2 where id=$1', [inv.id, encrypt(secret)]);
    const uri = totpUri(secret, inv.email);
    return { secret, otpauth_uri: uri, qr_svg: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 220 }) };
  });
  app.post('/staff-invite/:token/activate', { config: { rateLimit: limit } }, async (req) => {
    const { token } = parse(tokenp, req.params);
    const b = parse(z.object({ password: z.string().min(12).max(128), code: z.string().regex(/^\d{6}$/) }), req.body);
    const inv = await loadInvite(token);
    if (!inv.pending_mfa_enc) throw badRequest('mfa_not_started', 'Scan the QR code first');
    const secret = decrypt(inv.pending_mfa_enc);
    if (!verifyTotp(secret, b.code)) throw badRequest('otp_invalid', 'Wrong code');
    if (!ROLE_PERMISSIONS[inv.role]) throw badRequest('invite_invalid', 'This invitation is not valid');
    const hash = await hashPassword(b.password);
    const uid = await tx(async (db) => {   // (a 23505 below means the e-mail was registered after the invite was issued)
      const used = await db.query('update staff_invites set used_at=now() where id=$1 and used_at is null and revoked_at is null returning id', [inv.id]);
      if (!used.rowCount) throw badRequest('invite_invalid', 'This invitation is not valid');
      const u = await db.query('insert into users(email,password_hash,display_name,mfa_secret_enc,mfa_enabled) values ($1,$2,$3,$4,true) returning id', [inv.email, hash, inv.display_name, inv.pending_mfa_enc])
        .catch((e: any) => { throw e.code === '23505' ? conflict('email_in_use', 'Email already registered') : e; });
      await db.query('insert into user_roles(user_id, role) values ($1,$2)', [u.rows[0].id, inv.role]);
      return u.rows[0].id as string;
    });
    await audit({ id: uid, role: inv.role, ip: req.ip }, 'staff.activated', 'user', uid, undefined, { email: inv.email, role: inv.role });
    return { ok: true, email: inv.email };
  });
}
