import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requirePerm, actorOf } from '../guards.js';
import { q, q1 } from '../db.js';
import { notFound } from '../errors.js';
import { audit } from '../services/audit.js';
import { listAlerts } from '../services/alerts.js';
import { opsDashboard } from '../services/opsDashboard.js';

/** Round 5, console side: operations dashboard, staff alerts, fraud signals. */
export async function opsRoutes(app: FastifyInstance) {
  app.get('/admin/dashboard/ops', { preHandler: requirePerm('analytics.view') }, async (req) => {
    const b = parse(z.object({ hours: z.coerce.number().int().min(1).max(744).default(24) }), req.query);
    return opsDashboard(b.hours);
  });

  app.get('/admin/alerts', { preHandler: requirePerm('alerts.view') }, async (req) => {
    const b = parse(z.object({ status: z.enum(['open', 'acknowledged', 'all']).default('open') }), req.query);
    const open = await q1<{ n: number }>("select count(*)::int n from admin_alerts where status='open'");
    return { alerts: await listAlerts(b.status), open: open!.n };
  });
  app.post('/admin/alerts/:id/ack', { preHandler: requirePerm('alerts.view') }, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const r = await q1("update admin_alerts set status='acknowledged', acknowledged_by=$2, acknowledged_at=now() where id=$1 and status='open' returning id", [id, req.auth!.id]);
    if (!r) throw notFound('alert');
    await audit(actorOf(req), 'alert.acknowledged', 'alert', String(id));
    return { ok: true };
  });

  app.get('/admin/risk-events', { preHandler: requirePerm('alerts.view') }, async (req) => {
    const b = parse(z.object({ kind: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    return {
      events: await q(`select e.id, e.kind, e.detail, e.created_at, e.user_id, u.display_name, u.phone from risk_events e left join users u on u.id=e.user_id
                       where ($1::text is null or e.kind=$1) order by e.id desc limit $2`, [b.kind ?? null, b.limit]),
      by_kind: await q("select kind, count(*)::int n from risk_events where created_at > now() - interval '7 days' group by 1 order by 2 desc"),
    };
  });
}
