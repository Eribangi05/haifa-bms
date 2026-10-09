import { reqLang } from '../services/errmsg.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { normalizeAnyPhone } from '../util/phone.js';
import { badRequest } from '../errors.js';
import * as auth from '../services/auth.js';
import { anyAuth, routeLimit } from '../guards.js';
import { q } from '../db.js';
import { audit } from '../services/audit.js';

// language from the body, else the Accept-Language header, else Kinyarwanda (the product default)
const headerLang = (req: { headers: Record<string, any> }) => (req.headers['accept-language'] ? reqLang(req.headers['accept-language']) : 'rw');

export async function authRoutes(app: FastifyInstance) {
  const sign = (p: any, ttl: number) => app.jwt.sign(p, { expiresIn: ttl });
  const dev = (req: any) => ({ id: (req.headers['x-device-id'] as string) || undefined, name: (req.headers['x-device-name'] as string) || undefined, ip: req.ip });
  const phone = z.string().transform((s, ctx) => normalizeAnyPhone(s) ?? (ctx.addIssue({ code: 'custom', message: 'Enter a valid mobile number with its country code (for example +250 7XX XXX XXX)' }), z.NEVER));

  app.post('/auth/otp/request', { config: { rateLimit: { max: Number(process.env.AUTH_RATE_MAX ?? 10), timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ phone, language: z.enum(['rw', 'fr', 'en']).optional() }), req.body);
    return auth.requestOtp(b.phone, dev(req), b.language ?? headerLang(req));
  });

  app.post('/auth/otp/verify', { config: { rateLimit: { max: Number(process.env.AUTH_RATE_MAX ?? 20), timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ phone, code: z.string().regex(/^\d{6}$/), role: z.enum(['passenger', 'driver']).default('passenger'), language: z.enum(['rw', 'fr', 'en']).optional(), referral_code: z.string().max(20).optional() }), req.body);
    return auth.verifyOtp(b.phone, b.code, dev(req), sign, { lang: b.language ?? headerLang(req), role: b.role, referral: b.referral_code });
  });

  app.post('/auth/refresh', { config: routeLimit('REFRESH_RATE_MAX', 120) }, async (req) => {
    const b = parse(z.object({ refresh_token: z.string().min(20) }), req.body);
    return auth.refresh(b.refresh_token, dev(req), sign);
  });

  app.post('/auth/staff/login', { config: { rateLimit: { max: Number(process.env.AUTH_RATE_MAX ?? 10), timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().regex(/^\d{6}$/) }), req.body);
    return auth.staffLogin(b.email, b.password, b.totp, dev(req), sign);
  });

  app.post('/auth/logout', { preHandler: anyAuth }, async (req) => {
    await q('update sessions set revoked_at=now() where id=$1', [req.auth!.sid]);
    return { ok: true };
  });

  app.get('/users/me/sessions', { preHandler: anyAuth }, async (req) => {
    const rows = await q('select id, device_name, ip, created_at, last_used_at, privileged from sessions where user_id=$1 and revoked_at is null and expires_at > now() order by last_used_at desc limit 50', [req.auth!.id]);
    return { sessions: rows.map((r: any) => ({ ...r, current: r.id === req.auth!.sid })) };
  });
  app.delete('/users/me/sessions/:id', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await q('update sessions set revoked_at=now() where id=$1 and user_id=$2 and revoked_at is null returning id', [id, req.auth!.id]);
    if (!r.length) throw badRequest('not_found');
    await audit({ id: req.auth!.id, ip: req.ip }, 'auth.session_revoked', 'session', id);
    return { ok: true };
  });
}
