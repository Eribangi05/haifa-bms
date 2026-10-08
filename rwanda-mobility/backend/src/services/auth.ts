import { q, q1, tx } from '../db.js';
import { config } from '../config.js';
import { getSetting } from './settings.js';
import { hmac, randomDigits, randomToken, safeEqual, sha256, verifyPassword, decrypt, verifyTotp } from '../util/crypto.js';
import { AppError, badRequest, forbidden, tooMany, unauthorized } from '../errors.js';
import { sms } from '../providers/sms.js';
import { render, DEFAULT_TEMPLATES } from './i18n.js';
import { audit } from './audit.js';
import { effectivePermissions, isStaff } from '../rbac.js';
import { ensureRbac } from './rolesStore.js';

export type Tokens = { access_token: string; refresh_token: string; expires_in: number; session_id: string; roles: string[]; permissions: string[]; user: any };
type Sign = (payload: { sub: string; sid: string; roles: string[] }, ttlS: number) => string;
export type Device = { id?: string; name?: string; ip?: string };

const ACCESS_TTL = 15 * 60;
const REFRESH_TTL_DAYS = 30;
const STAFF_SESSION_HOURS = 8;

export async function requestOtp(phone: string, dev: Device, lang: 'rw' | 'fr' | 'en' = 'rw') {
  const [cooldown, perPhone, perIp, ttl] = await Promise.all([
    getSetting('otp.resend_cooldown_s'), getSetting('otp.max_per_hour_phone'), getSetting('otp.max_per_hour_ip'), getSetting('otp.ttl_s')]);
  const last = await q1<{ created_at: Date }>('select created_at from otp_challenges where phone=$1 order by created_at desc limit 1', [phone]);
  if (last && Date.now() - last.created_at.getTime() < cooldown * 1000)
    throw new AppError(429, 'otp_cooldown', `Wait ${cooldown}s before requesting another code`, { seconds: cooldown });
  const hr = await q1<{ p: number; i: number }>(
    `select count(*) filter (where phone=$1)::int p, count(*) filter (where ip=$2)::int i
     from otp_challenges where created_at > now() - interval '1 hour'`, [phone, dev.ip ?? null]);
  if (hr!.p >= perPhone) throw tooMany('Too many codes requested for this number. Try later.');
  if (dev.ip && hr!.i >= perIp) throw tooMany('Too many codes requested from this network. Try later.');
  const code = randomDigits(6);
  await q('insert into otp_challenges(phone, code_hash, expires_at, ip, device_id) values ($1,$2, now() + make_interval(secs => $3), $4, $5)',
    [phone, hmac(config.jwtSecret, `${phone}:${code}`), ttl, dev.ip ?? null, dev.id ?? null]);
  const tpl = DEFAULT_TEMPLATES.otp[lang];
  await sms.send(phone, render(tpl.body, { code, minutes: Math.round(ttl / 60) }));
  return { expires_in: ttl, resend_in: cooldown, dev_code: config.otpDevEcho ? code : undefined };
}

export async function verifyOtp(phone: string, code: string, dev: Device, sign: Sign, opts: { lang?: string; role?: 'passenger' | 'driver'; referral?: string } = {}): Promise<Tokens> {
  const maxAttempts = await getSetting('otp.max_attempts');
  const ch = await q1<any>(
    `select * from otp_challenges where phone=$1 and consumed_at is null and expires_at > now() order by created_at desc limit 1`, [phone]);
  if (!ch) throw badRequest('otp_invalid', 'Code expired or not requested');
  // Atomic: parallel guesses cannot slip past the attempt cap between the check and the increment.
  const bumped = await q('update otp_challenges set attempts = attempts + 1 where id=$1 and attempts < $2 returning id', [ch.id, maxAttempts]);
  if (!bumped.length) throw tooMany('Too many wrong attempts. Request a new code.');
  if (!safeEqual(ch.code_hash, hmac(config.jwtSecret, `${phone}:${code}`))) throw badRequest('otp_invalid', 'Wrong code');
  const used = await q('update otp_challenges set consumed_at=now() where id=$1 and consumed_at is null returning id', [ch.id]);
  if (!used.length) throw badRequest('otp_invalid', 'Code already used');

  let user = await q1<any>('select * from users where phone=$1', [phone]);
  if (!user) {
    // suspicious registration: many new accounts from one device in 24h
    if (dev.id) {
      const n = await q1<{ n: number }>("select count(*)::int n from users where device_fingerprint=$1 and created_at > now() - interval '24 hours'", [dev.id]);
      if (n!.n >= 3) throw new AppError(429, 'suspicious_registration', 'Too many accounts created from this device');
    }
    const lang = opts.lang === 'en' || opts.lang === 'fr' ? opts.lang : 'rw';
    user = await tx(async (c) => {
      const u = await q1<any>(
        `insert into users(phone, preferred_language, device_fingerprint, referral_code) values ($1,$2,$3,$4) returning *`,
        [phone, lang, dev.id ?? null, 'RM' + randomToken(5).replace(/[^A-Za-z0-9]/g, 'X').toUpperCase().slice(0, 6)], c);
      await q("insert into user_roles values ($1,'passenger')", [u.id], c);
      await q("insert into consents(user_id,kind,version,granted) values ($1,'terms','v1',true),($1,'privacy','v1',true)", [u.id], c);
      if (opts.referral) {
        const r = await q1<{ id: string }>('select id from users where referral_code=$1 and id <> $2', [opts.referral.toUpperCase(), u.id], c);
        if (r) await q('insert into referrals(referrer_id, referee_id) values ($1,$2) on conflict do nothing', [r.id, u.id], c);
      }
      return u;
    });
  }
  if (user.status === 'deactivated' || user.status === 'deleted' || user.status === 'restricted') throw forbidden('Account is not active');
  if (opts.role === 'driver') {
    await tx(async (c) => {
      await q("insert into user_roles values ($1,'driver') on conflict do nothing", [user.id], c);
      await q('insert into driver_profiles(user_id) values ($1) on conflict do nothing', [user.id], c);
    });
  }
  return issueSession(user.id, dev, sign, false);
}

async function rolesOf(userId: string): Promise<string[]> {
  return (await q<{ role: string }>('select role from user_roles where user_id=$1', [userId])).map((r) => r.role);
}

export async function issueSession(userId: string, dev: Device, sign: Sign, privileged: boolean): Promise<Tokens> {
  const roles = await rolesOf(userId);
  await ensureRbac();
  const refresh = randomToken(40);
  const ttlMs = privileged ? STAFF_SESSION_HOURS * 3600e3 : REFRESH_TTL_DAYS * 86400e3;
  const s = await q1<{ id: string }>(
    `insert into sessions(user_id, refresh_hash, device_id, device_name, ip, privileged, expires_at) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [userId, sha256(refresh), dev.id ?? null, dev.name ?? null, dev.ip ?? null, privileged, new Date(Date.now() + ttlMs)]);
  const user = await q1<any>('select id, phone, email, display_name, preferred_language, status from users where id=$1', [userId]);
  return { access_token: sign({ sub: userId, sid: s!.id, roles }, ACCESS_TTL), refresh_token: refresh, expires_in: ACCESS_TTL, session_id: s!.id, roles, permissions: isStaff(roles) ? effectivePermissions(roles) : [], user };
}

export async function refresh(token: string, dev: Device, sign: Sign): Promise<Tokens> {
  const s = await q1<any>('select * from sessions where refresh_hash=$1', [sha256(token)]);
  if (!s) throw unauthorized('invalid refresh token');
  if (s.revoked_at) {
    // refresh-token reuse => assume theft, kill all sessions of the user
    await q('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [s.user_id]);
    await audit({ id: s.user_id, ip: dev.ip }, 'auth.refresh_reuse_detected', 'session', s.id);
    throw unauthorized('session revoked');
  }
  if (new Date(s.expires_at) < new Date()) throw unauthorized('session expired');
  const u = await q1<any>('select status from users where id=$1', [s.user_id]);
  if (!u || ['deactivated', 'deleted', 'restricted', 'removed'].includes(u.status)) throw forbidden('Account is not active');
  // Rotation is single-use even under a race: of two parallel refreshes with the same token only one may win.
  const won = await q('update sessions set revoked_at=now() where id=$1 and revoked_at is null returning id', [s.id]);
  if (!won.length) throw unauthorized('session revoked');
  return issueSession(s.user_id, { id: s.device_id, name: s.device_name, ip: dev.ip }, sign, s.privileged);
}

export async function staffLogin(email: string, password: string, totp: string, dev: Device, sign: Sign): Promise<Tokens> {
  const u = await q1<any>('select * from users where lower(email)=lower($1)', [email]);
  const generic = unauthorized('invalid credentials');
  if (u?.locked_until && new Date(u.locked_until) > new Date()) throw new AppError(423, 'locked', 'Account temporarily locked');
  const ok = await verifyPassword(password, u?.password_hash ?? null);
  const roles = u ? await rolesOf(u.id) : [];
  await ensureRbac();
  const staff = isStaff(roles);
  const mfaOk = !!(u && ok && staff && u.mfa_enabled && u.mfa_secret_enc && verifyTotp(decrypt(u.mfa_secret_enc), totp));
  if (!u || !ok || !staff || !mfaOk || u.status !== 'active') {
    if (u) {
      const n = u.failed_logins + 1;
      await q('update users set failed_logins=$2, locked_until = case when $2 >= 5 then now() + interval \'15 minutes\' else null end where id=$1', [u.id, n]);
      await audit({ id: u.id, ip: dev.ip }, 'auth.staff_login_failed', 'user', u.id);
    }
    throw generic;
  }
  await q('update users set failed_logins=0, locked_until=null where id=$1', [u.id]);
  await audit({ id: u.id, role: roles[0], ip: dev.ip }, 'auth.staff_login', 'user', u.id);
  return issueSession(u.id, dev, sign, true);
}

/** The live session check for every authenticated request. Returns the user's roles as stored NOW (not as they were when the token was issued), so a role change applies at once. */
export async function sessionInfo(sid: string, userId: string): Promise<{ roles: string[] } | null> {
  const s = await q1<{ revoked_at: Date | null; expires_at: Date; status: string; roles: string[] }>(
    'select s.revoked_at, s.expires_at, u.status, array(select role from user_roles r where r.user_id=u.id) roles from sessions s join users u on u.id=s.user_id where s.id=$1 and s.user_id=$2', [sid, userId]);
  if (!s || s.revoked_at || s.expires_at < new Date() || s.status !== 'active') return null;
  await q('update sessions set last_used_at=now() where id=$1 and last_used_at < now() - interval \'1 minute\'', [sid]);
  return { roles: s.roles };
}
export async function sessionValid(sid: string, userId: string): Promise<boolean> { return !!(await sessionInfo(sid, userId)); }
