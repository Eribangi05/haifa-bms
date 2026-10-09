import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { authenticate } from '../guards.js';
import { can, isStaff } from '../rbac.js';
import { forbidden } from '../errors.js';
import { q1 } from '../db.js';
import { dashboard } from '../services/reports.js';

/**
 * Console live signals and the daily digest.
 *  GET /admin/pulse   small counts the open console polls every few seconds (new SOS, open support, drivers waiting, staff alerts, requests with no driver);
 *                     each count is only filled in for a role that may see it, the rest are null.
 *  GET /admin/digest  one Kigali day in numbers: trips, money, cancellations, safety, support, alerts. Same permission as the dashboard (analytics.view).
 */
export async function adminPulseRoutes(app: FastifyInstance) {
  app.get('/admin/pulse', { preHandler: authenticate }, async (req) => {
    const roles = req.auth!.roles; if (!isStaff(roles)) throw forbidden();
    const r = await q1<any>(`select
      (select count(*) from safety_incidents where status='open')::int sos_open, (select max(created_at) from safety_incidents where status='open') sos_newest,
      (select count(*) from support_cases where status='open')::int support_open, (select max(created_at) from support_cases where status='open') support_newest,
      (select count(*) from driver_profiles where status in ('DOCUMENTS_SUBMITTED','UNDER_REVIEW'))::int drivers_waiting,
      (select count(*) from admin_alerts where status='open')::int alerts_open, (select max(created_at) from admin_alerts where status='open') alerts_newest,
      (select count(*) from bookings where status='NO_DRIVER_FOUND' and created_at > now() - interval '15 minutes')::int no_driver_recent`);
    const pick = (perm: string, v: any) => (can(roles, perm) ? v : null);
    return {
      sos: pick('safety.respond', { open: r.sos_open, newest_at: r.sos_newest }),
      support: pick('support.handle', { open: r.support_open, newest_at: r.support_newest }),
      drivers_waiting: pick('drivers.view', r.drivers_waiting),
      alerts: pick('alerts.view', { open: r.alerts_open, newest_at: r.alerts_newest }),
      no_driver_recent: pick('bookings.view_all', r.no_driver_recent),
      server_time: new Date().toISOString(),
    };
  });

  app.get('/admin/digest', { preHandler: authenticate }, async (req) => {
    if (!isStaff(req.auth!.roles) || !can(req.auth!.roles, 'analytics.view')) throw forbidden('missing permission analytics.view');
    const b = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
    const day = b.date ?? new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);   // Kigali is UTC+2 all year
    const from = new Date(`${day}T00:00:00+02:00`), to = new Date(from.getTime() + 864e5 - 1);
    const d = await dashboard({ from: from.toISOString(), to: to.toISOString() });
    const x = await q1<any>(`select (select count(*) from admin_alerts where created_at between $1 and $2)::int alerts, (select count(*) from risk_events where created_at between $1 and $2)::int risk_events,
      (select count(*) from support_cases where created_at between $1 and $2)::int support_opened, (select count(*) from users where created_at between $1 and $2)::int new_users`, [from, to]);
    return { date: day, trips: { requested: d.bookings.requested, completed: d.bookings.completed, cancelled: d.bookings.cancelled, no_driver: d.bookings.no_driver, cancellation_rate_pct: d.bookings.cancellation_rate_pct },
      money: d.revenue, payments: { success_rate_pct: d.payments.success_rate_pct }, safety_incidents: d.safety_incidents.total, support_opened: x.support_opened, new_users: x.new_users, suspicious: { staff_alerts: x.alerts, risk_events: x.risk_events },
      drivers_waiting_now: d.drivers.pending };
  });
}
