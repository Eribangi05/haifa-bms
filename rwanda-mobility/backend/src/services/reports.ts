import { getSetting } from './settings.js';
import { q, q1 } from '../db.js';

export async function dashboard(filter: { from?: string; to?: string; service_id?: string; zone_id?: string } = {}) {
  const from = filter.from ?? new Date(Date.now() - 30 * 86400e3).toISOString();
  const to = filter.to ?? new Date().toISOString();
  const f = [from, to, filter.service_id ?? null, filter.zone_id ?? null];
  const W = `b.created_at between $1 and $2 and ($3::text is null or b.service_id=$3) and ($4::text is null or b.zone_id=$4)`;
  const users = await q1<any>(`select count(*) filter (where exists (select 1 from user_roles r where r.user_id=u.id and r.role='passenger'))::int passengers from users u`);
  const drivers = await q1<any>(`select count(*)::int total, count(*) filter (where status='APPROVED')::int verified,
      count(*) filter (where status in ('DOCUMENTS_SUBMITTED','UNDER_REVIEW','INFO_REQUIRED'))::int pending,
      count(*) filter (where is_online and last_seen_at > now() - make_interval(secs => ${Number(await getSetting('dispatch.heartbeat_max_age_s'))}))::int online from driver_profiles`);
  const b = await q1<any>(`select
      count(*) filter (where status in ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS'))::int active,
      count(*) filter (where status in ('COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED','PARTIALLY_REFUNDED','REFUNDED'))::int completed,
      count(*) filter (where status like 'CANCELLED%')::int cancelled,
      count(*) filter (where status='NO_DRIVER_FOUND')::int no_driver,
      count(*) filter (where status in ('REQUESTED','SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','AWAITING_PASSENGER_VERIFICATION','IN_PROGRESS','COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED','PARTIALLY_REFUNDED','REFUNDED','NO_DRIVER_FOUND') or status like 'CANCELLED%')::int requested,
      coalesce(sum(final_fare) filter (where status in ('PAYMENT_COMPLETED','PARTIALLY_REFUNDED','REFUNDED')),0)::bigint gross_booking_value,
      coalesce(avg(extract(epoch from (assigned_at - requested_at))) filter (where assigned_at is not null),0)::int avg_assign_s,
      coalesce(avg(extract(epoch from (arrived_at - assigned_at))) filter (where arrived_at is not null),0)::int avg_arrival_s
    from bookings b where ${W}`, f);
  const pay = await q1<any>(`select count(*) filter (where p.status='SUCCESS')::int ok, count(*) filter (where p.status in ('SUCCESS','FAILED'))::int tried,
      coalesce(sum(p.amount) filter (where p.status='SUCCESS' and p.method='cash'),0)::bigint cash_collected,
      coalesce(sum(p.amount) filter (where p.status='SUCCESS' and p.method in ('mtn_momo','airtel_money')),0)::bigint electronic_collected
    from payments p join bookings b on b.id=p.booking_id where p.kind='fare' and ${W}`, f);
  const rev = await q1<any>(`select coalesce(sum(e.commission),0)::bigint commission_revenue, coalesce(sum(e.net),0)::bigint driver_earnings from driver_earnings e join bookings b on b.id=e.booking_id where ${W}`, f);
  const payable = await q1<any>(`select coalesce(sum(credit-debit),0)::bigint v from ledger_entries where account_code='DRIVER_PAYABLE'`);
  const support = await q1<any>(`select count(*) filter (where status in ('open','in_progress','awaiting_user'))::int backlog, count(*) filter (where status in ('open','in_progress','awaiting_user') and sla_due_at < now())::int overdue from support_cases`);
  const safety = await q1<any>(`select count(*) filter (where status<>'resolved')::int open, count(*)::int total from safety_incidents where created_at between $1 and $2`, [from, to]);
  const refunds = await q1<any>(`select count(*) filter (where status='REQUESTED')::int pending_refunds, coalesce(sum(amount) filter (where status='PROCESSED'),0)::bigint refunded from refunds`);
  const disputes = await q1<any>(`select count(*)::int n from bookings where status='DISPUTED'`);
  const zones = await q(`select b.zone_id, count(*)::int requests, count(*) filter (where status in ('COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED'))::int completed,
      coalesce(sum(final_fare) filter (where status='PAYMENT_COMPLETED'),0)::bigint gbv from bookings b where ${W} group by b.zone_id`, f);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    range: { from, to },
    passengers: users.passengers, drivers,
    bookings: { ...b, fulfilment_rate_pct: pct(b.completed, b.requested), cancellation_rate_pct: pct(b.cancelled, b.requested) },
    payments: { success_rate_pct: pct(pay.ok, pay.tried), ...pay },
    revenue: { gross_booking_value: b.gross_booking_value, platform_commission_revenue: rev.commission_revenue, driver_earnings: rev.driver_earnings, cash_collected: pay.cash_collected,
      note: 'Gross booking value is not platform revenue: revenue is the commission only.' },
    driver_earnings_payable: payable.v, support, safety_incidents: safety, refunds, disputes: disputes.n, zones,
  };
}

export async function analytics() {
  const funnel = await q1<any>(`select
    (select count(*) from users)::int registered,
    (select count(distinct passenger_id) from bookings)::int requested_a_ride,
    (select count(distinct passenger_id) from bookings where status in ('COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED'))::int completed_a_ride,
    (select count(*) from driver_profiles)::int driver_applications,
    (select count(*) from driver_profiles where status='APPROVED')::int drivers_approved,
    (select coalesce(avg(extract(epoch from (decided_at - submitted_at))/3600),0)::numeric(10,1) from driver_profiles where decided_at is not null and submitted_at is not null) driver_verification_hours`);
  const repeat = await q1<any>(`select count(*) filter (where n >= 2)::int repeaters, count(*)::int riders from (select passenger_id, count(*) n from bookings where status in ('PAYMENT_COMPLETED') group by 1) t`);
  const ratings = await q1<any>(`select coalesce(avg(score) filter (where reviewee_id in (select user_id from driver_profiles)),0)::numeric(3,2) driver_avg, coalesce(avg(score) filter (where reviewee_id not in (select user_id from driver_profiles)),0)::numeric(3,2) passenger_avg from ratings`);
  const support = await q1<any>(`select coalesce(avg(extract(epoch from (updated_at - created_at))/3600) filter (where status in ('resolved','closed')),0)::numeric(10,1) avg_resolution_hours, coalesce(avg(csat),0)::numeric(3,2) csat from support_cases`);
  return { funnel, repeat_booking_rate_pct: repeat.riders ? Math.round((repeat.repeaters / repeat.riders) * 1000) / 10 : null, ratings, support, privacy: 'Aggregates only; no personal data.' };
}
