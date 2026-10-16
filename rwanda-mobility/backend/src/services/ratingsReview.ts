import { q } from '../db.js';
import { getSetting } from './settings.js';

/**
 * Staff view of ratings: score spread, the recent low ratings with their comments, and drivers flagged for a coaching call (average below the limit
 * over the window, after enough ratings). Thresholds are admin settings (ratings.*). Rider names are shown by first name only.
 */
export async function ratingsOverview() {
  const [low, flagAvg, minCount, days] = await Promise.all([getSetting('ratings.low_score'), getSetting('ratings.flag_avg_x10'), getSetting('ratings.flag_min_count'), getSetting('ratings.flag_window_days')]);
  const since = `now() - make_interval(days => ${Math.max(1, Number(days))})`;
  const dist = await q<any>(`select r.score, count(*)::int n from ratings r where r.created_at > ${since} and r.reviewee_id in (select user_id from driver_profiles) group by 1 order by 1`);
  const spread = [1, 2, 3, 4, 5].map((s) => ({ score: s, count: dist.find((d: any) => d.score === s)?.n ?? 0 }));
  const total = spread.reduce((a, b) => a + b.count, 0);
  const avg = total ? Math.round((spread.reduce((a, b) => a + b.score * b.count, 0) / total) * 100) / 100 : 0;
  const flagged = await q<any>(`select d.user_id driver_id, coalesce(u.display_name,'Driver') name, count(*)::int n, round(avg(r.score)::numeric, 2)::float avg,
      count(*) filter (where r.score <= $1)::int low_count, max(r.created_at) filter (where r.score <= $1) last_low_at
    from ratings r join driver_profiles d on d.user_id=r.reviewee_id join users u on u.id=d.user_id
    where r.created_at > ${since} group by d.user_id, u.display_name
    having count(*) >= $2 and avg(r.score) < $3::numeric / 10 order by avg(r.score), count(*) desc limit 50`, [low, minCount, flagAvg]);
  const recent = await q<any>(`select r.id, r.created_at, r.score, r.comment, r.tags, b.ref booking_ref, b.id booking_id,
      case when exists (select 1 from driver_profiles p where p.user_id=r.reviewee_id) then 'rider_to_driver' else 'driver_to_rider' end as direction,
      coalesce(split_part(ru.display_name,' ',1),'') reviewer, coalesce(eu.display_name,'') reviewee, r.reviewee_id
    from ratings r join bookings b on b.id=r.booking_id join users ru on ru.id=r.reviewer_id join users eu on eu.id=r.reviewee_id
    where r.score <= $1 and r.created_at > ${since} order by r.created_at desc limit 60`, [low]);
  return { window_days: Number(days), low_score: Number(low), flag_avg: Number(flagAvg) / 10, flag_min_count: Number(minCount), summary: { avg, count: total, spread, low_count: spread.filter((s) => s.score <= Number(low)).reduce((a, b) => a + b.count, 0) }, flagged, recent };
}
