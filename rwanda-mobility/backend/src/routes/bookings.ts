import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth, requireRole, routeLimit } from '../guards.js';
import { q, q1 } from '../db.js';
import * as B from '../services/bookings.js';
import * as P from '../services/payments.js';
import * as D from '../services/dispatch.js';
import { badRequest } from '../errors.js';
import { can } from '../rbac.js';
import { pickLang } from '../services/errmsg.js';

const idp = z.object({ id: z.string().uuid() });

export async function bookingRoutes(app: FastifyInstance) {
  // ---- passenger ----
  app.post('/bookings', { config: routeLimit('BOOKING_RATE_MAX', 20), preHandler: requireRole('passenger', 'corporate_booker', 'corporate_admin') }, async (req, reply) => {
    const key = (req.headers['idempotency-key'] as string) ?? '';
    if (key.length < 8 || key.length > 100) throw badRequest('idempotency_key_required', 'Send an Idempotency-Key header (8-100 chars)');
    const b = parse(z.object({
      quote_id: z.string().uuid(), payment_method: z.enum(['cash', 'mtn_momo', 'airtel_money', 'corporate']),
      pickup_name: z.string().max(160).optional(), pickup_note: z.string().max(300).optional(), dest_name: z.string().max(160).optional(),
      corporate_id: z.string().uuid().optional(), cost_centre: z.string().max(60).optional(), po_ref: z.string().max(60).optional(),
      rider_name: z.string().max(80).optional(), rider_phone: z.string().max(20).optional(),
      customer_vehicle_id: z.string().uuid().optional(), owner_attested: z.boolean().optional(), request_code: z.string().trim().max(12).optional(),
    }), req.body);
    const { booking, replay } = await B.createBooking(req.auth!.id, { ...b, idempotency_key: key });
    reply.code(replay ? 200 : 201);
    return { replay, booking: await B.bookingView(booking, 'passenger') };
  });

  app.get('/bookings', { preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({ role: z.enum(['passenger', 'driver']).default('passenger'), limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().optional() }), req.query);
    const col = b.role === 'driver' ? 'driver_id' : 'passenger_id';
    const rows = await q<any>(`select * from bookings where ${col}=$1 and ($2::timestamptz is null or created_at < $2) order by created_at desc limit $3`, [req.auth!.id, b.before ?? null, b.limit]);
    return { bookings: await Promise.all(rows.map((r) => B.bookingView(r, b.role === 'driver' ? 'driver' : 'passenger'))) };
  });
  app.get('/bookings/active', { preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({ role: z.enum(['passenger', 'driver']).default('passenger') }), req.query);
    const col = b.role === 'driver' ? 'driver_id' : 'passenger_id';
    const r = await q1<any>(`select * from bookings where ${col}=$1 and status in ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS','COMPLETED','PAYMENT_PENDING') order by created_at desc limit 1`, [req.auth!.id]);
    return { booking: r ? await B.bookingView(r, b.role === 'driver' ? 'driver' : 'passenger') : null };
  });

  app.get('/bookings/:id', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const staff = can(req.auth!.roles, 'bookings.view_all');
    const { b, as } = await B.accessBooking(req.auth!, id, staff);
    return B.bookingView(b, as);
  });
  app.get('/bookings/:id/events', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const { b, as } = await B.accessBooking(req.auth!, id, can(req.auth!.roles, 'bookings.view_all'));
    const rows = await q('select type, from_status, to_status, actor_role, reason, created_at from booking_events where booking_id=$1 order by id', [b.id]);
    // dispatch internals (which drivers were offered the trip) are for the driver's own view and staff only
    return { events: as !== 'driver' && as !== 'staff' ? rows.filter((r: any) => !['offer_sent', 'offer_rejected', 'pin_failed'].includes(r.type)) : rows };
  });
  app.get('/bookings/:id/receipt', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const { b, as } = await B.accessBooking(req.auth!, id, can(req.auth!.roles, 'bookings.view_all'));
    if (!['PAYMENT_COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'PAYMENT_PENDING', 'COMPLETED'].includes(b.status)) throw badRequest('no_receipt', 'Receipt is available once the trip is completed');
    const pay = await q1<any>("select reference, method, status, amount, completed_at from payments where booking_id=$1 order by created_at desc limit 1", [b.id]);
    const d = b.driver_id ? await q1<any>('select u.display_name, v.plate from users u left join vehicles v on v.id=$2 where u.id=$1', [b.driver_id, b.vehicle_id]) : null;
    return {
      receipt_no: b.ref, issued_at: new Date(), status: b.status, currency: 'RWF',
      route: { from: b.pickup_name, to: b.dest_name, distance_m: b.distance_m, duration_s: b.duration_s },
      fare: as === 'driver' ? undefined : b.fare_breakdown, total: b.final_fare,
      payment: pay ? { method: pay.method, status: pay.status, reference: pay.reference, paid_at: pay.completed_at } : null,
      driver: d ? { name: d.display_name, plate: d.plate } : null, final_fare_note: pickLang(req, {
        en: 'Final fare equals the accepted estimate unless disclosed waiting time or authorised extras apply.',
        fr: 'Le prix final est égal à l\'estimation acceptée, sauf temps d\'attente signalé ou suppléments autorisés.',
        rw: 'Igiciro cya nyuma kingana n\'icyo wemeye mbere, uretse igihe cyo gutegereza cyatangajwe cyangwa ibyongeweho byemewe.' }),
    };
  });

  app.post('/bookings/:id/cancel', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ reason: z.string().min(2).max(100), as: z.enum(['passenger', 'driver']).default('passenger') }), req.body);
    if (b.as === 'driver' && !req.auth!.roles.includes('driver')) throw badRequest('not_a_driver');
    return B.bookingView(await B.cancelBooking(req.auth!.id, id, b.reason, b.as), b.as);
  });
  app.post('/bookings/:id/ratings', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(500).optional(), tags: z.array(z.string().max(30)).max(6).optional() }), req.body);
    return B.rateBooking(req.auth!.id, id, b.score, b.comment, b.tags);
  });
  app.post('/bookings/:id/share', { config: routeLimit('SHARE_RATE_MAX', 20), preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ ttl_minutes: z.number().int().min(10).max(1440).default(240) }), req.body);
    return B.createShare(req.auth!.id, id, b.ttl_minutes);
  });
  app.delete('/bookings/:id/share', { preHandler: anyAuth }, async (req) => { const { id } = parse(idp, req.params); await B.revokeShares(req.auth!.id, id); return { ok: true }; });
  app.get('/bookings/:id/messages', { preHandler: anyAuth }, async (req) => { const { id } = parse(idp, req.params); return { messages: await B.listMessages(req.auth!.id, id) }; });
  app.post('/bookings/:id/messages', { config: routeLimit('CHAT_RATE_MAX', 30), preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ body: z.string().min(1).max(500) }), req.body);
    await B.postMessage(req.auth!.id, id, b.body); return { ok: true };
  });

  // passenger payment
  app.post('/bookings/:id/payment-method', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ method: z.enum(['cash', 'mtn_momo']) }), req.body);
    return B.bookingView(await P.switchMethod(req.auth!.id, id, b.method), 'passenger');
  });

  // ---- driver trip operations ----
  const drv = { preHandler: requireRole('driver') };
  app.get('/drivers/me/offers', drv, async (req) => {
    const rows = await q<any>(`select o.booking_id, o.expires_at, o.eta_s, o.distance_m, o.driver_net, b.pickup_lat, b.pickup_lng, b.pickup_name, b.pickup_note, b.dest_lat, b.dest_lng, b.dest_name, b.service_id, b.payment_method,
        b.distance_m trip_distance_m, b.duration_s trip_duration_s, b.estimated_fare, b.ref,
        b.hire_mode, b.hours_booked, cv.vehicle_class cv_class, cv.transmission cv_transmission, cv.make cv_make, cv.model cv_model, cv.color cv_color
      from dispatch_offers o join bookings b on b.id=o.booking_id left join customer_vehicles cv on cv.id=b.customer_vehicle_id where o.driver_id=$1 and o.status='pending' and o.expires_at > now() and b.status='SEARCHING_DRIVER'`, [req.auth!.id]);
    return { offers: rows };
  });
  app.post('/bookings/:id/accept', drv, async (req) => { const { id } = parse(idp, req.params); return B.bookingView(await D.acceptOffer(req.auth!.id, id), 'driver'); });
  app.post('/bookings/:id/reject', drv, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ reason: z.string().max(50).optional() }), req.body);
    await D.rejectOffer(req.auth!.id, id, b.reason); return { ok: true };
  });
  app.post('/bookings/:id/en-route', drv, async (req) => { const { id } = parse(idp, req.params); return B.bookingView(await B.enRoute(req.auth!.id, id), 'driver'); });
  app.post('/bookings/:id/arrived', drv, async (req) => { const { id } = parse(idp, req.params); return B.bookingView(await B.arrived(req.auth!.id, id), 'driver'); });
  app.post('/bookings/:id/verify', drv, async (req) => { const { id } = parse(idp, req.params); return B.bookingView(await B.beginVerification(req.auth!.id, id), 'driver'); });
  app.post('/bookings/:id/start', drv, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ pin: z.string().regex(/^\d{4}$/) }), req.body);
    return B.bookingView(await B.startTrip(req.auth!.id, id, b.pin), 'driver');
  });
  app.post('/bookings/:id/no-show', drv, async (req) => { const { id } = parse(idp, req.params); return B.bookingView(await B.noShow(req.auth!.id, id), 'driver'); });
  app.post('/bookings/:id/complete', drv, async (req) => { const { id } = parse(idp, req.params); return B.bookingView(await B.completeTrip(req.auth!.id, id), 'driver'); });
  app.post('/bookings/:id/cash-collected', drv, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ amount: z.number().int().positive() }), req.body);
    const key = String(req.headers['idempotency-key'] ?? '').slice(0, 100) || undefined;
    return P.confirmCash(req.auth!.id, id, b.amount, key);
  });
}
