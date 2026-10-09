import type { PoolClient } from 'pg';
import { depositBlocks } from './prepaidGuard.js';
import { q, q1, tx } from '../db.js';
import { conflict, notFound, AppError } from '../errors.js';
import { getSetting } from './settings.js';
import { haversineM } from '../util/geo.js';
import { cellsCovering, precisionFor } from '../util/geohash.js';
import { etaS } from './maps.js';
import { transition, logEvent, type BookingRow } from './bookingMachine.js';
import { DOCS_OK_SQL, driverPermission, abasarePermission } from './drivers.js';
import { notify } from './notify.js';
import { guestNotify } from './guestRides.js';
import { resolveCommission, calcCommission } from './commission.js';

export const EXCUSED_REASONS = new Set(['safety_concern', 'platform_error', 'connectivity', 'passenger_unreachable', 'vehicle_issue_reported']);

type Cand = { user_id: string; last_lat: number; last_lng: number; vehicle_id: string; vehicle_type: string; fleet_id: string | null;
  accepted_count: number; rejected_count: number; offers_count: number; last_trip_at: Date | null; };

/**
 * Eligible drivers for a booking, WITHOUT locking them. (Locking every candidate made two bookings searching at the same moment starve each other:
 * the second saw all drivers locked and found none. Only the drivers actually offered are locked: see `claimDriver`.)
 */
export async function findCandidates(c: PoolClient, b: BookingRow, svc: any, heartbeatS: number): Promise<Cand[]> {
  // Only drivers in the geohash cells around the pickup (within the largest search radius) are read: an indexed lookup instead of every online driver in the zone.
  const maxM = (await getSetting('dispatch.max_radius_km')) * 1000 + 500, gp = precisionFor(maxM);
  const ghSql = (n: number) => (gp ? `and dp.gh${gp} = any($${n})` : '');
  const ghParam = gp ? [cellsCovering({ lat: b.pickup_lat, lng: b.pickup_lng }, maxM, gp)] : [];
  if (svc.kind === 'abasare') {
    // The driver drives the CUSTOMER's car: match on skills (vehicle class + transmission), not on a driver vehicle.
    const cv = await q1<any>('select vehicle_class, transmission from customer_vehicles where id=$1', [b.customer_vehicle_id], c);
    if (!cv) return [];
    return q<Cand>(
      `select dp.user_id, dp.last_lat, dp.last_lng, dp.fleet_id, null::uuid vehicle_id, 'moto'::text vehicle_type, dp.accepted_count, dp.rejected_count, dp.offers_count, dp.last_trip_at
       from driver_profiles dp
       join users u on u.id = dp.user_id and u.status = 'active'
       where dp.status = 'APPROVED' and dp.abasare_status = 'approved' and 'abasare' = any(dp.accepting) and dp.is_online
         and dp.last_seen_at > now() - make_interval(secs => $1) and dp.last_location_at > now() - make_interval(secs => $1)
         and (dp.zone_id is null or dp.zone_id = $2)
         and (dp.abasare_skills->'classes') ? $3 and (dp.abasare_skills->'transmissions') ? $4
         and ${DOCS_OK_SQL('dp', "'abasare'")}
         and not exists (select 1 from bookings x where x.driver_id = dp.user_id and x.status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS'))
         and not exists (select 1 from dispatch_offers o where o.driver_id = dp.user_id and o.status = 'pending')
         and not exists (select 1 from dispatch_offers o where o.driver_id = dp.user_id and o.booking_id = $5)
         and not exists (select 1 from safety_blocks sb where sb.driver_id = dp.user_id and sb.passenger_id = $6)
         and not exists (select 1 from passenger_driver_prefs pp where pp.driver_id = dp.user_id and pp.passenger_id = $6 and pp.kind = 'blocked')
         and dp.last_lat is not null ${ghSql(7)}`,
      [heartbeatS, b.zone_id, cv.vehicle_class, cv.transmission, b.id, b.passenger_id, ...ghParam], c);
  }
  return q<Cand>(
    `select dp.user_id, dp.last_lat, dp.last_lng, dp.fleet_id, v.id vehicle_id, v.vehicle_type, dp.accepted_count, dp.rejected_count, dp.offers_count, dp.last_trip_at
     from driver_profiles dp
     join users u on u.id = dp.user_id and u.status = 'active'
     join vehicles v on v.driver_id = dp.user_id and v.status = 'approved'
     where dp.status = 'APPROVED' and dp.is_online and 'ride' = any(dp.accepting)
       and dp.last_seen_at > now() - make_interval(secs => $1) and dp.last_location_at > now() - make_interval(secs => $1)
       and (dp.zone_id is null or dp.zone_id = $2)
       and v.vehicle_type = any($3) and v.capacity >= $4 and (not $5 or v.comfort)
       and ${DOCS_OK_SQL('dp', 'v.vehicle_type')}
       and not exists (select 1 from bookings x where x.driver_id = dp.user_id and x.status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS'))
       and not exists (select 1 from dispatch_offers o where o.driver_id = dp.user_id and o.status = 'pending')
       and not exists (select 1 from dispatch_offers o where o.driver_id = dp.user_id and o.booking_id = $6)
       and not exists (select 1 from safety_blocks sb where sb.driver_id = dp.user_id and sb.passenger_id = $7)
       and not exists (select 1 from passenger_driver_prefs pp where pp.driver_id = dp.user_id and pp.passenger_id = $7 and pp.kind = 'blocked')
       and dp.last_lat is not null ${ghSql(8)}`,
    [heartbeatS, b.zone_id, svc.vehicle_types, svc.min_capacity, svc.requires_comfort, b.id, b.passenger_id, ...ghParam], c);
}

/**
 * Take the row lock on one driver and re-check, in a fresh statement, that nobody offered them a trip or assigned them one since the
 * candidate list was read. Returns false when another dispatch round holds or has just used the driver: pick the next candidate instead.
 */
async function claimDriver(c: PoolClient, driverId: string, bookingId: string): Promise<boolean> {
  if (!(await q1('select 1 from driver_profiles where user_id=$1 for update skip locked', [driverId], c))) return false;
  const busy = await q1(
    `select 1 where exists (select 1 from bookings x where x.driver_id=$1 and x.status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS'))
        or exists (select 1 from dispatch_offers o where o.driver_id=$1 and o.status='pending')
        or exists (select 1 from dispatch_offers o where o.driver_id=$1 and o.booking_id=$2)`, [driverId, bookingId], c);
  return !busy;
}

/** Lower is better. ETA first; small fairness credit for idle time and a penalty for unexcused rejections. */
export function rankScore(etaSec: number, d: Pick<Cand, 'rejected_count' | 'offers_count' | 'last_trip_at'>, now = Date.now()) {
  const idleMin = d.last_trip_at ? Math.min(30, (now - new Date(d.last_trip_at).getTime()) / 60000) : 30;
  const rejectRate = d.offers_count > 0 ? d.rejected_count / d.offers_count : 0;
  return etaSec - idleMin * 3 + rejectRate * 120;
}

export async function startSearch(bookingId: string) {
  if (await depositBlocks(bookingId)) return { offered: 0, status: 'AWAITING_DEPOSIT' };   // Abasare deposit required and not paid: never dispatch unpaid
  await tx(async (c) => {
    const cur = await q1<BookingRow>('select * from bookings where id=$1', [bookingId], c);
    if (!cur) throw notFound('booking');
    if (cur.status === 'SCHEDULED' || cur.status === 'NO_DRIVER_FOUND') {
      await transition(c, bookingId, cur.status === 'SCHEDULED' ? 'REQUESTED' : 'SEARCHING_DRIVER', { id: null, role: 'system' });
    }
    const b2 = await q1<BookingRow>('select status from bookings where id=$1', [bookingId], c);
    if (b2!.status === 'REQUESTED') await transition(c, bookingId, 'SEARCHING_DRIVER', { id: null, role: 'system' }, { patch: { search_started_at: new Date(), dispatch_round: 0 } });
    else if (b2!.status === 'SEARCHING_DRIVER') await q('update bookings set search_started_at=now(), dispatch_round=0 where id=$1', [bookingId], c);
  });
  return runRound(bookingId);
}

/** One dispatch round: pick eligible drivers, create time-limited offers. Idempotent per round via row lock. */
export async function runRound(bookingId: string): Promise<{ offered: number; status: string }> {
  const out = await tx(async (c) => {
    const b = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b) throw notFound('booking');
    if (b.status !== 'SEARCHING_DRIVER') return { offered: 0, status: b.status, notifyNoDriver: false };
    const pending = await q1("select 1 from dispatch_offers where booking_id=$1 and status='pending' and expires_at > now()", [bookingId], c);
    if (pending) return { offered: 0, status: b.status, notifyNoDriver: false };
    const [maxRounds, group, strategy, timeout, hb, baseKm, stepKm, maxKm] = await Promise.all([
      getSetting('dispatch.max_rounds'), getSetting('dispatch.group_size'), getSetting('dispatch.strategy'), getSetting('dispatch.offer_timeout_s'),
      getSetting('dispatch.heartbeat_max_age_s'), getSetting('dispatch.base_radius_km'), getSetting('dispatch.radius_step_km'), getSetting('dispatch.max_radius_km')]);
    const round = b.dispatch_round + 1;
    if (round > maxRounds) {
      await transition(c, bookingId, 'NO_DRIVER_FOUND', { id: null, role: 'system' }, { reason: 'no_driver_accepted' });
      return { offered: 0, status: 'NO_DRIVER_FOUND', notifyNoDriver: true };
    }
    const radiusM = Math.min(baseKm + stepKm * (round - 1), maxKm) * 1000;
    const svc = (await q1<any>('select * from service_categories where id=$1', [b.service_id], c))!;
    const pickup = { lat: b.pickup_lat, lng: b.pickup_lng };
    // favourite drivers of the passenger rank as if closer (setting-controlled, per-booking opt-out); blocked drivers were already excluded in findCandidates
    const favBoost = b.prefer_favourite === false ? 0 : await getSetting('dispatch.favourite_boost_s');
    const favs = new Set<string>(favBoost > 0 ? (await q<any>("select driver_id from passenger_driver_prefs where passenger_id=$1 and kind='favourite'", [b.passenger_id], c)).map((r) => r.driver_id) : []);
    const ranked = (await findCandidates(c, b, svc, hb))
      .map((d) => ({ d, dist: haversineM({ lat: d.last_lat, lng: d.last_lng }, pickup) }))
      .filter((x) => x.dist <= radiusM)
      .map((x) => { const eta = etaS({ lat: x.d.last_lat, lng: x.d.last_lng }, pickup, x.d.vehicle_type); return { ...x, eta, score: strategy === 'nearest' ? x.dist : rankScore(eta, x.d) }; })
      .map((x) => ({ ...x, score: x.score - (favs.has(x.d.user_id) ? favBoost * (strategy === 'nearest' ? 7 : 1) : 0) }))
      .sort((a, z) => a.score - z.score);
    const chosen: typeof ranked = [];
    for (const x of ranked) { if (chosen.length >= Math.max(1, group)) break; if (await claimDriver(c, x.d.user_id, bookingId)) chosen.push(x); }
    await q('update bookings set dispatch_round=$2, last_round_at=now() where id=$1', [bookingId, round], c);
    const quote = (await q1<any>('select breakdown from fare_quotes where id=$1', [b.quote_id], c))!;
    for (const x of chosen) {
      const comm = calcCommission(await resolveCommission(b.service_id, x.d.user_id, x.d.fleet_id, new Date(), c), quote.breakdown.commissionable);
      const net = quote.breakdown.subtotal - comm;
      await q(`insert into dispatch_offers(booking_id, driver_id, round, eta_s, distance_m, driver_net, expires_at)
               values ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $7))`, [bookingId, x.d.user_id, round, x.eta, x.dist, net, timeout], c);
      await q('update driver_profiles set offers_count = offers_count + 1 where user_id=$1', [x.d.user_id], c);
      await logEvent(c, bookingId, 'offer_sent', { id: null, role: 'system' }, { driver_id: x.d.user_id, round, eta_s: x.eta });
      await notify(x.d.user_id, 'offer', { km: (x.dist / 1000).toFixed(1), net }, { db: c });
    }
    return { offered: chosen.length, status: b.status, notifyNoDriver: false, passenger: b.passenger_id, ref: b.ref };
  });
  if (out.notifyNoDriver) {
    const b = await q1<any>('select passenger_id, ref from bookings where id=$1', [bookingId]);
    await notify(b.passenger_id, 'no_driver', { ref: b.ref }, { critical: true });
  }
  return { offered: out.offered, status: out.status };
}

export async function acceptOffer(driverId: string, bookingId: string) {
  const res = await tx(async (c) => {
    const b = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b) throw notFound('booking');
    if (b.status !== 'SEARCHING_DRIVER') throw conflict('offer_no_longer_available', 'This trip is no longer available');
    const offer = await q1<any>("select * from dispatch_offers where booking_id=$1 and driver_id=$2 and status='pending' for update", [bookingId, driverId], c);
    if (!offer) throw conflict('offer_not_found', 'No pending offer for you');
    if (new Date(offer.expires_at) < new Date()) throw conflict('offer_expired', 'Offer expired');
    const dp = await q1<any>('select * from driver_profiles where user_id=$1 for update', [driverId], c);
    const kind = (await q1<any>('select kind from service_categories where id=$1', [b.service_id], c))!.kind as 'ride' | 'abasare';
    const perm = kind === 'abasare' ? await abasarePermission(driverId, c) : await driverPermission(driverId, c);
    if (!perm.can_work || !dp.is_online || !(dp.accepting as string[]).includes(kind)) throw new AppError(403, 'not_permitted_to_work', 'Not eligible for this trip', perm);
    const veh = kind === 'abasare' ? null : await q1<any>("select id from vehicles where driver_id=$1 and status='approved'", [driverId], c);
    try {
      await q("update dispatch_offers set status='accepted', responded_at=now() where id=$1", [offer.id], c);
      await q("update dispatch_offers set status='cancelled' where booking_id=$1 and status='pending' and id<>$2", [bookingId, offer.id], c);
      await q('update driver_profiles set accepted_count = accepted_count + 1 where user_id=$1', [driverId], c);
      const row = await transition(c, bookingId, 'DRIVER_ASSIGNED', { id: driverId, role: 'driver' }, {
        patch: { driver_id: driverId, vehicle_id: veh?.id ?? null, assigned_at: new Date() }, meta: { offer_id: offer.id },
      });
      return { row, dp, veh };
    } catch (e: any) {
      if (e.code === '23505') throw conflict('driver_busy', 'You already have an active trip');
      throw e;
    }
  });
  await notifyAssigned(res.row, driverId);
  return res.row;
}

async function notifyAssigned(row: BookingRow, driverId: string) {
  await guestNotify(row, 'assigned');   // ride for someone else: SMS to the guest (no-op for normal rides)
  if (row.customer_vehicle_id) {
    const d = await q1<any>('select u.display_name, cv.plate from users u, customer_vehicles cv where u.id=$1 and cv.id=$2', [driverId, row.customer_vehicle_id]);
    await notify(row.passenger_id, 'abasare_assigned', { driver: d.display_name ?? 'Driver', plate: d.plate }, { critical: true });
  } else {
    const d = await q1<any>('select u.display_name, v.plate from users u join vehicles v on v.id=$2 where u.id=$1', [driverId, row.vehicle_id]);
    await notify(row.passenger_id, 'driver_assigned', { driver: d.display_name ?? 'Driver', plate: d.plate, ref: row.ref }, { critical: true });
  }
}

export async function rejectOffer(driverId: string, bookingId: string, reason?: string) {
  const excused = !!reason && EXCUSED_REASONS.has(reason);
  const ok = await tx(async (c) => {
    const o = await q1<any>("update dispatch_offers set status='rejected', responded_at=now(), reject_reason=$3, excused=$4 where booking_id=$1 and driver_id=$2 and status='pending' returning id",
      [bookingId, driverId, reason ?? null, excused], c);
    if (!o) throw conflict('offer_not_found', 'No pending offer for you');
    // Rejections only count against the driver when no legitimate reason was given.
    if (!excused) await q('update driver_profiles set rejected_count = rejected_count + 1 where user_id=$1', [driverId], c);
    await logEvent(c, bookingId, 'offer_rejected', { id: driverId, role: 'driver' }, { excused }, reason);
    return true;
  });
  await runRound(bookingId);
  return ok;
}

/** Background sweep: expire offers, advance searches, release scheduled bookings. Safe to run concurrently. */
export async function dispatchSweep() {
  const expired = await q<{ booking_id: string }>("update dispatch_offers set status='expired', responded_at=now() where status='pending' and expires_at < now() returning booking_id");
  const ids = new Set(expired.map((e) => e.booking_id));
  const stalled = await q<{ id: string }>(
    `select b.id from bookings b where b.status='SEARCHING_DRIVER' and coalesce(b.last_round_at, b.updated_at) < now() - interval '3 seconds'
       and not exists (select 1 from dispatch_offers o where o.booking_id=b.id and o.status='pending')`);
  stalled.forEach((s) => ids.add(s.id));
  for (const id of ids) await runRound(id).catch((e) => console.error('round failed', id, e.message));
  const due = await q<{ id: string }>("select id from bookings where status='SCHEDULED' and scheduled_for <= now() + interval '15 minutes'");
  for (const d of due) await startSearch(d.id).catch((e) => console.error('release failed', d.id, e.message));
  return { advanced: ids.size, released: due.length };
}

/** Dispatcher assignment / reassignment. Re-checks driver permission, availability and conflicts; fully audited via booking events. */
export async function manualAssign(staffId: string, bookingId: string, driverId: string, reason: string) {
  if (!reason || reason.length < 5) throw new AppError(400, 'reason_required', 'A reason is required');
  const row = await tx(async (c) => {
    let b = await q1<BookingRow>('select * from bookings where id=$1 for update', [bookingId], c);
    if (!b) throw notFound('booking');
    if (await depositBlocks(bookingId, c)) throw new AppError(409, 'deposit_required', 'The Abasare deposit has not been paid');
    if (['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION'].includes(b.status)) {
      b = await transition(c, bookingId, 'SEARCHING_DRIVER', { id: staffId, role: 'dispatcher' }, { reason: `reassigned: ${reason}`, patch: { driver_id: null, vehicle_id: null, assigned_at: null, arrived_at: null } });
    } else if (b.status === 'NO_DRIVER_FOUND') {
      b = await transition(c, bookingId, 'SEARCHING_DRIVER', { id: staffId, role: 'dispatcher' }, { reason: 'manual restart' });
    }
    if (b.status !== 'SEARCHING_DRIVER') throw conflict('invalid_state', `Booking is ${b.status}`);
    const dp = await q1<any>('select * from driver_profiles where user_id=$1 for update', [driverId], c);
    if (!dp) throw notFound('driver');
    const kind = (await q1<any>('select kind from service_categories where id=$1', [b.service_id], c))!.kind as 'ride' | 'abasare';
    const perm = kind === 'abasare' ? await abasarePermission(driverId, c) : await driverPermission(driverId, c);
    if (!perm.can_work || !dp.is_online) throw new AppError(409, 'driver_not_dispatchable', 'Driver is not online or not permitted to work', perm);
    let veh: any = null;
    if (kind === 'abasare') {
      const cv = await q1<any>('select vehicle_class, transmission from customer_vehicles where id=$1', [b.customer_vehicle_id], c);
      const sk = dp.abasare_skills ?? {};
      if (!cv || !(sk.classes ?? []).includes(cv.vehicle_class) || !(sk.transmissions ?? []).includes(cv.transmission)) throw new AppError(409, 'driver_skills_mismatch', "Driver is not approved for this car's type or transmission");
    } else {
      veh = (await q1<any>("select v.*, sc.vehicle_types, sc.min_capacity, sc.requires_comfort from vehicles v, service_categories sc where v.driver_id=$1 and v.status='approved' and sc.id=$2", [driverId, b.service_id], c));
      if (!veh || !veh.vehicle_types.includes(veh.vehicle_type) || veh.capacity < veh.min_capacity || (veh.requires_comfort && !veh.comfort))
        throw new AppError(409, 'vehicle_not_suitable', 'Driver vehicle does not fit this service');
    }
    await q("update dispatch_offers set status='cancelled' where booking_id=$1 and status='pending'", [bookingId], c);
    await q(`insert into dispatch_offers(booking_id, driver_id, round, status, expires_at, responded_at) values ($1,$2,$3,'accepted', now(), now())
             on conflict (booking_id, driver_id) do update set status='accepted', responded_at=now()`, [bookingId, driverId, b.dispatch_round + 1], c);
    try {
      return await transition(c, bookingId, 'DRIVER_ASSIGNED', { id: staffId, role: 'dispatcher' }, { reason: `manual assignment: ${reason}`, patch: { driver_id: driverId, vehicle_id: veh?.id ?? null, assigned_at: new Date() } });
    } catch (e: any) { if (e.code === '23505') throw conflict('driver_busy', 'Driver already has an active trip'); throw e; }
  });
  await notifyAssigned(row, driverId);
  return row;
}
