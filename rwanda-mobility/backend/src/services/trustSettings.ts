// Settings added by round 5 (fraud checks, staff alerts, referrals, number privacy, onboarding review time).
// Spread into SETTING_DEFAULTS (config.ts) and SETTING_META (settingsMeta.ts). Amounts marked PLACEHOLDER are starting points to confirm with the owner.
import type { SettingMeta } from './settingsMeta.js';

const F = 'Fraud & alerts', R = 'Referrals';
export const TRUST_DEFAULTS = {
  'fraud.cancel_loop_count': 3,            // this many passenger cancellations ...
  'fraud.cancel_loop_window_min': 30,      // ... within this many minutes ...
  'fraud.cancel_loop_block_min': 15,       // ... pause new requests for this long (support can still book for them)
  'fraud.promo_accounts_per_device': 1,    // different accounts on one phone that may use the same promo code
  'alerts.staff_views_per_10min': 60,      // customer records one staff member opens in 10 minutes before an alert is raised
  'alerts.failed_logins': 5,               // failed staff sign-ins on one account in 15 minutes
  'alerts.off_hours_start': 22,            // privileged actions between these Kigali hours raise an alert
  'alerts.off_hours_end': 5,
  'alerts.credit_adjust_threshold': 50000, // PLACEHOLDER: a single credit grant or removal above this (RWF) raises an alert
  'alerts.payment_failures_per_hour': 8,   // failed payments in one hour that raise an alert
  'alerts.fraud_events_per_hour': 10,      // fraud signals in one hour that raise an alert
  'referral.enabled': true,
  'referral.reward_referrer': 1000,        // PLACEHOLDER: credit (RWF) for the person who invited ...
  'referral.reward_referee': 1000,         // PLACEHOLDER: ... and for the new rider, after the new rider completes a first trip
  'referral.silver_after': 20,             // rewarded invitations needed for silver ambassador tier (+25% reward)
  'referral.gold_after': 50,               // ... and gold (+50% reward)
  'referral.max_rewards_per_month': 30,    // one inviter can earn rewards for at most this many people per month
  'onboarding.review_sla_hours': 24,       // target time for a driver application review; older ones are flagged in the console
  'privacy.mask_phones': true,             // riders and drivers see each other's phone only after the other person chooses to share it
};

export const TRUST_META: Record<keyof typeof TRUST_DEFAULTS, SettingMeta> = {
  'fraud.cancel_loop_count': { group: F, label: 'Cancel-and-rebook limit', desc: 'A rider who cancels this many times inside the window is paused briefly. Stops people hunting for a cheaper or closer driver by cancelling again and again.', unit: 'cancellations', min: 2, max: 20 },
  'fraud.cancel_loop_window_min': { group: F, label: 'Cancel-and-rebook window', desc: 'The time span in which cancellations are counted.', unit: 'minutes', min: 5, max: 240 },
  'fraud.cancel_loop_block_min': { group: F, label: 'Pause after too many cancellations', desc: 'How long new requests are paused.', unit: 'minutes', min: 1, max: 240 },
  'fraud.promo_accounts_per_device': { group: F, label: 'Accounts per phone per promo code', desc: 'How many different accounts on the same phone may use the same promo code. 1 stops one person making many accounts for one promo.', unit: 'accounts', min: 1, max: 5 },
  'alerts.staff_views_per_10min': { group: F, label: 'Staff data views before alert', desc: 'A staff member opening more customer records than this in 10 minutes raises an alert (possible data scraping).', unit: 'views', min: 10, max: 1000 },
  'alerts.failed_logins': { group: F, label: 'Failed staff sign-ins before alert', desc: 'Failed sign-ins on one staff account within 15 minutes.', unit: 'attempts', min: 3, max: 50 },
  'alerts.off_hours_start': { group: F, label: 'Off-hours start (Kigali)', desc: 'From this hour, privileged actions (staff, roles, refunds, credit, settings) raise an alert.', unit: 'hour', min: 0, max: 23 },
  'alerts.off_hours_end': { group: F, label: 'Off-hours end (Kigali)', desc: 'Until this hour.', unit: 'hour', min: 0, max: 23 },
  'alerts.credit_adjust_threshold': { group: F, label: 'Large credit change alert', desc: 'A single customer credit grant or removal above this amount raises an alert. PLACEHOLDER: confirm.', unit: 'RWF', min: 1000, max: 10000000 },
  'alerts.payment_failures_per_hour': { group: F, label: 'Payment failures per hour before alert', desc: 'Failed payments in one hour that raise an alert (provider outage or fraud).', unit: 'payments', min: 3, max: 500 },
  'alerts.fraud_events_per_hour': { group: F, label: 'Fraud signals per hour before alert', desc: 'Fake-GPS, cancel-loop and promo-device signals in one hour that raise an alert.', unit: 'signals', min: 3, max: 500 },
  'referral.enabled': { group: R, label: 'Referral rewards', desc: 'Invite-a-friend credit. Paid only after the invited person completes a first trip.', type: 'bool' },
  'referral.reward_referrer': { group: R, label: 'Reward for the inviter', desc: 'Credit given to the person who invited. PLACEHOLDER: confirm the amount.', unit: 'RWF', min: 0, max: 50000 },
  'referral.reward_referee': { group: R, label: 'Reward for the new rider', desc: 'Credit given to the invited person after their first completed trip. PLACEHOLDER: confirm the amount.', unit: 'RWF', min: 0, max: 50000 },
  'referral.silver_after': { group: R, label: 'Silver ambassador after', desc: 'Rewarded invitations needed for the silver tier (+25% reward).', unit: 'invitations', min: 2, max: 1000 },
  'referral.gold_after': { group: R, label: 'Gold ambassador after', desc: 'Rewarded invitations needed for the gold tier (+50% reward).', unit: 'invitations', min: 3, max: 5000 },
  'referral.max_rewards_per_month': { group: R, label: 'Rewards per inviter per month', desc: 'Caps how many people one inviter can earn rewards for each month.', unit: 'invitations', min: 1, max: 500 },
  'onboarding.review_sla_hours': { group: 'Drivers & Abasare', label: 'Driver application review target', desc: 'Applications waiting longer than this are marked late in the console queue and shown to the driver as "being prioritised".', unit: 'hours', min: 1, max: 240 },
  'privacy.mask_phones': { group: 'Privacy & retention', label: 'Hide phone numbers between rider and driver', desc: 'On: a rider and driver chat in the app and only see each other\'s number if the other person chooses to share it for that trip.', type: 'bool' },
};
