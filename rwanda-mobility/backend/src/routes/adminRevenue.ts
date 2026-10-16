import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requireAnyPerm } from '../guards.js';
import { revenueRange, revenueReport, revenueCsv, renderRevenueHtml } from '../services/revenue.js';
import { ratingsOverview } from '../services/ratingsReview.js';
import { demoStatus, loadDemo, clearDemo } from '../services/demo.js';
import { requirePerm, actorOf } from '../guards.js';
import { audit } from '../services/audit.js';

/**
 * Owner reports.
 *  GET /admin/revenue          trips, revenue (commission), driver payouts, active drivers, daily or weekly trend, compared with the previous period (analytics.view)
 *  GET /admin/revenue/csv      the same as a CSV file
 *  GET /admin/revenue/report   printable page in rw / fr / en ("Print" then "Save as PDF")
 *  GET /admin/ratings          score spread, low ratings with comments, drivers flagged for coaching (drivers.view or analytics.view)
 */
const perm = { preHandler: requireAnyPerm('analytics.view', 'finance.view') };
const rq = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), group: z.enum(['day', 'week']).default('day'), lang: z.enum(['rw', 'fr', 'en']).default('en') });

export async function adminRevenueRoutes(app: FastifyInstance) {
  const run = async (query: unknown) => { const b = parse(rq, query); const r = revenueRange(b.from, b.to); return { b, rep: await revenueReport({ ...r, group: b.group }) }; };
  app.get('/admin/revenue', perm, async (req, reply) => { reply.header('cache-control', 'no-store'); return (await run(req.query)).rep; });
  app.get('/admin/revenue/csv', perm, async (req, reply) => {
    const { rep } = await run(req.query);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="abasare-revenue-${rep.range.from}_${rep.range.to}.csv"`).header('cache-control', 'no-store');
    return revenueCsv(rep);
  });
  app.get('/admin/revenue/report', perm, async (req, reply) => {
    const { b, rep } = await run(req.query);
    reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store');
    return renderRevenueHtml(rep, b.lang);
  });
  app.get('/admin/ratings', { preHandler: requireAnyPerm('drivers.view', 'analytics.view') }, async (_req, reply) => { reply.header('cache-control', 'no-store'); return ratingsOverview(); });

  // Demo data for presentations (administrators only). Loading replaces any earlier demo data; removing deletes only rows tagged as demo.
  app.get('/admin/demo', { preHandler: requirePerm('settings.manage') }, async () => demoStatus());
  app.post('/admin/demo/load', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const b = parse(z.object({ drivers: z.number().int().min(5).max(150).optional(), riders: z.number().int().min(10).max(500).optional(), days: z.number().int().min(1).max(31).optional() }), req.body ?? {});
    const out = await loadDemo(b); await audit(actorOf(req), 'demo_load', 'demo', null, undefined, out); return { ...out, status: await demoStatus() };
  });
  app.post('/admin/demo/clear', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const out = await clearDemo(); await audit(actorOf(req), 'demo_clear', 'demo', null, undefined, out); return { ...out, status: await demoStatus() };
  });
}
