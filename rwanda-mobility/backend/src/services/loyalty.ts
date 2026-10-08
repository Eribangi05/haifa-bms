import type { PoolClient } from 'pg';
import { q, q1, tx } from '../db.js';
import { getSetting } from './settings.js';
import { badRequest, conflict } from '../errors.js';
import { grantCredit, lockUser } from './credit.js';
import { notify } from './notify.js';

export type Tier = 'bronze' | 'silver' | 'gold';

/** Tier table from settings (the admin edits thresholds and perks on the Settings page). */
export async function tiersConfig() {
  const [s, g, sb, gb, sg, gg] = await Promise.all([getSetting('loyalty.silver_min_points'), getSetting('loyalty.gold_min_points'), getSetting('loyalty.silver_bonus_pct'),
    getSetting('loyalty.gold_bonus_pct'), getSetting('loyalty.silver_extra_grace_s'), getSetting('loyalty.gold_extra_grace_s')]);
  return [
    { tier: 'bronze' as Tier, min_points: 0, bonus_pct: 0, extra_free_cancel_s: 0 },
    { tier: 'silver' as Tier, min_points: s, bonus_pct: sb, extra_free_cancel_s: sg },
    { tier: 'gold' as Tier, min_points: Math.max(g, s + 1), bonus_pct: gb, extra_free_cancel_s: gg },
  ];
}
export const tierFor = (tiers: Awaited<ReturnType<typeof tiersConfig>>, lifetime: number): Tier => [...tiers].reverse().find((t) => lifetime >= t.min_points)!.tier;

export async function tierPerks(userId: string) {
  if (!(await getSetting('loyalty.enabled'))) return { tier: 'bronze' as Tier, bonus_pct: 0, extra_free_cancel_s: 0 };
  const a = await q1<any>('select tier from loyalty_accounts where user_id=$1', [userId]);
  const t = (await tiersConfig()).find((x) => x.tier === (a?.tier ?? 'bronze'))!;
  return { tier: t.tier, bonus_pct: t.bonus_pct, extra_free_cancel_s: t.extra_free_cancel_s };
}

/** Called inside the payment-settlement transaction. One award per booking (unique index), so a replay does nothing. */
export async function awardTripPoints(c: PoolClient, b: { id: string; passenger_id: string; final_fare: number; payer_type?: string }) {
  if (!(await getSetting('loyalty.enabled')) || !b.final_fare) return 0;
  const per = await getSetting('loyalty.earn_rwf_per_point');
  const tiers = await tiersConfig();
  await lockUser(c, b.passenger_id);
  const acc = await q1<any>('select * from loyalty_accounts where user_id=$1 for update', [b.passenger_id], c);
  const cur = tiers.find((t) => t.tier === (acc?.tier ?? 'bronze'))!;
  const points = Math.floor(Math.floor(b.final_fare / per) * (100 + cur.bonus_pct) / 100);
  if (points <= 0) return 0;
  const ev = await q("insert into loyalty_events(user_id, kind, points, booking_id, memo) values ($1,'earn',$2,$3,'Completed trip') on conflict do nothing returning id", [b.passenger_id, points, b.id], c);
  if (!ev.length) return 0;
  const lifetime = (acc?.lifetime_points ?? 0) + points;
  const tier = tierFor(tiers, lifetime);
  await q(`insert into loyalty_accounts(user_id, points, lifetime_points, tier) values ($1,$2,$2,$3)
           on conflict (user_id) do update set points = loyalty_accounts.points + $2, lifetime_points = loyalty_accounts.lifetime_points + $2, tier=$3, updated_at=now()`, [b.passenger_id, points, tier], c);
  if (tier !== (acc?.tier ?? 'bronze')) await notify(b.passenger_id, 'loyalty_tier_up', { tier }, { db: c });
  return points;
}

export async function loyaltyView(userId: string) {
  const [acc, tiers, per, rate, minRedeem, enabled] = await Promise.all([q1<any>('select * from loyalty_accounts where user_id=$1', [userId]), tiersConfig(),
    getSetting('loyalty.earn_rwf_per_point'), getSetting('loyalty.redeem_rwf_per_100_points'), getSetting('loyalty.min_redeem_points'), getSetting('loyalty.enabled')]);
  const points = acc?.points ?? 0, lifetime = acc?.lifetime_points ?? 0, tier = tierFor(tiers, lifetime);
  const next = tiers.find((t) => t.min_points > lifetime) ?? null;
  const events = await q('select kind, points, booking_id, memo, created_at from loyalty_events where user_id=$1 order by id desc limit 20', [userId]);
  return {
    enabled, points, lifetime_points: lifetime, tier, credit_value_rwf: Math.floor(points / 100) * rate,
    next_tier: next ? { tier: next.tier, points_needed: next.min_points - lifetime } : null,
    earn: { rwf_per_point: per, bonus_pct: tiers.find((t) => t.tier === tier)!.bonus_pct },
    redeem: { rwf_per_100_points: rate, min_points: minRedeem, step: 100 }, tiers, events,
  };
}

/** Turn points into credit. Idempotent with an Idempotency-Key. */
export async function redeemPoints(userId: string, points: number, idemKey?: string) {
  if (!(await getSetting('loyalty.enabled'))) throw badRequest('loyalty_disabled', 'Loyalty is not available');
  const [min, rate] = await Promise.all([getSetting('loyalty.min_redeem_points'), getSetting('loyalty.redeem_rwf_per_100_points')]);
  if (!Number.isInteger(points) || points <= 0 || points % 100 !== 0) throw badRequest('invalid_points', 'Points must be a multiple of 100');
  if (points < min) throw badRequest('below_min_redeem', `Redeem at least ${min} points`, { min });
  const value = (points / 100) * rate;
  const r = await tx(async (c) => {
    await lockUser(c, userId);
    if (idemKey && await q1("select 1 from loyalty_events where user_id=$1 and idem_key=$2", [userId, idemKey], c)) return { replay: true as const };
    const a = await q1<any>('select points from loyalty_accounts where user_id=$1 for update', [userId], c);
    if (!a || a.points < points) throw conflict('insufficient_points', 'Not enough points', { available: a?.points ?? 0 });
    await q('update loyalty_accounts set points = points - $2, updated_at=now() where user_id=$1', [userId, points], c);
    await q("insert into loyalty_events(user_id, kind, points, memo, idem_key) values ($1,'redeem',$2,'Redeemed for credit',$3)", [userId, -points, idemKey ?? null], c);
    await grantCredit(c, userId, value, 'loyalty', { memo: `${points} loyalty points`, refType: 'loyalty', idemKey: idemKey ? `loy:${idemKey}` : undefined, notifyUser: false });
    return { replay: false as const, redeemed_points: points, credit_added: value };
  });
  return { ...r, ...(await loyaltyView(userId)) };
}
