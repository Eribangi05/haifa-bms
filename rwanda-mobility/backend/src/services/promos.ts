import { q1, type Db, pool } from '../db.js';

export type PromoCheck = { ok: true; id: string; code: string; discount: number } | { ok: false; reason: string };

/** Validate a promo for a user/service/zone/fare. Discount applies to the pre-extras fare. Single code per booking (no stacking). */
export async function checkPromo(code: string, userId: string, serviceId: string, zoneId: string, fare: number, db: Db = pool): Promise<PromoCheck> {
  const p = await q1<any>('select * from promotions where upper(code)=upper($1) and active', [code], db);
  if (!p) return { ok: false, reason: 'promo_not_found' };
  if (p.user_id && p.user_id !== userId) return { ok: false, reason: 'promo_not_eligible' };
  const now = Date.now();
  if (new Date(p.valid_from).getTime() > now || (p.valid_to && new Date(p.valid_to).getTime() < now)) return { ok: false, reason: 'promo_expired' };
  if (p.service_ids && !p.service_ids.includes(serviceId)) return { ok: false, reason: 'promo_not_for_service' };
  if (p.zone_ids && !p.zone_ids.includes(zoneId)) return { ok: false, reason: 'promo_not_for_zone' };
  if (fare < p.min_fare) return { ok: false, reason: 'promo_min_fare', };
  const used = await q1<{ n: number; mine: number }>(
    'select count(*)::int n, count(*) filter (where user_id=$2)::int mine from promotion_redemptions where promotion_id=$1', [p.id, userId], db);
  if (p.usage_limit != null && used!.n >= p.usage_limit) return { ok: false, reason: 'promo_exhausted' };
  if (used!.mine >= p.per_user_limit) return { ok: false, reason: 'promo_already_used' };
  if (p.first_ride_only) {
    const prior = await q1("select 1 from bookings where passenger_id=$1 and status in ('COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED')", [userId], db);
    if (prior) return { ok: false, reason: 'promo_first_ride_only' };
  }
  let d = p.kind === 'percent' ? Math.floor((fare * p.value) / 100) : p.value;
  if (p.max_discount != null) d = Math.min(d, p.max_discount);
  d = Math.min(d, fare);
  if (p.budget != null && p.spent + d > p.budget) return { ok: false, reason: 'promo_budget_exhausted' };
  return { ok: true, id: p.id, code: p.code, discount: d };
}
