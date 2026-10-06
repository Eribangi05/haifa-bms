# Setup and deployment

## 1. Local development

Requirements: Node.js >= 22, PostgreSQL >= 15.

```bash
cd rwanda-mobility/backend
cp .env.example .env              # edit; see ENVIRONMENT_VARIABLES.md
createdb rwanda_mobility && createdb rwanda_mobility_test
npm install
npm run migrate                   # applies migrations/*.sql
BOOTSTRAP_ADMIN_PASSWORD='a-long-passphrase' npm run seed   # zones, services, tariffs, roles, flags + first super admin (TOTP secret printed once)
npm run dev                       # http://localhost:8080  (admin console at /admin/)
npm test                          # 106 tests against a real PostgreSQL test database
npm run typecheck
npm run docs                      # regenerates docs/API.md and docs/PERMISSION_MATRIX.md
```
Add the printed TOTP secret to an authenticator app, then sign in at `http://localhost:8080/admin/`.

With `OTP_DEV_ECHO=true` and `SMS_PROVIDER=console` the API returns / logs the OTP so you can sign in without an SMS gateway. Default `MOMO_MODE=simulator`: phone numbers ending `0000` fail, `9999` stay pending (settle with `POST /api/v1/dev/momo/settle`), anything else succeeds. **Simulated payments are never real money**; the app labels them "test mode".

## 2. Android app

```bash
cd rwanda-mobility/mobile
npm install
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 npx expo start --android   # emulator, dev build
```
See `ANDROID_BUILD.md` for APK/AAB builds (local Gradle or EAS Build).

**Responsive web booking / UI regression test** (same screens via react-native-web):
```bash
cd rwanda-mobility/mobile
EXPO_PUBLIC_API_URL=http://localhost:8080 npm run web:export && (cd /tmp/rm-web && python3 -m http.server 8081 &)
OTP_DEV_ECHO=true npm --prefix ../backend run dev &      # backend must be running
node e2e/app-e2e.mjs /tmp/shots            # passenger journey, incl. offline recovery
node e2e/driver-e2e.mjs /tmp/shots some.jpg  # driver journey, incl. document upload
node e2e/abasare-e2e.mjs /tmp/shots some.jpg # Abasare: application, car, booking, check-in/out, PIN, cash
```

## 3. Production deployment checklist

1. **Infrastructure**: managed PostgreSQL (daily PITR backups, tested restores), a private object bucket, a small container host (2 vCPU / 2 GB is enough for a pilot), TLS 1.2+ at a reverse proxy/load balancer, a domain (`api.<yours>`), secrets in a manager.
2. **Region/data residency**: confirm with the Data Protection and Privacy Office whether Rwandan personal data may be stored/processed abroad and whether you need registration or authorisation *before* choosing a region (see `REGULATORY_AND_INTEGRATION_DEPENDENCIES.md`).
3. **Config**: `NODE_ENV=production`; strong random `JWT_SECRET`, `DATA_ENC_KEY`, `PIN_SECRET`, `FILE_SIGNING_SECRET`, `MOMO_CALLBACK_TOKEN`; `OTP_DEV_ECHO` unset; `SMS_PROVIDER=http` with a licensed aggregator; real `PUBLIC_BASE_URL`. The server refuses to start in production with default secrets.
4. **Database**: create a non-superuser role; run `npm run migrate` as a deploy step; run `npm run seed` once (idempotent) and then remove bootstrap variables.
5. **Run**: `docker build -f backend/Dockerfile -t rwanda-mobility .` run from the `rwanda-mobility/` directory or `npm ci && npm start` under a process supervisor. Run **one** instance until you move jobs to a dedicated worker (jobs are idempotent but are scheduled in-process).
6. **Health**: `GET /health` (liveness), `GET /ready` (DB reachable). Alert on 5xx rate, `payments` stuck `PENDING` > 15 min, reconciliation exceptions, failed SMS (`notifications.status='failed'`), OTP request spikes.
7. **Backups & DR**: PITR on the database; separate encrypted backup of `DATA_ENC_KEY`; restore drill each quarter; RPO <= 5 min, RTO <= 1 h are realistic targets for this architecture.
8. **Payments**: complete MTN onboarding, put sandbox credentials in staging first, test `requesttopay` + callback end to end, then production credentials. Do not announce live payments until a settlement report has reconciled cleanly (Admin -> Finance -> Reconciliation).
9. **Mobile**: set `EXPO_PUBLIC_API_URL` to the HTTPS API, build a signed AAB with your own keystore, publish to Play Console. Set `usesCleartextTraffic` to `false` in `app.json` for release.
10. **Go-live gates** (do not skip): legal sign-offs, insurance, driver verification SOP trained, emergency playbook rehearsed, support rota staffed, pilot with a few dozen verified drivers.

## 4. Backups, retention, jobs

* Location trail (`driver_locations`) is deleted after `retention.location_days` (default 30). OTP rows after 2 days, unused quotes after 2 days.
* Jobs: dispatch sweep (3 s), payment sweep (30 s), SMS flush (5 s), stale-driver offline (30 s), document expiry reminders + eligibility refresh (hourly), retention (6 h).

## 5. Upgrading a pilot to scale

Move jobs to a worker (pg-boss), add read replica for dashboards, PostGIS for driver search, WebSocket/SSE for tracking, CDN + object storage for documents, per-IP/per-user rate limiting in Redis.
