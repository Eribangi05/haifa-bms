import { SETTING_DEFAULTS } from '../config.js';
import { GROWTH_META } from './growthSettings.js';
import { MONEY_META } from './moneySettings.js';
import { TRUST_META } from './trustSettings.js';

export type SettingType = 'int' | 'bool' | 'enum' | 'int_list' | 'str_list';
export type SettingMeta = { label: string; desc: string; group: string; type?: SettingType; unit?: string; min?: number; max?: number; options?: string[]; superAdminOnly?: boolean };

export const SETTING_GROUPS = ['Pricing & approvals', 'Dispatch', 'Bookings & cancellations', 'Payments & payouts', 'Drivers & Abasare', 'Security & OTP', 'Privacy & retention', 'Safety & tracking', 'Credit & loyalty', 'Claims', 'USSD', 'Fraud & alerts', 'Referrals', 'Advanced'] as const;

/** Human metadata for every key in SETTING_DEFAULTS. The admin UI is data-driven from this; keys without an entry fall under "Advanced". */
export const SETTING_META: Record<keyof typeof SETTING_DEFAULTS, SettingMeta> = {
  ...MONEY_META,
  ...TRUST_META,
  ...GROWTH_META,
  'pricing.self_approval': { group: 'Pricing & approvals', label: 'Allow self-approval of price changes', desc: 'Off (recommended): a second person must approve every fare or commission change. On: the proposer may approve their own change (for very small teams). Every self-approval is flagged in the audit log.', type: 'bool', superAdminOnly: true },
  'dispatch.offer_timeout_s': { group: 'Dispatch', label: 'Driver offer timeout', desc: 'How long a driver has to accept a trip offer before it moves to the next driver.', unit: 'seconds', min: 5, max: 120 },
  'dispatch.max_rounds': { group: 'Dispatch', label: 'Maximum search rounds', desc: 'How many times the search widens before the passenger is told no driver was found.', unit: 'rounds', min: 1, max: 10 },
  'dispatch.group_size': { group: 'Dispatch', label: 'Drivers offered at once', desc: '1 = offer to one driver at a time. Higher numbers broadcast to a small group, first to accept wins.', unit: 'drivers', min: 1, max: 10 },
  'dispatch.strategy': { group: 'Dispatch', label: 'Driver ranking', desc: 'eta = fastest estimated arrival first; nearest = closest straight-line distance first.', type: 'enum', options: ['eta', 'nearest'] },
  'dispatch.heartbeat_max_age_s': { group: 'Dispatch', label: 'Driver location freshness', desc: 'A driver whose last location is older than this is treated as offline.', unit: 'seconds', min: 15, max: 600 },
  'dispatch.base_radius_km': { group: 'Dispatch', label: 'Starting search radius', desc: 'Radius around the pickup point for the first search round.', unit: 'km', min: 1, max: 30 },
  'dispatch.radius_step_km': { group: 'Dispatch', label: 'Radius growth per round', desc: 'How much the radius grows each round.', unit: 'km', min: 0, max: 20 },
  'dispatch.max_radius_km': { group: 'Dispatch', label: 'Maximum search radius', desc: 'The search never goes beyond this distance.', unit: 'km', min: 1, max: 50 },
  'booking.cancel_grace_s': { group: 'Bookings & cancellations', label: 'Free cancellation window', desc: 'Passengers can cancel free of charge for this long after a driver is assigned.', unit: 'seconds', min: 0, max: 900 },
  'booking.cancel_fee': { group: 'Bookings & cancellations', label: 'Late cancellation fee', desc: 'Charged on the next booking when a passenger cancels after the free window.', unit: 'RWF', min: 0, max: 20000 },
  'booking.noshow_wait_min': { group: 'Bookings & cancellations', label: 'No-show waiting time', desc: 'How long a driver waits at pickup before they can report a no-show.', unit: 'minutes', min: 1, max: 30 },
  'booking.noshow_fee': { group: 'Bookings & cancellations', label: 'No-show fee', desc: 'Charged when the passenger does not show up.', unit: 'RWF', min: 0, max: 50000 },
  'booking.quote_ttl_s': { group: 'Bookings & cancellations', label: 'Fare quote validity', desc: 'How long a displayed fare can be accepted at the quoted price.', unit: 'seconds', min: 60, max: 3600 },
  'map.nearby_radius_km': { group: 'Dispatch', label: 'Drivers shown on the rider map: distance', desc: 'Online drivers within this distance of the rider are drawn on the rider map.', unit: 'km', min: 1, max: 15 },
  'map.wide_radius_km': { group: 'Dispatch', label: 'Wide view of drivers: distance', desc: 'When a rider chooses to see all available drivers, drivers up to this distance are drawn; where there are many they are grouped into numbered bubbles. 300 covers all of Rwanda.', unit: 'km', min: 10, max: 300 },
  'map.nearby_max': { group: 'Dispatch', label: 'Drivers shown on the rider map: most cars', desc: 'The most car icons drawn at once (the nearest ones). The number of drivers nearby is still counted in full.', unit: 'drivers', min: 1, max: 30 },
  'map.nearby_blur_m': { group: 'Safety & tracking', label: 'Driver positions on the rider map: blur', desc: 'Positions shown to riders are moved to a grid of this size and shifted a little every half minute, so a rider can never follow one driver. 0 = exact position (not recommended).', unit: 'metres', min: 0, max: 500 },
  'booking.min_schedule_lead_min': { group: 'Bookings & cancellations', label: 'Shortest notice for a scheduled trip', desc: 'A scheduled trip must start at least this many minutes from now, so a driver has time to be found.', unit: 'minutes', min: 5, max: 720 },
  'abasare.quick_hours': { group: 'Drivers & Abasare', label: 'Quick hire lengths', desc: 'Hire lengths shown as quick choices when someone books an Umusare by the hour. Comma separated, e.g. 2, 4, 8, 12. Customers can still choose any whole number of hours between the pricing minimum and maximum.', type: 'int_list', unit: 'hours', min: 1, max: 24 },
  'booking.max_scheduled_days': { group: 'Bookings & cancellations', label: 'Advance booking limit', desc: 'How far ahead a trip can be scheduled.', unit: 'days', min: 1, max: 90 },
  'payout.min_amount': { group: 'Payments & payouts', label: 'Minimum payout', desc: 'Drivers cannot request a payout below this amount.', unit: 'RWF', min: 0, max: 1000000 },
  'payout.fee': { group: 'Payments & payouts', label: 'Payout fee', desc: 'Flat fee deducted from each payout.', unit: 'RWF', min: 0, max: 10000 },
  'payout.large_threshold': { group: 'Payments & payouts', label: 'Large payout threshold', desc: 'Payouts at or above this amount need an extra review step.', unit: 'RWF', min: 0, max: 100000000 },
  'refund.large_threshold': { group: 'Payments & payouts', label: 'Large refund threshold', desc: 'Refunds at or above this amount are flagged for senior approval.', unit: 'RWF', min: 0, max: 100000000 },
  'driver.expiry_reminder_days': { group: 'Drivers & Abasare', label: 'Document expiry reminders', desc: 'Days before a document expires when the driver is reminded. Comma separated, e.g. 30, 14, 7, 1.', type: 'int_list', unit: 'days', min: 0, max: 365 },
  'abasare.min_photos': { group: 'Drivers & Abasare', label: 'Handover photos required', desc: 'Photos of the customer car required at pickup and at drop-off.', unit: 'photos', min: 0, max: 10 },
  'abasare.min_licence_years': { group: 'Drivers & Abasare', label: 'Minimum licence experience', desc: 'Abasare drivers need a driving licence at least this old.', unit: 'years', min: 0, max: 20 },
  'abasare.issue_window_min': { group: 'Drivers & Abasare', label: 'Vehicle issue report window', desc: 'The owner can report a vehicle-condition issue this long after drop-off.', unit: 'minutes', min: 0, max: 1440 },
  'otp.ttl_s': { group: 'Security & OTP', label: 'Code validity', desc: 'How long a sign-in code stays valid.', unit: 'seconds', min: 60, max: 900 },
  'otp.max_attempts': { group: 'Security & OTP', label: 'Wrong-code attempts', desc: 'After this many wrong entries the code is locked.', unit: 'attempts', min: 1, max: 10 },
  'otp.resend_cooldown_s': { group: 'Security & OTP', label: 'Resend cooldown', desc: 'Minimum wait before a new code can be requested.', unit: 'seconds', min: 0, max: 600 },
  'otp.max_per_hour_phone': { group: 'Security & OTP', label: 'Codes per phone per hour', desc: 'Protects against SMS abuse.', unit: 'codes', min: 1, max: 50 },
  'otp.max_per_hour_ip': { group: 'Security & OTP', label: 'Codes per network per hour', desc: 'Per IP address. Mobile carriers share addresses, so keep this generous.', unit: 'codes', min: 1, max: 1000 },
  'retention.location_days': { group: 'Privacy & retention', label: 'Keep trip locations', desc: 'GPS traces are deleted after this many days.', unit: 'days', min: 1, max: 365 },
  'retention.client_error_days': { group: 'Privacy & retention', label: 'Keep app error reports', desc: 'Crash and error reports are deleted after this many days.', unit: 'days', min: 1, max: 365 },
  'retention.notification_days': { group: 'Privacy & retention', label: 'Keep notifications', desc: 'Delivered in-app, SMS and push notifications are deleted after this many days.', unit: 'days', min: 7, max: 730 },
  'retention.session_days': { group: 'Privacy & retention', label: 'Keep ended sign-in sessions', desc: 'Revoked or expired sessions are deleted after this many days. Keep at least 30 so token-theft detection keeps working.', unit: 'days', min: 30, max: 365 },
  'retention.handover_days': { group: 'Privacy & retention', label: 'Keep Abasare handover photos', desc: 'Deleted after this many days unless a dispute is open.', unit: 'days', min: 1, max: 365 },
  'safety.escalation_contacts': { group: 'Safety & tracking', label: 'Safety escalation contacts', desc: 'Phone numbers (+250...) alerted when an SOS is raised. Comma separated.', type: 'str_list' },
  'safety.checks_enabled': { group: 'Safety & tracking', label: 'Route and long-stop safety checks', desc: 'On: during a trip, a driver far from the route or stopped for too long triggers an "Are you OK?" message to the passenger. Passengers can switch it off per trip.', type: 'bool' },
  'safety.deviation_corridor_m': { group: 'Safety & tracking', label: 'Route corridor', desc: 'How far from the straight pickup-destination line the car may be before the trip is treated as off route (before the road-factor allowance).', unit: 'metres', min: 200, max: 5000 },
  'safety.road_factor_pct': { group: 'Safety & tracking', label: 'Road factor', desc: 'Roads are longer than straight lines. 150 means roads are assumed 50% longer; the corridor is widened accordingly so normal detours do not trigger checks.', unit: '%', min: 100, max: 300 },
  'safety.stop_minutes': { group: 'Safety & tracking', label: 'Long-stop time', desc: 'A car that has not moved for this long during a trip (away from the destination) triggers a check.', unit: 'minutes', min: 2, max: 60 },
  'safety.stop_radius_m': { group: 'Safety & tracking', label: 'Stationary radius', desc: 'The car counts as stationary when all its recent locations are within this distance of each other.', unit: 'metres', min: 20, max: 500 },
  'safety.check_interval_s': { group: 'Safety & tracking', label: 'Safety check interval', desc: 'Minimum time between two checks of the same trip.', unit: 'seconds', min: 15, max: 600 },
  'safety.response_wait_min': { group: 'Safety & tracking', label: 'Time to answer', desc: 'If the passenger does not answer "Are you OK?" within this time, a safety case is opened for support (no agency is contacted automatically).', unit: 'minutes', min: 1, max: 30 },
  'safety.recheck_cooldown_min': { group: 'Safety & tracking', label: 'Pause after "OK"', desc: 'After the passenger answers OK, the same kind of check waits this long.', unit: 'minutes', min: 1, max: 120 },
  'safety.max_alerts_per_trip': { group: 'Safety & tracking', label: 'Checks per trip', desc: 'Upper limit of "Are you OK?" checks on one trip.', unit: 'checks', min: 1, max: 10 },
  'share.expiry_after_trip_min': { group: 'Safety & tracking', label: 'Share link lifetime after the trip', desc: 'Live-share links keep working this long after the trip ends, then stop.', unit: 'minutes', min: 10, max: 1440 },
  'tips.enabled': { group: 'Payments & payouts', label: 'Tips', desc: 'Passengers can tip the driver after a completed trip. Tips go 100% to the driver (no commission).', type: 'bool' },
  'tips.min_amount': { group: 'Payments & payouts', label: 'Smallest tip', desc: 'Mobile-money and cash tips below this amount are refused.', unit: 'RWF', min: 0, max: 10000 },
  'tips.max_amount': { group: 'Payments & payouts', label: 'Largest tip', desc: 'Abuse guard: a single tip above this amount is refused.', unit: 'RWF', min: 100, max: 1000000 },
  'dispatch.favourite_boost_s': { group: 'Dispatch', label: 'Favourite driver boost', desc: 'A passenger\'s favourite driver is ranked as if this many seconds closer. 0 switches the boost off. Blocked drivers are always excluded.', unit: 'seconds', min: 0, max: 1800 },
  'tracking.max_speed_kmh': { group: 'Safety & tracking', label: 'Maximum plausible speed', desc: 'Location updates implying a higher speed are ignored as GPS errors.', unit: 'km/h', min: 40, max: 300 },
};

export function metaFor(key: string): SettingMeta {
  const m = (SETTING_META as Record<string, SettingMeta>)[key];
  if (m) return { type: typeOf(key), ...m };
  return { group: 'Advanced', label: key, desc: 'Legacy or unrecognised setting. Edit as raw JSON; it has no built-in range check.' };
}
function typeOf(key: string): SettingType {
  const d = (SETTING_DEFAULTS as Record<string, unknown>)[key];
  return typeof d === 'boolean' ? 'bool' : typeof d === 'number' ? 'int' : Array.isArray(d) ? (key === 'safety.escalation_contacts' ? 'str_list' : 'int_list') : 'enum';
}

/** Returns a human error message, or null when the value is acceptable for the key. Unknown keys are not range-checked. */
export function validateSetting(key: string, value: unknown): string | null {
  if (!(key in SETTING_META)) return null;
  const m = metaFor(key);
  switch (m.type) {
    case 'bool': return typeof value === 'boolean' ? null : 'Must be on or off';
    case 'enum': return typeof value === 'string' && m.options!.includes(value) ? null : `Must be one of: ${m.options!.join(', ')}`;
    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'Must be a whole number';
      if (m.min != null && value < m.min) return `Must be at least ${m.min}${m.unit ? ' ' + m.unit : ''}`;
      if (m.max != null && value > m.max) return `Must be at most ${m.max}${m.unit ? ' ' + m.unit : ''}`;
      return null;
    }
    case 'int_list':
      if (!Array.isArray(value) || value.length > 12 || !value.every((v) => Number.isInteger(v) && v >= (m.min ?? 0) && v <= (m.max ?? 365))) return `Must be a list of whole numbers between ${m.min ?? 0} and ${m.max ?? 365}`;
      return null;
    case 'str_list':
      if (!Array.isArray(value) || value.length > 20 || !value.every((v) => typeof v === 'string' && /^\+250[0-9]{9}$/.test(v))) return 'Must be a list of Rwandan phone numbers like +250788123456';
      return null;
  }
  return null;
}
