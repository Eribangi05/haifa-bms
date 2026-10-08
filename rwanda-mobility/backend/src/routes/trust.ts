import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth, requireRole, requirePerm, actorOf, routeLimit } from '../guards.js';
import { q, q1 } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { createTip, driverTipTotals, driverTagCounts } from '../services/tips.js';
import { driverBadges, setTraining } from '../services/badges.js';
import { tagCatalogue } from '../services/tags.js';

const idp = z.object({ id: z.string().uuid() });
const DONE = "('COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED','REFUNDED','PARTIALLY_REFUNDED')";

export async function trustRoutes(app: FastifyInstance) {
  const pre = { preHandler: anyAuth };

  // ---- tips ----
  app.post('/bookings/:id/tip', { config: routeLimit('TIP_RATE_MAX', 6), preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ amount: z.number().int().positive(), method: z.enum(['mtn_momo', 'cash_tip']), msisdn: z.string().max(20).optional() }), req.body);
    return createTip(req.auth!.id, id, b);
  });
  app.get('/bookings/:id/tip', pre, async (req) => {
    const { id } = parse(idp, req.params);
    const t = await q1<any>('select t.id, t.amount, t.method, t.payment_id, p.status payment_status, t.created_at from tips t left join payments p on p.id=t.payment_id where t.booking_id=$1 and t.passenger_id=$2', [id, req.auth!.id]);
    return { tip: t ? { ...t, status: t.method === 'cash_tip' ? 'recorded' : t.payment_status } : null };
  });

  // ---- driver self view: tags and tips (aggregates only, never who said what) ----
  app.get('/drivers/me/feedback', { preHandler: requireRole('driver') }, async (req) => {
    const id = req.auth!.id;
    const dp = await q1<any>('select rating_avg, rating_count from driver_profiles where user_id=$1', [id]);
    return {
      rating_avg: Number(dp.rating_avg), rating_count: dp.rating_count, tags: await driverTagCounts(id), tips: await driverTipTotals(id),
      badges: await driverBadges(id), catalogue: tagCatalogue(),
    };
  });

  // ---- favourite / blocked drivers ----
  app.get('/users/me/drivers', pre, async (req) => {
    const rows = await q<any>(`select p.driver_id, p.kind, p.created_at, split_part(coalesce(u.display_name,''),' ',1) first_name, dp.rating_avg, dp.completed_count,
        (select count(*)::int from bookings b where b.passenger_id=p.passenger_id and b.driver_id=p.driver_id and b.status in ${DONE}) trips_together
      from passenger_driver_prefs p join users u on u.id=p.driver_id join driver_profiles dp on dp.user_id=p.driver_id where p.passenger_id=$1 order by p.created_at desc`, [req.auth!.id]);
    return { drivers: await Promise.all(rows.map(async (r) => ({ ...r, rating_avg: Number(r.rating_avg), badges: r.kind === 'favourite' ? await driverBadges(r.driver_id) : undefined }))) };
  });
  app.put('/users/me/drivers/:driverId', { config: routeLimit('PREF_RATE_MAX', 30), preHandler: anyAuth }, async (req) => {
    const { driverId } = parse(z.object({ driverId: z.string().uuid() }), req.params);
    const b = parse(z.object({ kind: z.enum(['favourite', 'blocked']) }), req.body);
    // only a driver this passenger has actually ridden with: no probing of arbitrary driver ids
    const rode = await q1(`select 1 from bookings where passenger_id=$1 and driver_id=$2 and status in ${DONE} limit 1`, [req.auth!.id, driverId]);
    if (!rode) throw conflict('not_ridden', 'You can only list a driver you rode with');
    const n = await q1<any>('select count(*)::int n from passenger_driver_prefs where passenger_id=$1 and driver_id<>$2', [req.auth!.id, driverId]);
    if (n.n >= 100) throw conflict('limit', 'Too many saved drivers');
    await q(`insert into passenger_driver_prefs(passenger_id,driver_id,kind) values ($1,$2,$3) on conflict (passenger_id,driver_id) do update set kind=excluded.kind, created_at=now()`, [req.auth!.id, driverId, b.kind]);
    return { driver_id: driverId, kind: b.kind };
  });
  app.delete('/users/me/drivers/:driverId', pre, async (req) => {
    const { driverId } = parse(z.object({ driverId: z.string().uuid() }), req.params);
    await q('delete from passenger_driver_prefs where passenger_id=$1 and driver_id=$2', [req.auth!.id, driverId]);
    return { ok: true };
  });

  // ---- staff ----
  const view = requirePerm('drivers.view');
  app.get('/admin/trust/tags', { preHandler: view }, async () => {
    const rows = await q<any>(`select r.reviewee_id driver_id, t.tag, count(*)::int n from ratings r join driver_profiles dp on dp.user_id=r.reviewee_id, unnest(r.tags) t(tag) where r.tags is not null group by 1,2`);
    const drivers = await q<any>(`select dp.user_id driver_id, u.display_name, dp.rating_avg, dp.rating_count from driver_profiles dp join users u on u.id=dp.user_id where dp.rating_count > 0 or exists (select 1 from ratings r where r.reviewee_id=dp.user_id and r.tags is not null) order by dp.rating_count desc limit 300`);
    return { drivers: drivers.map((d) => ({ ...d, rating_avg: Number(d.rating_avg), tags: Object.fromEntries(rows.filter((r) => r.driver_id === d.driver_id).map((r) => [r.tag, r.n])) })) };
  });
  app.get('/admin/trust/tips', { preHandler: view }, async () => ({
    totals: await q1<any>(`select count(*)::int tips, coalesce(sum(t.amount) filter (where t.method='mtn_momo' and p.status='SUCCESS'),0)::int momo_total,
        count(*) filter (where t.method='mtn_momo' and p.status='SUCCESS')::int momo_count, coalesce(sum(t.amount) filter (where t.method='cash_tip'),0)::int cash_total_informational, count(*) filter (where t.method='cash_tip')::int cash_count
      from tips t left join payments p on p.id=t.payment_id`),
    top_drivers: await q(`select t.driver_id, u.display_name, count(*)::int tips, sum(t.amount)::int total from tips t join users u on u.id=t.driver_id left join payments p on p.id=t.payment_id
      where t.method='cash_tip' or p.status='SUCCESS' group by 1,2 order by total desc limit 20`),
  }));
  app.get('/admin/trust/favourites', { preHandler: view }, async () => ({
    totals: await q1<any>(`select count(*) filter (where kind='favourite')::int favourites, count(*) filter (where kind='blocked')::int blocked, count(distinct passenger_id)::int passengers from passenger_driver_prefs`),
    drivers: await q(`select p.driver_id, u.display_name, count(*) filter (where p.kind='favourite')::int favourited, count(*) filter (where p.kind='blocked')::int blocked
      from passenger_driver_prefs p join users u on u.id=p.driver_id group by 1,2 order by blocked desc, favourited desc limit 100`),
  }));
  app.get('/admin/drivers/:id/badges', { preHandler: view }, async (req) => {
    const { id } = parse(idp, req.params);
    if (!(await q1('select 1 from driver_profiles where user_id=$1', [id]))) throw notFound('driver');
    return { badges: await driverBadges(id), training: await q('select reason, granted_at, revoked_at, revoke_reason from driver_badge_grants where driver_id=$1 order by granted_at desc', [id]) };
  });
  app.post('/admin/drivers/:id/training', { preHandler: requirePerm('drivers.review') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ granted: z.boolean(), reason: z.string().trim().min(5).max(300) }), req.body);
    return setTraining(actorOf(req), id, b.granted, b.reason);
  });
}
