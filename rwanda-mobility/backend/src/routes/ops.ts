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

  // ---- referrals and ambassadors (growth.manage) ----
  app.get('/admin/referrals', { preHandler: requirePerm('growth.manage') }, async () => {
    const totals = await q1<any>(`select count(*)::int total, count(*) filter (where status='pending')::int pending, count(*) filter (where status='rewarded')::int rewarded, count(*) filter (where status='rejected')::int rejected,
        coalesce(sum(reward_referrer + reward_referee) filter (where status='rewarded'),0)::int paid from referrals`);
    const ambassadors = await q(`select a.user_id, a.tier, a.status, a.note, a.created_at, u.display_name, u.phone,
        (select count(*)::int from referrals r where r.referrer_id=a.user_id and r.status='rewarded') rewarded,
        (select count(*)::int from referrals r where r.referrer_id=a.user_id and r.status='pending') pending,
        (select count(*)::int from referrals r where r.referrer_id=a.user_id and r.status='rejected') rejected,
        (select coalesce(sum(reward_referrer),0)::int from referrals r where r.referrer_id=a.user_id and r.status='rewarded') earned
      from ambassadors a join users u on u.id=a.user_id order by rewarded desc, a.created_at limit 200`);
    const recent = await q(`select r.id, r.status, r.reject_reason, r.created_at, r.rewarded_at, r.reward_referrer, r.reward_referee, ur.display_name referrer, ue.display_name referee
      from referrals r join users ur on ur.id=r.referrer_id join users ue on ue.id=r.referee_id order by r.created_at desc limit 100`);
    return { totals, ambassadors, recent };
  });
  app.patch('/admin/ambassadors/:id', { preHandler: requirePerm('growth.manage') }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(z.object({ status: z.enum(['active', 'paused']).optional(), tier: z.enum(['bronze', 'silver', 'gold']).optional(), note: z.string().trim().max(300).nullable().optional(), reason: z.string().trim().min(5).max(300) }), req.body);
    const before = await q1<any>('select status, tier, note from ambassadors where user_id=$1', [id]); if (!before) throw notFound('ambassador');
    await q('update ambassadors set status=coalesce($2,status), tier=coalesce($3,tier), note=case when $4::boolean then $5 else note end where user_id=$1', [id, b.status ?? null, b.tier ?? null, b.note !== undefined, b.note ?? null]);
    await audit(actorOf(req), 'ambassador.updated', 'user', id, before, b);
    return { ok: true };
  });
}
