// Settings added by the growth round (guest rides, schedules, quests, heat map, campaigns, partners).
// Spread into SETTING_DEFAULTS (config.ts) and SETTING_META (settingsMeta.ts). Values marked PLACEHOLDER are starting points to confirm with the client.
import type { SettingMeta } from './settingsMeta.js';

export const GROWTH_GROUP = 'Growth & partners';

export const GROWTH_DEFAULTS = {
  'guest.max_active_per_user': 3,          // open guest trips (including scheduled) one booker may have
  'guest.max_per_user_per_day': 5,         // guest trips one booker may create per day
  'guest.max_per_phone_per_day': 3,        // trips booked for the same guest number per day, from anyone (anti-harassment)
  'retention.guest_days': 7,               // guest name and phone are erased this long after the trip ended
  'schedule.max_active_per_user': 5,
  'schedule.lookahead_hours': 24,          // the job books the next ride this far ahead
  'schedule.price_tolerance_pct': 15,      // a re-quote dearer or cheaper than the agreed price by more than this is NOT booked blindly
  'schedule.min_lead_min': 30,             // never book a recurring ride closer than this to its start
  'quests.peak_hours': [7, 8, 17, 18],     // PLACEHOLDER: hours of day (Kigali) counted as rush hour (7 = 07:00-07:59)
  'heatmap.k_min': 3,                      // a cell with fewer distinct requesters than this is never shown
  'heatmap.cache_s': 60,
  'campaign.batch_size': 200,              // recipients handled per job run
  'campaign.max_recipients': 5000,         // larger audiences need a smaller segment (SMS cost guard)
  'campaign.max_per_user_per_day': 1,      // marketing messages one person may receive per rolling 24 h, across campaigns
  'campaign.quiet_start_hour': 21,         // no marketing from this hour (Kigali) ...
  'campaign.quiet_end_hour': 7,            // ... until this hour
  'partner.max_billed_per_user_per_day': 4, // rides one person may charge to venue partners per day
};

const G = GROWTH_GROUP;
export const GROWTH_META: Record<keyof typeof GROWTH_DEFAULTS, SettingMeta> = {
  'guest.max_active_per_user': { group: G, label: 'Open guest trips per booker', desc: 'How many trips booked for other people one account may have open at once.', unit: 'trips', min: 1, max: 10 },
  'guest.max_per_user_per_day': { group: G, label: 'Guest trips per booker per day', desc: 'Abuse guard for rides booked for someone else.', unit: 'trips', min: 1, max: 50 },
  'guest.max_per_phone_per_day': { group: G, label: 'Trips per guest number per day', desc: 'The same guest number cannot be the target of more trips than this per day, from any booker. Stops people sending unwanted messages.', unit: 'trips', min: 1, max: 20 },
  'retention.guest_days': { group: 'Privacy & retention', label: 'Keep guest name and phone', desc: 'The guest\'s name and phone number are erased this many days after the trip ends.', unit: 'days', min: 1, max: 90 },
  'schedule.max_active_per_user': { group: G, label: 'Recurring rides per rider', desc: 'Active or paused recurring ride plans one account may keep.', unit: 'plans', min: 1, max: 20 },
  'schedule.lookahead_hours': { group: G, label: 'Recurring ride booking horizon', desc: 'A recurring ride is booked this long before it starts.', unit: 'hours', min: 1, max: 168 },
  'schedule.price_tolerance_pct': { group: G, label: 'Recurring ride price tolerance', desc: 'If the new price differs from the agreed price by more than this percentage the ride is not booked and the rider is asked first.', unit: '%', min: 0, max: 100 },
  'schedule.min_lead_min': { group: G, label: 'Recurring ride minimum lead time', desc: 'A recurring ride is never booked closer than this to its start time.', unit: 'minutes', min: 20, max: 720 },
  'quests.peak_hours': { group: G, label: 'Rush hours for quests (PLACEHOLDER)', desc: 'Hours of the day (Kigali, 0-23) that count for rush-hour quests. 7 means 07:00 to 07:59. Comma separated.', type: 'int_list', unit: 'hours', min: 0, max: 23 },
  'heatmap.k_min': { group: G, label: 'Heat map privacy threshold', desc: 'A map cell with fewer distinct requesters than this is hidden so no individual can be located. Cannot go below 3.', unit: 'people', min: 3, max: 50 },
  'heatmap.cache_s': { group: G, label: 'Heat map refresh', desc: 'The demand map is recomputed at most this often.', unit: 'seconds', min: 10, max: 900 },
  'campaign.batch_size': { group: G, label: 'Campaign batch size', desc: 'Recipients handled per job run, so a large campaign is spread out.', unit: 'people', min: 10, max: 2000 },
  'campaign.max_recipients': { group: G, label: 'Campaign audience limit', desc: 'A campaign larger than this cannot be scheduled (cost guard).', unit: 'people', min: 1, max: 100000 },
  'campaign.max_per_user_per_day': { group: G, label: 'Marketing messages per person per day', desc: 'Across all campaigns, in any rolling 24 hours.', unit: 'messages', min: 1, max: 5 },
  'campaign.quiet_start_hour': { group: G, label: 'Marketing quiet hours start', desc: 'No marketing message is sent from this hour (Kigali time).', unit: 'hour', min: 0, max: 23 },
  'campaign.quiet_end_hour': { group: G, label: 'Marketing quiet hours end', desc: 'Marketing resumes at this hour (Kigali time).', unit: 'hour', min: 0, max: 23 },
  'partner.max_billed_per_user_per_day': { group: G, label: 'Partner-billed rides per person per day', desc: 'Abuse guard for rides charged to a venue partner.', unit: 'rides', min: 1, max: 20 },
};
