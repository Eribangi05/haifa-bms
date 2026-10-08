// Driver quests and bonuses. Progress is computed from completed trips; reaching the target credits the bonus through the ledger
// (Dr INCENTIVE_EXPENSE / Cr DRIVER_PAYABLE) exactly once per quest, driver and period (unique award row), within the quest budget.
import { q, q1, tx } from '../db.js';
import { post } from './ledger.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';
import type { Lang } from './i18n.js';

export type Quest = Record<string, any>;
const KIGALI = 2 * 3600e3;
const DONE = "('COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED','PARTIALLY_REFUNDED')";
const dateStr = (ms: number) => new Date(ms + KIGALI).toISOString().slice(0, 10);
const QCOLS = `id, title_en, title_rw, title_fr, desc_en, desc_rw, desc_fr, kind, target, quest_window "window", reward, service_ids, to_char(starts_on,'YYYY-MM-DD') starts_on, to_char(ends_on,'YYYY-MM-DD') ends_on, budget_cap, spent, active, placeholder, created_at`;

/** The period containing `at`: daily = Kigali calendar day, weekly = Monday to Sunday. Key is stable and unique per period. */
export function periodFor(window: 'daily' | 'weekly', at: Date) {
  const day = dateStr(at.getTime());
  if (window === 'daily') {
    const start = Date.parse(`${day}T00:00:00+02:00`);
    return { key: `D:${day}`, start: new Date(start), end: new Date(start + 86400e3) };
  }
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();             // 0 = Sunday
  const monday = dateStr(Date.parse(`${day}T00:00:00+02:00`) - ((dow + 6) % 7) * 86400e3);
  const start = Date.parse(`${monday}T00:00:00+02:00`);
  return { key: `W:${monday}`, start: new Date(start), end: new Date(start + 7 * 86400e3) };
}

export async function progressOf(driverId: string, quest: Quest, period: { start: Date; end: Date }): Promise<number> {
  const base = `from bookings where driver_id=$1 and completed_at >= $2 and completed_at < $3 and status in ${DONE} and ($4::text[] is null or service_id = any($4))`;
  const args = [driverId, period.start, period.end, quest.service_ids ?? null];
  switch (quest.kind) {
    case 'trips': return (await q1<any>(`select count(*)::int n ${base}`, args))!.n;
    case 'earnings': return (await q1<any>(`select coalesce(sum(final_fare),0)::int n ${base}`, args))!.n;
    case 'peak_hours': {
      const hours = await getSetting('quests.peak_hours');
      return (await q1<any>(`select count(*)::int n ${base} and extract(hour from completed_at at time zone 'Africa/Kigali')::int = any($5)`, [...args, hours]))!.n;
    }
    case 'streak': {
      const days = (await q<any>(`select distinct to_char(completed_at at time zone 'Africa/Kigali','YYYY-MM-DD') d ${base} order by d`, args)).map((r) => r.d as string);
      let best = 0, run = 0, prev = 0;
      for (const d of days) { const t = Date.parse(d + 'T00:00:00Z'); run = prev && t - prev === 86400e3 ? run + 1 : 1; prev = t; best = Math.max(best, run); }
      return best;
    }
  }
  return 0;
}

class BudgetExhausted extends Error {}

/** Credit the bonus once. Safe under concurrency: the award row is unique, the budget is a guarded update, both roll back together. */
async function award(driverId: string, quest: Quest, periodKey: string, progress: number): Promise<'awarded' | 'exists' | 'budget'> {
  try {
    const got = await tx(async (c) => {
      const ins = await q1<{ id: string }>('insert into driver_quest_awards(quest_id, driver_id, period_key, amount, progress) values ($1,$2,$3,$4,$5) on conflict do nothing returning id',
        [quest.id, driverId, periodKey, quest.reward, progress], c);
      if (!ins) return false;
      const upd = await q1("update driver_quests set spent = spent + $2, updated_at=now() where id=$1 and active and (budget_cap is null or spent + $2 <= budget_cap) returning id", [quest.id, quest.reward], c);
      if (!upd) throw new BudgetExhausted();
      const txn = await post(c, [{ account: 'INCENTIVE_EXPENSE', debit: quest.reward }, { account: 'DRIVER_PAYABLE', credit: quest.reward, owner: driverId }],
        { memo: `quest bonus ${quest.id.slice(0, 8)} ${periodKey}` });
      await q('update driver_quest_awards set txn_id=$2 where id=$1', [ins.id, txn], c);
      return true;
    }, 0);
    if (!got) return 'exists';
  } catch (e) { if (e instanceof BudgetExhausted) return 'budget'; throw e; }
  const u = await q1<any>('select preferred_language from users where id=$1', [driverId]);
  const lang = (['rw', 'fr', 'en'].includes(u?.preferred_language) ? u.preferred_language : 'rw') as Lang;
  await notify(driverId, 'quest_bonus', { quest: quest[`title_${lang}`], amount: quest.reward });
  return 'awarded';
}

export async function activeQuests(at = new Date()): Promise<Quest[]> {
  const today = dateStr(at.getTime());
  return q<Quest>(`select ${QCOLS} from driver_quests where active and (starts_on is null or starts_on <= $1::date) and (ends_on is null or ends_on >= $1::date)`, [today]);
}

/** Evaluate every active quest for one driver (current period, plus the previous one so a trip finished just before midnight is not lost). */
export async function evaluateDriver(driverId: string, at = new Date()) {
  const dp = await q1<any>("select status from driver_profiles where user_id=$1", [driverId]);
  if (dp?.status !== 'APPROVED') return [];
  const results: { quest_id: string; period: string; result: string }[] = [];
  for (const quest of await activeQuests(at)) {
    const prev = new Date(at.getTime() - (quest.window === 'daily' ? 86400e3 : 7 * 86400e3));
    for (const when of [at, prev]) {
      const period = periodFor(quest.window, when);
      if (when === prev && await q1('select 1 from driver_quest_awards where quest_id=$1 and driver_id=$2 and period_key=$3', [quest.id, driverId, period.key])) continue;
      const progress = await progressOf(driverId, quest, period);
      if (progress >= quest.target) results.push({ quest_id: quest.id, period: period.key, result: await award(driverId, quest, period.key, progress) });
    }
  }
  return results;
}
export async function evaluateDriverSafe(driverId: string) {
  try { await evaluateDriver(driverId); } catch (e: any) { if (process.env.QUIET !== '1') console.error('quest evaluation failed', e.message); }
}
/** Job: re-evaluate drivers with a recent completed trip (catches anything the on-completion hook missed). */
export async function sweepQuests(at = new Date()) {
  const ds = await q<{ driver_id: string }>(`select distinct driver_id from bookings where driver_id is not null and completed_at > $1::timestamptz - interval '8 days' and status in ${DONE}`, [at]);
  for (const d of ds) await evaluateDriver(d.driver_id, at).catch(() => {});
  return ds.length;
}

/** Driver view: each live quest with the current period's progress. */
export async function driverQuests(driverId: string, at = new Date()) {
  const out = [];
  for (const quest of await activeQuests(at)) {
    const period = periodFor(quest.window, at);
    const progress = await progressOf(driverId, quest, period);
    const awarded = !!(await q1('select 1 from driver_quest_awards where quest_id=$1 and driver_id=$2 and period_key=$3', [quest.id, driverId, period.key]));
    const { budget_cap, spent, service_ids, ...pub } = quest;
    out.push({ ...pub, service_ids, period: { key: period.key, starts_at: period.start, ends_at: period.end }, progress: Math.min(progress, quest.target), target: quest.target,
      percent: Math.min(100, Math.floor((progress * 100) / quest.target)), completed: awarded, budget_exhausted: budget_cap != null && !awarded && spent + quest.reward > budget_cap });
  }
  return out;
}
export const questHistory = (driverId: string) => q(
  `select a.id, a.quest_id, a.period_key, a.amount, a.progress, a.created_at, d.title_en, d.title_rw, d.title_fr from driver_quest_awards a join driver_quests d on d.id=a.quest_id
    where a.driver_id=$1 order by a.created_at desc limit 100`, [driverId]);

// ---- admin ----
export const adminQuests = () => q(`select ${QCOLS}, (select count(*)::int from driver_quest_awards a where a.quest_id=driver_quests.id) awards,
  case when budget_cap is null then null else greatest(0, budget_cap - spent) end budget_remaining from driver_quests order by created_at desc`);
export { QCOLS };
