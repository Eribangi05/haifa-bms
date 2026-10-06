import type { PoolClient } from 'pg';
import { q, q1, tx, pool, type Db } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { notify } from './notify.js';
import { audit, type Actor } from './audit.js';
import { getSetting } from './settings.js';
import { haversineM } from '../util/geo.js';

/** SQL predicate: every mandatory document for the vehicle type is approved, current and not expired. */
export const DOCS_OK_SQL = (dp: string, vt: string) => `not exists (
  select 1 from document_requirements r where r.vehicle_type = ${vt} and r.mandatory and not exists (
    select 1 from driver_documents d where d.driver_id = ${dp}.user_id and d.doc_type = r.doc_type and not d.superseded
      and d.review_status = 'approved' and (d.expiry_date is null or d.expiry_date >= current_date)
      and (not r.requires_expiry or d.expiry_date is not null)))`;

export const DRIVER_TRANSITIONS: Record<string, string[]> = {
  APPLICATION_STARTED: ['DOCUMENTS_SUBMITTED', 'DEACTIVATED'],
  DOCUMENTS_SUBMITTED: ['UNDER_REVIEW', 'INFO_REQUIRED', 'REJECTED', 'APPROVED'],
  UNDER_REVIEW: ['INFO_REQUIRED', 'APPROVED', 'REJECTED'],
  INFO_REQUIRED: ['DOCUMENTS_SUBMITTED', 'REJECTED'],
  APPROVED: ['SUSPENDED', 'EXPIRED_INELIGIBLE', 'DEACTIVATED'],
  REJECTED: ['DOCUMENTS_SUBMITTED', 'DEACTIVATED'],
  SUSPENDED: ['APPROVED', 'DEACTIVATED'],
  EXPIRED_INELIGIBLE: ['APPROVED', 'SUSPENDED', 'DEACTIVATED'],
  DEACTIVATED: [],
};

export async function setDriverStatus(c: PoolClient, driverId: string, to: string, actor: Actor, reason?: string) {
  const d = await q1<any>('select status from driver_profiles where user_id=$1 for update', [driverId], c);
  if (!d) throw notFound('driver');
  if (!DRIVER_TRANSITIONS[d.status]?.includes(to)) throw conflict('invalid_driver_transition', `${d.status} -> ${to}`);
  const goesOffline = to !== 'APPROVED';
  await q(`update driver_profiles set status=$2, status_reason=$3, decided_at = case when $2 in ('APPROVED','REJECTED') then now() else decided_at end,
           is_online = case when $4 then false else is_online end where user_id=$1`, [driverId, to, reason ?? null, goesOffline], c);
  await q('insert into driver_status_history(driver_id, from_status, to_status, reason, actor_id) values ($1,$2,$3,$4,$5)', [driverId, d.status, to, reason ?? null, actor.id], c);
  await audit(actor, 'driver.status', 'driver', driverId, { status: d.status }, { status: to, reason }, c);
  return d.status as string;
}

export type Permission = { can_work: boolean; status: string; reasons: string[]; missing_documents: string[]; expired_documents: string[]; vehicle_ok: boolean };

/** "Permission to work" is evaluated independently from the online toggle. */
export async function driverPermission(driverId: string, db: Db = pool): Promise<Permission> {
  const dp = await q1<any>('select status from driver_profiles where user_id=$1', [driverId], db);
  if (!dp) throw notFound('driver');
  const reasons: string[] = [];
  if (dp.status !== 'APPROVED') reasons.push(`account_${dp.status.toLowerCase()}`);
  const v = await q1<any>("select * from vehicles where driver_id=$1 and status='approved'", [driverId], db);
  if (!v) reasons.push('no_approved_vehicle');
  const missing: string[] = [], expired: string[] = [];
  if (v) {
    const reqs = await q<any>('select doc_type, requires_expiry from document_requirements where vehicle_type=$1 and mandatory', [v.vehicle_type], db);
    for (const r of reqs) {
      const d = await q1<any>(`select expiry_date from driver_documents where driver_id=$1 and doc_type=$2 and not superseded and review_status='approved'
                               order by created_at desc limit 1`, [driverId, r.doc_type], db);
      if (!d) missing.push(r.doc_type);
      else if ((d.expiry_date && new Date(d.expiry_date) < startOfToday()) || (r.requires_expiry && !d.expiry_date)) expired.push(r.doc_type);
    }
    if (missing.length) reasons.push('documents_missing_or_unapproved');
    if (expired.length) reasons.push('documents_expired');
  }
  return { can_work: reasons.length === 0, status: dp.status, reasons, missing_documents: missing, expired_documents: expired, vehicle_ok: !!v };
}
const startOfToday = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

/** Auto-flip approved drivers to EXPIRED_INELIGIBLE when mandatory documents lapse; restore when fixed. */
export async function refreshEligibility(driverId?: string) {
  const ids = driverId ? [driverId] : (await q<{ user_id: string }>("select user_id from driver_profiles where status in ('APPROVED','EXPIRED_INELIGIBLE')")).map((r) => r.user_id);
  const sys: Actor = { id: null, role: 'system' };
  let changed = 0;
  for (const id of ids) {
    const p = await driverPermission(id);
    await tx(async (c) => {
      const cur = await q1<any>('select status, status_reason from driver_profiles where user_id=$1', [id], c);
      if (cur.status === 'APPROVED' && !p.can_work && (p.expired_documents.length || p.missing_documents.length || !p.vehicle_ok)) {
        await setDriverStatus(c, id, 'EXPIRED_INELIGIBLE', sys, `documents: ${[...p.expired_documents, ...p.missing_documents].join(',') || 'vehicle'}`);
        changed++;
      } else if (cur.status === 'EXPIRED_INELIGIBLE' && p.vehicle_ok && !p.expired_documents.length && !p.missing_documents.length) {
        await setDriverStatus(c, id, 'APPROVED', sys, 'documents valid again');
        changed++;
      }
    });
  }
  return changed;
}

export async function expiryReminders() {
  const thresholds = [...(await getSetting('driver.expiry_reminder_days'))].sort((a, b) => a - b);
  const docs = await q<any>(`select id, driver_id, doc_type, reminder_sent_days, (expiry_date - current_date) as days_left
                              from driver_documents where not superseded and review_status='approved' and expiry_date is not null
                              and expiry_date - current_date <= $1 and expiry_date >= current_date`, [thresholds[thresholds.length - 1]]);
  let sent = 0;
  for (const d of docs) {
    const t = thresholds.find((x) => d.days_left <= x)!;
    if (d.reminder_sent_days != null && d.reminder_sent_days <= t) continue;
    await notify(d.driver_id, 'doc_expiry', { doc: d.doc_type, days: d.days_left });
    await q('update driver_documents set reminder_sent_days=$2 where id=$1', [d.id, t]);
    sent++;
  }
  return sent;
}

export async function setOnline(driverId: string, online: boolean) {
  if (!online) {
    const busy = await q1("select 1 from bookings where driver_id=$1 and status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS')", [driverId]);
    if (busy) throw conflict('active_trip', 'Finish your current trip before going offline');
    await q('update driver_profiles set is_online=false where user_id=$1', [driverId]);
    await q("update dispatch_offers set status='cancelled' where driver_id=$1 and status='pending'", [driverId]);
    return;
  }
  const p = await driverPermission(driverId);
  if (!p.can_work) throw new AppError(403, 'not_permitted_to_work', 'You cannot go online yet', p);
  await q('update driver_profiles set is_online=true, last_seen_at=now() where user_id=$1', [driverId]);
}

export type LocationIn = { lat: number; lng: number; accuracy?: number; speed?: number; recorded_at?: string; booking_id?: string };
/** Heartbeat + location. Rejects stale/out-of-order/implausible points; stores trail only during an active trip. */
export async function updateLocation(driverId: string, p: LocationIn) {
  const maxKmh = await getSetting('tracking.max_speed_kmh');
  const now = Date.now();
  const rec = p.recorded_at ? new Date(p.recorded_at).getTime() : now;
  if (Number.isNaN(rec) || rec > now + 60_000) throw badRequest('bad_timestamp');
  const prev = await q1<any>('select last_lat, last_lng, last_location_at, is_online from driver_profiles where user_id=$1', [driverId]);
  if (!prev) throw notFound('driver');
  if (prev.last_location_at && rec < new Date(prev.last_location_at).getTime()) return { accepted: false, reason: 'out_of_order' };
  if (prev.last_lat != null && prev.last_location_at) {
    const dt = (rec - new Date(prev.last_location_at).getTime()) / 1000;
    const dist = haversineM({ lat: prev.last_lat, lng: prev.last_lng }, p);
    if (dt > 0 && dist / dt > (maxKmh * 1000) / 3600 && dist > 200) return { accepted: false, reason: 'implausible_jump' };
  }
  await q('update driver_profiles set last_lat=$2, last_lng=$3, last_location_at=to_timestamp($4/1000.0), last_seen_at=now() where user_id=$1', [driverId, p.lat, p.lng, rec]);
  const trip = await q1<any>("select id from bookings where driver_id=$1 and status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS')", [driverId]);
  if (trip) await q('insert into driver_locations(driver_id,booking_id,lat,lng,accuracy,speed,recorded_at) values ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0))',
    [driverId, trip.id, p.lat, p.lng, p.accuracy ?? null, p.speed ?? null, rec]);
  return { accepted: true, online: prev.is_online, on_trip: !!trip };
}
