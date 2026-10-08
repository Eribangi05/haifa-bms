// Background jobs of the growth round, registered with the scheduler in jobs.ts (cluster lock + health tracking come from `every`).
import { q } from '../db.js';
import { getSetting } from './settings.js';
import { flushGuestSms, purgeGuestData } from './guestRides.js';
import { runSchedules } from './rideSchedules.js';
import { sweepQuests } from './quests.js';
import { runCampaigns } from './campaigns.js';

export function registerGrowthJobs(every: (name: string, ms: number, fn: () => Promise<unknown>) => unknown) {
  every('guest-sms', 5_000, () => flushGuestSms());
  every('ride-schedules', 60_000, () => runSchedules());
  every('quests', 5 * 60_000, () => sweepQuests());
  every('campaigns', 30_000, () => runCampaigns());
}
/** Called from the retention job. */
export async function growthRetention(now = new Date()) {
  await purgeGuestData(now);
  const days = await getSetting('retention.notification_days');
  await q("delete from campaign_recipients where campaign_id in (select id from campaigns where finished_at < $1::timestamptz - make_interval(days => $2))", [now, days]);
  await q("delete from ride_schedule_runs where scheduled_for < $1::timestamptz - interval '90 days'", [now]);
  await q("delete from guest_messages where created_at < $1::timestamptz - interval '30 days'", [now]);
}
