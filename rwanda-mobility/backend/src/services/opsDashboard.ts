import { q, q1 } from '../db.js';

/** Operations dashboard numbers for the console: busy hours, cancellation rate, time to first driver, failed payments. All times are Kigali local. */
export async function opsDashboard(hours: number) {
  const since = `now() - make_interval(hours => ${Math.max(1, Math.min(24 * 31, Math.floor(hours)))})`;
  const [perHour, totals, ttd, payFail, payTotals, live, topReasons] = await Promise.all([
    q<any>(`select to_char(date_trunc('hour', requested_at at time zone 'Africa/Kigali'), 'YYYY-MM-DD"T"HH24:00') as "hour",
              count(*)::int requested,
              count(*) filter (where completed_at is not null)::int completed,
              count(*) filter (where status in ('CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER','CANCELLED_BY_SYSTEM','NO_DRIVER_FOUND'))::int cancelled
            from bookings where requested_at > ${since} group by 1 order by 1`),
    q1<any>(`select count(*)::int requested,
              count(*) filter (where completed_at is not null)::int completed,
              count(*) filter (where status='CANCELLED_BY_PASSENGER')::int cancelled_by_passenger,
              count(*) filter (where status='CANCELLED_BY_DRIVER')::int cancelled_by_driver,
              count(*) filter (where status='CANCELLED_BY_SYSTEM')::int cancelled_by_system,
              count(*) filter (where status='NO_DRIVER_FOUND')::int no_driver
            from bookings where requested_at > ${since}`),
    q1<any>(`select count(*)::int n,
              round(percentile_cont(0.5) within group (order by extract(epoch from assigned_at - requested_at)))::int p50_s,
              round(percentile_cont(0.9) within group (order by extract(epoch from assigned_at - requested_at)))::int p90_s,
              round(avg(extract(epoch from assigned_at - requested_at)))::int avg_s
            from bookings where requested_at > ${since} and assigned_at is not null and assigned_at >= requested_at`),
    q1<any>(`select count(*)::int n, coalesce(sum(amount),0)::int amount from payments where status='FAILED' and created_at > ${since}`),
    q1<any>(`select count(*)::int n from payments where created_at > ${since} and method in ('mtn_momo','airtel_money')`),
    q1<any>(`select (select count(*)::int from driver_profiles where is_online and last_seen_at > now() - interval '2 minutes') online_drivers,
                    (select count(*)::int from bookings where status in ('REQUESTED','SEARCHING_DRIVER')) searching,
                    (select count(*)::int from bookings where status in ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS')) active_trips`),
    q<any>(`select coalesce(failure_reason,'unknown') reason, count(*)::int n from payments where status='FAILED' and created_at > ${since} group by 1 order by 2 desc limit 5`),
  ]);
  const t = totals!;
  const cancelled = t.cancelled_by_passenger + t.cancelled_by_driver + t.cancelled_by_system + t.no_driver;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    hours, generated_at: new Date().toISOString(),
    live: live,
    trips: { requested: t.requested, completed: t.completed, cancelled, no_driver: t.no_driver, completion_rate_pct: pct(t.completed, t.requested), cancellation_rate_pct: pct(cancelled, t.requested),
      cancelled_by: { passenger: t.cancelled_by_passenger, driver: t.cancelled_by_driver, system: t.cancelled_by_system } },
    time_to_first_driver: { assigned_trips: ttd!.n, median_s: ttd!.p50_s, p90_s: ttd!.p90_s, average_s: ttd!.avg_s },
    payments: { failed: payFail!.n, failed_amount: payFail!.amount, mobile_money_total: payTotals!.n, failure_rate_pct: pct(payFail!.n, payTotals!.n), top_reasons: topReasons },
    per_hour: perHour,
  };
}
