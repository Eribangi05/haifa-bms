# Environment variables

Backend reads configuration only from the environment (`backend/.env.example` is the template; `deploy/.env.example` is the template for the Docker Compose stack; `render.yaml` sets the Render staging service). **Never commit real values.** `node docs/tools/check-docs.mjs` (run in CI) fails if a variable used in `backend/src` is missing from this page, or if a template sets a variable the code never reads. In production use your platform's secret manager; use different values per environment (dev / staging / production).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | prod | `development` | `production` turns on HSTS, refuses dev defaults for secrets (the server will not start), disables the dev simulator route and OTP echo, and enables the startup checks listed under "Startup checks" below. |
| `PORT` | no | `8080` | HTTP port. |
| `DATABASE_URL` | yes | local dev DB | PostgreSQL 15+ connection string. Use a least-privilege role in production (no superuser). |
| `JWT_SECRET` | prod | dev value | >= 16 chars (use 48+ random). Signs access tokens and OTP hashes. Rotating it invalidates current access tokens (clients refresh silently) and pending OTP codes; it does not end sessions. |
| `DATA_ENC_KEY` | prod | dev value | AES-256-GCM key material for national IDs, emergency contacts, staff MFA secrets. **Losing it makes that data unreadable; back it up in the secret manager.** |
| `PIN_SECRET` | prod | dev value | Derives trip PINs (never stored). |
| `FILE_SIGNING_SECRET` | prod | dev value | Signs 5-minute document links. |
| `PUBLIC_BASE_URL` | yes | `http://localhost:8080` | Public https origin of the API. Builds trip-share links and the venue QR codes (`${PUBLIC_BASE_URL}/r/<CODE>`). Production logs a warning if it still points at localhost. |
| `APP_DOWNLOAD_URL` | no | (empty) | Optional store/download link shown on the request-code landing page (`/r/<CODE>`). If unset the page tells people to ask the venue or install Abasare. Also set `PUBLIC_BASE_URL` to the public host: QR codes encode `${PUBLIC_BASE_URL}/r/<CODE>`. |
| `SMS_PROVIDER` | prod | `console` | `console` only logs (**SIMULATED**); `http` posts `{to,text}` to `SMS_HTTP_URL` with `Bearer SMS_HTTP_TOKEN` (adapt to your aggregator's format in `providers/sms.ts`). |
| `ADMIN_MFA_RESET_EMAIL`, `ADMIN_MFA_RESET_TOKEN` | no | | Recovery for a lost authenticator: set both (token = any text of 8+ characters), redeploy, read `STAFF MFA RESET` in the logs for the new secret. It runs once per distinct token value; remove both afterwards. |
| `APP_ENV` | no | | Set `staging` on a test deployment to allow `OTP_DEV_ECHO=true` there (the code is returned in the API response and shown in the app). Never set on production. |
| `SMS_HTTP_URL`, `SMS_HTTP_TOKEN` | if `http` | | SMS gateway endpoint and token. |
| `OTP_DEV_ECHO` | never in prod | `false` | `true` returns the OTP in the API response for testing. Honoured only outside production, or in production when `APP_ENV=staging` (the staging blueprint). Never enable it on a deployment with real users. |
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
| `STORAGE_DRIVER` | no | `disk` | `db` keeps uploads in PostgreSQL (`stored_files`) so they survive redeploys on a host without a persistent disk (free plan). Files are limited to 5 MB each. |
| `STORAGE_DIR` | no | `./storage` | Private directory for documents/evidence (mode 0600). Replace with an S3-compatible private bucket in production. |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | first run | `admin@rwandamobility.local` / (empty) | Server start (and `npm run seed`) the first `super_admin` when none exists and the password is >= 12 chars, and prints its TOTP secret **once** in the logs (search `FIRST SUPER ADMIN CREATED`). It never touches an existing admin. Remove the password afterwards. (The default e-mail is a leftover of the old project name: always set your own.) |
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
| `TRUST_PROXY` | prod | trust all | How many reverse proxies sit in front: a number (`1` for Caddy or Render), `false`, or a comma list of proxy addresses. Unset trusts every `X-Forwarded-For`, which lets a caller spoof its IP and dodge per-IP rate limits: set it in production. |
| `CORS_ORIGINS` | no | (open) | Comma-separated browser origins allowed to call the API. Empty = any origin (the API uses bearer tokens, never cookies). |
| `LOG_LEVEL` | no | `info` | Fastify/pino log level. Authorization headers and callback tokens are redacted. |
| `REQUEST_TIMEOUT_MS` | no | `30000` | Per-request timeout. |
| `DB_POOL_MAX` | no | `20` | PostgreSQL pool size. Keep it below the database's connection limit divided by the number of API instances. |
| `DB_CONNECT_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS` | no | `5000`, `30000`, `30000` | Connection, statement and idle-in-transaction timeouts. |
| `REFRESH_RATE_MAX` | no | `30` | Per-user per-minute cap on `POST /auth/refresh`. |
| `PLACES_RATE_MAX` | no | `60` | Per-user per-minute cap on `GET /places/search`. |
| `PROMO_RATE_MAX` | no | `30` | Per-user per-minute cap on `POST /promotions/validate`. |
| `ENROLL_RATE_MAX` | no | `10` | Per-user per-minute cap on `POST /drivers/enroll`. |
| `CHAT_RATE_MAX` | no | `30` | Per-user per-minute cap on in-trip chat messages. |
| `SHARE_RATE_MAX` | no | `20` | Per-user per-minute cap on creating trip-share links. |
| `SOS_RATE_MAX` | no | `6` | Per-user per-minute cap on `POST /safety/sos`. |
| `CASE_RATE_MAX` | no | `10` | Per-user per-minute cap on support cases, case messages and safety reports. |
| `CONSENT_RATE_MAX`, `PRIVACY_RATE_MAX` | no | `30`, `10` | Per-user per-minute caps on consent changes and privacy requests. |
| `ORG_RATE_MAX`, `MEMBER_RATE_MAX` | no | `5`, `30` | Per-user per-minute caps on creating companies/fleets and on adding members/inviting drivers. |
| `PUBLIC_CODE_RATE_MAX` | no | `60` | Per-IP per-minute cap on the public request-code lookup and landing page (`/request-codes/:code`, `/r/:code`). |
| `RBAC_CACHE_MS` | no | `15000` | How long (ms) a server keeps the role-to-permission map in memory. Role changes refresh the changing server at once; other servers follow within this time. |
| `INVITE_RATE_MAX` | no | `15` | Per-minute cap on the public staff-invite activation endpoints. |
| `CLIENT_ERR_MAX_PER_HOUR` | no | `5000` | Global cap on stored client error reports per hour (protects the table from a crash loop). |
| `QUIET` | no | | `1` silences logs (tests). |

## Startup checks (production only)

The server logs each problem at start; **fatal** ones stop it: `MOMO_MODE=live` without `MOMO_SUBSCRIPTION_KEY`, `MOMO_API_USER`, `MOMO_API_KEY` or a `MOMO_CALLBACK_TOKEN` of 16+ characters; `SMS_PROVIDER=http` without `SMS_HTTP_URL`; `PUSH_PROVIDER=expo` without `EXPO_PUSH_URL`; any of the four secrets missing or shorter than 16 characters. **Warnings**: simulator MoMo or console SMS outside `APP_ENV=staging`, `PUBLIC_BASE_URL` on localhost, default database credentials, two secrets with the same value, a bootstrap password under 12 characters.

## Mobile app (public: embedded in the build, **never put secrets here**)

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | HTTPS origin of the API (emulator default `http://10.0.2.2:8080`). |
| `EXPO_PUBLIC_APP_NAME` | Display name (also edit `app.config.js` for the launcher name and icons). |
| `EXPO_PUBLIC_ALLOW_CLEARTEXT` | `1` only for local dev/e2e builds that talk to plain `http://`; `eas.json` sets it to `0` for `preview` and `production`. |
| `EAS_PROJECT_ID` | Expo project id, needed for push registration (read by `app.config.js` at build time). |

## Admin-editable runtime settings (stored in `system_settings`, edit in Admin -> Settings)

`dispatch.offer_timeout_s`, `dispatch.max_rounds`, `dispatch.group_size`, `dispatch.strategy`, `dispatch.heartbeat_max_age_s`, `dispatch.base_radius_km`, `dispatch.radius_step_km`, `dispatch.max_radius_km`, `booking.cancel_grace_s`, `booking.cancel_fee`, `booking.noshow_wait_min`, `booking.noshow_fee`, `booking.quote_ttl_s`, `booking.max_scheduled_days`, `payout.min_amount`, `payout.fee`, `payout.large_threshold`, `refund.large_threshold`, `driver.expiry_reminder_days`, `retention.location_days`, `retention.client_error_days` (client error reports, default 30), `retention.notification_days` (180), `retention.session_days` (30), `retention.handover_days` (Abasare car-check photos, 90), `otp.*`, `safety.escalation_contacts`, `tracking.max_speed_kmh`, `abasare.min_photos`, `abasare.min_licence_years`, `abasare.issue_window_min`, `pricing.self_approval` (super admin only; lets a proposer approve their own price change, flagged `self_approved` in the audit log).


## Additional variables (feature rounds 1-3)
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CLAIM_RATE_MAX` | no | 30 | Per-minute request limit for this endpoint group (tests raise it). |
| `GUEST_CONTACT_RATE_MAX` | no | 20 | Per-minute request limit for this endpoint group (tests raise it). |
| `SCHEDULE_RATE_MAX` | no | 20 | Per-minute request limit for this endpoint group (tests raise it). |
| `HEATMAP_RATE_MAX` | no | 30 | Per-minute request limit for this endpoint group (tests raise it). |
| `CAMPAIGN_TEST_RATE_MAX` | no | 10 | Per-minute request limit for this endpoint group (tests raise it). |
| `WALLET_RATE_MAX` | no | 20 | Per-minute request limit for this endpoint group (tests raise it). |
| `SAFETY_RATE_MAX` | no | 30 | Per-minute request limit for this endpoint group (tests raise it). |
| `SHARE_STOP_RATE_MAX` | no | 10 | Per-minute request limit for this endpoint group (tests raise it). |
| `TIP_RATE_MAX` | no | 6 | Per-minute request limit for this endpoint group (tests raise it). |
| `PREF_RATE_MAX` | no | 30 | Per-minute request limit for this endpoint group (tests raise it). |
| `USSD_SHARED_SECRET` | with USSD | | Shared secret (16+ characters) the aggregator sends with each USSD callback; without it the USSD endpoint answers 503. See USSD.md. |
| `USSD_ALLOWED_IPS` | no | | Comma-separated IP allow-list for USSD callbacks. |
| `USSD_RATE_MAX` | no | see code | Per-minute request limit for this endpoint group (tests raise it). |
| `USSD_PHONE_RATE_MAX` | no | see code | Per-minute request limit for this endpoint group (tests raise it). |


## Additional runtime settings (editable in the admin console, Settings page)
| Setting | Default | Meaning |
|---|---|---|
| `safety.checks_enabled` | True | Route and long-stop safety checks: On: during a trip, a driver far from the route or stopped for too long triggers an "Are you OK?" message to the passenger. Passengers can switch it off per trip. |
| `safety.deviation_corridor_m` | 700 | Route corridor: How far from the straight pickup-destination line the car may be before the trip is treated as off route (before the road-factor allowance). |
| `safety.road_factor_pct` | 150 | Road factor: Roads are longer than straight lines. 150 means roads are assumed 50% longer; the corridor is widened accordingly so normal detours do not trigger checks. |
| `safety.stop_minutes` | 10 | Long-stop time: A car that has not moved for this long during a trip (away from the destination) triggers a check. |
| `safety.stop_radius_m` | 75 | Stationary radius: The car counts as stationary when all its recent locations are within this distance of each other. |
| `safety.check_interval_s` | 60 | Safety check interval: Minimum time between two checks of the same trip. |
| `safety.response_wait_min` | 3 | Time to answer: If the passenger does not answer "Are you OK?" within this time, a safety case is opened for support (no agency is contacted automatically). |
| `safety.recheck_cooldown_min` | 10 | Pause after "OK": After the passenger answers OK, the same kind of check waits this long. |
| `safety.max_alerts_per_trip` | 3 | Checks per trip: Upper limit of "Are you OK?" checks on one trip. |
| `share.expiry_after_trip_min` | 60 | Share link lifetime after the trip: Live-share links keep working this long after the trip ends, then stop. |
| `tips.enabled` | True | Tips: Passengers can tip the driver after a completed trip. Tips go 100% to the driver (no commission). |
| `tips.min_amount` | 100 | Smallest tip: Mobile-money and cash tips below this amount are refused. |
| `tips.max_amount` | 20000 | Largest tip: Abuse guard: a single tip above this amount is refused. |
| `dispatch.favourite_boost_s` | 240 | Favourite driver boost: A passenger's favourite driver is ranked as if this many seconds closer. 0 switches the boost off. Blocked drivers are always excluded. |
