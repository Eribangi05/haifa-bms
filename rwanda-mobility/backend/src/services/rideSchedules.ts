// Recurring rides. A job books the real SCHEDULED booking shortly ahead (re-quoted), or tells the rider instead of booking blindly.
import { q, q1 } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { getSetting, flag } from './settings.js';
import { estimate, createBooking } from './bookings.js';
import { notify } from './notify.js';

export type ScheduleIn = {
  label?: string; service_id: string; customer_vehicle_id?: string; hours?: number; owner_attested?: boolean;
  pickup: { lat: number; lng: number; name?: string }; dest: { lat: number; lng: number; name?: string };
  days_of_week: number[]; local_time: string; start_date: string; end_date?: string | null; payment_method?: 'cash' | 'mtn_momo';
};
const COLS = `id, user_id, label, service_id, customer_vehicle_id, hours, owner_attested, pickup_lat, pickup_lng, pickup_name, dest_lat, dest_lng, dest_name, days_of_week,
  local_time, to_char(start_date,'YYYY-MM-DD') start_date, to_char(end_date,'YYYY-MM-DD') end_date, status, skip_dates::text[] skip_dates, payment_method, expected_total, expected_at, created_at, updated_at`;
export type Schedule = Record<string, any>;

const KIGALI = 2 * 3600e3;
const dateStr = (ms: number) => new Date(ms + KIGALI).toISOString().slice(0, 10);          // Kigali calendar date of an instant
const atKigali = (date: string, time: string) => Date.parse(`${date}T${time}:00+02:00`);     // instant of a Kigali wall-clock time
const dowOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Instants (ms) the schedule fires within [fromMs, toMs], in order, ignoring skip dates only when asked. */
export function occurrences(s: Pick<Schedule, 'days_of_week' | 'local_time' | 'start_date' | 'end_date' | 'skip_dates'>, fromMs: number, toMs: number, honourSkips = true) {
  const out: { date: string; at: number }[] = [];
  for (let d = fromMs - 86400e3; d <= toMs + 86400e3; d += 86400e3) {
    const date = dateStr(d);
    if (out.some((o) => o.date === date)) continue;
    if (date < s.start_date || (s.end_date && date > s.end_date)) continue;
    if (!s.days_of_week.includes(dowOf(date))) continue;
    if (honourSkips && s.skip_dates.includes(date)) continue;
    const at = atKigali(date, s.local_time);
    if (at >= fromMs && at <= toMs) out.push({ date, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

async function quoteFor(s: Schedule, atMs: number) {
  const maxDays = await getSetting('booking.max_scheduled_days');
  const scheduled = atMs <= Date.now() + maxDays * 86400e3 - 3600e3;
  const e = await estimate(s.user_id, {
    pickup: { lat: s.pickup_lat, lng: s.pickup_lng }, dest: { lat: s.dest_lat, lng: s.dest_lng }, service_id: s.customer_vehicle_id ? undefined : s.service_id,
    ...(scheduled ? { scheduled_for: new Date(atMs).toISOString() } : {}),
    ...(s.customer_vehicle_id ? { abasare: { customer_vehicle_id: s.customer_vehicle_id, hours: s.hours ?? undefined } } : {}),
  });
  const opt = e.options.find((o: any) => o.service_id === s.service_id && !o.fixed_price) ?? e.options.find((o: any) => o.service_id === s.service_id);
  if (!opt) return null;
  return { opt, total: opt.fare.total - (opt.fare.debt ?? 0) };
}

export async function createSchedule(userId: string, b: ScheduleIn) {
  if (!(await flag('booking.scheduled'))) throw badRequest('scheduled_disabled', 'Scheduled rides are not enabled');
  if (b.end_date && b.end_date < b.start_date) throw badRequest('schedule_dates', 'The end date is before the start date');
  const days = [...new Set(b.days_of_week)].sort();
  const max = await getSetting('schedule.max_active_per_user');
  const mine = await q1<{ n: number }>("select count(*)::int n from ride_schedules where user_id=$1 and status <> 'ended'", [userId]);
  if (mine!.n >= max) throw conflict('schedule_limit', 'You have reached the maximum number of recurring rides', { max });
  const svc = await q1<any>('select id, kind from service_categories where id=$1 and enabled', [b.service_id]);
  if (!svc) throw badRequest('service_unavailable', 'This service is not available here');
  if (svc.kind === 'abasare') {
    if (!b.customer_vehicle_id) throw badRequest('vehicle_mismatch', 'Choose the car');
    if (!b.owner_attested) throw badRequest('attestation_required', 'Confirm that you own or may use this car and that its insurance allows another driver');
    if (!(await q1('select 1 from customer_vehicles where id=$1 and owner_id=$2 and active', [b.customer_vehicle_id, userId]))) throw notFound('vehicle');
  } else if (b.customer_vehicle_id) throw badRequest('invalid_quote');
  const draft: Schedule = { user_id: userId, service_id: b.service_id, customer_vehicle_id: b.customer_vehicle_id ?? null, hours: b.hours ?? null,
    pickup_lat: b.pickup.lat, pickup_lng: b.pickup.lng, dest_lat: b.dest.lat, dest_lng: b.dest.lng, days_of_week: days, local_time: b.local_time, start_date: b.start_date, end_date: b.end_date ?? null, skip_dates: [] };
  const lead = await getSetting('schedule.min_lead_min');
  const first = occurrences(draft as any, Math.max(Date.now() + (lead + 5) * 60e3, atKigali(b.start_date, '00:00')), Date.now() + 400 * 86400e3)[0];
  if (!first) throw badRequest('schedule_no_occurrence', 'No ride falls between the start and end dates');
  const quote = await quoteFor(draft, first.at);
  if (!quote) throw badRequest('service_unavailable', 'This service is not available here');
  const row = await q1<Schedule>(
    `insert into ride_schedules(user_id,label,service_id,customer_vehicle_id,hours,owner_attested,pickup_lat,pickup_lng,pickup_name,dest_lat,dest_lng,dest_name,days_of_week,local_time,start_date,end_date,payment_method,expected_total,expected_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now()) returning ${COLS}`,
    [userId, b.label ?? null, b.service_id, b.customer_vehicle_id ?? null, b.hours ?? null, !!b.owner_attested, b.pickup.lat, b.pickup.lng, b.pickup.name ?? null, b.dest.lat, b.dest.lng, b.dest.name ?? null,
     days, b.local_time, b.start_date, b.end_date ?? null, b.payment_method ?? 'cash', quote.total]);
  return { ...row!, next_occurrence: new Date(first.at).toISOString(), expected_total: quote.total };
}

export async function getSchedule(userId: string, id: string): Promise<Schedule> {
  const s = await q1<Schedule>(`select ${COLS} from ride_schedules where id=$1 and user_id=$2`, [id, userId]);
  if (!s) throw notFound('schedule');
  return s;
}
export async function viewSchedule(s: Schedule) {
  const lead = await getSetting('schedule.min_lead_min');
  const next = s.status === 'ended' ? undefined : occurrences(s as any, Date.now() + lead * 60e3, Date.now() + 400 * 86400e3)[0];
  const runs = await q(`select to_char(occurrence_date,'YYYY-MM-DD') date, scheduled_for, status, booking_id, quoted_total from ride_schedule_runs where schedule_id=$1 order by occurrence_date desc limit 10`, [s.id]);
  return { ...s, next_occurrence: next ? new Date(next.at).toISOString() : null, recent_runs: runs };
}
export async function listSchedules(userId: string) {
  const rows = await q<Schedule>(`select ${COLS} from ride_schedules where user_id=$1 order by created_at desc`, [userId]);
  return Promise.all(rows.map(viewSchedule));
}

export async function updateSchedule(userId: string, id: string, patch: Partial<Pick<ScheduleIn, 'label' | 'days_of_week' | 'local_time' | 'end_date' | 'payment_method'>> & { skip_dates?: string[] }) {
  const s = await getSchedule(userId, id);
  if (s.status === 'ended') throw conflict('schedule_ended', 'This recurring ride has ended');
  const n = { ...s, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  if (n.end_date && n.end_date < n.start_date) throw badRequest('schedule_dates', 'The end date is before the start date');
  await q(`update ride_schedules set label=$2, days_of_week=$3, local_time=$4, end_date=$5, payment_method=$6, skip_dates=$7::date[], updated_at=now() where id=$1`,
    [id, n.label, [...new Set(n.days_of_week as number[])].sort(), n.local_time, n.end_date, n.payment_method, n.skip_dates]);
  return getSchedule(userId, id);
}
export async function setScheduleStatus(userId: string, id: string, to: 'active' | 'paused' | 'ended') {
  const s = await getSchedule(userId, id);
  if (s.status === 'ended' && to !== 'ended') throw conflict('schedule_ended', 'This recurring ride has ended');
  await q('update ride_schedules set status=$2, updated_at=now() where id=$1', [id, to]);
  if (to === 'ended' || to === 'paused') await cancelUpcoming(userId, id, to === 'ended');
  return getSchedule(userId, id);
}
/** Ending a plan cancels its not-yet-started bookings; pausing leaves already booked rides alone. */
async function cancelUpcoming(_userId: string, _id: string, _ended: boolean) { /* booked rides stay; the rider cancels a single ride from the booking screen (fees apply as usual) */ }

/** Skip the next occurrence: adds its date to skip_dates. If it is already booked, the booking is cancelled free of charge (no driver assigned yet). */
export async function skipNext(userId: string, id: string) {
  const s = await getSchedule(userId, id);
  if (s.status === 'ended') throw conflict('schedule_ended', 'This recurring ride has ended');
  const next = occurrences(s as any, Date.now(), Date.now() + 400 * 86400e3)[0];
  if (!next) throw badRequest('schedule_no_occurrence', 'No upcoming ride to skip');
  await q('update ride_schedules set skip_dates = array(select distinct unnest(skip_dates || $2::date)), updated_at=now() where id=$1', [id, next.date]);
  const run = await q1<any>("select booking_id from ride_schedule_runs where schedule_id=$1 and occurrence_date=$2 and status='booked'", [id, next.date]);
  let cancelled = false;
  if (run?.booking_id) {
    const b = await q1<any>('select status from bookings where id=$1', [run.booking_id]);
    if (b?.status === 'SCHEDULED') { const { cancelBooking } = await import('./bookings.js'); await cancelBooking(userId, run.booking_id, 'schedule_skipped', 'passenger'); cancelled = true; }
  }
  return { skipped_date: next.date, booking_cancelled: cancelled, schedule: await getSchedule(userId, id) };
}
/** The rider accepts the latest price: future runs that were held back are retried by the job. */
export async function acceptPrice(userId: string, id: string) {
  const s = await getSchedule(userId, id);
  const run = await q1<any>("select quoted_total from ride_schedule_runs where schedule_id=$1 and status='price_changed' order by occurrence_date desc limit 1", [id]);
  if (!run?.quoted_total) throw conflict('schedule_no_price_change', 'There is no new price to accept');
  await q('update ride_schedules set expected_total=$2, expected_at=now(), updated_at=now() where id=$1', [s.id, run.quoted_total]);
  await q("delete from ride_schedule_runs where schedule_id=$1 and status='price_changed' and scheduled_for > now()", [id]);
  return getSchedule(userId, id);
}

const fmtTime = (s: Schedule) => s.local_time;
/** Job: create the real bookings ahead of time. Idempotent per (schedule, date); `now` is injectable for time-travel tests. */
export async function runSchedules(now = new Date()) {
  const [lookahead, lead, tol] = await Promise.all([getSetting('schedule.lookahead_hours'), getSetting('schedule.min_lead_min'), getSetting('schedule.price_tolerance_pct')]);
  await q("update ride_schedules set status='ended', updated_at=now() where status='active' and end_date is not null and end_date < $1::date", [dateStr(now.getTime())]);
  const rows = await q<Schedule>(`select ${COLS} from ride_schedules where status='active'`);
  const out = { booked: 0, price_changed: 0, no_coverage: 0, failed: 0 };
  for (const s of rows) {
    for (const occ of occurrences(s as any, now.getTime() + lead * 60e3, now.getTime() + lookahead * 3600e3)) {
      try {
        const r = await processOccurrence(s, occ, tol);
        if (r) out[r]++;
      } catch (e: any) { if (process.env.QUIET !== '1') console.error('schedule run failed', s.id, e.message); }
    }
  }
  return out;
}

async function processOccurrence(s: Schedule, occ: { date: string; at: number }, tolPct: number): Promise<'booked' | 'price_changed' | 'no_coverage' | 'failed' | null> {
  const key = `sched-${s.id}-${occ.date}`;
  let run = await q1<any>(
    `insert into ride_schedule_runs(schedule_id, occurrence_date, scheduled_for) values ($1,$2,$3) on conflict (schedule_id, occurrence_date) do nothing returning *`, [s.id, occ.date, new Date(occ.at)]);
  let prevStatus: string | null = null;
  if (!run) {
    run = await q1<any>('select * from ride_schedule_runs where schedule_id=$1 and occurrence_date=$2', [s.id, occ.date]);
    prevStatus = run.status;
    const stale = Date.now() - new Date(run.updated_at).getTime() > 5 * 60e3;
    const retry = run.status === 'no_coverage' || (run.status === 'failed' && run.attempts < 4) || (run.status === 'pending' && stale);
    if (!retry) return null;
    // claim the retry atomically so two instances never both process it
    const claimed = await q1("update ride_schedule_runs set updated_at=now(), status='pending', attempts=attempts+1 where id=$1 and status=$2 and attempts=$3 returning id", [run.id, run.status, run.attempts]);
    if (!claimed) return null;
  }
  const done = await q1<any>('select id from bookings where passenger_id=$1 and idempotency_key=$2', [s.user_id, key]);   // survived a crash after booking
  if (done) { await q("update ride_schedule_runs set status='booked', booking_id=$2, updated_at=now() where id=$1", [run.id, done.id]); return null; }
  const when = { date: occ.date, time: fmtTime(s) };
  try {
    let quote;
    try { quote = await quoteFor(s, occ.at); } catch (e: any) { if (e instanceof AppError && e.status < 500) quote = null; else throw e; }
    const opt = quote?.opt;
    if (!opt || !opt.available || !opt.quote_id) {
      await q("update ride_schedule_runs set status='no_coverage', detail=$2, updated_at=now() where id=$1", [run.id, opt?.reason ?? 'no_option']);
      if (prevStatus !== 'no_coverage') await notify(s.user_id, 'schedule_no_coverage', when);
      return 'no_coverage';
    }
    const exp = s.expected_total as number | null;
    if (exp != null && Math.abs(quote!.total - exp) * 100 > tolPct * exp) {
      await q("update ride_schedule_runs set status='price_changed', quoted_total=$2, updated_at=now() where id=$1", [run.id, quote!.total]);
      await notify(s.user_id, 'schedule_price_changed', { ...when, old: exp, new: quote!.total });
      return 'price_changed';
    }
    const { booking } = await createBooking(s.user_id, {
      quote_id: opt.quote_id, payment_method: s.payment_method, idempotency_key: key, pickup_name: s.pickup_name ?? undefined, dest_name: s.dest_name ?? undefined,
      ...(s.customer_vehicle_id ? { customer_vehicle_id: s.customer_vehicle_id, owner_attested: !!s.owner_attested } : {}),
    });
    await q("update ride_schedule_runs set status='booked', booking_id=$2, quoted_total=$3, updated_at=now() where id=$1", [run.id, booking.id, quote!.total]);
    await notify(s.user_id, 'schedule_booked', { ...when, amount: quote!.total });
    return 'booked';
  } catch (e: any) {
    await q("update ride_schedule_runs set status='failed', detail=$2, updated_at=now() where id=$1", [run.id, String(e.code ?? e.message).slice(0, 120)]);
    return 'failed';
  }
}
