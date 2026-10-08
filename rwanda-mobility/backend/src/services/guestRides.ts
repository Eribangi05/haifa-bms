// Ride for someone else: the booker stays passenger and payer; the guest gets SMS (booker-chosen language) and a live-share link.
import type { PoolClient } from 'pg';
import { q, q1 } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { normalizePhone } from '../util/phone.js';
import { getSetting } from './settings.js';
import { sms } from '../providers/sms.js';
import { DEFAULT_TEMPLATES, render, type Lang } from './i18n.js';
import { logEvent, ACTIVE_TRIP, type BookingRow } from './bookingMachine.js';
import { tripPin, createShare } from './bookings.js';
import { maskMsisdn } from '../util/money.js';

export type GuestIn = { name: string; phone: string; language?: Lang };
const OPEN = ['SCHEDULED', 'REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'AWAITING_PASSENGER_VERIFICATION', 'IN_PROGRESS'];
const langOf = (l: unknown): Lang => (l === 'fr' || l === 'en' || l === 'rw' ? l : 'rw');

/** Inside the booking transaction: validates the guest, enforces the abuse limits and stores the minimum (name, phone, language). */
export async function attachGuest(c: PoolClient, b: BookingRow, serviceKind: string, g: GuestIn) {
  if (serviceKind !== 'ride') throw badRequest('guest_not_allowed', 'A ride for someone else is only available for normal rides');
  const phone = normalizePhone(g.phone);
  if (!phone) throw badRequest('invalid_phone', 'Enter a valid Rwandan phone number for the guest');
  const booker = (await q1<any>('select phone, preferred_language from users where id=$1', [b.passenger_id], c))!;
  if (booker.phone === phone) throw badRequest('guest_same_as_booker', 'The guest number is your own number');
  await q('select pg_advisory_xact_lock(hashtext($1))', ['guest:' + phone], c);
  await q('select pg_advisory_xact_lock(hashtext($1))', ['guestuser:' + b.passenger_id], c);
  const [maxActive, maxDay, maxPhone] = await Promise.all([getSetting('guest.max_active_per_user'), getSetting('guest.max_per_user_per_day'), getSetting('guest.max_per_phone_per_day')]);
  const n = await q1<any>(
    `select count(*) filter (where passenger_id=$1 and status = any($3))::int active,
            count(*) filter (where passenger_id=$1 and created_at > now() - interval '1 day')::int day_user,
            count(*) filter (where guest_phone=$2 and created_at > now() - interval '1 day')::int day_phone
       from bookings where id <> $4 and guest_phone is not null and (passenger_id=$1 or guest_phone=$2)`, [b.passenger_id, phone, OPEN, b.id], c);
  if (n.active >= maxActive) throw conflict('guest_limit_active', 'Too many open trips booked for other people', { max: maxActive });
  if (n.day_user >= maxDay) throw conflict('guest_limit_daily', 'Daily limit of trips booked for other people reached', { max: maxDay });
  if (n.day_phone >= maxPhone) throw conflict('guest_limit_phone', 'This number has already received the maximum number of trips today', { max: maxPhone });
  const lang = g.language ?? langOf(booker.preferred_language);
  await q('update bookings set guest_name=$2, guest_phone=$3, guest_lang=$4 where id=$1', [b.id, g.name.trim().slice(0, 60), phone, lang], c);
  await logEvent(c, b.id, 'guest_attached', { id: b.passenger_id, role: 'passenger' }, { lang });   // never the phone number
}

/** Queue the guest SMS for an event. Never throws: a messaging problem must not break dispatch. */
export async function guestNotify(row: BookingRow, kind: 'assigned' | 'arrived' | 'cancelled') {
  try {
    if (!row.guest_phone) return;
    if (kind === 'cancelled' && !(await q1("select 1 from guest_messages where booking_id=$1 and kind='assigned'", [row.id]))) return;   // nothing to take back
    const lang = langOf(row.guest_lang);
    const booker = await q1<any>('select display_name from users where id=$1', [row.passenger_id]);
    const params: Record<string, unknown> = { booker: (booker?.display_name ?? '').split(' ')[0] || 'Abasare' };
    if (kind !== 'cancelled') {
      if (!row.driver_id) return;
      const d = row.vehicle_id
        ? await q1<any>('select u.display_name, v.plate from users u join vehicles v on v.id=$2 where u.id=$1', [row.driver_id, row.vehicle_id])
        : await q1<any>('select display_name, null plate from users where id=$1', [row.driver_id]);
      const share = await createShare(row.passenger_id, row.id, 240);
      Object.assign(params, { driver: (d?.display_name ?? '').split(' ')[0] || '-', plate: d?.plate ?? '-', pin: tripPin(row.id), link: share.url });
    }
    const tpl = DEFAULT_TEMPLATES[`guest_${kind}`][lang];
    await q(`insert into guest_messages(booking_id, kind, dedupe_key, lang, body) values ($1,$2,$3,$4,$5) on conflict (booking_id, dedupe_key) do nothing`,
      [row.id, kind, `${kind}:${row.driver_id ?? '-'}`, lang, render(tpl.body, params)]);
  } catch (e: any) { if (process.env.QUIET !== '1') console.error('guestNotify failed', e.message); }
}

/** Worker: send queued guest SMS (SIMULATED until an SMS provider is connected). The body is erased once sent. */
export async function flushGuestSms(limit = 50) {
  const rows = await q<any>(
    `select m.id, m.body, b.guest_phone from guest_messages m join bookings b on b.id=m.booking_id
      where m.status='queued' and (m.next_attempt_at is null or m.next_attempt_at <= now()) order by m.created_at limit $1`, [limit]);
  for (const r of rows) {
    if (!r.guest_phone || !r.body) { await q("update guest_messages set status='skipped', body=null where id=$1", [r.id]); continue; }
    try {
      await sms.send(r.guest_phone, r.body);
      await q("update guest_messages set status='sent', sent_at=now(), attempts=attempts+1, body=null where id=$1", [r.id]);
    } catch (e: any) {
      await q(`update guest_messages set attempts=attempts+1, error=$2, next_attempt_at = now() + make_interval(secs => (attempts+1)*(attempts+1)*15),
               status = case when attempts+1 >= 5 then 'failed' else 'queued' end where id=$1`, [r.id, String(e.message).slice(0, 200)]);
    }
  }
  return rows.length;
}

/** Retention: the guest's name and phone are erased N days after the trip ended (or was cancelled). */
export async function purgeGuestData(now = new Date()) {
  const days = await getSetting('retention.guest_days');
  const rows = await q<{ id: string }>(
    `update bookings set guest_name=null, guest_phone=null, guest_purged_at=$2
      where guest_phone is not null and status in ('PAYMENT_COMPLETED','CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER','CANCELLED_BY_SYSTEM','NO_DRIVER_FOUND','REFUNDED','PARTIALLY_REFUNDED')
        and coalesce(completed_at, cancelled_at, updated_at) < $2::timestamptz - make_interval(days => $1) returning id`, [days, now]);
  if (rows.length) await q("update guest_messages set body=null, status = case when status='queued' then 'skipped' else status end where booking_id = any($1)", [rows.map((r) => r.id)]);
  return rows.length;
}

/** What each side may see about the guest. The driver gets the first name; the phone only through guestContact() after assignment. */
export function guestViewPatch(b: BookingRow, as: string): Record<string, unknown> {
  if (!b.guest_name && !b.guest_purged_at) return {};
  if (as === 'driver') return { passenger: { first_name: String(b.guest_name ?? '').split(' ')[0] || null }, guest: { first_name: String(b.guest_name ?? '').split(' ')[0] || null, can_contact: !!b.guest_phone && ACTIVE_TRIP.includes(b.status) } };
  if (as === 'passenger' || as === 'staff') return { guest: { name: b.guest_name ?? null, phone_masked: b.guest_phone ? maskMsisdn(b.guest_phone) : null, language: b.guest_lang, purged: !!b.guest_purged_at } };
  return {};
}

/** The assigned driver asks for the guest's number during an active trip. Logged on the booking. */
export async function guestContact(driverId: string, bookingId: string) {
  const b = await q1<BookingRow>('select * from bookings where id=$1', [bookingId]);
  if (!b || b.driver_id !== driverId) throw notFound('booking');
  if (!b.guest_phone || !ACTIVE_TRIP.includes(b.status)) throw new AppError(409, 'guest_contact_unavailable', 'The guest cannot be contacted for this trip');
  await q("insert into booking_events(booking_id,type,actor_id,actor_role) values ($1,'guest_contact_viewed',$2,'driver')", [bookingId, driverId]);
  return { first_name: String(b.guest_name ?? '').split(' ')[0], phone: b.guest_phone };
}
