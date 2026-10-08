import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fstatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config, isProd } from './config.js';
import { AppError } from './errors.js';
import { reqLang, localizeError } from './services/errmsg.js';
import { pool } from './db.js';
import { jobHealth } from './jobs.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { catalogRoutes } from './routes/catalog.js';
import { bookingRoutes } from './routes/bookings.js';
import { driverRoutes } from './routes/driver.js';
import { paymentRoutes } from './routes/payments.js';
import { supportRoutes } from './routes/support.js';
import { shareRoutes } from './routes/share.js';
import { businessRoutes } from './routes/business.js';
import { adminRoutes } from './routes/admin.js';
import { adminFinanceRoutes } from './routes/adminFinance.js';
import { safetyRoutes } from './routes/safety.js';
import { trustRoutes } from './routes/trust.js';
import compress from '@fastify/compress';
import { abasareRoutes } from './routes/abasare.js';
import { growthRoutes } from './routes/growth.js';
import { growthAdminRoutes } from './routes/growthAdmin.js';
import { partnerRoutes } from './routes/partners.js';
import { staffInviteRoutes } from './routes/staffInvites.js';
import { adminStaffRoutes } from './routes/adminStaff.js';
import { adminRoleRoutes } from './routes/adminRoles.js';
import { adminConfigRoutes } from './routes/adminConfig.js';
import { requestCodeRoutes, requestCodeLandingRoutes } from './routes/requestCodes.js';
import { diagnosticsRoutes } from './routes/diagnostics.js';
import { moneyRoutes } from './routes/money.js';
import { claimRoutes } from './routes/claims.js';
import { ussdRoutes, ussdAdminRoutes } from './routes/ussd.js';

/** Capability URLs (share links, staff invitations) and signed-link / webhook tokens must never reach the logs. */
export function redactUrl(url: string): string {
  return url
    .replace(/^(\/share\/)[^/?#]+/, '$1[redacted]')
    .replace(/^(\/api\/v1\/staff-invite\/)[^/?#]+/, '$1[redacted]')
    .replace(/([?&](?:token|code|otp|password|secret)=)[^&#]*/gi, '$1[redacted]');
}

function parseTrustProxy(v: string | undefined): boolean | number | string[] {
  if (v == null || v === '' || v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map((x) => x.trim()).filter(Boolean);
}

export async function buildApp(opts: { onRoute?: (r: { method: string | string[]; url: string; config?: any }) => void } = {}) {
  const app = Fastify({
    logger: process.env.QUIET === '1' ? false : {
      level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers["x-callback-token"]', 'req.headers.cookie'],
      serializers: { req: (r: any) => ({ method: r.method, url: redactUrl(r.url), host: r.host, remoteAddress: r.ip, remotePort: r.socket?.remotePort }) },
    },
    // TRUST_PROXY: "true" (default, the API sits behind a load balancer), "false", a hop count, or a comma-separated list of proxy addresses/CIDRs.
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY) as any,
    bodyLimit: 1_000_000, genReqId: () => crypto.randomUUID(),
    requestTimeout: Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000), keepAliveTimeout: 65_000,
  });
  if (opts.onRoute) app.addHook('onRoute', (r) => opts.onRoute!({ method: r.method, url: r.url }));
  // Mobile clients often send Content-Type: application/json with no body on action endpoints (accept, arrived...). Treat as {}.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try { done(null, JSON.parse(String(body))); } catch { const e: any = new Error('Malformed JSON'); e.statusCode = 400; e.code = 'bad_json'; done(e, undefined); }
  });
  // CORS_ORIGINS="https://admin.example.rw,https://app.example.rw" restricts browsers; unset keeps it open (bearer tokens only, no cookies).
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  await app.register(cors, { origin: origins.length ? origins : true, exposedHeaders: ['x-request-id'] });
  await app.register(jwt, { secret: config.jwtSecret });
  // Rate-limit bucket: the signed-in user (token verified, no database), else the client IP. Without this, everyone behind one mobile-carrier NAT shares 300 requests a minute.
  const globalKey = (req: any): string => {
    const h = String(req.headers.authorization ?? '');
    if (h.startsWith('Bearer ')) { try { const p: any = app.jwt.verify(h.slice(7)); if (p?.sub) return `u:${p.sub}`; } catch { /* anonymous */ } }
    return `ip:${req.ip}`;
  };
  await app.register(rateLimit, { global: true, max: Number(process.env.RATE_LIMIT_MAX ?? 300), timeWindow: '1 minute', keyGenerator: globalKey });
  await app.register(compress, { global: true, threshold: 512, encodings: ['br', 'gzip', 'deflate'] });   // low-data mode: gzip/brotli when the client asks for it
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (!req.url.startsWith('/share/')) reply.header('x-frame-options', 'DENY');
    if (isProd) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (req.url.startsWith('/api/')) {
      if (!reply.getHeader('cache-control')) reply.header('cache-control', 'no-store');   // routes with an ETag set their own revalidation policy
      reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");   // API responses are data, never documents
      reply.header('cross-origin-resource-policy', 'cross-origin');
    }
    reply.header('permissions-policy', 'geolocation=(), camera=(), microphone=()');
  });

  const langOf = (req: { headers: Record<string, any> }) => reqLang(req.headers['accept-language']);
  app.setErrorHandler((err: any, req, reply) => {
    const lang = langOf(req);
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: localizeError(err.code, lang, err.message, err.details), details: err.details } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: localizeError('validation_error', lang, 'Invalid input') } });
    if (err.statusCode && err.statusCode < 500) {
      const code = err.statusCode === 429 ? 'rate_limited' : (err.code ?? 'bad_request');
      return reply.code(err.statusCode).send({ error: { code: err.code ?? (err.statusCode === 429 ? 'rate_limited' : 'bad_request'), message: localizeError(code, lang, err.message) } });
    }
    req.log.error({ err, reqId: req.id }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: localizeError('internal_error', lang, 'Something went wrong.') + ({ en: ' Reference: ', rw: ' Nimero y\'ikibazo: ', fr: ' Référence : ' } as const)[lang] + req.id } });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'not_found', message: localizeError('not_found', langOf(req), 'Not found') } }));

  app.get('/health', async () => ({ ok: true, time: new Date().toISOString() }));
  // Readiness: the database answers and (when the scheduler runs in this process) no job has been failing for 10 intervals.
  app.get('/ready', async (_r, reply) => {
    try { await pool.query('select 1'); } catch { return reply.code(503).send({ ready: false, db: false }); }
    const h = jobHealth();
    const stale = Object.entries(h.jobs).filter(([, j]) => j.stale).map(([n]) => n);
    if (h.started && stale.length) return reply.code(503).send({ ready: false, db: true, stale_jobs: stale });
    return { ready: true };
  });

  await app.register(async (api) => {
    await api.register(authRoutes); await api.register(meRoutes); await api.register(catalogRoutes);
    await api.register(bookingRoutes); await api.register(driverRoutes); await api.register(paymentRoutes);
    await api.register(supportRoutes); await api.register(businessRoutes);
    await api.register(abasareRoutes); await api.register(staffInviteRoutes); await api.register(adminStaffRoutes); await api.register(adminRoleRoutes); await api.register(adminConfigRoutes); await api.register(diagnosticsRoutes); await api.register(requestCodeRoutes); await api.register(adminRoutes); await api.register(adminFinanceRoutes);
    await api.register(moneyRoutes); await api.register(claimRoutes); await api.register(ussdAdminRoutes);   // round 3: credit/loyalty/deposit, claims, USSD admin views
    await api.register(safetyRoutes); await api.register(trustRoutes);   // round 1: safety checks / live share, tips / tags / favourites / badges
    await api.register(growthRoutes); await api.register(growthAdminRoutes); await api.register(partnerRoutes);   // round 2: guest rides, schedules, quests, heat map, campaigns, partners
  }, { prefix: '/api/v1' });
  // public trip-share page lives outside /api
  await app.register(shareRoutes);
  await app.register(ussdRoutes);   // public USSD gateway callback (POST /ussd/callback, shared-secret protected)
  await app.register(requestCodeLandingRoutes);

  const here = dirname(fileURLToPath(import.meta.url));
  const adminDir = join(here, '..', '..', 'admin-web');
  if (existsSync(adminDir)) {
    await app.register(fstatic, { root: adminDir, prefix: '/admin/', decorateReply: false });
    app.get('/admin', async (_r, reply) => reply.redirect('/admin/'));
  }
  return app;
}
