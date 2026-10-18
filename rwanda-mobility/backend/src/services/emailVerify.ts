import { q, q1 } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest, conflict } from '../errors.js';
import { hmac, randomDigits } from '../util/crypto.js';
import { email } from '../providers/email.js';

const TTL_MIN = 15, COOLDOWN_S = 60, MAX_PER_HOUR = 5, MAX_ATTEMPTS = 5;
const TEXT: Record<'rw' | 'fr' | 'en', { subject: string; body: (code: string) => string }> = {
  en: { subject: 'Your Abasare email code', body: (c) => `Your Abasare code is ${c}. It works for ${TTL_MIN} minutes. If you did not ask for it, ignore this message.` },
  rw: { subject: 'Kode yawe ya Abasare kuri email', body: (c) => `Kode yawe ya Abasare ni ${c}. Imara iminota ${TTL_MIN}. Niba utayisabye, ntugire icyo ukora kuri ubu butumwa.` },
  fr: { subject: 'Votre code Abasare par email', body: (c) => `Votre code Abasare est ${c}. Il est valable ${TTL_MIN} minutes. Si vous ne l'avez pas demandé, ignorez ce message.` },
};
const lang = (l: string | null | undefined): 'rw' | 'fr' | 'en' => (l === 'fr' || l === 'en' ? l : 'rw');

/** Send a code to the address on the account. One minute between codes, five per hour; the code is stored only as a keyed hash. */
export async function requestEmailCode(userId: string) {
  const u = await q1<any>('select email, email_verified_at, preferred_language from users where id=$1', [userId]);
  if (!u?.email) throw badRequest('email_missing', 'Add an email address first');
  if (u.email_verified_at) throw conflict('email_already_verified', 'This email is already verified');
  const last = await q1<any>('select created_at from email_verifications where user_id=$1 order by created_at desc limit 1', [userId]);
  if (last && Date.now() - last.created_at.getTime() < COOLDOWN_S * 1000) throw new AppError(429, 'email_cooldown', `Wait ${COOLDOWN_S}s before asking for another code`, { seconds: COOLDOWN_S });
  const n = await q1<any>("select count(*)::int n from email_verifications where user_id=$1 and created_at > now() - interval '1 hour'", [userId]);
  if (n.n >= MAX_PER_HOUR) throw new AppError(429, 'email_too_many', 'Too many codes requested. Try later.');
  const code = randomDigits(6);
  await q('insert into email_verifications(user_id, email, code_hash, expires_at) values ($1,$2,$3, now() + make_interval(mins => $4))', [userId, u.email, hmac(config.jwtSecret, `${userId}:${u.email}:${code}`), TTL_MIN]);
  const tx = TEXT[lang(u.preferred_language)];
  await email.send(u.email, tx.subject, tx.body(code));
  return { expires_in: TTL_MIN * 60, resend_in: COOLDOWN_S, dev_code: config.otpDevEcho ? code : undefined };
}

export async function verifyEmailCode(userId: string, code: string) {
  const u = await q1<any>('select email, email_verified_at from users where id=$1', [userId]);
  if (!u?.email) throw badRequest('email_missing', 'Add an email address first');
  if (u.email_verified_at) return { ok: true, verified: true };
  const v = await q1<any>('select * from email_verifications where user_id=$1 and email=$2 and used_at is null and expires_at > now() order by created_at desc limit 1', [userId, u.email]);
  if (!v) throw badRequest('email_code_expired', 'The code expired. Ask for a new one.');
  if (v.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'email_too_many', 'Too many wrong codes. Ask for a new one.');
  if (hmac(config.jwtSecret, `${userId}:${u.email}:${code}`) !== v.code_hash) {
    await q('update email_verifications set attempts = attempts + 1 where id=$1', [v.id]);
    throw badRequest('email_code_wrong', 'That code is not right');
  }
  await q('update email_verifications set used_at=now() where id=$1', [v.id]);
  await q('update users set email_verified_at=now() where id=$1 and email=$2', [userId, u.email]);
  return { ok: true, verified: true };
}
