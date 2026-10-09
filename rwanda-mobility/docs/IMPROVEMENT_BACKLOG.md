# Improvement backlog (honest status)

Result of a full review of the app, and what has been done about each point. "Done" means implemented and covered by an automated test or a browser test.
"Needs you" means it cannot be finished without an account, a payment, a real device or a business decision.

## Done (needs no payment or outside account)

| Area | Improvement | Evidence |
|---|---|---|
| Place search | Offline search over about 5,000 named OpenStreetMap places (areas, hospitals, schools, hotels, markets, banks, bus stations). Ignores accents, matches word starts, ranks nearby places first, merged with the curated list. Works on the free plan. | `MAP-03`, `MAP-04` tests; `scripts/map/places.py` |
| Rural map | Self-hosted Rwanda vector map (earlier step). | `docs/MAP.md` |
| Uploads on the free plan | `STORAGE_DRIVER=db` keeps documents and photos in PostgreSQL, so redeploys no longer lose them (Render blueprint now sets it). | `STORE-01` test |
| Fake GPS | A phone that reports a mocked location is rejected (not used for dispatch, fares or tracks), the driver is flagged in the audit log and drops out of dispatch. | `FRAUD-01` test |
| Dispatch speed | Nearby-driver query now filters by a bounding box in SQL before the exact distance check. | all 294 backend tests |
| Dispatch reliability | Location freshness window raised from 60 to 90 seconds (adjustable in the console) so a weak network does not show "no drivers". | `dispatch.heartbeat_max_age_s` |
| Regression safety | Browser tests (booking, driver, brand) added to CI as an `e2e` job (informational until it has a green history). | `.github/workflows/rwanda-mobility-ci.yml` |
| Backups | `scripts/restore-test.sh` dumps a database, restores it into a scratch database and compares row counts. Run here: 98 tables, identical. | script output |
| Load | `scripts/loadtest.mjs` measured the hot read paths (see `PERFORMANCE_NOTES.md`). Place search was 2x faster after caching. | measured |
| Web map | The map showed blank in the web build (worker blocked in a srcdoc frame) and the page never sent "ready". Both fixed. | e2e step "Rwanda map draws vector tiles" |

## Corrections to my earlier review

* **Accessibility is better than I said.** Every pressable already has a role and the shared button, header and progress components carry labels. A native screen-reader pass on a phone is still outstanding.
* **Crash reporting exists.** The app posts client errors to the API and the console shows them (`diagnostics.view`). It is not a hosted service such as Sentry, but it works at no cost.
* **A load test already existed** (`backend/scripts/loadtest.ts`); the new script adds the place-search paths.

## Needs you (account, payment, device or business decision)

1. Real SMS provider for OTP (`SMS_PROVIDER=http` plus the provider URL and key).
2. Push notifications (Firebase project and Expo credentials), then `PUSH_PROVIDER=expo`.
3. MTN MoMo: sandbox keys now, live agreement later.
4. Paid Render database (the free one expires after 30 days) and a persistent disk or bucket for real driver documents.
5. Tariffs, night window and commission: confirm the real numbers.
6. Regulatory items and insurance for Abasare (`REGULATORY_AND_INTEGRATION_DEPENDENCIES.md`).
7. A field test on real Android phones, then on an iPhone (needs the Apple Developer Program for the native iPhone app).
8. Native-speaker review of the Kinyarwanda and French texts.
9. Rotate the old `index.php` database password.

## Round 5 (done): the 14 items that needed no account or payment

| # | Item | Result |
|---|---|---|
| 1 | Offline cache of the Kigali map and of history, credit and earnings screens | Map: pieces cached on use and saved in advance for Kigali (199 pieces, drew with the map file blocked). Screens: saved copy with an age note. |
| 2 | Spatial index for nearby drivers | Geohash cells on the driver row (indexed); nearby lookups and dispatch read only the cells around the pickup. |
| 3 | In-app turn-by-turn navigation | Own road router over OpenStreetMap, navigation screen, rerouting. No voice. Another navigation app stays one tap away. |
| 4 | Vehicle application for an approved Abasare driver | Screen, documents, send for review, console approval, notifications. |
| 5 | Chat between rider and driver, numbers hidden by default | Quick replies, read ticks, unread badge, push once a minute; a number is shown only after the other person shares it for that trip. |
| 6 | Fraud: promo per phone, cancel-and-rebook | One account per phone per promo; a rider who cancels 3 times in 30 minutes is paused for 15 (settings). Signals listed in the console. |
| 7 | Alerts for suspicious staff activity | Failed sign-ins, token reuse, mass record views, night-time privileged actions, large credit changes, bursts of failed payments or fraud signals, every SOS. |
| 8 | Gradual rollout and remote off-switch | Flags have a rollout percentage, an off message and "send to the apps"; `booking.requests` pauses all new requests. |
| 9 | Compiled production build | `npm run build` then `node dist/server.js`; the Docker image builds in two stages. |
| 10 | Dashboards | Console "Operations dashboard": busy hours, cancellation rate, time to first driver, failed payments. |
| 11 | Driver app: countdown, goal bar, online status | Shrinking countdown on offers, daily goal card, status strip with a pulsing dot. |
| 12 | SOS reaches the support number; faster onboarding | SOS texts the owner's number, raises a critical alert, shows Call and WhatsApp buttons; onboarding tracker, review target and late marker, console review queue. |
| 13 | Referral rewards and ambassador tracking | Paid after the invited rider's first paid trip; bronze, silver, gold with +25% / +50%; rejected for the same phone or the monthly cap; console view. |
| 14 | Split the big files | Locale files renamed by feature (`features/trust`, `growth`, `money`, ...), screens grouped in folders, `docs/MOBILE_CODE_MAP.md`. |

Checked by: 311 backend tests, 79 mobile unit tests, browser tests of the rider and driver flows, the new `e2e/round5-e2e.mjs` (chat, navigation, goal, referral, paused requests, saved copy, vehicle application), and the console opened as every staff role. Not checked: on a real phone, with a real SMS or payment provider, under real traffic.

## Still to build later (feasible, not done yet)

* Voice instructions in navigation, and live traffic.
* Road routing with turn restrictions and time-of-day speeds (the router uses free-flow speed per road class).
* An automatic first check of driver documents (photo quality, expiry reading).
* A hosted map CDN once traffic grows (the map file is served by the API today).

## Added in 0.9.1

* Loud repeating request chime with vibration for drivers, chat ping for both sides, push channels with custom sounds (needs push credentials to work in the background).
* About 19,000 villages, cells, towns and the 30 districts searchable; pickup named "Near {place}".
