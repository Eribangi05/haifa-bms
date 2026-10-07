import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { sessionValid } from '../services/auth.js';
import { recordClientError } from '../services/clientErrors.js';
import { requirePerm } from '../guards.js';
import { q } from '../db.js';

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
}
