# Backend audit

Scope: everything under `backend/` (15 route files, 27 services, jobs, migrations 001-007, seed, config, Dockerfile). Method: read every route and service, `grep` for dynamic SQL, secrets in logs, unguarded routes and unused code, `EXPLAIN ANALYZE` on hot queries against a synthetic database (30,000 users, 3,000 drivers, 300,000 bookings, 294,000 payments, 200,000 notifications), boot the real server in production mode (graceful shutdown, config assertions, fresh-database migration), and write a failing test before each fix where that was practical.

Result: typecheck clean (also with `--noUnusedLocals --noUnusedParameters`), **189 tests pass** (was 154; 35 new in `backend/tests/audit.test.ts`, one existing assertion updated because a purged file is now a 404 instead of an `ENOENT` 500). One new migration, `008_audit_hardening.sql` (additive and idempotent, safe to re-run).

Severity: **High** = money, privacy or authorisation could be wrong in normal use; **Medium** = wrong under load, retries or abuse; **Low** = hygiene, resilience or cosmetic.

## 1. Findings

| ID | Sev | Area | Finding | Status |
|---|---|---|---|---|
| F-01 | High | Dispatch | `findCandidates` locked **every** eligible online driver (`for update skip locked`) for the whole round. Two bookings searching at the same moment starved each other: the second saw all drivers locked, got no offers and still burned a dispatch round (toward a false `NO_DRIVER_FOUND`). | Fixed. Candidates are read without locks; only the drivers actually offered are locked (`claimDriver`), with a fresh re-check for an offer or active trip. Test I-01 failed before, passes now. |
| F-02 | High | Reliability | `pg.Pool` had no `error` handler (a database restart or failover crashes the process), no connection timeout, no statement timeout, no idle-in-transaction timeout. | Fixed (`db.ts`): error handler, 5 s connect, 30 s statement, 30 s idle-in-tx, `application_name`. Env-tunable. |
| F-03 | High | Privacy | Account deletion left personal data behind: push tokens, notifications, customer-car and driver-vehicle plates, chat text, rating comments, support messages and evidence, fleet invites, OTP rows, share links, error reports. Uploaded documents were deleted from the table but **the files stayed on disk forever** (a comment claimed the retention worker removed them; it never did). A `SCHEDULED` trip did not block deletion. The access export omitted cars, fees, devices, messages and error reports. | Fixed (`privacy.ts`). Files are removed after commit. Tests D-01, D-02. |
| F-04 | High | Payments | Starting a mobile-money payment while another live payment existed (a different method, or an `INITIATED` row left by a crash between "record" and "send") hit the one-live-payment unique index and returned a raw 500; a crashed `INITIATED` row blocked the booking permanently. | Fixed: `payment_in_flight` 409 while a request is genuinely in flight, abandon rows older than 1 min, sweeper closes `INITIATED` rows after 5 min. Test C-04. |
| F-05 | High | Money | A booking that ended `NO_DRIVER_FOUND` kept the passenger's carried cancellation fee attached to a dead booking: never collected, receivable stuck, and the fee could not be waived. | Fixed: released on `NO_DRIVER_FOUND`, re-attached (or the fare line re-stated) when a dispatcher restarts the search. Tests C-02, C-03. |
| F-06 | High | Authorisation | `POST /admin/users/:id/status` (`users.restrict`, held by `support_lead`) could deactivate **any** account including staff and the super admin, or the caller itself. | Fixed: staff accounts only by a super admin; nobody changes their own status. Test B-04. |
| F-07 | Medium | Auth | Refresh rotation was not atomic: two parallel refreshes with one token produced two valid sessions (a replay the theft detector never saw). | Fixed (conditional update, loser gets 401). Test B-01. Mobile must serialise its refresh calls (see N-09). |
| F-08 | Medium | Auth | OTP attempt cap was check-then-increment: parallel guesses could exceed `otp.max_attempts`. | Fixed (atomic `attempts < max` update). Test B-02. |
| F-09 | Medium | Auth | `users.email` was unique case-sensitively while staff sign-in matches `lower(email)` and takes the first row: a customer could register `Admin@x` next to staff `admin@x` and break or confuse staff sign-in and invites. | Fixed: e-mails are stored lower-case, unique index on `lower(email)` (created only if no case-duplicates exist; otherwise a NOTICE explains). Test B-03. |
| F-10 | Medium | Logging | Access logs contained capability URLs and secrets: `/share/<token>`, `/staff-invite/<token>`, `?token=` on webhooks and signed file links. | Fixed: URL redaction in the request serializer (`redactUrl`). Test A-02. |
| F-11 | Medium | Rate limits | Global limit (300/min) was keyed by IP: everyone behind one mobile-carrier NAT shared it. | Fixed: bucket per **verified** signed-in user, else IP. A forged token cannot buy a fresh bucket. Test A-05. |
| F-12 | Medium | Jobs | Scheduler ticks could overlap themselves (slow DB) and, with two instances, double-run (duplicate SMS and push). No visibility into failing jobs. | Fixed: per-job no-overlap, cluster-wide advisory lock, last-ok tracking surfaced in `/ready` and `/admin/system/health`. |
| F-13 | Medium | Outbox | SMS/push failures were retried on every tick, so 5 attempts were used up in about 25 s; a short gateway outage lost critical messages. | Fixed: back-off 15 s / 1 / 2 / 4 min via `notifications.next_attempt_at`. |
| F-14 | Medium | Error leakage | A provider failure while starting a payment stored the raw error (status codes, response bodies, credential problems) in `payments.failure_reason`, which the passenger sees. | Fixed: passenger sees `provider_unreachable`; detail goes to the staff-only `payment_provider_events`. Test H-01. |
| F-15 | Medium | Privacy | A driver's profile photo was shown to passengers the moment it was uploaded, before staff review. | Fixed: set on approval, withdrawn if the current photo is rejected. Test F-01. |
| F-16 | Medium | Promotions | Per-user and usage limits were checked without a lock: racing bookings (scheduled rides are not covered by the one-open-request index) could redeem a single-use promo twice. | Fixed: promo row locked before the check. Test C-06. |
| F-17 | Medium | Timezone | Reconciliation selected "payments of day D" by the UTC date (payments between 00:00 and 02:00 Kigali land on the wrong day); the corporate monthly budget month began at UTC midnight. | Fixed (Kigali). Test G-01. |
| F-18 | Medium | Idempotency | The same `Idempotency-Key` with a different quote silently returned the other booking. Payout requests and cash collection (partial amounts accumulate!) had no idempotency at all. | Fixed: key reuse for another quote is `409 idempotency_conflict`; optional `Idempotency-Key` on payouts and `cash-collected`. Tests C-09, C-11. |
| F-19 | Medium | Referrals | Reward voucher code used 6 hex characters of the referral id: a collision would violate `promotions.code` and abort the **payment settlement** transaction. | Fixed (8 hex). |
| F-20 | Low | Authorisation | `GET /bookings/:id/events` showed dispatch internals (which drivers were offered) to corporate and fleet viewers. | Fixed: only the driver's own view and staff see them. Test C-01. |
| F-21 | Low | Abuse | No specific limits on: SOS (each one can SMS the escalation contacts), support cases/messages, trip chat, share links, places search (proxies to Nominatim), promo validation, business/fleet creation, member invites, driver enrolment, consents, privacy requests. | Fixed: per-user limits, env-tunable. Test A-06. |
| F-22 | Low | Performance | `/admin/finance/drivers` ran two queries per driver; CSV export, request-code list, business list, applications list, sessions list were unbounded. | Fixed: one aggregate query (equals `driverBalance`, test C-08); caps on all of them. |
| F-23 | Low | CSV | Formula guard prefixed negative **numbers** with a quote and ignored a leading tab/CR. | Fixed. |
| F-24 | Low | Errors | Raw 500s for: file purged from disk, impossible date (`2099-02-30`), unknown `zone_id`, staff-invite activation when the e-mail was registered meanwhile. | Fixed (404 / 400 / 400 / 409). Test D-04. |
| F-25 | Low | Abuse | `client_errors` could be flooded from many addresses; unlimited share links per trip and evidence files per case. | Fixed: 5,000/h ceiling (excess acknowledged and dropped), 10 links, 20 files. Test D-05. |
| F-26 | Low | i18n | Static English sentences in successful responses (SOS result, receipt note, driver enrolment, business/fleet notes) broke the "never mixed" rule. | Fixed: `pickLang` by `Accept-Language`. Test C-10. |
| F-27 | Low | Migrations | Two instances starting together could both apply a migration; DDL ran under the new statement timeout. | Fixed: advisory lock, timeout off inside migrations. Test E-02. |
| F-28 | Low | Shutdown | No pool close, no forced-exit timer, no `unhandledRejection` handler; the image started the server through `npx` so SIGTERM may not reach it. | Fixed (`server.ts`, Dockerfile now `node --import tsx`). Verified by booting and sending SIGTERM: clean exit. |
| F-29 | Low | Retention | `notifications`, ended `sessions` (one row per token refresh), used `staff_invites` and expired `trip_shares` were never purged; large deletes were single statements. | Fixed: new settings `retention.notification_days` (180) and `retention.session_days` (30), batched deletes. Test D-03. |
| F-30 | Low | Indexes | Missing indexes on hot paths and foreign keys (see section 3). | Fixed in migration 008. |
| F-31 | Low | Dead code | 21 unused imports/locals, 4 dead exports (`clientIp`, `PRE_ASSIGN`, `validLatLng`, `useDatabase`), an unused parameter; `admin.ts` imported `seed.ts` for nothing. | Fixed. |
| F-32 | Low | Config | Nothing checked production configuration at boot. | Fixed: `configProblems()` stops the server for `MOMO_MODE=live` without credentials/callback token and `SMS_PROVIDER=http` without URL; warns for simulator, console SMS, localhost base URL, default DB credentials, reused secrets, default sandbox callback token. Sandbox/staging is never blocked. Test A-01. |
| F-33 | Low | Headers | API responses had no CSP; CORS and proxy trust were hard-wired. | Fixed: `default-src 'none'; frame-ancestors 'none'` and `permissions-policy` on API responses; `CORS_ORIGINS`, `TRUST_PROXY` (matches `render.yaml`'s `TRUST_PROXY=1`). Test A-03. |

### Not fixed

| ID | Sev | Area | Finding | Why not fixed |
|---|---|---|---|---|
| N-01 | Medium | Rate limits | OTP and staff-login limits (10/min) are per IP; behind a carrier NAT this can block legitimate sign-ups. The DB-side per-phone/hour cap already protects SMS cost. | Needs a product decision (key by phone+IP, or raise limits); changing it blind weakens abuse protection. |
| N-02 | Medium | Finance | Setting `refund.large_threshold` says large refunds are "flagged for senior approval" but **nothing enforces or flags it**. | Needs a decision on who "senior" is (super admin only?); enforcing it could block operations. Either enforce or remove the setting. |
| N-03 | Medium | State machine | There is no write-off/void path for a completed trip that is never paid (`PAYMENT_PENDING`, `DISPUTED` without a payment): it stays open forever. `CANCELLATION_REQUESTED` and `PAYMENT_REVERSED` are declared but nothing ever enters them. | New business states and ledger postings; not a small safe fix. |
| N-04 | Medium | Performance | `bookingView` runs about 5 queries per booking (a 50-item list is about 250); `getSetting` hits the database on every call (a dispatch round reads 8 settings). Fine at current volume. | Needs batching and a short settings cache; do after the first load test (`scripts/loadtest.ts`). |
| N-05 | Low | Performance | Admin search uses `ILIKE '%q%'` (sequential scan; 54 ms at 300,000 bookings). | Needs `pg_trgm` (superuser extension). |
| N-06 | Low | Timezone | Document expiry uses the database's `current_date` (UTC), so a document expires 2 h late in Kigali time. | Setting the session time zone changes other date casts; low impact. |
| N-07 | Low | Corporate | Monthly spend/budget check is not serialised: two simultaneous company bookings can exceed the budget by one fare. | Needs a per-company lock; small overshoot. |
| N-08 | Medium | Storage | Documents/photos live on local disk (lost on every Render redeploy, as `render.yaml` already warns). | Needs an object store or persistent disk before real uploads. |
| N-09 | Low | Auth | The loser of a refresh race gets 401 `session revoked`; a client that retries refresh in parallel will log the user out. | Mobile must serialise refresh (single-flight). |
| N-10 | Low | Finance | Ledger adjustments (up to 100,000 RWF) are single-person plus audit, no second approver. | Policy decision. |
| N-11 | Low | Auth | A TOTP code can be replayed inside its 90 s window; five bad staff logins lock an account for 15 min (an attacker can lock a known admin out). | Needs per-IP+account throttling and used-code memory. |
| N-12 | Low | i18n | The SOS escalation SMS to staff contacts is English only; it is sent synchronously inside the request instead of the outbox. | Staff language policy undecided; moving it to the outbox changes SOS timing semantics. |
| N-13 | Low | Privacy | `/places/search` forwards user text to public Nominatim (usage policy: 1 req/s, no heavy use). | Needs a self-hosted geocoder before launch. |
| N-14 | Low | Headers | HTML pages (share, venue landing, admin-web static files) have no CSP. | They use inline scripts; needs nonces, and admin-web is another team's code. |
| N-15 | Low | Timeouts | `requestTimeout` bounds receiving a request; there is no overall handler deadline (the 30 s statement timeout bounds database work). | A global deadline can cut off a booking after it committed. |
| N-16 | Low | Fleets | `PATCH /fleets/:id/vehicles/:vid` can re-approve a suspended vehicle; if the driver already has an approved one the unique index returns 500. | Rare; needs a product rule. |
| N-17 | Info | Pagination | List endpoints use different shapes (`before` timestamp, `before_id`, plain `limit`). Error shape is consistent (`{error:{code,message,details}}`). | Changing shapes breaks clients; document before it spreads. |

## 2. Verified OK (read and/or tested, no defect found)

- **Authorisation:** every route has `anyAuth`, `requireRole` or `requirePerm`, or is deliberately public (config, services, places/popular, coverage, FAQ, share, request-code resolve/landing, staff-invite by token, client-errors, webhooks with shared secret). Every permission named in a route exists in `rbac.ts`; the three that only `super_admin` holds (`audit.view`, `settings.manage`, `users.manage`) are pinned by test E-04.
- **IDOR:** bookings, events, receipts, chat, share, payments, cancel, rating, payment-method, handover respond, driver actions, support cases, cars, saved places, emergency contacts, sessions, corporate and fleet objects are all scoped to the caller; not-yours answers 404, never 403 (tests E-05 and the existing security suite). The driver view never carries passenger phone or PIN.
- **Races:** double accept (one winner; existing test), double cash settle (C-05), double mobile-money settle (existing), double refund decision, double payout (balance lock; existing), one fee carried by one booking (existing), cancel vs accept vs dispatch (all serialise on the booking row), scheduled release by two sweepers (second transition is rejected and logged).
- **Money:** all amounts integer RWF, rounding via integer helpers; every ledger transaction balances (DB trigger plus tests); ledger and audit tables are append-only at the database level; refunds are maker-checker and cannot exceed the payment; settlement is idempotent (unique earnings row); callback bodies are never trusted (status is re-queried).
- **Injection / traversal:** all dynamic SQL fragments are server-controlled (enum columns, schema-validated keys, constant maps); file keys are matched against `^(docs|evidence|photos)/<uuid>.<ext>$`; signed file links expire; uploads are type-sniffed, structurally validated and optionally virus-scanned.
- **Secrets:** OTP stored only as HMAC, never in notification params; JWT secret/keys required in production; authorization header redacted; 500s return a request id, not internals.
- **Seed consistency:** every enabled service has an active price, a zone link, a commission rule, names/descriptions in three languages and document requirements for its vehicle types (test E-03). The disabled phase-2/3 services (`intercity`, `goods`, `cargo`) have no price by design and cannot be enabled without one.
- **Translations:** every user-facing error code has Kinyarwanda and French text (existing test); templates have identical placeholders in all languages.
- **Docs linkage:** `docs/API.md` and `docs/PERMISSION_MATRIX.md` are generated from the registered routes and were regenerated (205 routes; the only change is `GET /admin/system/health`).
- **Migrations:** apply cleanly to an empty database under production settings, idempotent on re-run, safe concurrently (test E-02); 008 was also applied and then re-run on a populated 300,000-booking database.

## 3. Indexes and query plans (EXPLAIN ANALYZE, synthetic data)

| Query | Before | After |
|---|---|---|
| Admin bookings list `order by created_at desc limit 50` (300k rows) | parallel seq scan + sort, 65 ms | index scan on `bookings_created`, 0.05 ms |
| Dashboard range count (30 days) | seq scan | index-only scan on `bookings_status_created` |
| Online drivers (dispatch, nearby, stale sweep) | seq scan of `driver_profiles` | partial index `driver_profiles_online` |
| Booking payment lookup (every booking view) | only the partial unique index | `payments_booking (booking_id, created_at desc)` |
| Offer expiry sweep, scheduled release, session/notification retention | seq scans | `dispatch_offers_expiry`, `bookings_scheduled`, `sessions_expiry/revoked`, `notifications_created` |

Already fine: passenger/driver booking lists (`bookings_passenger/driver`), one-active-trip-per-driver check (unique index), offers for a driver, stalled-search sweep. Also added: indexes for unindexed foreign keys and lookups (`ratings_reviewee`, `promo_redemptions_promo_user`, `case_events_case`, `support_cases_reporter/open_sla`, `refunds_booking`, `payouts_owner`, `corporate_members_user`, `fleet_invites_phone`, `driver_earnings_fleet`, `vehicles_driver/fleet`, `driver_profiles_fleet`, `trip_shares_booking`, `consents_user`, `saved_places_user`, `otp_created`, `fare_quotes_expiry`, `payments_sweep`, `bookings_customer_vehicle`).

## 4. Deployment notes (staging auto-deploys from this branch)

- Migration `008_audit_hardening.sql`: indexes (non-concurrent, sub-second on staging data), `notifications.next_attempt_at`, `payouts.idempotency_key`, conditional unique index on `lower(email)`. Nothing is dropped or rewritten. Apply order and idempotency verified. Do not edit it after it has been applied anywhere.
- Behaviour changes a client may notice: `409 idempotency_conflict` (booking key reused for a different quote), `409 payment_in_flight` (payment started twice), `429` on the newly limited endpoints, `401` for the loser of a refresh race, `404` for a missing file, driver photo visible only after approval, `GET /admin/finance/drivers` unchanged in shape.
- New optional environment variables: `DB_POOL_MAX` (default 20, minimum 16), `DB_CONNECT_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS`, `TRUST_PROXY` (true / false / hop count / list), `CORS_ORIGINS`, `REQUEST_TIMEOUT_MS`, `LOG_LEVEL`, `CLIENT_ERR_MAX_PER_HOUR`, and per-route limits `REFRESH_RATE_MAX`, `SOS_RATE_MAX`, `CASE_RATE_MAX`, `CHAT_RATE_MAX`, `SHARE_RATE_MAX`, `PLACES_RATE_MAX`, `PROMO_RATE_MAX`, `ORG_RATE_MAX`, `MEMBER_RATE_MAX`, `ENROLL_RATE_MAX`, `CONSENT_RATE_MAX`, `PRIVACY_RATE_MAX`. New admin settings: `retention.notification_days`, `retention.session_days`.
- New endpoint: `GET /admin/system/health` (`diagnostics.view`): queue depth and age, stuck payments, pool use, per-job health, migration level. `/ready` now returns 503 when a background job has not succeeded for 10 intervals.
- Operators: watch for the boot warnings (`config: ...`); with `MOMO_MODE=live` the server now refuses to start without credentials and a callback token of at least 16 characters.

## 5. Remaining recommendations, in priority order

1. Decide and implement N-02 (large-refund control) and N-03 (write-off path for unpaid trips) before real money flows.
2. Move uploads to object storage or a persistent disk (N-08); until then every redeploy deletes documents.
3. Make the mobile client's token refresh single-flight (N-09) and re-test sign-in on a real carrier network; decide on N-01 (OTP limits behind NAT).
4. Run `scripts/loadtest.ts` against staging and then do N-04 (batch `bookingView`, cache settings for a few seconds).
5. Add used-TOTP memory and per-account login throttling (N-11); require a second approver for large ledger adjustments (N-10).
6. Self-host the geocoder (N-13); add CSP with nonces to the HTML pages (N-14).
7. Install `pg_trgm` and index the admin text searches (N-05) once lists grow beyond a few hundred thousand rows.
8. Keep `docs/API.md` regeneration in CI (`npm run docs`) and add `tsc --noUnusedLocals` to the typecheck script to keep dead code out.
