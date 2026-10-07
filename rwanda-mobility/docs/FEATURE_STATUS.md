# Feature status

Labels (assigned by evidence, not intent):

* **TESTED** - implemented and exercised by automated tests that pass: `backend` 154 integration/unit tests against real PostgreSQL (including a fuzz-style smoke sweep of every route with six identities; the count is of `test(...)` cases in `backend/tests`); `mobile` 28 unit tests (network layer, formatting, trip logic, request-code parsing); six browser end-to-end scripts in `mobile/e2e` (passenger, driver, Abasare, languages, responsive layouts, venue QR) that drive the real React Native screens against a live backend; and four browser scripts for the operations console in `backend/scripts` (see the Admin rows).
* **IMPLEMENTED** - code exists and type-checks (and the Android bundle compiles) but has **no automated or on-device test**.
* **SIMULATED** - works against a local stand-in, not the real external system.
* **PENDING INTEGRATION** - needs third-party credentials/approval or a build-out not done here.
* **NOT BUILT** - deliberately deferred.

## What I could and could not verify

| Verified | Not verified |
|---|---|
| All backend business rules via integration tests; a smoke sweep that calls every registered route (800+ calls, six identities, junk bodies) and asserts no 5xx | **The Android app has not been run on a device or emulator** (no KVM in the build environment, so no emulator). Native-only behaviour is unverified: the WebView map, permission prompts, camera, SecureStore, `geo:` navigation hand-off, back button, layout on real small screens. |
| The app's real screens run end to end in Chromium (via react-native-web) against a live server: **passenger** journey (language, OTP, consent, landmark, prices, confirm, assignment, PIN, SOS, completion, cash, rating through the offline outbox, history, offline booking queued then sent exactly once) and **driver** journey (apply, upload 5 documents through the file picker, submit, review, consent, online, GPS heartbeat, offer with earnings, accept, arrive by GPS, wrong/correct PIN, complete, cash, earnings, offline) | The web build uses a different storage/dialog/map path from native (guarded by `Platform.OS`); passing on web does not prove the native build |
| The operations console, driven in Chromium with real TOTP logins: **every tab opened as each of the nine staff roles at 1280 px and 768 px** with no failed API call, script error, sideways page scroll or missing title (`scripts/admin-audit-e2e.ts`); table sorting/filtering/CSV, dashboard numbers re-derived from SQL, map without tile access, dark mode, phone menu, form validation, permission gating, staff disable/enable (`scripts/admin-console-e2e.ts`); staff invitation and pricing flows (`admin-invite-e2e.ts`, `admin-pricing-e2e.ts`) | MTN's real sandbox/production: **no call has been made** (no credentials); payment logic is verified against an in-repo simulator |
| The Docker image's start-up path (production-mode install from the lockfile, migrations on an empty database, `/health`, the console and its vendored map library) reproduced step by step outside Docker; Android **release APK builds** (Gradle, Hermes, R8): package `rw.abasare.app`, arm64, ~28 MB, debug-signed | `docker build` itself and the `docker compose` stack (no Docker daemon was available: they are checked by CI and by reading, not run); the CI workflow (not executed on GitHub); the console on a real phone, in Safari or Firefox, or with a screen reader; iOS build; Play Store packaging; load, penetration and accessibility testing; a native-speaker review of the Kinyarwanda copy |

> **Bugs found by the UI end-to-end run that unit/API tests had missed** (now fixed and covered by regression tests): `GET /drivers/me/earnings` returned HTTP 500 (reserved SQL alias); an empty JSON body on action endpoints (`/accept`, `/arrived`...) was rejected by the server; a deletion request locked users out of their own session. Treat first device testing the same way: expect findings.

## Matrix

### Abasare (hire a driver for your own car): see `ABASARE.md`

| Feature | Status |
|---|---|
| Driver application (licence 2+ years, skills, return mode), police-clearance requirement, verifier approval/suspension, no vehicle needed | TESTED |
| Skill-matched dispatch (car class + manual/automatic), "accepting" toggles (rides / Abasare) | TESTED |
| Owner's cars, ownership/insurance attestation, quote bound to the car | TESTED |
| Pricing: drive-me-home (return allowance, night band, minimum), hourly packages, long-hire rate, overtime blocks | TESTED |
| Car check-in/check-out: photos, odometer, fuel, notes; start/complete guards; owner confirm or dispute; urgent sensitive case; 30-minute window | TESTED |
| Photo privacy: signed links, retention purge (90 days, kept while a case is open) | TESTED |
| Corporate booking of Abasare under company policy; scheduled Abasare; document-expiry removal from dispatch | TESTED |
| Moto "ride home" for the driver | TESTED (API: driver books Moto from the drop-off) / IMPLEMENTED (one-tap button) |
| Console: applications queue, approval, handover evidence in booking detail, pricing fields | IMPLEMENTED (API TESTED; not exercised in a browser) |
| Mobile screens (owner and driver) | TESTED in browser e2e (web build); **not run on a device** |
| Pay-before-trip, auto-dispatched return Moto, insurance integration, damage-claim workflow | NOT BUILT (roadmap) |
| Tariffs, night window, commission | PLACEHOLDERS, confirm with the client |
| Insurance/licensing/liability rules | PENDING legal input (see `ABASARE.md` section 6) |

| Area | Feature | Status |
|---|---|---|
| Identity | Phone OTP sign-up/sign-in, expiry, attempts, cooldown, hourly caps | TESTED |
| | OTP SMS delivery | SIMULATED (console) / IMPLEMENTED (generic HTTP gateway, untested against a real gateway) |
| | Refresh rotation, reuse detection, logout, device list/revoke | TESTED |
| | Staff password + mandatory TOTP, lockout | TESTED |
| | Staff invitation by single-use link (own password, own authenticator, secret never shown to the inviter, expiry, revoke), staff disable and session revoke | TESTED (`staffinvite.test.ts`) + browser e2e |
| | Lost authenticator recovery by environment variables (`ADMIN_MFA_RESET_EMAIL` / `ADMIN_MFA_RESET_TOKEN`, once per token, audited) | TESTED |
| | Languages: Kinyarwanda, French and English across the app, server messages, SMS/push templates, share page and catalogue; staff console English only | TESTED (`i18n.test.ts`, `mobile/e2e/i18n-e2e.mjs`) |
| | Suspicious registration (device velocity) | TESTED |
| | Profile, language, notification prefs, saved places, emergency contacts | TESTED |
| | Account deactivation (admin/user request) | IMPLEMENTED |
| | Deletion + access request workflow, anonymisation | TESTED |
| | Email verification | NOT BUILT |
| | Google / Apple sign-in | PENDING INTEGRATION |
| Catalogue | Moto, Standard car live; Comfort/Family/Airport/Intercity/Goods/Cargo defined but disabled | IMPLEMENTED (enabling requires price + approval) |
| | Availability only with real eligible drivers; coverage polygon check | TESTED |
| Pricing | Fare engine, rounding, minimum, waiting, promo, tax, pass-through, surge cap (off) | TESTED |
| | Maker-checker fare and commission changes; immutable accepted quotes | TESTED |
| | Console price editor: labelled fields with units, validation, current-vs-proposed diff, live fare preview (`POST /admin/pricing/preview`, same `computeFare`), copy values to another service/zone, scheduled start date | TESTED (API) + browser e2e (`scripts/admin-pricing-e2e.ts`) |
| | `pricing.self_approval` switch (default off, super admin only): proposer may approve own fare/commission change, flagged `self_approved` in audit, red banner in the console | TESTED |
| | Peak / off-peak windows per pricing rule (day-of-week + hour range, -50%..+100%, capped by the rule surge cap), own itemised rw/fr/en receipt line | TESTED (engine + estimates) |
| | Negotiated fares | NOT BUILT (flag reserved) |
| Booking | State machine, transitions, events, idempotency, one-active-trip constraints | TESTED |
| | Scheduled rides (release by sweeper) | TESTED |
| | Cancellation rules (grace, fee recorded, driver/platform fault) | TESTED |
| | **Cancellation / no-show fee collection**: fee becomes a ledger-backed passenger debt (`passenger_debts`), shown as `previous_cancellation_fee` (rw/fr/en) on the next quote, collected with the next cash or MoMo payment and settled idempotently; staff waiver (reason, audited, permission `finance.waive_fee`); never billed to a company | TESTED (cash and MoMo-simulator paths, concurrency, ledger balance). Caveat: a full refund of the paying trip does not re-open the fee |
| | Trip PIN, lockout, logged override | TESTED |
| | Arrival geofence (500 m, fresh GPS) | TESTED |
| | Live driver position via polling | TESTED (API) / IMPLEMENTED (app) |
| | In-app chat | TESTED |
| Dispatch | Eligibility incl. documents, vehicle, heartbeat freshness, zone, safety blocks | TESTED |
| | Sequential / group offers, radius expansion, timeouts, no-driver outcome | TESTED |
| | Fair ranking, excused rejections | TESTED (unit + integration) |
| | Manual assign / reassign | TESTED |
| | Road-network ETA | IMPLEMENTED (OSRM adapter, untested in CI); default is an estimate |
| Drivers | Application, document upload validation, review, approve/reject/suspend/reinstate | TESTED |
| | Expiry auto-ineligibility and reminders | TESTED |
| | Fleet invites and affiliation | TESTED |
| | Identity/licence verification API | PENDING INTEGRATION |
| Payments | Cash due/collected/partial | TESTED |
| | MoMo flow: initiate, verify by provider status, idempotent callbacks, mismatch, timeout/late success | TESTED against SIMULATED provider |
| | MTN sandbox / live | PENDING INTEGRATION (adapter written to MTN's documented API) |
| | Airtel Money | PENDING INTEGRATION (stub) |
| | Corporate billing + invoices | TESTED |
| | Prepaid wallet, cards | NOT BUILT (legal review) |
| Finance | Double-entry ledger, balance trigger, immutability | TESTED |
| | Commission (percent/fixed/specific/exempt), fleet share, earnings | TESTED |
| | Refunds (maker-checker), clawbacks | TESTED |
| | Payouts (min, balance, concurrency, netting, large-payout controls) | TESTED |
| | Automated payout disbursement | PENDING INTEGRATION |
| | Reconciliation + exceptions, CSV exports | TESTED |
| Safety | SOS (records, never over-claims), share links, safety blocks, incidents | TESTED |
| | Masked calling | PENDING INTEGRATION |
| Support | Cases, SLA, priorities, sensitive scoping, internal notes, search by ref/payment/phone, CSAT | TESTED |
| Notifications | In-app + SMS queue with retries, rw/fr/en templates (three languages, never mixed), admin overrides | TESTED (queueing) / SIMULATED (delivery) |
| | Push backend: token registry (`/users/me/push-token`), time-critical kinds queue a localised push, retries, Expo adapter with batching and receipt handling (revokes `DeviceNotRegistered` tokens) | TESTED against a fake adapter and a stubbed `fetch`; default `PUSH_PROVIDER=none` is SIMULATED (log only) |
| | Push delivery to real devices (`PUSH_PROVIDER=expo`) | PENDING INTEGRATION (no Expo/FCM/APNs account used; the mobile app now registers tokens, see the Mobile rows) |
| | WhatsApp | PENDING INTEGRATION |
| Diagnostics | Client error reporting (`POST /client-errors`, scrubbed, rate limited, 30-day retention, admin list `GET /admin/client-errors`) | TESTED (no third-party service; there is no alerting or aggregation) |
| Uploads | Strict magic-byte and structure validation (JPEG/PNG/PDF), polyglot and script-marker rejection, dimension sanity, pluggable `scanFile` hook | TESTED |
| | ClamAV scanning (`CLAMAV_HOST`, INSTREAM client) | TESTED against a fake clamd socket; **no real ClamAV daemon was run** |
| Abuse | Per-route rate limits (OTP, client errors, uploads, bookings, payments, estimates) | TESTED |
| Public share page | Trip-share web page localised rw/fr/en (`?lang=` or `Accept-Language`) | TESTED |
| Request codes | Venue QR codes: public resolve `GET /request-codes/:code`, landing page `/r/:code` (rw/fr/en, XSS-safe), booking attribution (`request_code`), scan counting | TESTED |
| | Admin: create/list/edit/deactivate, QR download (SVG/PNG 1024 px), `codes.view`/`codes.manage`, audited | TESTED (API) |
| | Admin-web tab: create form (validation, optional expiry), QR download, activate/deactivate, A5 trilingual print poster | TESTED in browser (create, validation, QR PNG download, deactivate); the print poster and the geolocation button are IMPLEMENTED but not exercised (they open a print window / ask for location) |
| | Mobile: `scan` screen (in-app QR camera, typed code or full URL), `abasare://r/<CODE>` deep link (pending code kept across sign-in), venue confirmation card, Home prefilled (pickup = venue, default service), `request_code` sent with the booking | IMPLEMENTED; parser + pending-code unit-tested; flow (deep-link-equivalent `?code=` on web, sign-in, prefill, booking stored with `request_code_id`, typed bad code in rw/fr/en) browser-e2e TESTED (`e2e/scan-e2e.mjs`). **Camera scanning and the Android deep link/intent filter have not been run on a device** |
| Performance | Small load test (`scripts/loadtest.ts`) on a single dev machine | MEASURED once, see `PERFORMANCE_NOTES.md`; not a capacity test |
| Corporate | Accounts, members, policies, limits, isolation, statements, invoices | TESTED |
| Fleet | Fleet, invites, revenue share, isolation, vehicle availability, earnings | TESTED |
| Growth | Promotions (budget, limits, first-ride), referral rewards, self-referral block | TESTED |
| | Promotion audiences: everyone, first ride, corporate members, referred sign-ups, phone list; start/end dates and budget editable | TESTED |
| | Loyalty points, subscriptions | NOT BUILT |
| Admin | KPI dashboard, drivers, bookings, support, safety, pricing, finance, privacy, settings, audit, staff | TESTED (APIs) + browser audit of every tab for every role (see above) |
| | Console shell: role-based menu (a tab is shown only when the role holds the permission the API needs, mirror of `rbac.ts` checked by test), responsive drawer menu, breadcrumbs, light/dark theme, loading/empty/error states, sign-in page with explanation when the session expires | TESTED in browser |
| | Dashboard: needs-attention cards, KPIs with change vs the previous period, 7-day sparklines, zone table with names, period selector | TESTED (numbers compared with SQL over a fixed window; sparklines rendered). **Known data caveat**: "Active bookings" counts bookings *created in the selected period* that are not finished |
| | Tables: sticky header, sort, row filter, 50-row pages, CSV of the rows shown (formula-injection safe); finance CSV exports with a date range | TESTED in browser |
| | Finance sub-pages: ledger and exports, transactions (status/method filters), refunds, payouts, **cancellation fee debts with waiver**, reconciliation (validated input) | TESTED for load, validation and export; money-moving buttons (approve, pay, waive) are covered by the API tests, **not clicked** by the browser scripts |
| | Staff: invite by link, revoke sessions, disable / re-enable (disabled staff cannot sign in) | TESTED in browser |
| | Settings page: grouped, labelled, units/ranges, default + reset-to-default, last change from audit, legacy keys under Advanced | TESTED (API) + browser e2e |
| | Services screen: enable per zone, rename (rw/fr/en), seats | TESTED (API); screen rendered in browser e2e |
| | Live map (self-hosted Leaflet, OpenStreetMap tiles, 5 s refresh that stops when you leave the page, driver and booking tables under the map, notice when tiles are blocked) | TESTED in browser (`admin-console-e2e.ts`: renders, tile failure notice); **driver and booking markers were not exercised with live traffic** (no driver was online during the run) |
| Mobile | Auth, home, options, track, pay, rate, history, profile, support, SOS, driver onboarding/home/offers/trip/earnings (React Native, Android) | IMPLEMENTED (type-checked, APK built; **not run on a device**) |
| | Same screens as a responsive **web** build (`npm run web:export`) | TESTED (browser e2e) |
| | Network layer: retry/backoff, idempotency keys, single-flight refresh, persistent outbox | TESTED |
| | iOS | NOT BUILT/UNTESTED (code is shared; no iOS build produced) |
| | Driver background location (Android foreground service via expo-task-manager, with prominent disclosure; no ACCESS_BACKGROUND_LOCATION) | IMPLEMENTED (type-checked, Android bundle compiles; inert on web; **not run on a device**) |
| | Push registration (expo-notifications: rationale, channels, token register/unregister, tap routing) | IMPLEMENTED (**not run on a device**; needs EAS project id + FCM config to deliver) |
| | Crash/error reporting (global handlers, error boundary, `POST /client-errors`) | IMPLEMENTED (boundary and web handlers exercised only by build; **not run on a device**) |
| | Abasare first-time explainer; reduce-motion, 44 px targets, localized a11y labels; 320/360 px and zoomed layout pass | TESTED in browser e2e (web build) |
| | Cleartext HTTP off by default (`app.config.js`, flag for dev builds) | IMPLEMENTED |
| Ops | Health/ready endpoints, jobs, retention, structured logs | IMPLEMENTED |
| | Backups, monitoring, alerting | operator task (documented) |
