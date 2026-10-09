import { GROWTH_DEFAULTS } from './services/growthSettings.js';
import { MONEY_DEFAULTS } from './services/moneySettings.js';

const env = process.env;
export const isProd = env.NODE_ENV === 'production';

function secret(name: string, dev: string): string {
  const v = env[name];
  if (v && v.length >= 16) return v;
  if (isProd) throw new Error(`${name} must be set (>=16 chars) in production`);
  return dev;
}

export const config = {
  port: Number(env.PORT ?? 8080),
  databaseUrl: env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility',
  jwtSecret: secret('JWT_SECRET', 'dev-jwt-secret-not-for-production'),
  dataEncKey: secret('DATA_ENC_KEY', 'dev-enc-key-not-for-production!!'),
  pinSecret: secret('PIN_SECRET', 'dev-pin-secret-not-for-production'),
  fileSigningSecret: secret('FILE_SIGNING_SECRET', 'dev-file-secret-not-for-production'),
  publicBaseUrl: env.PUBLIC_BASE_URL ?? 'http://localhost:8080',
  appDownloadUrl: env.APP_DOWNLOAD_URL ?? '',
  // OTP echo is for local dev and an explicitly marked STAGING deployment only (APP_ENV=staging); never in production.
  otpDevEcho: (!isProd || env.APP_ENV === 'staging') && env.OTP_DEV_ECHO === 'true',
  smsProvider: env.SMS_PROVIDER ?? 'console',
  smsHttpUrl: env.SMS_HTTP_URL ?? '',
  smsHttpToken: env.SMS_HTTP_TOKEN ?? '',
  momo: {
    mode: (env.MOMO_MODE ?? 'simulator') as 'sandbox' | 'live' | 'simulator',
    baseUrl: env.MOMO_BASE_URL ?? 'https://sandbox.momodeveloper.mtn.com',
    subscriptionKey: env.MOMO_SUBSCRIPTION_KEY ?? '',
    apiUser: env.MOMO_API_USER ?? '',
    apiKey: env.MOMO_API_KEY ?? '',
    targetEnv: env.MOMO_TARGET_ENV ?? 'sandbox',
    currency: env.MOMO_CURRENCY ?? 'RWF',   // MTN sandbox only accepts EUR; set MOMO_CURRENCY=EUR when testing there
    callbackUrl: env.MOMO_CALLBACK_URL ?? '',
    callbackToken: env.MOMO_CALLBACK_TOKEN ?? 'dev-callback-token',
  },
  pushProvider: (env.PUSH_PROVIDER ?? 'none') as 'none' | 'expo',
  expoPushUrl: env.EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2',
  expoAccessToken: env.EXPO_ACCESS_TOKEN ?? '',
  clamavHost: env.CLAMAV_HOST ?? '',
  clamavPort: Number(env.CLAMAV_PORT ?? 3310),
  mapProvider: env.MAP_PROVIDER ?? 'haversine',
  osrmUrl: env.OSRM_URL ?? 'https://router.project-osrm.org',
  nominatimUrl: env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org',
  storageDir: env.STORAGE_DIR ?? './storage',
  storageDriver: (env.STORAGE_DRIVER === 'db' ? 'db' : 'disk') as 'disk' | 'db',
  // Recovery: set both, redeploy, read the new secret in the logs once. Runs again only when the token value changes.
  adminMfaResetEmail: env.ADMIN_MFA_RESET_EMAIL ?? '',
  adminMfaResetToken: env.ADMIN_MFA_RESET_TOKEN ?? '',
  bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@rwandamobility.local',
  bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD ?? '',
};

/**
 * Boot-time safety checks. `fatal` problems stop the server in production (they would make it unsafe or non-functional);
 * `warn` problems are logged loudly. Pure function of its input so it can be tested.
 */
export function configProblems(c: typeof config = config, e: Record<string, string | undefined> = env, prod = isProd): { fatal: string[]; warn: string[] } {
  const fatal: string[] = [], warn: string[] = [];
  if (!prod) return { fatal, warn };
  const staging = e.APP_ENV === 'staging';
  if (c.momo.mode === 'live') {
    if (!c.momo.subscriptionKey || !c.momo.apiUser || !c.momo.apiKey) fatal.push('MOMO_MODE=live needs MOMO_SUBSCRIPTION_KEY, MOMO_API_USER and MOMO_API_KEY');
    if (c.momo.callbackToken === 'dev-callback-token' || c.momo.callbackToken.length < 16) fatal.push('MOMO_CALLBACK_TOKEN must be set (>=16 chars) when MOMO_MODE=live');
  } else if (c.momo.mode === 'sandbox' && (c.momo.callbackToken === 'dev-callback-token' || c.momo.callbackToken.length < 16)) warn.push('MOMO_CALLBACK_TOKEN is the public development default: set a secret value');
  if (c.momo.mode === 'simulator' && !staging) warn.push('MOMO_MODE=simulator in production: mobile-money payments are SIMULATED');
  if (c.smsProvider === 'http' && !c.smsHttpUrl) fatal.push('SMS_PROVIDER=http needs SMS_HTTP_URL');
  if (c.smsProvider === 'console' && !staging) warn.push('SMS_PROVIDER=console in production: OTP codes are not delivered');
  if (c.pushProvider === 'expo' && !c.expoPushUrl) fatal.push('PUSH_PROVIDER=expo needs EXPO_PUSH_URL');
  if (/localhost|127\.0\.0\.1/.test(c.publicBaseUrl)) warn.push('PUBLIC_BASE_URL points at localhost: share and request-code links will not work');
  if (/\/\/rm:rm@/.test(c.databaseUrl)) warn.push('DATABASE_URL uses the default development credentials');
  const secrets = [c.jwtSecret, c.dataEncKey, c.pinSecret, c.fileSigningSecret];
  if (new Set(secrets).size !== secrets.length) warn.push('JWT_SECRET, DATA_ENC_KEY, PIN_SECRET and FILE_SIGNING_SECRET should all be different values');
  if (c.bootstrapAdminPassword && c.bootstrapAdminPassword.length < 12) warn.push('BOOTSTRAP_ADMIN_PASSWORD is shorter than 12 characters and will be ignored');
  return { fatal, warn };
}

/** Defaults for admin-editable settings (system_settings table overrides these). */
export const SETTING_DEFAULTS = {
  ...MONEY_DEFAULTS,                        // round 3: credit, loyalty, deposit, claims, USSD (services/moneySettings.ts)
  ...GROWTH_DEFAULTS,                       // growth round: guest rides, schedules, quests, heat map, campaigns, partners (services/growthSettings.ts)
  'dispatch.offer_timeout_s': 20,
  'dispatch.max_rounds': 4,
  'dispatch.group_size': 1,                 // 1 = sequential offers, N = small-group broadcast
  'dispatch.strategy': 'eta',               // eta | nearest
  'dispatch.heartbeat_max_age_s': 90,
  'dispatch.base_radius_km': 3,
  'dispatch.radius_step_km': 2,
  'dispatch.max_radius_km': 12,
  'booking.cancel_grace_s': 120,
  'booking.cancel_fee': 500,
  'booking.noshow_wait_min': 5,
  'booking.noshow_fee': 1000,
  'booking.quote_ttl_s': 600,
  'booking.max_scheduled_days': 14,
  'payout.min_amount': 5000,
  'payout.fee': 0,
  'payout.large_threshold': 200000,
  'refund.large_threshold': 50000,
  'driver.expiry_reminder_days': [30, 14, 7, 1],
  'retention.location_days': 30,
  'retention.client_error_days': 30,
  'retention.notification_days': 180,      // delivered notifications (bodies can name drivers and plates) are deleted after this
  'retention.session_days': 30,            // revoked / expired sign-in sessions are kept this long (refresh-token reuse detection), then deleted
  'otp.ttl_s': 300,
  'otp.max_attempts': 5,
  'otp.resend_cooldown_s': 60,
  'otp.max_per_hour_phone': 5,
  'otp.max_per_hour_ip': 20,
  'safety.escalation_contacts': [] as string[],
  'tracking.max_speed_kmh': 160,
  'abasare.min_photos': 2,                 // handover photos required at pickup and at drop-off
  'abasare.min_licence_years': 2,
  'retention.handover_days': 90,           // car check-in/out photos are deleted after this unless a dispute is open
  'pricing.self_approval': false,           // true = the proposer of a price/commission change may approve it themselves (audited, super_admin only switch)
  'abasare.issue_window_min': 30,          // owner can report a vehicle-condition issue this long after drop-off
  // --- safety checks, sharing, tips, favourites (round 1)
  'safety.checks_enabled': true,           // master switch for the route-deviation / long-stop "Are you OK?" checks
  'safety.deviation_corridor_m': 700,      // corridor half-width around the pickup-destination line before a trip counts as off route
  'safety.road_factor_pct': 150,           // roads are longer than straight lines: the corridor widens by (factor-100)% of the straight-line distance, halved
  'safety.stop_minutes': 10,               // stationary this long during a trip => check
  'safety.stop_radius_m': 75,              // "stationary" = every location in the window within this distance of the latest one
  'safety.check_interval_s': 60,           // minimum spacing between checks of the same trip
  'safety.response_wait_min': 3,           // no answer after this long => escalate to support
  'safety.recheck_cooldown_min': 10,       // after the passenger says OK, the same kind of check waits this long
  'safety.max_alerts_per_trip': 3,
  'share.expiry_after_trip_min': 60,       // live-share links stop working this long after the trip ends
  'tips.enabled': true,
  'tips.min_amount': 100,
  'tips.max_amount': 20000,
  'dispatch.favourite_boost_s': 240,       // a favourite driver ranks as if this many seconds closer (0 = off)
};
