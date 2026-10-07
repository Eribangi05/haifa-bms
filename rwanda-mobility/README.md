# Abasare (Rwanda Mobility Platform)

A ride-hailing and transport platform for Rwanda (Kigali first): passengers book Moto and car rides, verified drivers accept and earn, **Abasare** drivers drive customers' own cars, companies and fleets manage their transport, and operations staff run everything from a secure web console. The app and console speak Kinyarwanda, French and English (the app never mixes languages; the staff console is English only).

| Part | Folder | Stack |
|---|---|---|
| Backend API + jobs | [`backend/`](backend) | Node 22, TypeScript, Fastify, PostgreSQL |
| Android app (passenger + driver) | [`mobile/`](mobile) | Expo SDK 57, React Native 0.86, TypeScript |
| Operations console | [`admin-web/`](admin-web) | Framework-free JavaScript (plus a vendored copy of Leaflet for the map), served by the backend at `/admin/` |
| Documentation | [`docs/`](docs) | Architecture, API, security, operations, status |
| Deployment | [`deploy/`](deploy), [`../render.yaml`](../render.yaml), [`.github/workflows`](../.github/workflows/rwanda-mobility-ci.yml) | Docker Compose + Caddy, Render blueprint, GitHub Actions CI |

> **Read [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) first.** It says exactly which features are tested, simulated, or still need credentials. In short: the backend is thoroughly tested, and the app's screens pass browser end-to-end journeys against a live server; **payments run against a local simulator until you add MTN credentials; the Android APK builds but has not been run on a device**; and nothing here is regulatory approval.

## 60-second tour

```bash
cd backend && cp .env.example .env && npm install
createdb rwanda_mobility && createdb rwanda_mobility_test
npm run migrate
BOOTSTRAP_ADMIN_PASSWORD='a-long-passphrase' npm run seed     # catalogue + first super admin; prints the authenticator secret once
OTP_DEV_ECHO=true npm run dev                                  # API + console on http://localhost:8080/admin/
npm test                                                       # 154 tests, real PostgreSQL
```
Android: `cd mobile && npm install && EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 npx expo start --android` - see [`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md).

## What it does

* **Passenger**: phone/OTP sign-up (Kinyarwanda, French, English), pickup by GPS/pin/landmark/note, fare estimates with a line-by-line breakdown (including peak-time windows), cash or MTN Mobile Money, live driver tracking, **trip PIN**, trip sharing, SOS, receipts, ratings, history, saved places, referrals, push notifications, and **venue QR request codes** (scan at a hotel or bar to request a ride in two taps). Late-cancellation and no-show fees are collected with the next trip.
* **Driver**: gated onboarding with document upload and review, online toggle separate from permission to work, offers showing **earnings before accepting**, navigation hand-off, PIN start, cash/MoMo collection, earnings and payouts.
* **Abasare**: hire a verified driver to drive **your own car** (drive-me-home or by the hour), with skill-matched dispatch, itemised pricing, a digital car check-in/check-out record and stronger vetting. See [`docs/ABASARE.md`](docs/ABASARE.md).
* **Operations console**: dashboard with KPIs and trends, live map, bookings, driver verification, manual dispatch and PIN override (audited), pricing and commission with two-person approval, services and promotions, request codes (printable QR posters), refunds, payouts, cancellation-fee debts, reconciliation, support cases, safety incidents, privacy requests, audit log, and staff management by one-time invitation link (own password and own authenticator).
* **Companies and fleets**: spending limits, policies, statements, invoices; revenue-share, invites, strict data isolation.
* **Money**: integer RWF, balanced immutable double-entry ledger, idempotent provider-verified payments, cash obligations tracked, daily reconciliation.

## Documentation index (suggested reading order)

**1. Understand the product and what is real**

| Doc | Purpose |
|---|---|
| [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) | What is tested, simulated or pending, with test counts and what could not be verified. Read first. |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements: users, scope, success measures. |
| [`docs/ABASARE.md`](docs/ABASARE.md) | The Abasare own-car hire service: rules, pricing, vetting, open legal questions. |
| [`docs/SCREENS_AND_JOURNEYS.md`](docs/SCREENS_AND_JOURNEYS.md) | Every app and console screen and the key user journeys. |
| [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) | Assumptions and placeholders to confirm with the client (tariffs, commission, thresholds). |
| [`docs/FEATURE_PROPOSALS.md`](docs/FEATURE_PROPOSALS.md) | Ideas for later phases, not built. |

**2. Build, run and test**

| Doc | Purpose |
|---|---|
| [`docs/SETUP_AND_DEPLOYMENT.md`](docs/SETUP_AND_DEPLOYMENT.md) | Local setup, tests, production checklist, jobs and retention. |
| [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md) | Every environment variable and runtime setting, with defaults. Checked against the code in CI. |
| [`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md) | Building the APK/AAB, EAS, push set-up, Play Console declarations, device test plan. |
| [`docs/TESTER_GUIDE.md`](docs/TESTER_GUIDE.md) | One-page guide to hand to people testing the staging APK. |
| [`store/LISTING.md`](store/LISTING.md) | Google Play listing copy (English, Kinyarwanda, French) and asset list. |

**3. How it works inside**

| Doc | Purpose |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modular monolith, guarantees, state machine, money flow, dispatch, pricing, request codes, languages, console structure. |
| [`docs/ERD.md`](docs/ERD.md) | Database diagrams per module, generated from the migrated schema. |
| [`docs/API.md`](docs/API.md) | Every HTTP route (generated: `npm run docs`). |
| [`docs/PERMISSION_MATRIX.md`](docs/PERMISSION_MATRIX.md) | Which role may call what (generated: `npm run docs`). |
| [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md) | Controls, data handling, known limitations. |
| [`docs/MAP_PROVIDER_EVALUATION.md`](docs/MAP_PROVIDER_EVALUATION.md) | Choice of routing and map provider. |
| [`docs/PERFORMANCE_NOTES.md`](docs/PERFORMANCE_NOTES.md) | Load test results and limits. |

**4. Run it day to day**

| Doc | Purpose |
|---|---|
| [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md) | Daily checks, backups and restore, secret rotation, staff accounts and MFA reset, rollback, payment and SOS incidents, monitoring. For the engineer on call. |
| [`docs/SUPPORT_OPERATIONS_GUIDE.md`](docs/SUPPORT_OPERATIONS_GUIDE.md) | For support, dispatch, verification and finance staff: roles, daily routine, common cases, how to change prices. |
| [`docs/EMERGENCY_RESPONSE_PLAYBOOK.md`](docs/EMERGENCY_RESPONSE_PLAYBOOK.md) | What to do when an SOS arrives. |

**5. Before and at launch**

| Doc | Purpose |
|---|---|
| [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md) | Go-live gates: legal, operations, technical, pilot. |
| [`docs/REGULATORY_AND_INTEGRATION_DEPENDENCIES.md`](docs/REGULATORY_AND_INTEGRATION_DEPENDENCIES.md) | Licences, data-protection duties and third-party integrations that still need a decision or a contract. |

**Audit reports** (point-in-time findings, with what was fixed and what remains): [`docs/AUDIT_ADMIN_DOCS.md`](docs/AUDIT_ADMIN_DOCS.md) (operations console, documentation and delivery); [`docs/AUDIT_BACKEND.md`](docs/AUDIT_BACKEND.md) (backend).

## Repository map

```
backend/src/services/   pricing, bookings, dispatch, payments, ledger, finance, auth ... (business logic)
backend/src/routes/     HTTP routes (zod-validated, permission-guarded)
backend/migrations/     SQL schema (constraints, triggers), applied automatically on start
backend/tests/          integration + unit tests (run against PostgreSQL)
backend/scripts/        load test, map evaluation, doc generator, browser end-to-end checks of the console
mobile/src/             lib (net, i18n, state) - screens - ui
mobile/e2e/             browser end-to-end journeys against the web export
admin-web/              operations console (core.js, views-*.js, business.js, app.js, vendor/leaflet)
docs/                   product, architecture, operations and status documents; docs/tools/ has the ERD generator and the docs checker
deploy/                 docker-compose stack (API + PostgreSQL + Caddy), backup script, environment template
../render.yaml          Render blueprint (staging)
../.github/workflows/   CI: backend, mobile, web export, console and docs checks, Docker image smoke test
```

## Checks you can run

```bash
node docs/tools/check-docs.mjs                                  # markdown links, README coverage, env vars vs code/render/compose
DATABASE_URL=... node docs/tools/gen-erd.mjs                    # regenerate docs/ERD.md from the migrated database
cd backend && npm run typecheck && npm test                     # 154 backend tests
cd mobile && npm run typecheck && npm test                      # 28 mobile unit tests
# console browser checks (start a server first, then): API_ORIGIN=http://localhost:8092 DATABASE_URL=... node --import tsx scripts/admin-audit-e2e.ts
#   scripts/admin-audit-e2e.ts (every tab as every role), admin-console-e2e.ts (behaviour), admin-invite-e2e.ts, admin-pricing-e2e.ts
```

## Before you launch

Complete the checklists in [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md), [`docs/REGULATORY_AND_INTEGRATION_DEPENDENCIES.md`](docs/REGULATORY_AND_INTEGRATION_DEPENDENCIES.md) and [`docs/SETUP_AND_DEPLOYMENT.md`](docs/SETUP_AND_DEPLOYMENT.md): licences, data-protection obligations, tariffs, MTN production onboarding, SMS gateway, insurance, emergency arrangements, a pilot with verified drivers.
