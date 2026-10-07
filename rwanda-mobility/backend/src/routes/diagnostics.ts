import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { sessionValid } from '../services/auth.js';
import { recordClientError } from '../services/clientErrors.js';
import { requirePerm } from '../guards.js';
import { q, q1, poolStats } from '../db.js';
import { jobHealth } from '../jobs.js';

/** Authentication is optional here: crashes can happen before sign-in. A bad or expired token is simply ignored. */
async function optionalUserId(req: FastifyRequest): Promise<string | null> {
  if (!req.headers.authorization) return null;
  try {
    const p: any = await req.jwtVerify();
    return (await sessionValid(p.sid, p.sub)) ? (p.sub as string) : null;
  } catch { return null; }
}

export async function diagnosticsRoutes(app: FastifyInstance) {
  app.post('/client-errors', { config: { rateLimit: { max: Number(process.env.CLIENT_ERR_RATE_MAX ?? 10), timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({
      message: z.string().min(1).max(500), stack: z.string().max(4000).optional(), app_version: z.string().max(40).optional(),
      platform: z.string().max(40).optional(), screen: z.string().max(120).optional(), lang: z.string().max(10).optional(),
    }), req.body);
    const id = await recordClientError(await optionalUserId(req), b);
    return reply.code(202).send({ ok: true, id });
  });

  // ---------- admin: read-only diagnostics ----------
  app.get('/admin/client-errors', { preHandler: requirePerm('diagnostics.view') }, async (req) => {
    const b = parse(z.object({
      platform: z.string().max(40).optional(), app_version: z.string().max(40).optional(), screen: z.string().max(120).optional(),
      q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), before_id: z.coerce.number().int().optional(),
    }), req.query);
    const rows = await q(
      `select id, user_id, message, stack, app_version, platform, screen, lang, created_at from client_errors
       where ($1::text is null or platform=$1) and ($2::text is null or app_version=$2) and ($3::text is null or screen=$3)
         and ($4::text is null or message ilike $5) and ($6::bigint is null or id < $6) order by id desc limit $7`,
      [b.platform ?? null, b.app_version ?? null, b.screen ?? null, b.q ?? null, `%${(b.q ?? '').replace(/[%_]/g, '')}%`, b.before_id ?? null, b.limit]);
    return { errors: rows, next_before_id: rows.length === b.limit ? (rows[rows.length - 1] as any).id : null };
  });

  // ---------- admin: system health (read-only, cheap: a handful of indexed counts) ----------
  app.get('/admin/system/health', { preHandler: requirePerm('diagnostics.view') }, async () => {
    const t0 = Date.now();
    const db = await q1<any>(`select
      (select count(*) from notifications where channel='sms' and status='queued')::int sms_queued,
      (select coalesce(extract(epoch from now() - min(created_at)),0) from notifications where channel='sms' and status='queued')::int sms_oldest_s,
      (select count(*) from notifications where channel='push' and status='queued')::int push_queued,
      (select coalesce(extract(epoch from now() - min(created_at)),0) from notifications where channel='push' and status='queued')::int push_oldest_s,
      (select count(*) from notifications where status='failed' and created_at > now() - interval '24 hours')::int notifications_failed_24h,
      (select count(*) from payments where status='PENDING' and method <> 'cash' and created_at < now() - interval '15 minutes')::int payments_stuck_pending,
      (select count(*) from payments where status='INITIATED' and updated_at < now() - interval '5 minutes')::int payments_stuck_initiated,
      (select count(*) from bookings where status='SEARCHING_DRIVER')::int searching,
      (select count(*) from driver_profiles where is_online and last_seen_at > now() - interval '2 minutes')::int drivers_online,
      (select count(*) from schema_migrations)::int migrations_applied,
      (select max(name) from schema_migrations) latest_migration`);
    const jobs = jobHealth();
    const problems = [
      ...Object.entries(jobs.jobs).filter(([, j]) => j.stale).map(([n]) => `job ${n} is stale`),
      ...(db.sms_oldest_s > 300 ? ['SMS queue is more than 5 minutes behind'] : []),
      ...(db.push_oldest_s > 300 ? ['push queue is more than 5 minutes behind'] : []),
      ...(db.payments_stuck_pending > 0 ? ['mobile-money payments pending for more than 15 minutes'] : []),
    ];
    return { ok: problems.length === 0, problems, db_latency_ms: Date.now() - t0, pool: poolStats(), jobs, ...db, uptime_s: Math.round(process.uptime()), node: process.version };
  });
}
