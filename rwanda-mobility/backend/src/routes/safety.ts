import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth, requirePerm, actorOf, routeLimit } from '../guards.js';
import { q, q1 } from '../db.js';
import { notFound } from '../errors.js';
import { normalizePhone } from '../util/phone.js';
import { audit } from '../services/audit.js';
import * as B from '../services/bookings.js';
import { respondToCheck, resolveAlert } from '../services/safety.js';

const idp = z.object({ id: z.string().uuid() });

export async function safetyRoutes(app: FastifyInstance) {
  const pre = { preHandler: anyAuth };

  // ---- passenger preferences ----
  app.get('/users/me/safety-prefs', pre, async (req) => {
    const u = await q1<any>('select auto_share from users where id=$1', [req.auth!.id]);
    return { auto_share: u.auto_share, trusted_contacts_notified: (await q1<any>('select count(*)::int n from emergency_contacts where user_id=$1 and notify_on_trip', [req.auth!.id])).n };
  });
  app.patch('/users/me/safety-prefs', pre, async (req) => {
    const b = parse(z.object({ auto_share: z.boolean() }).strict(), req.body);
    await q('update users set auto_share=$2, updated_at=now() where id=$1', [req.auth!.id, b.auto_share]);
    return { auto_share: b.auto_share };
  });

  // ---- per-trip switches ----
  app.patch('/bookings/:id/safety-settings', { ...pre, config: routeLimit('SAFETY_RATE_MAX', 30) }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ safety_checks: z.boolean().optional(), auto_share: z.boolean().optional() }).strict(), req.body);
    const r = await q1<any>('update bookings set safety_checks=coalesce($3,safety_checks), auto_share=coalesce($4,auto_share) where id=$1 and passenger_id=$2 returning safety_checks, auto_share', [id, req.auth!.id, b.safety_checks ?? null, b.auto_share ?? null]);
    if (!r) throw notFound('booking');
    return r;
  });

  // ---- "Are you OK?" answer ----
  app.post('/bookings/:id/safety-check/respond', { ...pre, config: routeLimit('SAFETY_RATE_MAX', 30) }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ answer: z.enum(['ok', 'help']) }), req.body);
    return respondToCheck(req.auth!.id, id, b.answer);
  });
  app.get('/bookings/:id/safety-check', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const own = await q1('select 1 from bookings where id=$1 and passenger_id=$2', [id, req.auth!.id]);
    if (!own) throw notFound('booking');
    return { open: await q1("select id, kind, status, asked_at, respond_by from safety_alerts where booking_id=$1 and status='asked' order by asked_at desc limit 1", [id]) };
  });

  // ---- share link management ----
  app.get('/bookings/:id/shares', pre, async (req) => { const { id } = parse(idp, req.params); return { shares: await B.listShares(req.auth!.id, id) }; });
  app.delete('/bookings/:id/share/:shareId', pre, async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), shareId: z.string().uuid() }), req.params);
    await B.revokeShare(req.auth!.id, p.id, p.shareId); return { ok: true };
  });

  // ---- staff ----
  const view = requirePerm('safety.respond');
  app.get('/admin/safety/alerts', { preHandler: view }, async (req) => {
    const b = parse(z.object({ status: z.enum(['asked', 'ok', 'escalated', 'resolved', 'trip_ended']).optional() }), req.query);
    return { alerts: await q(`select a.id, a.ref, a.kind, a.status, a.answer, a.detail, a.lat, a.lng, a.asked_at, a.respond_by, a.responded_at, a.escalated_at, a.escalation_reason, a.resolved_at, a.resolution,
        bk.ref booking_ref, bk.id booking_id, split_part(coalesce(pu.display_name,''),' ',1) passenger_first_name, du.display_name driver, i.ref incident_ref, c.ref case_ref
      from safety_alerts a join bookings bk on bk.id=a.booking_id join users pu on pu.id=a.passenger_id left join users du on du.id=a.driver_id
      left join safety_incidents i on i.id=a.incident_id left join support_cases c on c.id=a.case_id
      where ($1::text is null or a.status=$1) order by (a.status in ('asked','escalated')) desc, a.created_at desc limit 200`, [b.status ?? null]) };
  });
  app.post('/admin/safety/alerts/:id/resolve', { preHandler: view }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ note: z.string().trim().min(5).max(500) }), req.body);
    return resolveAlert(actorOf(req), id, b.note);
  });
  app.get('/admin/safety/opt-outs', { preHandler: view }, async () => ({ opt_outs: await q('select phone, source, created_at from sms_opt_outs order by created_at desc limit 500') }));
  app.post('/admin/safety/opt-outs', { preHandler: view }, async (req) => {
    const b = parse(z.object({ phone: z.string() }), req.body);
    const phone = normalizePhone(b.phone); if (!phone) throw (await import('../errors.js')).badRequest('invalid_phone');
    await q("insert into sms_opt_outs(phone,source,created_by) values ($1,'staff',$2) on conflict do nothing", [phone, req.auth!.id]);
    await q('update emergency_contacts set notify_on_trip=false where phone=$1', [phone]);
    await audit(actorOf(req), 'safety.opt_out_added', 'phone', null, undefined, { phone: phone.slice(0, 7) + '***' });
    return { ok: true };
  });
  app.delete('/admin/safety/opt-outs/:phone', { preHandler: view }, async (req) => {
    const { phone } = parse(z.object({ phone: z.string().regex(/^\+250[0-9]{9}$/) }), req.params);
    await q('delete from sms_opt_outs where phone=$1', [phone]);
    await audit(actorOf(req), 'safety.opt_out_removed', 'phone', null, undefined, { phone: phone.slice(0, 7) + '***' });
    return { ok: true };
  });
}
