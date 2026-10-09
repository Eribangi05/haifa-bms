import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../util/validate.js';
import { anyAuth, requireRole, routeLimit } from '../guards.js';
import { q, q1 } from '../db.js';
import * as B from '../services/bookings.js';
import * as P from '../services/payments.js';
import * as D from '../services/dispatch.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { flagFor } from '../services/settings.js';
import { turnByTurn } from '../services/navigation.js';
import { can } from '../rbac.js';
import { pickLang, reqLang } from '../services/errmsg.js';
import { isLite, liteBooking, liteOffers, sendConditional } from '../services/lowdata.js';

const idp = z.object({ id: z.string().uuid() });

export async function bookingRoutes(app: FastifyInstance) {
  // ---- passenger ----
  app.post('/bookings', { config: routeLimit('BOOKING_RATE_MAX', 20), preHandler: requireRole('passenger', 'corporate_booker', 'corporate_admin') }, async (req, reply) => {
    const key = (req.headers['idempotency-key'] as string) ?? '';
    if (key.length < 8 || key.length > 100) throw badRequest('idempotency_key_required', 'Send an Idempotency-Key header (8-100 chars)');
    const b = parse(z.object({
      quote_id: z.string().uuid(), payment_method: z.enum(['cash', 'mtn_momo', 'airtel_money', 'corporate', 'partner', 'wallet', 'wallet_partial']), wallet_amount: z.number().int().positive().optional(), remainder_method: z.enum(['cash', 'mtn_momo']).optional(),
      pickup_name: z.string().max(160).optional(), pickup_note: z.string().max(300).optional(), dest_name: z.string().max(160).optional(),
      corporate_id: z.string().uuid().optional(), cost_centre: z.string().max(60).optional(), po_ref: z.string().max(60).optional(),
      rider_name: z.string().max(80).optional(), rider_phone: z.string().max(20).optional(),
      customer_vehicle_id: z.string().uuid().optional(), owner_attested: z.boolean().optional(), prefer_favourite: z.boolean().optional(), request_code: z.string().trim().max(12).optional(),
      for_guest: z.object({ name: z.string().trim().min(1).max(60), phone: z.string().max(20), language: z.enum(['rw', 'fr', 'en']).optional() }).optional(),
    }), req.body);
    const { booking, replay } = await B.createBooking(req.auth!.id, { ...b, idempotency_key: key });
    reply.code(replay ? 200 : 201);
    return { replay, booking: await B.bookingView(booking, 'passenger') };
  });

  app.get('/bookings', { preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({ role: z.enum(['passenger', 'driver']).default('passenger'), limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().optional() }), req.query);
    const col = b.role === 'driver' ? 'driver_id' : 'passenger_id';
    const rows = await q<any>(`select * from bookings where ${col}=$1 and ($2::timestamptz is null or created_at < $2) order by created_at desc limit $3`, [req.auth!.id, b.before ?? null, b.limit]);
    const lite = isLite(req);
    return { bookings: await Promise.all(rows.map(async (r) => { const v = await B.bookingView(r, b.role === 'driver' ? 'driver' : 'passenger'); return lite ? liteBooking(v) : v; })) };
  });
  app.get('/bookings/active', { preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({ role: z.enum(['passenger', 'driver']).default('passenger') }), req.query);
    const col = b.role === 'driver' ? 'driver_id' : 'passenger_id';
    const r = await q1<any>(`select * from bookings where ${col}=$1 and status in ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS','COMPLETED','PAYMENT_PENDING') order by created_at desc limit 1`, [req.auth!.id]);
    const v = r ? await B.bookingView(r, b.role === 'driver' ? 'driver' : 'passenger') : null;
    return { booking: v && isLite(req) ? liteBooking(v) : v };
  });

  // Polling endpoint: ETag + If-None-Match (304 with no body when nothing changed) and the optional lite payload (?lite=1 or x-lite: 1).
  app.get('/bookings/:id', { preHandler: anyAuth }, async (req, reply) => {
    const { id } = parse(idp, req.params);
    const staff = can(req.auth!.roles, 'bookings.view_all');
    const { b, as } = await B.accessBooking(req.auth!, id, staff);
    const lite = isLite(req);
    const v = await B.bookingView(b, as);
    const out = lite ? liteBooking(v) : v;
    if (sendConditional(req, reply, out, `${as}|${lite ? 'lite' : 'full'}|${req.auth!.id}`).notModified) return reply.send();
    return out;
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
    const pay = await q1<any>("select reference, method, status, amount, completed_at from payments where booking_id=$1 and kind='fare' order by created_at desc limit 1", [b.id]);
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
    const b = parse(z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(500).optional(), tags: z.array(z.string().max(30)).max(6).optional(),
      tip: z.object({ amount: z.number().int().positive(), method: z.enum(['mtn_momo', 'cash_tip']), msisdn: z.string().max(20).optional() }).optional() }), req.body);
    return B.rateBooking(req.auth!.id, id, b.score, b.comment, b.tags, b.tip);
  });
  app.post('/bookings/:id/share', { config: routeLimit('SHARE_RATE_MAX', 20), preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ ttl_minutes: z.number().int().min(10).max(1440).default(240), hide_destination: z.boolean().default(false) }), req.body);
    return B.createShare(req.auth!.id, id, b.ttl_minutes, b.hide_destination);
  });
  app.delete('/bookings/:id/share', { preHandler: anyAuth }, async (req) => { const { id } = parse(idp, req.params); await B.revokeShares(req.auth!.id, id); return { ok: true }; });
  app.get('/bookings/:id/messages', { preHandler: anyAuth }, async (req) => { const { id } = parse(idp, req.params); const { after } = parse(z.object({ after: z.coerce.number().int().min(0).default(0) }), req.query); return { messages: await B.listMessages(req.auth!.id, id, after) }; });
  app.post('/bookings/:id/messages', { config: routeLimit('CHAT_RATE_MAX', 30), preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ body: z.string().min(1).max(500) }), req.body);
    await B.postMessage(req.auth!.id, id, b.body); return { ok: true };
  });
  app.post('/bookings/:id/share-phone', { config: routeLimit('CHAT_RATE_MAX', 30), preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ share: z.boolean() }), req.body);
    return B.sharePhone(req.auth!.id, id, b.share);
  });

  // passenger payment
  app.post('/bookings/:id/payment-method', { preHandler: anyAuth }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({ method: z.enum(['cash', 'mtn_momo']) }), req.body);
    return B.bookingView(await P.switchMethod(req.auth!.id, id, b.method), 'passenger');
  });

  // ---- driver trip operations ----
  const drv = { preHandler: requireRole('driver') };
  app.get('/drivers/me/offers', drv, async (req, reply) => {
    const rows = await q<any>(`select o.booking_id, o.expires_at, o.eta_s, o.distance_m, o.driver_net, b.pickup_lat, b.pickup_lng, b.pickup_name, b.pickup_note, b.dest_lat, b.dest_lng, b.dest_name, b.service_id, b.payment_method,
        b.distance_m trip_distance_m, b.duration_s trip_duration_s, b.estimated_fare, b.ref,
        b.hire_mode, b.hours_booked, cv.vehicle_class cv_class, cv.transmission cv_transmission, cv.make cv_make, cv.model cv_model, cv.color cv_color
      from dispatch_offers o join bookings b on b.id=o.booking_id left join customer_vehicles cv on cv.id=b.customer_vehicle_id where o.driver_id=$1 and o.status='pending' and o.expires_at > now() and b.status='SEARCHING_DRIVER'`, [req.auth!.id]);
    const out = { offers: isLite(req) ? liteOffers(rows) : rows };
    if (sendConditional(req, reply, out, isLite(req) ? 'lite' : 'full').notModified) return reply.send();
    return out;
  });
  // Turn-by-turn route for the driver (own road graph). Optional lat/lng = the phone's current position; otherwise the last position the server has.
  app.get('/bookings/:id/navigation', { ...drv, config: routeLimit('NAV_RATE_MAX', 40) }, async (req) => {
    const { id } = parse(idp, req.params);
    const qy = parse(z.object({ lat: z.coerce.number().min(-3).max(0).optional(), lng: z.coerce.number().min(28).max(32).optional() }), req.query);
    if (!(await flagFor('navigation.enabled', req.auth!.id))) throw conflict('navigation_unavailable', 'Navigation is switched off');
    const b = await q1<any>("select * from bookings where id=$1 and driver_id=$2 and status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS')", [id, req.auth!.id]);
    if (!b) throw notFound('booking');
    const d = await q1<any>("select dp.last_lat, dp.last_lng, (select vehicle_type from vehicles where driver_id=dp.user_id and status='approved' limit 1) vt from driver_profiles dp where dp.user_id=$1", [req.auth!.id]);
    const from = qy.lat != null && qy.lng != null ? { lat: qy.lat, lng: qy.lng } : d?.last_lat != null ? { lat: d.last_lat, lng: d.last_lng } : null;
    if (!from) throw conflict('location_unknown', 'Your location is not known yet');
    return turnByTurn(b, from, d?.vt ?? 'car');
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
