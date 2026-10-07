import { SETTING_DEFAULTS } from '../config.js';

export type SettingType = 'int' | 'bool' | 'enum' | 'int_list' | 'str_list';
export type SettingMeta = { label: string; desc: string; group: string; type?: SettingType; unit?: string; min?: number; max?: number; options?: string[]; superAdminOnly?: boolean };

export const SETTING_GROUPS = ['Pricing & approvals', 'Dispatch', 'Bookings & cancellations', 'Payments & payouts', 'Drivers & Abasare', 'Security & OTP', 'Privacy & retention', 'Safety & tracking', 'Advanced'] as const;

/** Human metadata for every key in SETTING_DEFAULTS. The admin UI is data-driven from this; keys without an entry fall under "Advanced". */
export const SETTING_META: Record<keyof typeof SETTING_DEFAULTS, SettingMeta> = {
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
  'retention.handover_days': { group: 'Privacy & retention', label: 'Keep Abasare handover photos', desc: 'Deleted after this many days unless a dispute is open.', unit: 'days', min: 1, max: 365 },
  'safety.escalation_contacts': { group: 'Safety & tracking', label: 'Safety escalation contacts', desc: 'Phone numbers (+250...) alerted when an SOS is raised. Comma separated.', type: 'str_list' },
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
