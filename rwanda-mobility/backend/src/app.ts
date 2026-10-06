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
import { pool } from './db.js';
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

export async function buildApp(opts: { onRoute?: (r: { method: string | string[]; url: string; config?: any }) => void } = {}) {
  const app = Fastify({
    logger: process.env.QUIET === '1' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers["x-callback-token"]'] },
    trustProxy: true, bodyLimit: 1_000_000, genReqId: () => crypto.randomUUID(),
  });
  if (opts.onRoute) app.addHook('onRoute', (r) => opts.onRoute!({ method: r.method, url: r.url }));
  // Mobile clients often send Content-Type: application/json with no body on action endpoints (accept, arrived...). Treat as {}.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try { done(null, JSON.parse(String(body))); } catch { const e: any = new Error('Malformed JSON'); e.statusCode = 400; e.code = 'bad_json'; done(e, undefined); }
  });
  await app.register(cors, { origin: true, exposedHeaders: ['x-request-id'] });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, { global: true, max: Number(process.env.RATE_LIMIT_MAX ?? 300), timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (!req.url.startsWith('/share/')) reply.header('x-frame-options', 'DENY');
    if (isProd) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Invalid input' } });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
    req.log.error({ err, reqId: req.id }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong. Reference: ' + req.id } });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }));

  app.get('/health', async () => ({ ok: true, time: new Date().toISOString() }));
  app.get('/ready', async (_r, reply) => {
    try { await pool.query('select 1'); return { ready: true }; } catch { return reply.code(503).send({ ready: false }); }
  });

  await app.register(async (api) => {
    await api.register(authRoutes); await api.register(meRoutes); await api.register(catalogRoutes);
    await api.register(bookingRoutes); await api.register(driverRoutes); await api.register(paymentRoutes);
    await api.register(supportRoutes); await api.register(businessRoutes);
    await api.register(adminRoutes); await api.register(adminFinanceRoutes);
  }, { prefix: '/api/v1' });
  // public trip-share page lives outside /api
  await app.register(shareRoutes);

  const here = dirname(fileURLToPath(import.meta.url));
  const adminDir = join(here, '..', '..', 'admin-web');
  if (existsSync(adminDir)) {
    await app.register(fstatic, { root: adminDir, prefix: '/admin/', decorateReply: false });
    app.get('/admin', async (_r, reply) => reply.redirect('/admin/'));
  }
  return app;
}
