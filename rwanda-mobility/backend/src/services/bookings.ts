import { createHmac, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { q, q1, tx } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { haversineM, pointInPolygon, type LatLng } from '../util/geo.js';
import { computeFare, finalizeFare, activeRule, ruleById, type Breakdown } from './pricing.js';
import { route } from './maps.js';
import { checkPromo } from './promos.js';
import { getSetting, flag } from './settings.js';
import { transition, logEvent, ACTIVE_TRIP, type BookingRow, type Status } from './bookingMachine.js';
import { startSearch } from './dispatch.js';
import { notify } from './notify.js';
import { sha256, randomToken } from '../util/crypto.js';
import { createDuePayment } from './payments.js';
import { DOCS_OK_SQL } from './drivers.js';

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => 'RM-' + Array.from(randomBytes(6), (b) => REF_ALPHABET[b % 32]).join('');

/** 4-digit trip PIN derived from the booking id: never stored, always verifiable, unguessable without the server secret. */
export const tripPin = (bookingId: string) =>
  String(parseInt(createHmac('sha256', config.pinSecret).update(bookingId).digest('hex').slice(0, 8), 16) % 10000).padStart(4, '0');

export async function zoneFor(p: LatLng): Promise<{ id: string; name: string } | null> {
  const zones = await q<any>('select id, name, polygon from service_zones where active');
  return zones.find((z) => pointInPolygon(p, z.polygon)) ?? null;
}

async function nearbyAvailable(svc: any, zoneId: string, pickup: LatLng, radiusM: number, heartbeatS: number) {
  const rows = await q<any>(
    `select dp.last_lat, dp.last_lng, v.vehicle_type from driver_profiles dp
     join users u on u.id=dp.user_id and u.status='active'
     join vehicles v on v.driver_id=dp.user_id and v.status='approved'
     where dp.status='APPROVED' and dp.is_online and dp.last_seen_at > now() - make_interval(secs => $1)
       and dp.last_location_at > now() - make_interval(secs => $1) and (dp.zone_id is null or dp.zone_id=$2)
       and v.vehicle_type = any($3) and v.capacity >= $4 and (not $5 or v.comfort) and ${DOCS_OK_SQL('dp', 'v.vehicle_type')}
       and not exists (select 1 from bookings x where x.driver_id=dp.user_id and x.status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS'))`,
    [heartbeatS, zoneId, svc.vehicle_types, svc.min_capacity, svc.requires_comfort]);
  const near = rows.filter((r) => haversineM({ lat: r.last_lat, lng: r.last_lng }, pickup) <= radiusM);
  return near.map((r) => haversineM({ lat: r.last_lat, lng: r.last_lng }, pickup));
}

async function schedulableSupply(svc: any): Promise<number> {
  const r = await q1<{ n: number }>(
    `select count(*)::int n from driver_profiles dp join vehicles v on v.driver_id=dp.user_id and v.status='approved'
     where dp.status='APPROVED' and v.vehicle_type = any($1) and v.capacity >= $2 and (not $3 or v.comfort) and ${DOCS_OK_SQL('dp', 'v.vehicle_type')}`,
    [svc.vehicle_types, svc.min_capacity, svc.requires_comfort]);
  return r!.n;
}

export type EstimateIn = { pickup: LatLng; dest: LatLng; service_id?: string; promo_code?: string; scheduled_for?: string };

/** Validates coverage, prices every enabled service, stores an immutable quote per option. */
export async function estimate(passengerId: string, inp: EstimateIn) {
  const pz = await zoneFor(inp.pickup);
  if (!pz) throw badRequest('pickup_outside_coverage', 'Pickup is outside our service area');
  const scheduled = inp.scheduled_for ? new Date(inp.scheduled_for) : null;
  if (scheduled) {
    if (!(await flag('booking.scheduled'))) throw badRequest('scheduled_disabled', 'Scheduled rides are not enabled');
    const days = await getSetting('booking.max_scheduled_days');
    if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() < Date.now() + 20 * 60e3 || scheduled.getTime() > Date.now() + days * 86400e3)
      throw badRequest('invalid_schedule', `Schedule between 20 minutes and ${days} days ahead`);
  }
  const svcs = await q<any>(
    `select s.* from service_categories s join zone_services zs on zs.service_id=s.id and zs.zone_id=$1 and zs.enabled
     where s.enabled and ($2::text is null or s.id=$2) order by s.sort`, [pz.id, inp.service_id ?? null]);
  if (inp.service_id && !svcs.length) throw badRequest('service_unavailable', 'This service is not available here');
  const dz = await zoneFor(inp.dest);
  const [hb, ttl, radius] = [await getSetting('dispatch.heartbeat_max_age_s'), await getSetting('booking.quote_ttl_s'), await getSetting('dispatch.max_radius_km')];
  const options: any[] = [];
  for (const s of svcs) {
    const maxKm = s.restrictions?.max_distance_km;
    if (!dz && !s.restrictions?.allow_outside_dest) { options.push({ service_id: s.id, available: false, reason: 'destination_outside_coverage' }); continue; }
    const vt = s.vehicle_types[0];
    const rt = await route(inp.pickup, inp.dest, vt);
    if (maxKm && rt.distance_m > maxKm * 1000) { options.push({ service_id: s.id, available: false, reason: 'too_far_for_service' }); continue; }
    const rule = await activeRule(s.id, pz.id, scheduled ?? new Date());
    const promo = inp.promo_code ? await (async () => {
      const pre = computeFare(rule, { distance_m: rt.distance_m, duration_s: rt.duration_s, airport: s.id === 'airport', scheduled: !!scheduled });
      return checkPromo(inp.promo_code!, passengerId, s.id, pz.id, pre.subtotal);
    })() : null;
    const bd: Breakdown = computeFare(rule, {
      distance_m: rt.distance_m, duration_s: rt.duration_s, airport: s.id === 'airport', scheduled: !!scheduled,
      promo: promo?.ok ? { code: promo.code, discount: promo.discount } : undefined,
    });
    let available: boolean, near: number[] = [], reason: string | undefined;
    if (scheduled) { available = (await schedulableSupply(s)) > 0; if (!available) reason = 'no_vehicles_for_service'; }
    else { near = await nearbyAvailable(s, pz.id, inp.pickup, radius * 1000, hb); available = near.length > 0; if (!available) reason = 'no_drivers_nearby'; }
    let quoteId: string | null = null;
    if (available) {
      quoteId = (await q1<{ id: string }>(
        `insert into fare_quotes(passenger_id, service_id, zone_id, pickup_lat, pickup_lng, dest_lat, dest_lng, distance_m, duration_s, route_source, rule_id, rule_version, promo_code, breakdown, total, scheduled_for, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now() + make_interval(secs => $17)) returning id`,
        [passengerId, s.id, pz.id, inp.pickup.lat, inp.pickup.lng, inp.dest.lat, inp.dest.lng, rt.distance_m, rt.duration_s, rt.source, rule.id, rule.version,
         promo?.ok ? promo.code : null, JSON.stringify(bd), bd.total, scheduled, ttl]))!.id;
    }
    options.push({
      service_id: s.id, name_en: s.name_en, name_rw: s.name_rw, capacity: s.passenger_capacity, luggage: s.luggage,
      available, reason, quote_id: quoteId, fare: bd, distance_m: rt.distance_m, duration_s: rt.duration_s, route_source: rt.source,
      pickup_eta_s: near.length ? Math.round((Math.min(...near) * 1.5) / 1000 / 24 * 3600) : null, nearby_drivers: scheduled ? undefined : near.length,
      promo: promo ? (promo.ok ? { code: promo.code, discount: promo.discount } : { error: promo.reason }) : undefined,
      is_estimate: true,
    });
  }
  const hasAny = options.some((o) => o.available);
  return { zone: pz.id, options, alternatives: hasAny ? [] : ['try_other_service', 'move_pickup', 'schedule_later'], quote_ttl_s: ttl };
}

export type CreateIn = {
  quote_id: string; payment_method: string; pickup_name?: string; pickup_note?: string; dest_name?: string; idempotency_key: string;
  corporate_id?: string; cost_centre?: string; po_ref?: string; rider_name?: string; rider_phone?: string;
};

async function enforceCorporate(c: PoolClient, userId: string, corporateId: string, serviceId: string, total: number, when: Date) {
  const corp = await q1<any>('select * from corporate_accounts where id=$1', [corporateId], c);
  if (!corp || corp.status !== 'active') throw forbidden('Corporate account is not active');
  const m = await q1<any>('select * from corporate_members where corporate_id=$1 and user_id=$2 and active', [corporateId, userId], c);
  if (!m) throw forbidden('You are not an authorised member of this business account');
  const pol = corp.policy ?? {};
  if (pol.max_fare && total > pol.max_fare) throw new AppError(403, 'corporate_max_fare', `Fare exceeds the company limit of ${pol.max_fare} RWF`);
  if (pol.allowed_services?.length && !pol.allowed_services.includes(serviceId)) throw new AppError(403, 'corporate_service_not_allowed', 'Service not allowed by company policy');
  if (pol.start_hour != null && pol.end_hour != null) {
    const h = (when.getUTCHours() + 2) % 24; // Africa/Kigali
    if (h < pol.start_hour || h >= pol.end_hour) throw new AppError(403, 'corporate_time_not_allowed', 'Booking time not allowed by company policy');
  }
  const monthStart = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1));
  const spend = (where: string, p: unknown[]) => q1<{ s: number }>(
    `select coalesce(sum(coalesce(final_fare, estimated_fare)),0)::int s from bookings where corporate_id=$1 ${where}
       and status not in ('CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER','CANCELLED_BY_SYSTEM','NO_DRIVER_FOUND') and created_at >= $2`, [corporateId, monthStart, ...p], c);
  if (m.spending_limit != null && (await spend('and passenger_id=$3', [userId]))!.s + total > m.spending_limit)
    throw new AppError(403, 'corporate_member_limit', 'Monthly spending limit for this employee would be exceeded');
  if (corp.monthly_budget != null && (await spend('', []))!.s + total > corp.monthly_budget)
    throw new AppError(403, 'corporate_budget_exceeded', 'Company monthly transport budget would be exceeded');
  return { member: m, corp };
}

export async function createBooking(passengerId: string, inp: CreateIn) {
  const methods = ['cash', 'mtn_momo', 'airtel_money', 'corporate'];
  if (!methods.includes(inp.payment_method)) throw badRequest('payment_method_unavailable');
  if (inp.payment_method === 'mtn_momo' && !(await flag('payments.mtn_momo'))) throw badRequest('payment_method_unavailable');
  if (inp.payment_method === 'airtel_money' && !(await flag('payments.airtel_money'))) throw badRequest('payment_method_unavailable', 'Airtel Money is not enabled yet');
  if ((inp.payment_method === 'corporate') !== !!inp.corporate_id) throw badRequest('corporate_payment_mismatch', 'Corporate payment requires a business account');
  if (inp.corporate_id && !(await flag('corporate.enabled'))) throw badRequest('corporate_disabled');

  const existing = await q1<BookingRow>('select * from bookings where passenger_id=$1 and idempotency_key=$2', [passengerId, inp.idempotency_key]);
  if (existing) return { booking: existing, replay: true };

  let created: BookingRow;
  try {
    created = await tx(async (c) => {
      const quote = await q1<any>('select * from fare_quotes where id=$1 for update', [inp.quote_id], c);
      if (!quote || quote.passenger_id !== passengerId) throw notFound('quote');
      if (quote.used_booking_id) throw conflict('quote_used', 'Quote already used');
      if (new Date(quote.expires_at) < new Date()) throw conflict('quote_expired', 'Fare expired. Please re-check the price.');
      const svc = (await q1<any>('select * from service_categories where id=$1', [quote.service_id], c))!;
      if (!svc.enabled) throw badRequest('service_unavailable');
      // Re-validate a promo at commit time so a spent/expired promo can never be silently honoured.
      if (quote.promo_code) {
        const pc = await checkPromo(quote.promo_code, passengerId, quote.service_id, quote.zone_id, quote.breakdown.subtotal - quote.breakdown.passthrough, c);
        if (!pc.ok || pc.discount !== quote.breakdown.discount) throw conflict('promo_invalid', 'Promotion is no longer valid; please re-check the price.');
      }
      const when = quote.scheduled_for ? new Date(quote.scheduled_for) : new Date();
      if (inp.corporate_id) await enforceCorporate(c, passengerId, inp.corporate_id, quote.service_id, quote.total, when);
      const scheduled = !!quote.scheduled_for;
      const ref = newRef();
      const b = (await q<BookingRow>(
        `insert into bookings(ref, passenger_id, service_id, zone_id, status, pickup_lat, pickup_lng, pickup_name, pickup_note, dest_lat, dest_lng, dest_name,
           quote_id, estimated_fare, distance_m, duration_s, payment_method, payer_type, corporate_id, cost_centre, po_ref, rider_name, rider_phone, scheduled_for, idempotency_key, requested_at, fare_breakdown)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,now(),$26) returning *`,
        [ref, passengerId, quote.service_id, quote.zone_id, scheduled ? 'SCHEDULED' : 'REQUESTED', quote.pickup_lat, quote.pickup_lng, inp.pickup_name ?? null, inp.pickup_note ?? null,
         quote.dest_lat, quote.dest_lng, inp.dest_name ?? null, quote.id, quote.total, quote.distance_m, quote.duration_s, inp.payment_method,
         inp.corporate_id ? 'corporate' : 'passenger', inp.corporate_id ?? null, inp.cost_centre ?? null, inp.po_ref ?? null, inp.rider_name ?? null, inp.rider_phone ?? null,
         quote.scheduled_for, inp.idempotency_key, JSON.stringify(quote.breakdown)], c))[0];
      await q('update fare_quotes set used_booking_id=$2 where id=$1', [quote.id, b.id], c);
      await logEvent(c, b.id, 'booking_created', { id: passengerId, role: 'passenger' }, { quote_id: quote.id, total: quote.total, rule_version: quote.rule_version });
      if (quote.promo_code) {
        const p = (await q1<any>('select id from promotions where upper(code)=upper($1)', [quote.promo_code], c))!;
        const ok = await q('update promotions set spent = spent + $2 where id=$1 and (budget is null or spent + $2 <= budget) returning id', [p.id, quote.breakdown.discount], c);
        if (!ok.length) throw conflict('promo_invalid', 'Promotion budget exhausted');
        await q('insert into promotion_redemptions(promotion_id,user_id,booking_id,amount) values ($1,$2,$3,$4)', [p.id, passengerId, b.id, quote.breakdown.discount], c);
      }
      return b;
    });
  } catch (e: any) {
    if (e.code === '23505') {
      if (String(e.constraint).includes('one_open_request')) {
        const open = await q1<any>("select id, ref, status from bookings where passenger_id=$1 and payer_type='passenger' and scheduled_for is null and status in ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS')", [passengerId]);
        throw new AppError(409, 'active_booking_exists', 'You already have an active trip', open);
      }
      const again = await q1<BookingRow>('select * from bookings where passenger_id=$1 and idempotency_key=$2', [passengerId, inp.idempotency_key]);
      if (again) return { booking: again, replay: true };
    }
    throw e;
  }
  await notify(passengerId, 'booking_confirmed', { ref: created.ref });
  if (created.status === 'REQUESTED') {
    await startSearch(created.id);
    created = (await q1<BookingRow>('select * from bookings where id=$1', [created.id]))!;
  }
  return { booking: created, replay: false };
}

// ---------- access control & views ----------
export type Viewer = { id: string; roles: string[] };
export type Perspective = 'passenger' | 'driver' | 'corporate' | 'fleet' | 'staff';

export async function accessBooking(v: Viewer, id: string, staffAllowed: boolean): Promise<{ b: BookingRow; as: Perspective }> {
  const b = await q1<BookingRow>('select * from bookings where id=$1', [id]);
  if (!b) throw notFound('booking');
  if (b.passenger_id === v.id) return { b, as: 'passenger' };
  if (b.driver_id === v.id) return { b, as: 'driver' };
  if (b.corporate_id) {
    const m = await q1("select 1 from corporate_members where corporate_id=$1 and user_id=$2 and role='admin' and active", [b.corporate_id, v.id]);
    if (m) return { b, as: 'corporate' };
  }
  if (b.driver_id) {
    const f = await q1('select 1 from driver_profiles dp join fleet_members fm on fm.fleet_id=dp.fleet_id where dp.user_id=$1 and fm.user_id=$2', [b.driver_id, v.id]);
    if (f) return { b, as: 'fleet' };
  }
  if (staffAllowed) return { b, as: 'staff' };
  throw notFound('booking'); // do not reveal existence
}

export async function bookingView(b: BookingRow, as: Perspective) {
  const out: any = {
    id: b.id, ref: b.ref, status: b.status, version: b.version, service_id: b.service_id,
    pickup: { lat: b.pickup_lat, lng: b.pickup_lng, name: b.pickup_name, note: b.pickup_note },
    destination: { lat: b.dest_lat, lng: b.dest_lng, name: b.dest_name },
    estimated_fare: b.estimated_fare, final_fare: b.final_fare, fare_is_final: b.final_fare != null,
    fare_breakdown: b.fare_breakdown, payment_method: b.payment_method, scheduled_for: b.scheduled_for,
    requested_at: b.requested_at, assigned_at: b.assigned_at, started_at: b.started_at, completed_at: b.completed_at,
    cancelled_at: b.cancelled_at, cancel_by: b.cancel_by, cancel_reason: b.cancel_reason, cancel_fee: b.cancel_fee,
    distance_m: b.distance_m, duration_s: b.duration_s, confirmed: !['DRAFT', 'FARE_ESTIMATED'].includes(b.status),
  };
  if (as === 'fleet' || as === 'driver') { /* money below */ }
  if (b.driver_id && ACTIVE_TRIP.concat(['COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED'] as Status[]).includes(b.status)) {
    const d = await q1<any>(
      `select u.display_name, dp.rating_avg, dp.rating_count, dp.last_lat, dp.last_lng, dp.last_location_at, u.photo_key,
              v.make, v.model, v.color, v.plate, v.vehicle_type
       from driver_profiles dp join users u on u.id=dp.user_id left join vehicles v on v.id=$2 where dp.user_id=$1`, [b.driver_id, b.vehicle_id]);
    if (as === 'passenger' || as === 'staff' || as === 'corporate') {
      out.driver = { name: d.display_name, rating: Number(d.rating_avg), rating_count: d.rating_count, has_photo: !!d.photo_key };
      out.vehicle = { make: d.make, model: d.model, color: d.color, plate: d.plate, type: d.vehicle_type };
      if (ACTIVE_TRIP.includes(b.status) && d.last_lat != null)
        out.driver_location = { lat: d.last_lat, lng: d.last_lng, at: d.last_location_at };
    }
  }
  if (as === 'passenger' && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'].includes(b.status)) out.trip_pin = tripPin(b.id);
  if (as === 'driver') {
    const p = await q1<any>('select display_name from users where id=$1', [b.passenger_id]);
    out.passenger = { first_name: (b.rider_name ?? p.display_name ?? 'Passenger').split(' ')[0] };   // no phone: use in-app messages
    const net = await q1<any>('select driver_net from dispatch_offers where booking_id=$1 and driver_id=$2 order by offered_at desc limit 1', [b.id, b.driver_id]);
    out.estimated_driver_net = net?.driver_net ?? null;
    delete out.fare_breakdown;
  }
  if (as === 'driver' || as === 'passenger' || as === 'staff' || as === 'fleet') {
    const pay = await q1<any>("select id, method, status, amount, amount_collected, reference, failure_reason from payments where booking_id=$1 order by created_at desc limit 1", [b.id]);
    if (pay) out.payment = { ...pay, outstanding: pay.method === 'cash' && pay.status !== 'SUCCESS' ? pay.amount - (pay.amount_collected ?? 0) : 0 };
  }
  if (as === 'driver') delete out.fare_breakdown;
  return out;
}

// ---------- cancellation ----------
export async function cancelBooking(actorId: string, bookingId: string, reason: string, who: 'passenger' | 'driver') {
  const [grace, fee] = await Promise.all([getSetting('booking.cancel_grace_s'), getSetting('booking.cancel_fee')]);
  const res = await tx(async (c) => {
    const b = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b) throw notFound('booking');
    if (who === 'passenger' && b.passenger_id !== actorId) throw notFound('booking');
    if (who === 'driver' && b.driver_id !== actorId) throw notFound('booking');
    if (['IN_PROGRESS', 'COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED'].includes(b.status)) throw conflict('cannot_cancel', 'Trip already started');
    if (who === 'passenger') {
      let cancelFee = 0;
      if (b.assigned_at && ACTIVE_TRIP.includes(b.status)) {
        const elapsed = (Date.now() - new Date(b.assigned_at).getTime()) / 1000;
        const driverResponsible = b.status === 'DRIVER_ASSIGNED' && reason === 'driver_too_far';
        if (elapsed > grace && !driverResponsible) cancelFee = fee;
      }
      const row = await transition(c, bookingId, 'CANCELLED_BY_PASSENGER', { id: actorId, role: 'passenger' },
        { reason, patch: { cancelled_at: new Date(), cancel_by: 'passenger', cancel_reason: reason, cancel_fee: cancelFee } });
      if (b.driver_id) await q("update dispatch_offers set status='cancelled' where booking_id=$1 and status='pending'", [bookingId], c);
      await q("update dispatch_offers set status='cancelled' where booking_id=$1 and status='pending'", [bookingId], c);
      return { row, driverId: b.driver_id };
    }
    // driver cancel => automatic reassignment; no fee for the passenger
    const excused = ['safety_concern', 'platform_error', 'connectivity', 'vehicle_issue_reported'].includes(reason);
    if (!excused) await q('update driver_profiles set cancel_count = cancel_count + 1 where user_id=$1', [actorId], c);
    await logEvent(c, bookingId, 'driver_cancelled', { id: actorId, role: 'driver' }, { excused }, reason);
    const row = await transition(c, bookingId, 'SEARCHING_DRIVER', { id: actorId, role: 'driver' },
      { reason: `driver_cancelled:${reason}`, patch: { driver_id: null, vehicle_id: null, assigned_at: null, arrived_at: null, dispatch_round: 0, last_round_at: null } });
    return { row, driverId: null };
  });
  if (who === 'driver') await startSearch(bookingId);
  else await notify(res.row.passenger_id, 'booking_cancelled', { ref: res.row.ref, reason: res.row.cancel_fee ? `Cancellation fee ${res.row.cancel_fee} RWF applies.` : '' });
  return (await q1<BookingRow>('select * from bookings where id=$1', [bookingId]))!;
}

// ---------- trip operations (driver) ----------
async function ownTrip(c: PoolClient, driverId: string, bookingId: string): Promise<BookingRow> {
  const b = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
  if (!b || b.driver_id !== driverId) throw notFound('booking');
  return b;
}

export async function enRoute(driverId: string, bookingId: string) {
  return tx(async (c) => { await ownTrip(c, driverId, bookingId); return transition(c, bookingId, 'DRIVER_ARRIVING', { id: driverId, role: 'driver' }, { expectFrom: ['DRIVER_ASSIGNED'] }); });
}

export async function arrived(driverId: string, bookingId: string) {
  const row = await tx(async (c) => {
    const b = await ownTrip(c, driverId, bookingId);
    const d = await q1<any>('select last_lat, last_lng, last_location_at from driver_profiles where user_id=$1', [driverId], c);
    const fresh = d.last_location_at && Date.now() - new Date(d.last_location_at).getTime() < 120_000;
    if (!fresh) throw conflict('location_stale', 'Turn on location to confirm arrival');
    if (haversineM({ lat: d.last_lat, lng: d.last_lng }, { lat: b.pickup_lat, lng: b.pickup_lng }) > 500) throw conflict('too_far_from_pickup', 'You are not at the pickup location yet');
    return transition(c, bookingId, 'DRIVER_ARRIVED', { id: driverId, role: 'driver' }, { expectFrom: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'], patch: { arrived_at: new Date() } });
  });
  const v = await q1<any>('select plate from vehicles where id=$1', [row.vehicle_id]);
  await notify(row.passenger_id, 'driver_arrived', { plate: v?.plate }, { critical: true });
  return row;
}

export async function beginVerification(driverId: string, bookingId: string) {
  return tx(async (c) => { await ownTrip(c, driverId, bookingId); return transition(c, bookingId, 'AWAITING_PASSENGER_VERIFICATION', { id: driverId, role: 'driver' }, { expectFrom: ['DRIVER_ARRIVED'] }); });
}

export async function startTrip(driverId: string, bookingId: string, pin: string) {
  const out = await tx(async (c) => {
    const b = await ownTrip(c, driverId, bookingId);
    if (!['DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'].includes(b.status)) throw conflict('invalid_state', `Booking is ${b.status}`);
    if (b.pin_attempts >= 5) throw new AppError(423, 'pin_locked', 'Too many wrong PIN attempts. Contact support.');
    if (pin !== tripPin(b.id)) {
      await q('update bookings set pin_attempts = pin_attempts + 1 where id=$1', [b.id], c);
      await logEvent(c, b.id, 'pin_failed', { id: driverId, role: 'driver' });
      return { ok: false as const, attemptsLeft: 4 - b.pin_attempts };
    }
    const row = await transition(c, bookingId, 'IN_PROGRESS', { id: driverId, role: 'driver' }, { patch: { started_at: new Date(), pin_verified_at: new Date() } });
    return { ok: true as const, row };
  }, 0);
  if (!out.ok) throw new AppError(400, 'pin_invalid', 'Wrong PIN', { attempts_left: out.attemptsLeft });
  await notify(out.row.passenger_id, 'trip_started', { ref: out.row.ref });
  return out.row;
}

/** Authorised, logged exception to PIN verification (dispatcher/support only; caller must hold bookings.dispatch). */
export async function overridePin(staffId: string, bookingId: string, reason: string) {
  if (!reason || reason.length < 10) throw badRequest('reason_required', 'A written reason is required');
  return tx(async (c) => {
    const row = await transition(c, bookingId, 'IN_PROGRESS', { id: staffId, role: 'staff' },
      { expectFrom: ['DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'], reason: `pin_override: ${reason}`, patch: { started_at: new Date(), pin_override_by: staffId } });
    await logEvent(c, bookingId, 'pin_override', { id: staffId, role: 'staff' }, {}, reason);
    return row;
  });
}

export async function noShow(driverId: string, bookingId: string) {
  const [wait, fee] = await Promise.all([getSetting('booking.noshow_wait_min'), getSetting('booking.noshow_fee')]);
  return tx(async (c) => {
    const b = await ownTrip(c, driverId, bookingId);
    if (!b.arrived_at || !['DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'].includes(b.status)) throw conflict('invalid_state', 'Arrive at pickup first');
    if ((Date.now() - new Date(b.arrived_at).getTime()) / 60000 < wait) throw conflict('wait_longer', `Wait at least ${wait} minutes before reporting a no-show`);
    return transition(c, bookingId, 'CANCELLED_BY_PASSENGER', { id: driverId, role: 'driver' },
      { reason: 'passenger_no_show', patch: { cancelled_at: new Date(), cancel_by: 'passenger_no_show', cancel_reason: 'passenger_no_show', cancel_fee: fee } });
  });
}

export async function completeTrip(driverId: string, bookingId: string) {
  const row = await tx(async (c) => {
    const b = await ownTrip(c, driverId, bookingId);
    if (b.status !== 'IN_PROGRESS') throw conflict('invalid_state', `Booking is ${b.status}`);
    if (b.final_fare != null) throw conflict('already_finalised', 'Fare already finalised');
    const rule = await ruleById((await q1<any>('select rule_id from fare_quotes where id=$1', [b.quote_id], c))!.rule_id, c);
    const waiting = b.arrived_at && b.started_at ? Math.ceil((new Date(b.started_at).getTime() - new Date(b.arrived_at).getTime()) / 60000) : 0;
    const bd = finalizeFare(rule, b.fare_breakdown, { waiting_min: waiting, extras: b.extra_charges ?? [] });
    const done = await transition(c, bookingId, 'COMPLETED', { id: driverId, role: 'driver' },
      { patch: { completed_at: new Date(), final_fare: bd.total, fare_breakdown: JSON.stringify(bd), waiting_min: waiting } });
    await q('update driver_profiles set completed_count = completed_count + 1, last_trip_at = now() where user_id=$1', [driverId], c);
    await createDuePayment(c, done);
    return (await q1<BookingRow>('select * from bookings where id=$1', [bookingId], c))!;
  });
  await notify(row.passenger_id, 'trip_completed', { ref: row.ref, fare: row.final_fare });
  return row;
}

// ---------- sharing, rating, messages ----------
export async function createShare(passengerId: string, bookingId: string, ttlMin = 240) {
  const b = await q1<BookingRow>('select * from bookings where id=$1 and passenger_id=$2', [bookingId, passengerId]);
  if (!b) throw notFound('booking');
  const token = randomToken(24);
  const exp = new Date(Date.now() + Math.min(ttlMin, 24 * 60) * 60000);
  await q('insert into trip_shares(booking_id, token_hash, expires_at, created_by) values ($1,$2,$3,$4)', [bookingId, sha256(token), exp, passengerId]);
  return { url: `${config.publicBaseUrl}/share/${token}`, token, expires_at: exp };
}
export async function revokeShares(passengerId: string, bookingId: string) {
  await q('update trip_shares set revoked_at=now() where booking_id=$1 and created_by=$2 and revoked_at is null', [bookingId, passengerId]);
}
/** Limited, unauthenticated view for trusted contacts: no phone, no PII beyond driver first name and plate. */
export async function sharedView(token: string) {
  const s = await q1<any>('select * from trip_shares where token_hash=$1', [sha256(token)]);
  if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) throw notFound('share link');
  const b = (await q1<BookingRow>('select * from bookings where id=$1', [s.booking_id]))!;
  const live = ACTIVE_TRIP.includes(b.status);
  const d = b.driver_id ? await q1<any>(`select u.display_name, dp.last_lat, dp.last_lng, dp.last_location_at, v.plate, v.make, v.model, v.color from driver_profiles dp join users u on u.id=dp.user_id left join vehicles v on v.id=$2 where dp.user_id=$1`, [b.driver_id, b.vehicle_id]) : null;
  return {
    status: b.status, ref: b.ref, destination: b.dest_name ?? null,
    driver: d ? { first_name: (d.display_name ?? '').split(' ')[0], plate: d.plate, vehicle: `${d.color ?? ''} ${d.make ?? ''} ${d.model ?? ''}`.trim() } : null,
    location: live && d?.last_lat != null ? { lat: d.last_lat, lng: d.last_lng, at: d.last_location_at } : null,
    expires_at: s.expires_at,
  };
}

export async function rateBooking(userId: string, bookingId: string, score: number, comment?: string, tags?: string[]) {
  return tx(async (c) => {
    const b = await q1<BookingRow>('select * from bookings where id=$1', [bookingId], c);
    if (!b || (b.passenger_id !== userId && b.driver_id !== userId)) throw notFound('booking');
    if (!['COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'DISPUTED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(b.status)) throw conflict('not_ratable', 'Only completed trips can be rated');
    const reviewee = userId === b.passenger_id ? b.driver_id! : b.passenger_id;
    try {
      await q('insert into ratings(booking_id, reviewer_id, reviewee_id, score, comment, tags) values ($1,$2,$3,$4,$5,$6)', [bookingId, userId, reviewee, score, comment ?? null, tags ?? null], c);
    } catch (e: any) { if (e.code === '23505') throw conflict('already_rated', 'You already rated this trip'); throw e; }
    if (userId === b.passenger_id) {
      await q(`update driver_profiles set rating_avg = (select round(avg(score)::numeric,2) from ratings where reviewee_id=$1), rating_count = (select count(*) from ratings where reviewee_id=$1) where user_id=$1`, [reviewee], c);
    }
    return { ok: true };
  });
}

export async function postMessage(userId: string, bookingId: string, body: string) {
  const b = await q1<BookingRow>('select * from bookings where id=$1', [bookingId]);
  if (!b || (b.passenger_id !== userId && b.driver_id !== userId)) throw notFound('booking');
  if (!b.driver_id || !ACTIVE_TRIP.includes(b.status)) throw conflict('chat_closed', 'Chat is only available during an active trip');
  await q('insert into trip_messages(booking_id, sender_id, body) values ($1,$2,$3)', [bookingId, userId, body]);
}
export async function listMessages(userId: string, bookingId: string) {
  const b = await q1<BookingRow>('select * from bookings where id=$1', [bookingId]);
  if (!b || (b.passenger_id !== userId && b.driver_id !== userId)) throw notFound('booking');
  return q('select id, sender_id, body, created_at from trip_messages where booking_id=$1 order by id', [bookingId]);
}
