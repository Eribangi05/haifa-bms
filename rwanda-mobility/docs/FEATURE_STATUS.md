# Feature status

Labels (assigned by evidence, not intent):

* **TESTED** - implemented and exercised by automated tests that pass: `backend` 88 integration/unit tests against real PostgreSQL (including a fuzz-style smoke sweep of every route with six identities); `mobile` 10 tests of the network layer; and two browser end-to-end scripts (32 steps) that drive the real React Native screens against a live backend.
* **IMPLEMENTED** - code exists and type-checks (and the Android bundle compiles) but has **no automated or on-device test**.
* **SIMULATED** - works against a local stand-in, not the real external system.
* **PENDING INTEGRATION** - needs third-party credentials/approval or a build-out not done here.
* **NOT BUILT** - deliberately deferred.

## What I could and could not verify

| Verified | Not verified |
|---|---|
| All backend business rules via integration tests; a smoke sweep that calls every registered route (800+ calls, six identities, junk bodies) and asserts no 5xx | **The Android app has not been run on a device or emulator** (no KVM in the build environment, so no emulator). Native-only behaviour is unverified: the WebView map, permission prompts, camera, SecureStore, `geo:` navigation hand-off, back button, layout on real small screens. |
| The app's real screens run end to end in Chromium (via react-native-web) against a live server: **passenger** journey (language, OTP, consent, landmark, prices, confirm, assignment, PIN, SOS, completion, cash, rating through the offline outbox, history, offline booking queued then sent exactly once) and **driver** journey (apply, upload 5 documents through the file picker, submit, review, consent, online, GPS heartbeat, offer with earnings, accept, arrive by GPS, wrong/correct PIN, complete, cash, earnings, offline) | The web build uses a different storage/dialog/map path from native (guarded by `Platform.OS`); passing on web does not prove the native build |
| Admin console renders and works against a live server (Chromium, real login with TOTP) | MTN's real sandbox/production: **no call has been made** (no credentials); payment logic is verified against an in-repo simulator |
| Android **release APK builds** (Gradle, Hermes, R8): package `rw.mobility.app`, arm64, ~28 MB, debug-signed | iOS build; Play Store packaging; load, penetration and accessibility testing; a native-speaker review of the Kinyarwanda copy |

> **Bugs found by the UI end-to-end run that unit/API tests had missed** (now fixed and covered by regression tests): `GET /drivers/me/earnings` returned HTTP 500 (reserved SQL alias); an empty JSON body on action endpoints (`/accept`, `/arrived`...) was rejected by the server; a deletion request locked users out of their own session. Treat first device testing the same way: expect findings.

## Matrix

| Area | Feature | Status |
|---|---|---|
| Identity | Phone OTP sign-up/sign-in, expiry, attempts, cooldown, hourly caps | TESTED |
| | OTP SMS delivery | SIMULATED (console) / IMPLEMENTED (generic HTTP gateway, untested against a real gateway) |
| | Refresh rotation, reuse detection, logout, device list/revoke | TESTED |
| | Staff password + mandatory TOTP, lockout | TESTED |
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
| | Negotiated fares | NOT BUILT (flag reserved) |
| Booking | State machine, transitions, events, idempotency, one-active-trip constraints | TESTED |
| | Scheduled rides (release by sweeper) | TESTED |
| | Cancellation rules (grace, fee recorded, driver/platform fault) | TESTED |
| | **Cancellation fee collection** | NOT BUILT (fee recorded only) |
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
| Notifications | In-app + SMS queue with retries, rw/en templates, admin overrides | TESTED (queueing) / SIMULATED (delivery) |
| | Push (FCM), WhatsApp | PENDING INTEGRATION |
| Corporate | Accounts, members, policies, limits, isolation, statements, invoices | TESTED |
| Fleet | Fleet, invites, revenue share, isolation, vehicle availability, earnings | TESTED |
| Growth | Promotions (budget, limits, first-ride), referral rewards, self-referral block | TESTED |
| | Loyalty points, subscriptions | NOT BUILT |
| Admin | KPI dashboard, drivers, bookings, support, safety, pricing, finance, privacy, settings, audit, staff | TESTED (APIs) + exercised in a browser smoke test |
| | Live map | IMPLEMENTED (needs map tiles) |
| Mobile | Auth, home, options, track, pay, rate, history, profile, support, SOS, driver onboarding/home/offers/trip/earnings (React Native, Android) | IMPLEMENTED (type-checked, APK built; **not run on a device**) |
| | Same screens as a responsive **web** build (`npm run web:export`) | TESTED (browser e2e, 32 steps) |
| | Network layer: retry/backoff, idempotency keys, single-flight refresh, persistent outbox | TESTED |
| | iOS | NOT BUILT/UNTESTED (code is shared; no iOS build produced) |
| | Background location | NOT BUILT (foreground only; disclosed) |
| Ops | Health/ready endpoints, jobs, retention, structured logs | IMPLEMENTED |
| | Backups, monitoring, alerting | operator task (documented) |
