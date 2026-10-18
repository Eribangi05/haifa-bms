import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth, actorOf } from '../guards.js';
import { cursor, waitFor } from '../services/realtime.js';

export async function realtimeRoutes(app: FastifyInstance) {
  /**
   * Held request: answers as soon as something changes for the signed-in user (new offer, booking step, message) or after `timeout_s`.
   * Without `since` it answers at once with the current cursor, so the first call never reports old events.
   */
  app.get('/realtime/wait', { preHandler: anyAuth, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const q = parse(z.object({ since: z.coerce.number().int().min(0).optional(), timeout_s: z.coerce.number().min(1).max(30).default(25) }), req.query);
    const me = actorOf(req);
    if (q.since == null) return { cursor: cursor(), events: [] as string[] };
    return waitFor(me.id, q.since, q.timeout_s * 1000, (cb) => { req.raw.once('close', cb); });
  });
}
