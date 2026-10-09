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

## Still to build later (feasible, not done yet)

* Offline cache of the Kigali map and of history/wallet screens.
* Road routing (OSRM or Valhalla) for accurate fares; today the fare uses a calibrated straight-line estimate when no routing server is configured.
* In-app chat and number masking; richer fraud checks (promo abuse per device, cancel-and-rebook loops).
* Spatial index (PostGIS or geohash) once there are thousands of online drivers.
* Compiled production build instead of running TypeScript through `tsx`.
