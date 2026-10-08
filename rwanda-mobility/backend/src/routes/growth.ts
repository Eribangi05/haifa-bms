// Rider and driver endpoints of the growth round: guest contact, recurring rides, driver quests, driver heat map.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { requireRole, routeLimit } from '../guards.js';
import { q1 } from '../db.js';
import { AppError } from '../errors.js';
import { reqLang } from '../services/errmsg.js';
import { guestContact } from '../services/guestRides.js';
import * as S from '../services/rideSchedules.js';
import { driverQuests, questHistory } from '../services/quests.js';
import { heatmapView } from '../services/heatmap.js';

const idp = z.object({ id: z.string().uuid() });
const pt = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), name: z.string().max(160).optional() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const dow = z.array(z.number().int().min(0).max(6)).min(1).max(7);

export async function growthRoutes(app: FastifyInstance) {
  const drv = { preHandler: requireRole('driver') };
  const rider = { preHandler: requireRole('passenger') };

  // ---- ride for someone else: the assigned driver may reach the guest only during an active trip (logged) ----
  app.post('/bookings/:id/guest-contact', { ...drv, config: routeLimit('GUEST_CONTACT_RATE_MAX', 20) }, async (req) => guestContact(req.auth!.id, parse(idp, req.params).id));

  // ---- recurring rides ----
  app.post('/ride-schedules', { ...rider, config: routeLimit('SCHEDULE_RATE_MAX', 20) }, async (req, reply) => {
    const b = parse(z.object({
      label: z.string().max(60).optional(), service_id: z.string().max(40), customer_vehicle_id: z.string().uuid().optional(), hours: z.number().int().min(1).max(24).optional(), owner_attested: z.boolean().optional(),
      pickup: pt, dest: pt, days_of_week: dow, local_time: time, start_date: day, end_date: day.nullable().optional(), payment_method: z.enum(['cash', 'mtn_momo']).default('cash'),
    }), req.body);
    reply.code(201);
    return S.createSchedule(req.auth!.id, b);
  });
  app.get('/ride-schedules', rider, async (req) => ({ schedules: await S.listSchedules(req.auth!.id) }));
  app.get('/ride-schedules/:id', rider, async (req) => S.viewSchedule(await S.getSchedule(req.auth!.id, parse(idp, req.params).id)));
  app.patch('/ride-schedules/:id', rider, async (req) => {
    const b = parse(z.object({ label: z.string().max(60).nullable().optional(), days_of_week: dow.optional(), local_time: time.optional(), end_date: day.nullable().optional(), payment_method: z.enum(['cash', 'mtn_momo']).optional(), skip_dates: z.array(day).max(60).optional() }), req.body);
    return S.viewSchedule(await S.updateSchedule(req.auth!.id, parse(idp, req.params).id, b as any));
  });
  app.delete('/ride-schedules/:id', rider, async (req) => S.viewSchedule(await S.setScheduleStatus(req.auth!.id, parse(idp, req.params).id, 'ended')));
  app.post('/ride-schedules/:id/pause', rider, async (req) => S.viewSchedule(await S.setScheduleStatus(req.auth!.id, parse(idp, req.params).id, 'paused')));
  app.post('/ride-schedules/:id/resume', rider, async (req) => S.viewSchedule(await S.setScheduleStatus(req.auth!.id, parse(idp, req.params).id, 'active')));
  app.post('/ride-schedules/:id/skip-next', rider, async (req) => S.skipNext(req.auth!.id, parse(idp, req.params).id));
  app.post('/ride-schedules/:id/accept-price', rider, async (req) => S.viewSchedule(await S.acceptPrice(req.auth!.id, parse(idp, req.params).id)));

  // ---- driver quests ----
  app.get('/drivers/me/quests', drv, async (req) => {
    const lang = reqLang(req.headers['accept-language']);
    const quests = (await driverQuests(req.auth!.id)).map((x: any) => ({ ...x, title: x[`title_${lang}`], description: x[`desc_${lang}`] }));
    return { quests };
  });
  app.get('/drivers/me/quests/history', drv, async (req) => {
    const lang = reqLang(req.headers['accept-language']);
    return { awards: (await questHistory(req.auth!.id)).map((a: any) => ({ ...a, title: a[`title_${lang}`] })) };
  });

  // ---- demand heat map (approved, online drivers only; no counts) ----
  app.get('/drivers/me/heatmap', { ...drv, config: routeLimit('HEATMAP_RATE_MAX', 30) }, async (req) => {
    const dp = await q1<any>('select status, is_online from driver_profiles where user_id=$1', [req.auth!.id]);
    if (dp?.status !== 'APPROVED' || !dp.is_online) throw new AppError(403, 'heatmap_unavailable', 'The demand map is available to approved drivers who are online');
    return heatmapView('driver');
  });
}
