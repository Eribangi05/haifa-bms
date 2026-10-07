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
  otpDevEcho: !isProd && env.OTP_DEV_ECHO === 'true',
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
  bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@rwandamobility.local',
  bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD ?? '',
};

/** Defaults for admin-editable settings (system_settings table overrides these). */
export const SETTING_DEFAULTS = {
  'dispatch.offer_timeout_s': 20,
  'dispatch.max_rounds': 4,
  'dispatch.group_size': 1,                 // 1 = sequential offers, N = small-group broadcast
  'dispatch.strategy': 'eta',               // eta | nearest
  'dispatch.heartbeat_max_age_s': 60,
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
  'abasare.issue_window_min': 30,          // owner can report a vehicle-condition issue this long after drop-off
};
