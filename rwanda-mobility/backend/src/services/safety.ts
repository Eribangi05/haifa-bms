import { q, q1, tx } from '../db.js';
import { config } from '../config.js';
import { conflict, notFound } from '../errors.js';
import { haversineM, type LatLng } from '../util/geo.js';
import { etaS } from './maps.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';
import { DEFAULT_TEMPLATES, render, type Lang } from './i18n.js';
import { sha256, randomToken } from '../util/crypto.js';
import { refOf } from '../util/ids.js';
import { sms } from '../providers/sms.js';
import { audit, type Actor } from './audit.js';
import type { BookingRow } from './bookingMachine.js';

// ---------------------------------------------------------------- trusted contacts
const WHO_FALLBACK: Record<Lang, string> = { rw: 'Umuntu wawe', fr: 'Votre proche', en: 'Your contact' };

/** Queue an SMS to a trusted contact (not a user) in the contact's own language. The row sits in the passenger's outbox with the contact's number. */
async function queueContactSms(passengerId: string, contact: { phone: string; lang: Lang }, key: string, params: Record<string, unknown>) {
  const lang = (DEFAULT_TEMPLATES[key]?.[contact.lang] ? contact.lang : 'en') as Lang;
  const over = await q1<{ title: string; body: string }>('select title, body from notification_templates where key=$1 and lang=$2', [key, lang]);
  const tpl = over ?? DEFAULT_TEMPLATES[key][lang];
  const { link: _l, ...safe } = params;   // the capability link is in the message body only, not in the stored params
  await q(`insert into notifications(user_id, channel, template_key, params, title, body, lang, critical, status, to_phone) values ($1,'sms',$2,$3,$4,$5,$6,false,'queued',$7)`,
    [passengerId, key, JSON.stringify(safe), render(tpl.title, params), render(tpl.body, params), lang, contact.phone]);
}

async function whoOf(userId: string, lang: Lang) {
  const u = await q1<any>('select display_name from users where id=$1', [userId]);
  return String(u?.display_name ?? '').trim().split(/\s+/)[0] || WHO_FALLBACK[lang];
}

/** Trip became IN_PROGRESS: message every opted-in contact (once) with driver first name, plate and a personal live-share link. Never throws. */
export async function onTripStarted(b: BookingRow) {
  try {
    if (!b.auto_share || !b.driver_id) return;
    const u = await q1<any>('select auto_share from users where id=$1', [b.passenger_id]);
    if (!u?.auto_share) return;
    const contacts = await q<any>('select id, phone, lang from emergency_contacts where user_id=$1 and notify_on_trip', [b.passenger_id]);
    if (!contacts.length) return;
    const d = await q1<any>('select u.display_name, v.plate from users u left join vehicles v on v.id=$2 where u.id=$1', [b.driver_id, b.vehicle_id]);
    const plate = d?.plate ?? (b.customer_vehicle_id ? (await q1<any>('select plate from customer_vehicles where id=$1', [b.customer_vehicle_id]))?.plate : '') ?? '';
    for (const c of contacts) {
      if (await q1('select 1 from sms_opt_outs where phone=$1', [c.phone])) continue;
      const first = await q('insert into trip_contact_notices(booking_id,contact_id,kind) values ($1,$2,\'started\') on conflict do nothing returning contact_id', [b.id, c.id]);
      if (!first.length) continue;
      const token = randomToken(24);
      await q('insert into trip_shares(booking_id, token_hash, expires_at, created_by, contact_id, auto) values ($1,$2, now() + interval \'12 hours\', $3, $4, true)', [b.id, sha256(token), b.passenger_id, c.id]);
      await queueContactSms(b.passenger_id, c, 'trusted_trip_started', {
        who: await whoOf(b.passenger_id, c.lang), driver: String(d?.display_name ?? '').trim().split(/\s+/)[0] || '-', plate, link: `${config.publicBaseUrl}/share/${token}?lang=${c.lang}`,
      });
    }
  } catch (e) { console.error('[safety] trusted contact notice failed', (e as Error).message); }
}

/** Trip completed: "arrived safely" to the contacts who were told it started (and have not opted out since). */
export async function onTripCompleted(b: BookingRow) {
  try {
    const rows = await q<any>(`select c.id, c.phone, c.lang from trip_contact_notices n join emergency_contacts c on c.id=n.contact_id
      where n.booking_id=$1 and n.kind='started' and c.notify_on_trip and not exists (select 1 from trip_contact_notices a where a.booking_id=n.booking_id and a.contact_id=n.contact_id and a.kind='arrived')`, [b.id]);
    for (const c of rows) {
      if (await q1('select 1 from sms_opt_outs where phone=$1', [c.phone])) continue;
      const ins = await q("insert into trip_contact_notices(booking_id,contact_id,kind) values ($1,$2,'arrived') on conflict do nothing returning contact_id", [b.id, c.id]);
      if (ins.length) await queueContactSms(b.passenger_id, c, 'trusted_trip_arrived', { who: await whoOf(b.passenger_id, c.lang) });
    }
  } catch (e) { console.error('[safety] arrived notice failed', (e as Error).message); }
}

// ---------------------------------------------------------------- geometry
/** Extra distance (m) of reaching the destination via P compared with going straight: 0 on the line, grows with the detour. */
export const routeExcessM = (p: LatLng, a: LatLng, b: LatLng) => Math.max(0, haversineM(a, p) + haversineM(p, b) - haversineM(a, b));
/** Allowed excess: two corridor widths (out and back) plus half of the road-factor allowance on the straight distance. */
export const deviationLimitM = (straightM: number, corridorM: number, roadPct: number) => 2 * corridorM + (straightM * Math.max(0, roadPct - 100)) / 200;

// ---------------------------------------------------------------- checks
const TERMINAL_OPEN = ['asked'];

async function raise(b: any, kind: 'route_deviation' | 'long_stop', pos: LatLng, detail: Record<string, unknown>) {
  const wait = await getSetting('safety.response_wait_min');
  const a = await q1<any>(`insert into safety_alerts(ref,booking_id,passenger_id,driver_id,kind,detail,lat,lng,respond_by) values ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9)) returning *`,
    [refOf('SA'), b.id, b.passenger_id, b.driver_id, kind, JSON.stringify(detail), pos.lat, pos.lng, wait]);
  await notify(b.passenger_id, kind === 'route_deviation' ? 'safety_check_deviation' : 'safety_check_stop', { minutes: wait, stop: detail.stopped_min ?? '' }, { critical: true });
  return a;
}

export async function evaluateTrip(b: any) {
  const [corridor, roadPct, stopMin, stopR, maxAlerts, cooldown] = await Promise.all([
    getSetting('safety.deviation_corridor_m'), getSetting('safety.road_factor_pct'), getSetting('safety.stop_minutes'), getSetting('safety.stop_radius_m'),
    getSetting('safety.max_alerts_per_trip'), getSetting('safety.recheck_cooldown_min')]);
  const hist = await q<any>('select kind, status, responded_at from safety_alerts where booking_id=$1', [b.id]);
  if (hist.length >= maxAlerts || hist.some((h) => h.status === 'asked' || h.status === 'escalated')) return null;
  const cooling = (k: string) => hist.some((h) => h.kind === k && h.responded_at && Date.now() - new Date(h.responded_at).getTime() < cooldown * 60e3);
  const d = await q1<any>('select last_lat, last_lng, last_location_at from driver_profiles where user_id=$1', [b.driver_id]);
  if (!d?.last_lat || !d.last_location_at || Date.now() - new Date(d.last_location_at).getTime() > 120e3) return null;   // no fresh location: nothing to judge
  const pos = { lat: d.last_lat, lng: d.last_lng }, pickup = { lat: b.pickup_lat, lng: b.pickup_lng }, dest = { lat: b.dest_lat, lng: b.dest_lng };
  const straight = haversineM(pickup, dest);
  if (haversineM(pos, dest) < 150) return null;   // at the destination: stopping is normal
  if (!cooling('route_deviation') && straight > 300) {
    const excess = routeExcessM(pos, pickup, dest), limit = deviationLimitM(straight, corridor, roadPct);
    if (excess > limit) return raise(b, 'route_deviation', pos, { excess_m: Math.round(excess), limit_m: Math.round(limit), corridor_m: corridor, straight_m: straight });
  }
  if (!cooling('long_stop') && b.started_at && Date.now() - new Date(b.started_at).getTime() >= stopMin * 60e3) {
    const since = new Date(Date.now() - stopMin * 60e3);
    const before = await q1<any>('select 1 from driver_locations where booking_id=$1 and recorded_at <= $2 limit 1', [b.id, since]);
    const win = await q<any>('select lat, lng from driver_locations where booking_id=$1 and recorded_at > $2', [b.id, since]);
    if (before && win.length && win.every((w) => haversineM(w, pos) <= stopR)) return raise(b, 'long_stop', pos, { stopped_min: stopMin, radius_m: stopR });
  }
  return null;
}

/** Job body: close stale alerts, escalate unanswered ones, look for new off-route / long-stop trips. Idempotent. */
export async function runSafetyChecks() {
  await q("update safety_alerts a set status='trip_ended' where a.status='asked' and not exists (select 1 from bookings b where b.id=a.booking_id and b.status='IN_PROGRESS')");
  const due = await q<any>("select id from safety_alerts where status='asked' and respond_by <= now()");
  for (const a of due) await escalateAlert(a.id, 'no_answer').catch((e) => console.error('[safety] escalate failed', e.message));
  if (!(await getSetting('safety.checks_enabled'))) return { raised: 0, escalated: due.length };
  const every = await getSetting('safety.check_interval_s');
  const trips = await q<any>(`select * from bookings where status='IN_PROGRESS' and safety_checks and driver_id is not null and hire_mode is distinct from 'hourly'
    and (safety_checked_at is null or safety_checked_at < now() - make_interval(secs => $1)) limit 200`, [every]);
  let raised = 0;
  for (const b of trips) {
    await q('update bookings set safety_checked_at=now() where id=$1', [b.id]);
    try { if (await evaluateTrip(b)) raised++; } catch (e) { console.error('[safety] check failed', (e as Error).message); }
  }
  return { raised, escalated: due.length };
}

/** Same human path as SOS: a safety incident plus an urgent, sensitive support case. Never claims an agency was contacted. */
export async function escalateAlert(alertId: string, reason: 'help' | 'no_answer') {
  const out = await tx(async (c) => {
    const a = await q1<any>('select * from safety_alerts where id=$1 for update', [alertId], c);
    if (!a || a.status !== 'asked') return null;
    const desc = `Automatic safety check (${a.kind}) ${reason === 'help' ? 'answered HELP by the passenger' : 'not answered in time'}.`;
    const inc = (await q<any>("insert into safety_incidents(ref,booking_id,reporter_id,kind,lat,lng,description) values ($1,$2,$3,'sos',$4,$5,$6) returning id, ref", [refOf('SOS'), a.booking_id, a.passenger_id, a.lat, a.lng, desc], c))[0];
    const cs = (await q<any>(`insert into support_cases(ref,booking_id,reporter_id,category,priority,subject,sensitive,sla_due_at) values ($1,$2,$3,'safety','urgent',$4,true, now() + interval '15 minutes') returning id`,
      [refOf('CS'), a.booking_id, a.passenger_id, `Safety check ${a.ref} (${inc.ref})`], c))[0];
    await q("insert into case_events(case_id, author_id, kind, body, visibility) values ($1,null,'internal_note',$2,'internal')", [cs.id, desc], c);
    await q("update safety_alerts set status='escalated', escalated_at=now(), escalation_reason=$2, answer=coalesce(answer, case when $2='help' then 'help' end), responded_at=coalesce(responded_at, case when $2='help' then now() end), incident_id=$3, case_id=$4 where id=$1", [alertId, reason, inc.id, cs.id], c);
    return { a, inc };
  });
  if (!out) return false;
  let alerted = 0;
  for (const phone of (await getSetting('safety.escalation_contacts')) as string[]) {
    try { await sms.send(phone, `SOS ${out.inc.ref}: safety check on a trip needs attention${out.a.lat != null ? ` near ${Number(out.a.lat).toFixed(5)},${Number(out.a.lng).toFixed(5)}` : ''}. Open the safety console.`); alerted++; } catch { /* reported nowhere else: best effort */ }
  }
  await notify(out.a.passenger_id, 'safety_escalated', { ref: out.inc.ref }, { critical: true });
  return true;
}

export async function respondToCheck(passengerId: string, bookingId: string, answer: 'ok' | 'help') {
  const b = await q1<any>('select passenger_id from bookings where id=$1', [bookingId]);
  if (!b || b.passenger_id !== passengerId) throw notFound('booking');
  const a = await q1<any>("select * from safety_alerts where booking_id=$1 and status in ('asked','escalated') order by asked_at desc limit 1", [bookingId]);
  if (!a) throw conflict('no_open_safety_check', 'There is no safety check waiting for your answer');
  if (a.status === 'escalated') {
    // already with support: a late OK is recorded for the agent, it does not close the case
    if (answer === 'ok' && a.case_id) {
      await q('update safety_alerts set answer=$2, responded_at=coalesce(responded_at, now()) where id=$1', [a.id, answer]);
      await q("insert into case_events(case_id, author_id, kind, body, visibility) values ($1,null,'internal_note','Passenger later answered OK in the app.','internal')", [a.case_id]);
    }
    return { status: 'escalated', case_open: true };
  }
  if (answer === 'ok') {
    await q("update safety_alerts set status='ok', answer='ok', responded_at=now() where id=$1", [a.id]);
    return { status: 'ok', case_open: false };
  }
  await escalateAlert(a.id, 'help');
  return { status: 'escalated', case_open: true };
}

export async function resolveAlert(actor: Actor, id: string, note: string) {
  const r = await q1<any>("update safety_alerts set status='resolved', resolved_by=$2, resolved_at=now(), resolution=$3 where id=$1 and status in ('escalated','asked','ok') returning id", [id, actor.id, note]);
  if (!r) throw notFound('alert');
  await audit(actor, 'safety.alert_resolved', 'safety_alert', id, undefined, { note });
  return { ok: true };
}

// ---------------------------------------------------------------- live share v2
const ONGOING = ['DRAFT', 'FARE_ESTIMATED', 'SCHEDULED', 'REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS', 'CANCELLATION_REQUESTED'];
const LIVE = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS'];

/** Limited, unauthenticated view: driver first name, plate, vehicle, status, live position and ETA. No phone numbers, no passenger identity, no fare. */
export async function sharedView(token: string) {
  const s = await q1<any>('select * from trip_shares where token_hash=$1', [sha256(token)]);
  if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) throw notFound('share link');
  const b = (await q1<any>('select * from bookings where id=$1', [s.booking_id]))!;
  const ended = !ONGOING.includes(b.status);
  let expires = new Date(s.expires_at);
  if (ended) {
    const end = new Date(b.completed_at ?? b.cancelled_at ?? b.updated_at);
    const after = await getSetting('share.expiry_after_trip_min');
    expires = new Date(Math.min(expires.getTime(), end.getTime() + after * 60e3));
    if (expires < new Date()) throw notFound('share link');
  }
  const live = LIVE.includes(b.status);
  const d = b.driver_id ? await q1<any>(`select u.display_name, dp.last_lat, dp.last_lng, dp.last_location_at, v.plate, v.make, v.model, v.color, v.vehicle_type from driver_profiles dp join users u on u.id=dp.user_id left join vehicles v on v.id=$2 where dp.user_id=$1`, [b.driver_id, b.vehicle_id]) : null;
  let plate = d?.plate ?? null, vehicle = `${d?.color ?? ''} ${d?.make ?? ''} ${d?.model ?? ''}`.trim();
  if (d && b.customer_vehicle_id) {   // Abasare: the car is the owner's
    const cv = await q1<any>('select plate, make, model, color from customer_vehicles where id=$1', [b.customer_vehicle_id]);
    if (cv) { plate = cv.plate; vehicle = `${cv.color ?? ''} ${cv.make ?? ''} ${cv.model ?? ''}`.trim(); }
  }
  const at = d?.last_location_at ? new Date(d.last_location_at) : null;
  const fresh = !!at && Date.now() - at.getTime() < 5 * 60e3;
  let eta_s: number | null = null, eta_target: string | null = null;
  if (live && d?.last_lat != null && fresh) {
    const toPickup = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(b.status);
    eta_target = toPickup ? 'pickup' : 'destination';
    eta_s = toPickup ? etaS({ lat: d.last_lat, lng: d.last_lng }, { lat: b.pickup_lat, lng: b.pickup_lng }, d.vehicle_type ?? 'car') : (b.hire_mode === 'hourly' ? null : etaS({ lat: d.last_lat, lng: d.last_lng }, { lat: b.dest_lat, lng: b.dest_lng }, d.vehicle_type ?? 'car'));
    if (eta_s == null) eta_target = null;
  }
  return {
    status: b.status, live, ended,
    destination: s.hide_destination ? null : b.dest_name ?? null,
    driver: d ? { first_name: (d.display_name ?? '').split(' ')[0], plate, vehicle } : null,
    location: live && d?.last_lat != null ? { lat: d.last_lat, lng: d.last_lng, at: d.last_location_at, stale: !at || Date.now() - at.getTime() > 90e3 } : null,
    eta_s, eta_target, updated_at: new Date(), expires_at: expires,
    poll_after_s: ended ? 0 : 10,
    can_stop: !!s.contact_id,
  };
}

/** The contact asked to stop: record the number as opted out, stop their personal link and the contact's notify flag. */
export async function contactOptOut(token: string) {
  const s = await q1<any>('select * from trip_shares where token_hash=$1', [sha256(token)]);
  if (!s || !s.contact_id) return { stopped: false };
  const c = await q1<any>('select phone from emergency_contacts where id=$1', [s.contact_id]);
  if (!c) return { stopped: false };
  await q("insert into sms_opt_outs(phone,source) values ($1,'contact') on conflict do nothing", [c.phone]);
  await q('update emergency_contacts set notify_on_trip=false where phone=$1', [c.phone]);
  await q('update trip_shares set revoked_at=coalesce(revoked_at, now()) where contact_id in (select id from emergency_contacts where phone=$1) and revoked_at is null', [c.phone]);
  return { stopped: true };
}
