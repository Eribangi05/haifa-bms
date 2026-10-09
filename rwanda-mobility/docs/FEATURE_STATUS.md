# Feature status

Labels (assigned by evidence, not intent):

* **TESTED** - implemented and exercised by automated tests that pass: `backend` 154 integration/unit tests against real PostgreSQL (including a fuzz-style smoke sweep of every route with six identities; the count is of `test(...)` cases in `backend/tests`); `mobile` 29 unit tests (network layer and outbox, formatting/dates, trip and payment state logic, error mapping, request-code parsing); seven browser end-to-end scripts in `mobile/e2e` (passenger, driver, Abasare, languages, responsive layouts, venue QR, layout/insets/back across 6 phone sizes) that drive the real React Native screens against a live backend; and four browser scripts for the operations console in `backend/scripts` (see the Admin rows).
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
| Mobile screens (owner and driver) | TESTED in browser e2e (web build, incl. simulated notch/gesture-bar insets); **not run on a device** (see `AUDIT_MOBILE.md`) |
| Mobile Round 1 (trusted contacts, share management, tags + tips, favourites/blocked, safety check prompt, badges, navigation hand-off, driver ETA, dark mode, large text, app lock, low-data) | TESTED in browser e2e (`mobile/e2e/r1-e2e.mjs`, rw + fr) and unit tests; **not run on a device**: biometric app lock, OS share sheet, Google Maps/Waze hand-off, push tap routing and map-tile skipping are untested on hardware. Favourite/block buttons on a finished trip need the driver id in the passenger booking view (not yet exposed by the server) |
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
| | Loyalty points (earn per trip, Bronze/Silver/Gold from settings, redeem for credit) | TESTED, see Round 3 rows below. Subscriptions: NOT BUILT |
| Admin | KPI dashboard, drivers, bookings, support, safety, pricing, finance, privacy, settings, audit, staff | TESTED (APIs) + browser audit of every tab for every role (see above) |
| | Console shell: role-based menu (a tab is shown only when the role holds the permission the API needs, mirror of `rbac.ts` checked by test), responsive drawer menu, breadcrumbs, light/dark theme, loading/empty/error states, sign-in page with explanation when the session expires | TESTED in browser |
| | Dashboard: needs-attention cards, KPIs with change vs the previous period, 7-day sparklines, zone table with names, period selector | TESTED (numbers compared with SQL over a fixed window; sparklines rendered). **Known data caveat**: "Active bookings" counts bookings *created in the selected period* that are not finished |
| | Tables: sticky header, sort, row filter, 50-row pages, CSV of the rows shown (formula-injection safe); finance CSV exports with a date range | TESTED in browser |
| | Finance sub-pages: ledger and exports, transactions (status/method filters), refunds, payouts, **cancellation fee debts with waiver**, reconciliation (validated input) | TESTED for load, validation and export; money-moving buttons (approve, pay, waive) are covered by the API tests, **not clicked** by the browser scripts |
| | Staff: invite by link, revoke sessions, disable / re-enable (disabled staff cannot sign in) | TESTED in browser |
| | Settings page: grouped, labelled, units/ranges, default + reset-to-default, last change from audit, legacy keys under Advanced | TESTED (API) + browser e2e |
| | Services screen: enable per zone, rename (rw/fr/en), seats | TESTED (API); screen rendered in browser e2e |
| | Live map (self-hosted Leaflet, OpenStreetMap tiles, 5 s refresh that stops when you leave the page, driver and booking tables under the map, notice when tiles are blocked) | TESTED in browser (`admin-console-e2e.ts`: renders, tile failure notice); **driver and booking markers were not exercised with live traffic** (no driver was online during the run) |
| Mobile | Auth, home, options, track, pay, rate, history, profile, support, SOS, driver onboarding/home/offers/trip/earnings (React Native, Android); audited: safe-area insets and visible Back on every screen, permission recovery, localised errors, offline start, driver location kept alive across screens | IMPLEMENTED (type-checked; web build e2e; **not run on a device**) Round 3 (credit and loyalty screen with statement and tier ring, pay with credit full/partial in Options, receipt lines for credit and deposit, Abasare deposit step with MoMo/credit pay, retry and refund messages, claims: file with photos, list, detail with timeline/evidence/before-after/decision/settlement, driver reply, withdraw, more-info flow, USSD info card): IMPLEMENTED; unit-tested (`tests/moneyFmt.test.ts`) and exercised in the web build by `mobile/e2e/r3-e2e.mjs` (rw and fr) against a local backend with the MoMo SIMULATOR; **not run on a device**; staff steps in that script use the backend services directly, not the admin console; credit cannot be applied after a trip (only at booking, per the API); no insurer or real USSD network involved |
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

### Round 1: safety, trust, tips, low data: see `FEATURE_ROUND1.md`

| Feature | Status |
|---|---|
| Trusted contacts auto-notified on trip start / arrival, per-contact language, opt-outs | TESTED (SMS delivery SIMULATED until a provider is connected) |
| Live share v2 (ETA, vehicle, revoke one, expiry trip end + 1h, auto-refresh page in rw/fr/en) | TESTED |
| Tagged ratings, tips (MoMo tip as payment kind `tip`, balanced ledger, 100% to driver; cash tip informational) | TESTED (MoMo SIMULATED) |
| Favourite and blocked drivers (dispatch exclusion and boost) | TESTED |
| Route deviation and long-stop "Are you OK?" checks, escalation to sensitive case + incident | TESTED (push/SMS SIMULATED; corridor is straight-line with road-factor allowance, not validated on real GPS traces) |
| Abasare owner tags and computed badges, audited training grant | TESTED |
| Low-data mode: gzip, ETag/304, `lite=1` | TESTED |
| Navigation hand-off links and live driver ETA | TESTED (deep links not opened on a device) |
| Admin "Trust and safety" tab | IMPLEMENTED (loaded by the audit script for every role; see report) |

## Round 2: growth and partners (see `FEATURE_ROUND2.md` for the endpoint contract)
| Area | Feature | Status |
|---|---|---|
| Rides | Ride for someone else (`for_guest`): guest SMS in the booker's chosen language with driver, plate, PIN and live-share link on assignment and arrival, cancellation SMS, driver sees first name and may fetch the number only during the active trip (logged), abuse limits, retention purge of name and phone | TESTED (API). **SMS delivery SIMULATED** |
| | Recurring rides (`/ride-schedules`): CRUD, pause/resume/skip-next/accept-price, idempotent booking job with re-quote, price-tolerance and no-coverage notices instead of blind booking | TESTED incl. restart/lost-claim, concurrent ticks and time travel. Push/SMS of the notices SIMULATED |
| Pricing | Fixed-price routes: automatic labelled option (rw/fr/en lines), bidirectional, validity, tax and commission as normal fares, admin CRUD with maker-checker and audit | TESTED. The 4 seeded routes are **PLACEHOLDER prices and INACTIVE** |
| Drivers | Quests and bonuses (trips, earnings, streak, peak hours; daily/weekly; budget cap): progress, history, ledger credit exactly once, admin CRUD with budget usage | TESTED incl. concurrency on the last budget unit. The 3 seeded quests are **PLACEHOLDERS and INACTIVE**; peak hours setting is a placeholder |
| | Demand heat map (driver and admin): 500 m cells, 3 windows, k=3 distinct requesters, cached, approved online drivers only | TESTED |
| Growth | Campaign manager: segments, three required languages, per-recipient language, marketing opt-in and quiet hours, daily cap, batches, preview, test-send, audit; admin UI with per-language preview | TESTED (API) + browser e2e (editor, count). **SMS and push delivery SIMULATED** |
| Partners | Venue partners and the `partner_manager` role: own codes, requests, monthly statement with row-level isolation; `bill_to_partner` codes billed through the corporate invoice engine; invitation through the staff invite flow; admin and partner console views | TESTED (isolation A vs B, billing, caps, suspension) + browser e2e |
| Console | Tabs: Fixed-price routes, Driver quests, Campaigns, Demand map, Venue partners, Your venue (`views-growth.js`, `views-partner.js`) | TESTED in browser (`scripts/growth-e2e.ts`) |
| Mobile (round 2) | Passenger: "Book for someone else" (Options, Home chip; guest name, phone, SMS language, validation, server limit errors shown inline; guest on Track and History); recurring rides ("Repeat this ride" on Options, Recurring rides screen from Home and Profile with pause/resume/skip next/end/accept new price, next run, last result, price-changed and no-coverage warnings); fixed-price option with a Fixed price badge and itemised fare; marketing opt-in switch in Profile (default off). Driver: guest first name and a Contact guest button (active trip only), Quests & bonuses screen and card on Working (progress ring and bar, deadline, history, celebration, reduce-motion aware), Where to go demand map on the shared Leaflet map (online drivers only, no counts) | TESTED in browser e2e (`mobile/e2e/r2-e2e.mjs`, Kinyarwanda and French, incl. the server-side guest SMS record) and unit tests (`mobile/tests/r2.test.ts`); **not run on a device**. Map tiles were not reachable in the sandbox, so cell drawing on the map itself is visually unverified (the cell list under the map is tested). The in-app campaign inbox is **NOT BUILT** (the contract defines no inbox endpoint; the app does not use `GET /notifications`) |
| Credit (round 3) | Customer credit: ledger liability per user, FIFO lots, statement, credit-only (no cash-in, no cash-out), sources: refund-as-credit, promo, referral, quest/goodwill, claim settlement, loyalty, staff adjustment; optional expiry with reminder; cap; reconciliation against the ledger (also in the bank reconciliation run) | TESTED (`credit.test.ts`) |
| | Pay a booking with credit (`wallet`, `wallet_partial` with cash or MoMo remainder): reserve at booking, apply final fare at completion, release on cancel, top-up for full-credit bookings | TESTED incl. ledger balance |
| | Staff credit adjustment with reason, audit and second approver above a threshold (maker-checker) | TESTED |
| | Loyalty: points per fare, tier bonus and free-cancel perk, redeem in steps of 100 (idempotent, parallel-safe) | TESTED |
| Abasare deposit (round 3) | `abasare.deposit_percent`: booking not dispatched until paid (MoMo via the existing provider layer, or credit); applied to the final fare; refund as credit on cancel; fee kept from deposit after the free window; failure, timeout, double tap, duplicate callback and late success (kept as credit) | TESTED with the MoMo SIMULATOR; real MTN not run |
| Claims (round 3) | Damage/loss/injury/other claims for owner, driver, passenger: state machine, filing window, evidence upload through the existing scanner, handover photos as before/after evidence, right of reply, internal notes, assignment, decision with reason and amount, SLA and reminder timers, settlement as credit or manual payout record with second approver, insurer fields, notifications in rw/fr/en, privacy | TESTED (`claims.test.ts`). Insurer integration: **PENDING** (fields entered by hand). Manual payout is a record of an outside transfer |
| USSD (round 3) | `POST /ussd/callback` (Africa's Talking form and generic JSON), shared secret, IP allow-list, rate limits, stored sessions with expiry and retry safety, menu in rw/fr/en (ride, my trip with PIN, Abasare, help, language), consent step and account creation, `channel='ussd'`, SMS templates, `scripts/ussd-sim.ts` | TESTED against the simulator (`ussd.test.ts`). **No real shortcode, aggregator or network test: PENDING** |
| Console (round 3) | `views-money.js`: Credit & loyalty, Claims (timeline, before/after evidence), USSD channel | TESTED in browser (`scripts/money-e2e.ts`) |
| Admin (round 4) | Staff management: search/filter, edit name/email/roles (several roles per person), disable/enable, remove (soft delete, email freed, audit kept), anonymise, resend invitation, password / two-factor / full reset links, sessions, last login, activity view; safeguards (self-protection, last super admin, super-admin-only actions, no privilege escalation) | TESTED (API + browser e2e) |
| | Data-driven roles and permissions: DB-backed with cache and explicit invalidation, permission catalogue with descriptions, custom roles (clone, edit, delete with reassignment), built-in reset to defaults, server-provided permissions to the console (no static mirror) | TESTED |
| | Editors: places (map pick, CSV import), zones (circle/polygon), driver document rules, help-centre FAQ (moved from code to a table), support priority/SLA per category, feature flags page, notification wording | TESTED (API + browser e2e) |

### Round 5: scale, trust and driver tools

| Feature | Status |
|---|---|
| Geohash cells for nearby drivers and dispatch | TESTED (backend tests GEO-01, GEO-02 and every dispatch test) |
| Remote feature rollout (percentage) and off-switch (`booking.requests` pauses all new requests) | TESTED (R5-01, R5-02); console editor TESTED opening as each role |
| Cancel-and-rebook pause, one promo per phone, fake GPS rejected | TESTED (R5-03, R5-04, FRAUD-01) |
| Staff alerts (sign-ins, mass views, night actions, large credit, bursts) and fraud signal list | TESTED (R5-05); the thresholds are PLACEHOLDERS to confirm |
| Operations dashboard | TESTED (R5-06); numbers checked against test trips, not against real traffic |
| Chat: quick replies, read ticks, unread badge, number sharing | TESTED (R5-07 and browser test round5) |
| Referral rewards, tiers, ambassador list | TESTED (R5-08); reward amounts are PLACEHOLDERS |
| Vehicle application and review queue | TESTED (R5-09, R5-10 and browser test round5) |
| SOS to the owner's number plus console alert | TESTED up to the SMS call; no real SMS provider connected (PENDING INTEGRATION) |
| Own road router, fares from real road distance, turn-by-turn navigation | TESTED (R5-12, R5-13, browser test round5); not driven on a road with a phone; no voice, no live traffic |
| Offline map of Kigali and saved copies of screens | TESTED in a browser (199 map pieces saved; map drew with the map file blocked; Trips tab showed the saved copy); not tested on Android |
| Compiled production server (`node dist/server.js`) | TESTED locally (health, console, map, ready); the Docker image build runs in CI |


## Request notification sounds (0.9.1)

* **TESTED**: the in-app alert logic (rings on a new request, stops on accept/reject/empty list/background; unit tests), the push message mapping (request → channel `offers_v2` with `offer.wav`, chat → `messages_v1` with `ping.wav`; backend test SOUND-01), and a browser end-to-end check that the app asks for the request sound when an offer arrives.
* **PENDING on a real phone**: hearing it (a browser test cannot hear audio), and ringing while the app is closed, which needs Firebase/Expo push credentials. An Android channel's sound is fixed when the channel is first created, which is why the channel is named `offers_v2`: on a phone with the app already installed the new channel is created at first launch of this version.
* Riders and drivers can turn request and chat sounds off in Settings > Appearance > Sounds; there is a test button.

## Console and 0.9.2 items

* **TESTED** (backend tests, browser audit of every console page for every role): pulse and digest endpoints (R5-20); the console in rw/fr/en (checked in a browser for the menu and the overview page); live alert badges and tab title; phone card layout (333 cells labelled on the bookings page); installable shell (service worker registers).
* **IMPLEMENTED, not heard**: the console alarm and ping sounds (Web Audio, need one click to allow sound), the phone's text-to-speech for spoken directions (unit-tested cue timing only; a real phone and, for Kinyarwanda, an installed Kinyarwanda voice are needed to hear it).
* **TESTED**: rush-hour speeds and turn-restriction loading (MAP-05), document pre-check (DOC-01 and a mobile unit test).
* **Translations**: console rw/fr (about 2,600 texts) and the new app strings are written by the assistant and need a native-speaker review before launch. `console-lang-check.ts` found no English left on any page in either language except names typed by people and the multi-language record editors.
* **Naming**: one driver is an Umusare, several are Abasare (see `docs/BRAND.md`); the app, notifications and console were changed accordingly.

## Village and district search (0.9.1)

* **TESTED**: `localities.json` search and `GET /places/reverse` (backend test MAP-04), "Near {place}" pickup naming wired in the passenger home screen (type-checked; not field-checked in the countryside).

## Flexible dates, times and preferences (0.9.3)

* **TESTED**: the calendar and clock pickers (pure logic: `tests/calendar.test.ts`; browser: `e2e/pickers-e2e.mjs` schedules a ride with the calendar and the clock, past and too-far days cannot be chosen, 12-hour clock and the largest text size apply); document expiry, licence date and repeat-ride dates and times use the pickers (driver and Abasare browser scripts pick dates with the calendar); shortest notice for a scheduled trip and the quick hire lengths are settings (R5-21).
* **App**: nobody types a date or a time any more. Hire length, trip-share duration and app-lock delay can be stepped or typed in any whole number within limits; text size has four levels; the clock can be 24-hour or 12-hour; the week can start on Monday or Sunday; sound volume and vibration can be changed.
* **Console**: native calendar and clock inputs everywhere a date or time is asked, a custom date range next to the fixed periods, and a Display menu (text size, table density, time format, landing page, rows per page, refresh intervals). The operations dashboard and USSD pages accept only "last N hours/days" from the server, so their custom range takes a start date only.
* **Not changed on purpose**: staff-alert polling (15 s) is fixed; server limits on the Bookings and Audit row counts.

## Phone numbers from any country (0.9.3)

* **TESTED**: a country picker (239 countries and territories, names in Kinyarwanda, French and English, calling code and flag, search by name in any language or by code, popular countries first, the last choice remembered) on sign-in, trusted contacts and the "ride for someone else" form; numbers are stored as E.164. Unit tests (`tests/phone.test.ts`), server tests (R5-22) and a browser run that signs in with a Ugandan number chosen from the list.
* **Server**: `normalizeAnyPhone` accepts a Rwandan number in any local form or an international number with "+" or "00"; migration `020_international_phones.sql` relaxes the phone checks of users, trusted contacts and SMS opt-outs. Mobile-money numbers (payout, pay-by-MoMo, deposits, tips), fleet invitations and USSD stay Rwandan on purpose.
* **Not verified**: whether the SMS provider delivers one-time codes to every country (it depends on the provider and its price list; a real provider is still to be connected), national number lengths per country are only range-checked (4 to 12 digits), and the Kinyarwanda country names need a native-speaker review. The country data is generated by `scripts/data/gen-countries.mjs` from `scripts/data/dial-codes.json` and `country-rw.json`.
