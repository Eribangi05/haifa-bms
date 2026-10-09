import type { PoolClient } from 'pg';
import { q, q1 } from '../db.js';
import { getSetting } from './settings.js';
import { grantCredit } from './credit.js';
import { recordRisk } from './fraud.js';
import { notify } from './notify.js';

export type Tier = 'bronze' | 'silver' | 'gold';
const BONUS: Record<Tier, number> = { bronze: 0, silver: 0.25, gold: 0.5 };

export async function tierFor(rewardedCount: number): Promise<Tier> {
  const [silver, gold] = await Promise.all([getSetting('referral.silver_after'), getSetting('referral.gold_after')]);
  return rewardedCount >= gold ? 'gold' : rewardedCount >= silver ? 'silver' : 'bronze';
}

async function devicesOf(c: PoolClient, userId: string): Promise<string[]> {
  return (await q<{ d: string }>(`select device_fingerprint d from users where id=$1 and device_fingerprint is not null union select device_id from sessions where user_id=$1 and device_id is not null`, [userId], c)).map((x) => x.d);
}

/**
 * Pays a referral after the invited rider's first completed and paid trip: both people get a reward (credit when credit is enabled, otherwise a promo voucher),
 * the inviter's reward grows with their ambassador tier. Rejected (with a reason, visible to staff) when it looks like one person using two accounts
 * or when the inviter already reached the monthly cap. Runs inside the payment transaction; idempotent per referral.
 */
export async function rewardReferral(c: PoolClient, booking: { id: string; passenger_id: string }): Promise<void> {
  const ref = await q1<any>("select * from referrals where referee_id=$1 and status='pending' for update", [booking.passenger_id], c);
  if (!ref) return;
  const reject = async (why: string) => { await q("update referrals set status='rejected', reject_reason=$2 where id=$1", [ref.id, why], c); await recordRisk(ref.referrer_id, 'referral_rejected', { referral: ref.id, why }, c); };
  if (!(await getSetting('referral.enabled'))) return;                       // keeps the referral pending until the programme is switched on
  const [a, b] = await Promise.all([devicesOf(c, ref.referrer_id), devicesOf(c, ref.referee_id)]);
  if (a.some((d) => b.includes(d))) return reject('same_device');
  const rewardedBefore = (await q1<{ n: number }>("select count(*)::int n from referrals where referrer_id=$1 and status='rewarded'", [ref.referrer_id], c))!.n;
  const monthly = (await q1<{ n: number }>("select count(*)::int n from referrals where referrer_id=$1 and status='rewarded' and rewarded_at > date_trunc('month', now())", [ref.referrer_id], c))!.n;
  if (monthly >= (await getSetting('referral.max_rewards_per_month'))) return reject('monthly_cap');

  const tier = await tierFor(rewardedBefore);
  const [baseA, baseB, legacyCredit] = await Promise.all([getSetting('referral.reward_referrer'), getSetting('referral.reward_referee'), getSetting('referral.reward_credit')]);
  const amountReferrer = Math.round((legacyCredit > 0 ? legacyCredit : baseA) * (1 + BONUS[tier]));
  const amountReferee = legacyCredit > 0 ? legacyCredit : baseB;
  if (amountReferrer > 0 || amountReferee > 0) {
    if (legacyCredit > 0) {
      for (const [uid, amt] of [[ref.referrer_id, amountReferrer], [ref.referee_id, amountReferee]] as const)
        if (amt > 0) await grantCredit(c, uid, amt, 'referral', { refType: 'referral', refId: ref.id, idemKey: `ref:${ref.id}:${uid}`, memo: 'Referral reward' });
    } else {
      for (const [uid, tag, amt] of [[ref.referrer_id, 'A', amountReferrer], [ref.referee_id, 'B', amountReferee]] as const) {
        if (amt <= 0) continue;
        await q(`insert into promotions(code, kind, value, min_fare, per_user_limit, usage_limit, user_id, valid_to, budget)
                 values ($1,'fixed',$3,1500,1,1,$2, now() + interval '60 days', $3) on conflict (code) do nothing`, [`REF-${ref.id.replace(/-/g, '').slice(0, 8).toUpperCase()}${tag}`, uid, amt], c);
      }
    }
  }
  await q("update referrals set status='rewarded', rewarded_at=now(), reward_referrer=$2, reward_referee=$3, trigger_booking_id=$4 where id=$1", [ref.id, amountReferrer, amountReferee, booking.id], c);
  // ambassador tier follows the number of rewarded invitations
  const newTier = await tierFor(rewardedBefore + 1);
  await q(`insert into ambassadors(user_id, tier) values ($1,$2) on conflict (user_id) do update set tier=excluded.tier where ambassadors.tier <> excluded.tier`, [ref.referrer_id, newTier], c);
  await notify(ref.referrer_id, 'referral_rewarded', { amount: amountReferrer, tier: newTier }, { db: c });
  await notify(ref.referee_id, 'referral_welcome', { amount: amountReferee }, { db: c });
}

/** Everything the rider/driver needs on the invite screen: code, counts, money earned, tier and the next goal. */
export async function referralSummary(userId: string) {
  const u = await q1<any>('select referral_code from users where id=$1', [userId]);
  const r = await q1<any>(`select count(*)::int total, count(*) filter (where status='rewarded')::int rewarded, count(*) filter (where status='pending')::int pending,
      count(*) filter (where status='rejected')::int rejected, coalesce(sum(reward_referrer) filter (where status='rewarded'),0)::int earned
      from referrals where referrer_id=$1`, [userId]);
  const [tier, silver, gold, enabled] = await Promise.all([tierFor(r.rewarded), getSetting('referral.silver_after'), getSetting('referral.gold_after'), getSetting('referral.enabled')]);
  const next = tier === 'gold' ? null : tier === 'silver' ? { tier: 'gold' as const, at: gold } : { tier: 'silver' as const, at: silver };
  const people = await q<any>(`select r.status, r.created_at, r.rewarded_at, r.reward_referrer, u.display_name from referrals r join users u on u.id=r.referee_id where r.referrer_id=$1 order by r.created_at desc limit 50`, [userId]);
  const vouchers = await q('select code, value, valid_to, (select count(*) from promotion_redemptions pr where pr.promotion_id=promotions.id)::int used from promotions where user_id=$1 and active', [userId]);
  return { code: u.referral_code, ...r, tier, bonus_pct: Math.round(BONUS[tier] * 100), next, enabled, reward_referrer: await getSetting('referral.reward_referrer'), reward_referee: await getSetting('referral.reward_referee'), people: people.map((p) => ({ ...p, display_name: p.display_name ? String(p.display_name).split(' ')[0] : null })), vouchers };
}
