import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { parse } from '../util/validate.js';
import { requirePerm, actorOf, routeLimit } from '../guards.js';
import { q, q1, tx, pool } from '../db.js';
import { badRequest, conflict, forbidden, notFound, AppError } from '../errors.js';
import { staffRoleNames } from '../rbac.js';
import { audit } from '../services/audit.js';
import { ensureRbac } from '../services/rolesStore.js';
import { assertCanGrantRoles, assertOutranks, createLink, revokeAllSessions, isSuperReq, maskEmail } from '../services/staffAdmin.js';
import { decrypt, encrypt, hashPassword, newTotpSecret, sha256, totpUri, verifyPassword, verifyTotp } from '../util/crypto.js';

const tokenp = z.object({ token: z.string().min(20).max(80) });
const LINK_NOTE = 'Shown once. Send it only to the person it is for. They choose their own credentials on their own device; you will never see them.';

async function loadInvite(token: string) {
  const inv = await q1<any>('select * from staff_invites where token_hash=$1', [sha256(token)]);
  if (!inv || inv.used_at || inv.revoked_at) throw badRequest('invite_invalid', 'This link is not valid');
  if (new Date(inv.expires_at).getTime() < Date.now()) throw badRequest('invite_expired', 'This link has expired');
  if (inv.user_id) {   // a reset link is only good for an account that is still active
    const u = await q1<any>('select status from users where id=$1', [inv.user_id]);
    if (!u || u.status !== 'active') throw badRequest('invite_invalid', 'This link is not valid');
  }
  return inv;
}
/** Wrong credentials on a reset link count against the same lock-out as sign-in, so a leaked link cannot be used to guess a code or password. */
async function bumpFail(userId: string, ip: string) {
  const u = await q1<any>("update users set failed_logins=failed_logins+1, locked_until = case when failed_logins+1 >= 5 then now() + interval '15 minutes' else locked_until end where id=$1 returning failed_logins", [userId]);
  await audit({ id: userId, ip }, 'auth.reset_link_failed', 'user', userId, undefined, { failed: u?.failed_logins });
}

export async function staffInviteRoutes(app: FastifyInstance) {
  // ---- admin side: create / list / regenerate / revoke. The admin gets a link, never the person's authenticator key ----
  app.post('/admin/staff/invites', { preHandler: requirePerm('users.manage') }, async (req) => {
    const b = parse(z.object({ email: z.string().email(), name: z.string().trim().min(2).max(80), role: z.string().min(2).max(40) }), req.body);
    assertCanGrantRoles(req, [b.role]);
    const email = b.email.trim().toLowerCase();
    if (await q1('select 1 from users where lower(email)=$1', [email])) throw conflict('email_in_use', 'Email already registered');
    const l = await createLink(pool, { purpose: 'invite', email, name: b.name, role: b.role, by: req.auth!.id });
    await audit(actorOf(req), 'staff.invited', 'staff_invite', l.id, undefined, { role: b.role, email: maskEmail(email) });
    return { id: l.id, invite_url: l.url, expires_at: l.expires_at, note: LINK_NOTE };
  });
  app.get('/admin/staff/invites', { preHandler: requirePerm('users.manage') }, async () => ({
    invites: await q("select id, email, display_name, role, purpose, user_id, expires_at, created_at from staff_invites where used_at is null and revoked_at is null and expires_at > now() order by created_at desc"),
  }));
  app.delete('/admin/staff/invites/:id', { preHandler: requirePerm('users.manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const inv = await q1<any>('select role from staff_invites where id=$1 and used_at is null and revoked_at is null', [id]);
    if (!inv) throw notFound('invitation');
    if (inv.role === 'super_admin' && !isSuperReq(req)) throw forbidden('Only a super admin can manage a super admin invitation');
    await q('update staff_invites set revoked_at=now() where id=$1', [id]);
    await audit(actorOf(req), 'staff.invite_revoked', 'staff_invite', id); return { ok: true };
  });
  // New link for a pending invitation (or reset) whose link was lost or expired. The old link stops working at once.
  app.post('/admin/staff/invites/:id/regenerate', { preHandler: requirePerm('users.manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const inv = await q1<any>('select * from staff_invites where id=$1 and used_at is null', [id]);
    if (!inv) throw notFound('invitation');
    if (inv.user_id) {   // a reset link: the person must still be someone the caller may manage
      const roles = (await q<{ role: string }>('select role from user_roles where user_id=$1', [inv.user_id])).map((r) => r.role);
      assertOutranks(req, roles);
      if (req.auth!.id === inv.user_id) throw forbidden('You cannot issue a reset link for your own account');
    } else { assertCanGrantRoles(req, [inv.role]); }
    const l = await tx(async (c) => {
      await q('update staff_invites set revoked_at=now() where id=$1 and revoked_at is null', [id], c);
      return createLink(c, { purpose: inv.purpose, email: inv.email, name: inv.display_name, role: inv.role, userId: inv.user_id, partnerId: inv.partner_id, by: req.auth!.id });
    });
    await audit(actorOf(req), 'staff.invite_regenerated', 'staff_invite', l.id, { replaced: id }, { purpose: inv.purpose });
    return { id: l.id, invite_url: l.url, expires_at: l.expires_at, note: LINK_NOTE };
  });

  // ---- the person's side (public, token-gated, rate limited) ----
  const limit = routeLimit('INVITE_RATE_MAX', 15).rateLimit;
  app.get('/staff-invite/:token', { config: { rateLimit: limit } }, async (req) => {
    const inv = await loadInvite(parse(tokenp, req.params).token);
    return { email: inv.email, name: inv.display_name, role: inv.role, purpose: inv.purpose };
  });
  // Generates the person's own authenticator key and returns it (as QR + text) to their browser only.
  app.post('/staff-invite/:token/begin', { config: { rateLimit: limit } }, async (req) => {
    const inv = await loadInvite(parse(tokenp, req.params).token);
    if (inv.purpose === 'password_reset') throw badRequest('mfa_not_needed', 'This link only resets the password');
    const secret = newTotpSecret();
    await q('update staff_invites set pending_mfa_enc=$2 where id=$1', [inv.id, encrypt(secret)]);
    const uri = totpUri(secret, inv.email);
    return { secret, otpauth_uri: uri, qr_svg: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 220 }) };
  });
  app.post('/staff-invite/:token/activate', { config: { rateLimit: limit } }, async (req) => {
    const { token } = parse(tokenp, req.params);
    const b = parse(z.object({ password: z.string().min(12).max(128).optional(), current_password: z.string().max(128).optional(), code: z.string().regex(/^\d{6}$/) }), req.body);
    const inv = await loadInvite(token);
    const ip = req.ip;
    await ensureRbac();

    if (inv.purpose === 'password_reset' || inv.purpose === 'mfa_reset') {
      // Proof of the factor the person still has: the current authenticator (password reset) or the current password (two-factor reset).
      const u = await q1<any>('select id, password_hash, mfa_secret_enc, locked_until from users where id=$1', [inv.user_id]);
      if (!u) throw badRequest('invite_invalid', 'This link is not valid');
      if (u.locked_until && new Date(u.locked_until) > new Date()) throw new AppError(423, 'locked', 'Too many wrong attempts. Try again in 15 minutes.');
      if (inv.purpose === 'password_reset') {
        if (!b.password) throw badRequest('password_required', 'Choose a new password');
        if (!u.mfa_secret_enc || !verifyTotp(decrypt(u.mfa_secret_enc), b.code)) { await bumpFail(u.id, ip); throw badRequest('otp_invalid', 'Wrong code'); }
        const hash = await hashPassword(b.password);
        await tx(async (c) => {
          const used = await c.query('update staff_invites set used_at=now() where id=$1 and used_at is null and revoked_at is null returning id', [inv.id]);
          if (!used.rowCount) throw badRequest('invite_invalid', 'This link is not valid');
          await c.query('update users set password_hash=$2, failed_logins=0, locked_until=null, updated_at=now() where id=$1', [u.id, hash]);
          await revokeAllSessions(c, u.id);
        });
        await audit({ id: u.id, ip }, 'staff.password_reset_completed', 'user', u.id);
      } else {
        if (!b.current_password) throw badRequest('password_required', 'Enter your current password');
        if (!inv.pending_mfa_enc) throw badRequest('mfa_not_started', 'Scan the QR code first');
        if (!(await verifyPassword(b.current_password, u.password_hash))) { await bumpFail(u.id, ip); throw badRequest('password_invalid', 'Wrong password'); }
        if (!verifyTotp(decrypt(inv.pending_mfa_enc), b.code)) throw badRequest('otp_invalid', 'Wrong code');
        await tx(async (c) => {
          const used = await c.query('update staff_invites set used_at=now() where id=$1 and used_at is null and revoked_at is null returning id', [inv.id]);
          if (!used.rowCount) throw badRequest('invite_invalid', 'This link is not valid');
          await c.query('update users set mfa_secret_enc=$2, mfa_enabled=true, failed_logins=0, locked_until=null, updated_at=now() where id=$1', [u.id, inv.pending_mfa_enc]);
          await revokeAllSessions(c, u.id);
        });
        await audit({ id: u.id, ip }, 'staff.mfa_reset_completed', 'user', u.id);
      }
      return { ok: true, email: inv.email };
    }

    // invite (new account) and full_reset (new password AND new authenticator)
    if (!b.password) throw badRequest('password_required', 'Choose a password');
    if (!inv.pending_mfa_enc) throw badRequest('mfa_not_started', 'Scan the QR code first');
    const secret = decrypt(inv.pending_mfa_enc);
    if (!verifyTotp(secret, b.code)) throw badRequest('otp_invalid', 'Wrong code');
    const hash = await hashPassword(b.password);
    if (inv.purpose === 'full_reset') {
      await tx(async (c) => {
        const used = await c.query('update staff_invites set used_at=now() where id=$1 and used_at is null and revoked_at is null returning id', [inv.id]);
        if (!used.rowCount) throw badRequest('invite_invalid', 'This link is not valid');
        await c.query('update users set password_hash=$2, mfa_secret_enc=$3, mfa_enabled=true, failed_logins=0, locked_until=null, updated_at=now() where id=$1', [inv.user_id, hash, inv.pending_mfa_enc]);
        await revokeAllSessions(c, inv.user_id);
      });
      await audit({ id: inv.user_id, ip }, 'staff.full_reset_completed', 'user', inv.user_id);
      return { ok: true, email: inv.email };
    }
    if (!staffRoleNames().includes(inv.role)) throw badRequest('invite_invalid', 'This invitation is not valid');
    const uid = await tx(async (db) => {   // (a 23505 below means the e-mail was registered after the invite was issued)
      const used = await db.query('update staff_invites set used_at=now() where id=$1 and used_at is null and revoked_at is null returning id', [inv.id]);
      if (!used.rowCount) throw badRequest('invite_invalid', 'This invitation is not valid');
      const u = await db.query('insert into users(email,password_hash,display_name,mfa_secret_enc,mfa_enabled) values ($1,$2,$3,$4,true) returning id', [inv.email, hash, inv.display_name, inv.pending_mfa_enc])
        .catch((e: any) => { throw e.code === '23505' ? conflict('email_in_use', 'Email already registered') : e; });
      await db.query('insert into user_roles(user_id, role) values ($1,$2)', [u.rows[0].id, inv.role]);
      if (inv.partner_id) await db.query('insert into partner_users(user_id, partner_id) values ($1,$2)', [u.rows[0].id, inv.partner_id]);   // partner manager: bound to exactly this partner
      return u.rows[0].id as string;
    });
    await audit({ id: uid, role: inv.role, ip }, 'staff.activated', 'user', uid, undefined, { role: inv.role });
    return { ok: true, email: inv.email };
  });
}
