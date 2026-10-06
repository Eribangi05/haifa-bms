# Rwanda Mobility

A ride-hailing and transport platform for Rwanda (Kigali first): passengers book Moto and car rides, verified drivers accept and earn, companies and fleets manage their transport, and operations staff run everything from a secure web console.

| Part | Folder | Stack |
|---|---|---|
| Backend API + jobs | [`backend/`](backend) | Node 22, TypeScript, Fastify, PostgreSQL |
| Android app (passenger + driver) | [`mobile/`](mobile) | Expo SDK 57, React Native 0.86, TypeScript |
| Operations console | [`admin-web/`](admin-web) | Dependency-free SPA served by the backend at `/admin/` |
| Documentation | [`docs/`](docs) | Architecture, API, security, operations, status |

> **Read [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) first.** It says exactly which features are tested, simulated, or still need credentials. In short: the backend is thoroughly tested, and the app's screens pass two browser end-to-end journeys (passenger and driver) against a live server; **payments run against a local simulator until you add MTN credentials; the Android APK builds but has not been run on a device**; and nothing here is regulatory approval.

## 60-second tour

```bash
cd backend && cp .env.example .env && npm install
createdb rwanda_mobility && npm run migrate
BOOTSTRAP_ADMIN_PASSWORD='a-long-passphrase' npm run seed     # prints the admin TOTP secret once
OTP_DEV_ECHO=true npm run dev                                  # API + console on http://localhost:8080/admin/
npm test                                                       # 106 tests, real PostgreSQL
```
Android: `cd mobile && npm install && EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 npx expo start --android` - see [`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md).

## What it does

* **Passenger**: phone/OTP sign-up (Kinyarwanda + English), pickup by GPS/pin/landmark/note, fare estimates with a line-by-line breakdown, cash or MTN Mobile Money, live driver tracking, **trip PIN**, trip sharing, SOS, receipts, ratings, history, saved places, referrals.
* **Driver**: gated onboarding with document upload and review, online toggle separate from permission to work, offers showing **earnings before accepting**, navigation hand-off, PIN start, cash/MoMo collection, earnings and payouts.
* **Abasare**: hire a verified driver to drive **your own car** (drive-me-home or by the hour), with skill-matched dispatch, itemised pricing, a digital car check-in/check-out record and stronger vetting. See [`docs/ABASARE.md`](docs/ABASARE.md).
* **Operations**: KPIs, live map, driver verification, manual dispatch and PIN override (audited), pricing and commission with two-person approval, refunds, payouts, reconciliation, support cases, safety incidents, privacy requests, audit log.
* **Companies and fleets**: spending limits, policies, statements, invoices; revenue-share, invites, strict data isolation.
* **Money**: integer RWF, balanced immutable double-entry ledger, idempotent provider-verified payments, cash obligations tracked, daily reconciliation.

## Repository map

```
backend/src/services/   pricing, bookings, dispatch, payments, ledger, finance, auth ... (business logic)
backend/src/routes/     HTTP routes (zod-validated, permission-guarded)
backend/migrations/     SQL schema (constraints, triggers)
backend/tests/          integration + unit tests (run against PostgreSQL)
mobile/src/             lib (net, i18n, state) - screens - ui
admin-web/              operations console
docs/                   PRD, architecture, ERD, API, permissions, security, ops, playbooks, status, assumptions
```

## Before you launch

Complete the checklists in [`docs/REGULATORY_AND_INTEGRATION_DEPENDENCIES.md`](docs/REGULATORY_AND_INTEGRATION_DEPENDENCIES.md) and [`docs/SETUP_AND_DEPLOYMENT.md`](docs/SETUP_AND_DEPLOYMENT.md): licences, data-protection obligations, tariffs, MTN production onboarding, SMS gateway, insurance, emergency arrangements, a pilot with verified drivers.
