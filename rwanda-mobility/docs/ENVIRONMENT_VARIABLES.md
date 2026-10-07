# Environment variables

Backend reads configuration only from the environment (`backend/.env.example` is the template). **Never commit real values.** In production use your platform's secret manager; use different values per environment (dev / staging / production).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | prod | `development` | `production` turns on HSTS, refuses dev defaults for secrets, disables the dev simulator route and OTP echo. |
| `PORT` | no | `8080` | HTTP port. |
| `DATABASE_URL` | yes | local dev DB | PostgreSQL 15+ connection string. Use a least-privilege role in production (no superuser). |
| `JWT_SECRET` | prod | dev value | >= 16 chars (use 48+ random). Signs access tokens and OTP hashes. Rotating it signs everyone out. |
| `DATA_ENC_KEY` | prod | dev value | AES-256-GCM key material for national IDs, emergency contacts, staff MFA secrets. **Losing it makes that data unreadable; back it up in the secret manager.** |
| `PIN_SECRET` | prod | dev value | Derives trip PINs (never stored). |
| `FILE_SIGNING_SECRET` | prod | dev value | Signs 5-minute document links. |
| `PUBLIC_BASE_URL` | yes | `http://localhost:8080` | Used to build public trip-share links. |
| `SMS_PROVIDER` | prod | `console` | `console` only logs (**SIMULATED**); `http` posts `{to,text}` to `SMS_HTTP_URL` with `Bearer SMS_HTTP_TOKEN` (adapt to your aggregator's format in `providers/sms.ts`). |
| `APP_ENV` | no | | Set `staging` on a test deployment to allow `OTP_DEV_ECHO=true` there (the code is returned in the API response and shown in the app). Never set on production. |
| `SMS_HTTP_URL`, `SMS_HTTP_TOKEN` | if `http` | | SMS gateway endpoint and token. |
| `OTP_DEV_ECHO` | never in prod | `false` | `true` returns the OTP in the API response for testing. Ignored when `NODE_ENV=production`. |
| `MOMO_MODE` | yes | `simulator` | `simulator` (local fake, **no real money**), `sandbox` (MTN sandbox), `live`. |
| `MOMO_BASE_URL` | sandbox/live | MTN sandbox URL | MTN MoMo API origin (see momodeveloper.mtn.com / Rwanda portal). |
| `MOMO_SUBSCRIPTION_KEY` | sandbox/live | | `Ocp-Apim-Subscription-Key` of your Collections product. |
| `MOMO_API_USER`, `MOMO_API_KEY` | sandbox/live | | API user and key (created via the provisioning API in sandbox). |
| `MOMO_TARGET_ENV` | sandbox/live | `sandbox` | `X-Target-Environment` (`sandbox` or the live environment name MTN gives you). |
| `MOMO_CURRENCY` | | `RWF` | MTN sandbox accepts only `EUR`; set `EUR` while testing there. |
| `MOMO_CALLBACK_URL` | sandbox/live | | Public HTTPS URL of `/api/v1/webhooks/payments/mtn_momo`; sent as `X-Callback-Url`. |
| `MOMO_CALLBACK_TOKEN` | prod | dev value | Shared secret appended to the callback URL as `?token=`. The handler *also* re-queries MTN, so a leaked token cannot fake a payment. |
| `MAP_PROVIDER` | no | `haversine` | `haversine` (estimate only) or `osrm` (uses `OSRM_URL` + `NOMINATIM_URL`; public demo servers are for evaluation only). |
| `OSRM_URL`, `NOMINATIM_URL` | if osrm | public demo servers | Self-host or use a commercial provider for production. |
| `STORAGE_DIR` | no | `./storage` | Private directory for documents/evidence (mode 0600). Replace with an S3-compatible private bucket in production. |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | first run | | `npm run seed` creates the first `super_admin` when the password is >= 12 chars and prints its TOTP secret **once**. Remove the variables afterwards. |
| `RATE_LIMIT_MAX` | no | `300` | Per-IP requests per minute (global). |
| `AUTH_RATE_MAX` | no | `10` (OTP request) / `20` (OTP verify) / `10` (staff login) | Per-IP per-minute cap on OTP and staff-login routes. |
| `CLIENT_ERR_RATE_MAX` | no | `10` | Per-IP per-minute cap on `POST /client-errors`. |
| `BOOKING_RATE_MAX` | no | `20` | Per-user (token subject, else IP) per-minute cap on `POST /bookings`. |
| `PAYMENT_RATE_MAX` | no | `10` | Per-user per-minute cap on `POST /payments` (mobile-money initiate). |
| `UPLOAD_RATE_MAX` | no | `20` | Per-user per-minute cap on file uploads (documents, evidence, Abasare handover photos). |
| `ESTIMATE_RATE_MAX` | no | `60` | Per-user per-minute cap on `POST /fares/estimate`. |
| `PUSH_PROVIDER` | no | `none` | `none` = log-only / **SIMULATED** (nothing is sent); `expo` = deliver through the Expo Push API (`https://exp.host/--/api/v2/push/send`, 100 messages per request, receipts polled every minute; `DeviceNotRegistered` revokes the token). |
| `EXPO_ACCESS_TOKEN` | if your Expo project enforces push security | | Bearer token for the Expo Push API. Keep secret. |
| `EXPO_PUSH_URL` | no | `https://exp.host/--/api/v2` | Override only for testing. |
| `CLAMAV_HOST`, `CLAMAV_PORT` | no | unset / `3310` | When set, every upload is also streamed to this clamd (`INSTREAM`) after the built-in structural checks. **Fail closed**: if clamd is unreachable the upload is rejected with `scan_unavailable` (HTTP 503). Unset = built-in checks only. |
| `QUIET` | no | | `1` silences logs (tests). |

## Mobile app (public: embedded in the build, **never put secrets here**)

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | HTTPS origin of the API (emulator default `http://10.0.2.2:8080`). |
| `EXPO_PUBLIC_APP_NAME` | Display name (also edit `app.config.js` for the launcher name and icons). |

## Admin-editable runtime settings (stored in `system_settings`, edit in Admin -> Settings)

`dispatch.offer_timeout_s`, `dispatch.max_rounds`, `dispatch.group_size`, `dispatch.strategy`, `dispatch.heartbeat_max_age_s`, `dispatch.base_radius_km`, `dispatch.radius_step_km`, `dispatch.max_radius_km`, `booking.cancel_grace_s`, `booking.cancel_fee`, `booking.noshow_wait_min`, `booking.noshow_fee`, `booking.quote_ttl_s`, `booking.max_scheduled_days`, `payout.min_amount`, `payout.fee`, `payout.large_threshold`, `refund.large_threshold`, `driver.expiry_reminder_days`, `retention.location_days`, `retention.client_error_days` (client error reports, default 30), `otp.*`, `safety.escalation_contacts`, `tracking.max_speed_kmh`.
