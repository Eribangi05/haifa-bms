# RWANDA SMART MOBILITY PLATFORM: MASTER BUILD PROMPT

> Paste everything below the line into your AI app builder or coding agent.
> Working name: **Rwanda Mobility**. The brand name, logo, colours, fonts and contact details must be configurable.

---

## 0. HOW YOU MUST WORK

You are acting as a senior product manager, software architect, UI/UX designer, mobile and web engineer, backend engineer, database architect, security engineer, QA lead and transport-business consultant.

Build a **working, production-oriented transport marketplace for Rwanda**. It must have real authentication, a persistent database, role-based permissions, server-enforced workflows, validation, dashboards and clear integration points. It must not be a landing page, a static mockup or a set of disconnected screens.

**Ground rules (non-negotiable)**

1. **Plan first.** Inspect the environment. Then present the architecture, module list, data model, API list, implementation sequence and any blocking limitations. Do this before generating code. Continue without waiting unless something truly blocks you.
2. **Build one coherent, tested module at a time**, in the order in section 14. Do not start a dependent module until the previous one passes its tests.
3. **Honesty labels.** Tag every feature in the docs and in an in-app admin "Integration status" page as exactly one of: `IMPLEMENTED`, `TESTED`, `SIMULATED (sandbox/mock)`, or `PENDING INTEGRATION (needs credentials/approval)`. Never claim an integration works unless it was built and tested.
4. **No deception.** No fake payment confirmations. No simulated live locations presented as real. No fabricated driver availability or booking confirmations. No non-functional buttons: if a feature is deferred, hide it behind a feature flag or show a clear "coming soon / not enabled" state.
5. **Missing decisions:** choose a sensible *configurable* default, record it in `docs/ASSUMPTIONS.md`, and continue.
6. **Missing credentials:** build a clearly labelled sandbox or mock adapter behind the real interface. Document exactly how to swap in real credentials.
7. **Secrets** live only in server-side environment configuration or a secret manager. Never store plaintext passwords, OTPs, payment credentials or API keys, and never ship them to a client.
8. **Legal.** Nothing you build is regulatory approval. Document the dependencies in `docs/REGULATORY_AND_INTEGRATION_DEPENDENCIES.md`.

---

## 1. PRODUCT

A trusted transport marketplace for Rwanda connecting passengers with verified drivers. It supports independent drivers, fleet operators and corporate customers. Administrators have full operational control.

**Principles:** (1) safety and trust, (2) transparent pricing and payments, (3) fast and reliable matching, (4) fair treatment of drivers and fleets, (5) works on affordable phones and weak networks.

**Market:** Kigali first, then other Rwandan cities, then selected East African markets.
**Currency:** RWF, stored as integers. Zero floating-point money maths.
**Time:** store UTC, display Africa/Kigali (CAT, UTC+2).
**Languages:** Kinyarwanda (`rw`) and English (`en`) at launch. The i18n architecture must allow French (`fr`) and Kiswahili (`sw`) to be added by adding translation files only. Kinyarwanda strings run long, so layouts must not break.

---

## 2. SCOPE AND PHASING

Build the architecture for all features. Order the *delivery* so a reliable core ships first. Everything below is required eventually. Phase tags show build order and which features are enabled by default.

- **Phase 1 (MVP, enabled by default):** passenger/driver auth, driver onboarding and verification, Moto and Standard car, fare estimate, dispatch, state machine, trip PIN, live tracking, cash plus one mobile-money provider (MTN MoMo sandbox), ledger, commission and earnings, receipts, ratings, basic cancellation rules, support, safety (SOS, trip share), admin dashboard, audit logs, essential reports, basic corporate booking.
- **Phase 2 (built, behind feature flags):** Airtel Money adapter, fleet portal, scheduled rides, airport transfers, promotions and referrals, corporate accounts in full, automated payouts, advanced dispatch, fraud and dispute tooling.
- **Phase 3 (modelled and flagged off):** intercity, goods/cargo/courier, accessible transport, school/staff transport, chauffeur hire, subscriptions and loyalty, more cities and languages, advanced analytics, regional expansion.

Every service, payment method and growth feature is controlled by **feature flags and the service catalogue**, so it can be enabled per zone without a code change.

---

## 3. ARCHITECTURE

**Modular monolith** (no premature microservices), deployable via Docker, with staging and production configs and separate credentials.

| Layer | Choice (use equivalents if the environment dictates) |
|---|---|
| Backend | Node.js + TypeScript (NestJS or Fastify), REST `/api/v1` + OpenAPI 3 spec, WebSocket/SSE for realtime |
| Database | PostgreSQL 15+ with PostGIS, versioned migrations (e.g. Prisma/Knex/Drizzle/Flyway) |
| Jobs | Postgres-backed queue (pg-boss/BullMQ). Add Redis only if load testing justifies it |
| Web apps | Next.js + TypeScript (passenger web, admin, fleet, corporate), PWA-capable |
| Mobile | React Native/Expo (passenger and driver as two build flavours or two apps) |
| Storage | Private S3-compatible bucket, signed expiring URLs, malware and type validation |
| Maps | Provider behind an interface (see section 10) |
| Notifications | Provider adapters: in-app, push (FCM/APNs), SMS, email, WhatsApp Business (flagged) |
| Observability | Structured logs, request IDs, health endpoints, error tracking, metrics, alerting |

**Backend modules** (each with its own service layer, DTO validation and tests): `identity`, `rbac`, `drivers`, `vehicles`, `fleets`, `corporate`, `catalogue`, `zones`, `pricing`, `promotions`, `dispatch`, `bookings`, `trips`, `payments`, `ledger`, `earnings`, `payouts`, `notifications`, `support`, `safety`, `reporting`, `audit`, `settings`, `i18n`.

**Cross-cutting:** idempotency middleware, rate limiting, request validation, central error model, object-level authorization guards, audit interceptor, feature-flag service, config service.

Deliver Mermaid diagrams for architecture and the ER model in `docs/`.

---

## 4. ROLES AND PERMISSIONS

Use a **permission-based RBAC** model (roles → permissions, with object-level checks) and a documented role/permission matrix at `docs/PERMISSION_MATRIX.md`.

Roles: `passenger`, `driver`, `fleet_manager` (and fleet staff), `corporate_admin`, `corporate_booker`/employee, `super_admin`, `dispatcher`, `support_agent`, `support_lead`, `driver_verifier`, `finance_officer`, `finance_approver`, `business_manager`, `analyst` (PII-free).

Rules:
- Enforce on the **backend** for every endpoint. UI hiding is cosmetic only.
- Object-level checks: a passenger sees only their bookings. A fleet manager sees only their fleet's drivers, vehicles, trips and money. A corporate user sees only their organisation. Support sees sensitive cases only if granted.
- Maker–checker (two-person) approval for: large payouts, refunds above a threshold, commission/pricing changes, exceptional ledger adjustments, role changes.
- Privileged roles: mandatory MFA (TOTP) plus device/session management, short sessions, IP/session audit, forced re-auth for destructive actions.

---

## 5. IDENTITY AND ACCOUNTS

- Phone registration with `+250` validation (E.164, Rwandan mobile prefixes configurable), SMS OTP: hashed storage, 5-minute expiry, max attempts, resend cooldown, per-phone/per-IP/per-device rate limits, lockout, OTP-abuse and SMS-pumping detection.
- Short-lived access tokens plus rotating refresh tokens bound to device. Session list with remote revoke. Secure logout.
- Account recovery via phone OTP (plus email where verified). Optional email verification. Optional Google/Apple sign-in (flagged, `PENDING INTEGRATION`).
- Staff accounts: email + password (argon2id) + mandatory TOTP.
- Profile: name, photo (private storage), language, notification preferences, saved places, emergency contacts.
- Deactivation and **deletion/privacy request workflow** (data-subject access, correction, deletion, with legal-hold and financial-record retention exceptions), tracked as cases with deadlines.
- Duplicate-account and suspicious-registration detection (device fingerprint, phone churn, velocity).
- Consent records (terms, privacy, location, background tracking, marketing), versioned and timestamped.
- A passenger signs up **without** any driver documents. Driver onboarding is a separate, gated flow.

---

## 6. SERVICE CATALOGUE, ZONES, PRICING

### 6.1 Catalogue (fully admin-configurable)
Each service category defines: name/description (i18n), vehicle requirements, passenger capacity, luggage allowance, pricing rule set, operating zones, driver eligibility, booking restrictions (advance window, max distance, payer types) and an enabled flag.

Seed: **Moto, Standard car** (on); **Comfort, Family/group, Airport transfer, Scheduled, Corporate, Intercity** (built, flagged); **Pickup/light goods, Cargo, Courier, Accessible, School/staff, Chauffeur hire** (modelled, off).

A service is shown as available **only if** the pickup is in an active zone **and** at least one eligible, dispatchable driver and vehicle exists. Otherwise show an honest "no drivers nearby" state with alternatives.

### 6.2 Zones
PostGIS polygons with admin editing, per-zone service availability and pricing overrides, designated pickup points (airport, bus parks), and geofence checks for pickup and destination. Seed Kigali.

### 6.3 Pricing engine (pure, deterministic, heavily unit-tested)
Components: base fare, distance, time, minimum fare, waiting time (with free grace), booking fee (disclosed), airport fee, scheduled surcharge, long-distance tier, extra stops, tolls/pass-through, coupons, corporate rates, taxes/levies (configurable, e.g. VAT), cancellation/no-show fees, RWF rounding rule (e.g. nearest 50 RWF, configurable).

Pricing models, selectable per service/zone:
- **A. Fixed/regulated tariff**
- **B. Platform-calculated from an approved fare schedule** (default)
- **C. Negotiated** (passenger offer ↔ driver counter-offers, flagged off by default; full offer history; both parties confirm before start)

Rules: rule versions with effective dates and time-of-day bands. Every change is logged and approval-gated. A **fare quote is immutable once accepted** (store `fare_quote` with the rule version used). Final fare equals the quote unless a published, auditable adjustment applies (route change, waiting, authorised extras). Surge/demand pricing exists but is **disabled by default**, capped, disclosed and approval-gated. Always show a line-by-line breakdown. Never add hidden charges.

### 6.3.1 Commission
Percentage, fixed, per-service, fleet-negotiated, promotional/introductory, and time-boxed exemptions (admin-approved). The commissionable base is explicitly configured: which of discounts, taxes, tolls, waiting, tips and booking fee count. Output per trip: gross, discounts, taxes, pass-through, commission, fleet share, driver net, processor fees.

---

## 7. BOOKING, DISPATCH AND TRIP ENGINE

### 7.1 Booking flow
Pickup (GPS, map pin, typed address, landmark/business name, editable notes, ability to correct bad GPS) → destination → server validates zone, route, service suitability → fare estimate (distance, duration, ETA) → select service and payment method → confirm with an **idempotency key** → dispatch → driver offer → assignment → driver en route → arrival → passenger verifies driver/vehicle → **trip PIN** start → live tracking → completion → final fare → payment → receipt → ratings.

### 7.2 Server-authoritative state machine
States: `DRAFT`, `FARE_ESTIMATED`, `REQUESTED`, `SEARCHING_DRIVER`, `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `AWAITING_PASSENGER_VERIFICATION`, `IN_PROGRESS`, `COMPLETED`, `PAYMENT_PENDING`, `PAYMENT_COMPLETED`, `CANCELLATION_REQUESTED`, `CANCELLED_BY_PASSENGER`, `CANCELLED_BY_DRIVER`, `CANCELLED_BY_SYSTEM`, `DISPUTED`, `REFUNDED`, `PARTIALLY_REFUNDED`, `PAYMENT_REVERSED`, plus `NO_DRIVER_FOUND` and `EXPIRED`.

- One transition table in code and tests. Illegal transitions are rejected with a clear error.
- Every transition writes `booking_events` (actor, from, to, reason, metadata, UTC time) in the same DB transaction.
- Guards: only the assigned driver may arrive/start/complete; PIN verification cannot be bypassed except via an authorised, logged, reason-coded exception (dispatcher/support with permission); no duplicate fare finalisation; no completion without start.
- **Concurrency:** assignment uses row-level locking / unique partial indexes so a driver has at most one active trip, a vehicle cannot be double-booked, and the first valid acceptance wins while concurrent ones fail cleanly.
- The client never reports a driver as assigned before the commit. Stale client writes cannot overwrite newer server state (optimistic versioning / `If-Match`).

### 7.3 Dispatch engine
Eligibility (hard filters): account approved and active, mandatory documents valid, vehicle approved and suitable, **online with fresh location (configurable max age) and a live connection**, no conflicting trip, pickup in zone, capacity/luggage/accessibility fit, no safety restriction between this driver and passenger.

Ranking (configurable weights): route ETA preferred over straight-line distance, acceptance/cancellation history (with excused reasons), fairness/rotation, rating.

Strategies (admin-selectable per zone/service): nearest, lowest ETA, sequential offers, small-group broadcast, scheduled dispatch, manual dispatcher assignment, automatic reassignment on reject/timeout/driver-cancel.

Offers have a configurable timeout, retry rounds and expanding search radius. Passengers see searching / retrying / no driver. On failure, offer another category, a changed pickup, a later time or a scheduled ride. **Do not penalise** rejections that are connectivity, platform error, safety or other excused reasons.

### 7.4 Cancellations, disputes, refunds
- Cancellation records initiator, reason code, timestamp, trip state, and any fee. Grace period is configurable. **No automatic fee** when the driver or platform caused the failure. No-show timers (wait time then fee, with driver arrival evidence).
- Scenarios handled as cases: driver didn't arrive, wrong pickup/destination, mid-trip destination change (both-party confirmation), route deviation, fare discrepancy, duplicate charge, failed payment, refund request, lost property, safety complaint, service quality.
- Cases carry IDs, evidence attachments, assignee, SLA deadline, internal notes, resolution record, and an **appeal** path (passengers and drivers).
- All money corrections are **new ledger entries**, never edits.

---

## 8. PAYMENTS, LEDGER, EARNINGS, PAYOUTS

### 8.1 Payment abstraction
Interface: `initiate`, `getStatus`, `verifyCallback`, `refund`, `payout`, `settlementReport`. Adapters: `cash`, `mtn_momo` (official MTN MoMo API, Collections/Disbursements, sandbox-first), `airtel_money` (adapter skeleton, flagged), `corporate_account`, `wallet` (**off, pending legal/financial review**), `card` (off).

Workflow: unique payment reference → initiate server-side → `PENDING` → verify via **authenticated provider callback and/or status polling** → record exactly once (idempotent on provider event ID/reference) → update booking only when payment conditions are met → receipt → reconciliation. Handle timeouts, partial/failed/cancelled/reversed, and mismatches via a reconciliation exception queue.

**Never** treat a client success message or screenshot as proof of payment. Cash: record amount due, amount collected (driver-confirmed, passenger-visible), outstanding balance and driver remittance obligation. Callbacks are signature/credential-verified, replay-protected and logged raw in `payment_provider_events`.

### 8.2 Double-entry ledger
Immutable `ledger_entries` grouped by `transaction_group_id`, balanced debits and credits enforced by DB constraint/trigger, with chart of accounts (e.g. passenger receivable, cash held by driver, provider clearing, driver payable, fleet payable, platform commission revenue, tax payable, processor fees, promo expense, refunds, adjustments, suspense). Customer prepaid balances (if ever enabled) are kept strictly separate from driver earnings and from third-party-held funds. Track separately: gross fare, discounts, taxes and pass-through, commission, driver earnings, fleet share, processing fees, refunds, adjustments, cash collected, amounts payable, platform revenue, outstanding balances. Corrections are reversal + adjustment entries only.

### 8.3 Reconciliation
Daily job: match internal payments and ledger to provider settlement reports (CSV import and API where available), flag unmatched/duplicate/amount-mismatch items, support investigation notes and resolution, export for accounting.

### 8.4 Earnings and payouts
Per-trip earnings record. Driver views gross, commission, adjustments, net, cash collected, mobile-money collected, platform obligations (cash commission owed), eligible payout balance, history; daily/weekly/monthly reports. Payout requests with configurable minimums, fees, limits and schedule (all disclosed). Approval workflow for large/exceptional payouts (maker–checker). Cash-commission netting against payable balance. Full status history on payouts. Fleet owners receive consolidated statements and fleet payouts. Automated disbursement via MoMo Disbursements is `PENDING INTEGRATION`; manual approved payouts work from day one.

---

## 9. DRIVER ONBOARDING AND VERIFICATION

Collect only what is necessary: legal name, verified phone, photo, national ID, driving licence (category matching vehicle), vehicle registration, ownership/authorisation, insurance, transport permits where required, inspection/roadworthiness, emergency contact (justified, encrypted), preferred zones and hours, payout account, fleet affiliation.

- Document requirements are **admin-configurable per service/vehicle type**, with expiry dates.
- Secure upload: size/type/magic-byte validation, malware-scan hook, private storage, encryption at rest, signed expiring access URLs, access logged.
- Driver states: `APPLICATION_STARTED`, `DOCUMENTS_SUBMITTED`, `UNDER_REVIEW`, `INFO_REQUIRED`, `APPROVED`, `REJECTED` (reason), `SUSPENDED`, `EXPIRED_INELIGIBLE`, `DEACTIVATED`. Reviewer notes, resubmission requests, full audit trail, appeals.
- **Online ≠ permitted.** A permission-to-work check (approved + docs valid + vehicle valid + not suspended) is evaluated separately from the online toggle on every dispatch. A nightly job and an on-event check auto-flip drivers to `EXPIRED_INELIGIBLE` when a mandatory document lapses, with reminders at 30/14/7/1 days before expiry.
- Third-party identity/licence verification is an adapter (`PENDING INTEGRATION`), with manual review as the fallback.

---

## 10. MAPS AND LOCATION

- **Evaluate before committing.** Build `docs/MAP_PROVIDER_EVALUATION.md` comparing at least Google Maps Platform, Mapbox, HERE, and OpenStreetMap-based stacks (OSRM/Valhalla/GraphHopper + Nominatim/Photon) for Kigali coverage, landmark search, routing quality, cost and licensing. Include a test script that runs a fixed Kigali test set (landmarks, markets, bus parks, airport, hospitals, hotels) through candidates. Implement behind `MapProvider` (`geocode`, `reverseGeocode`, `search`, `route`, `matrix`, `tiles`). Default to an OSM-based adapter for development.
- Pickup by GPS, pin drag, text, landmark/business, with an **editable pickup note** and GPS-accuracy warning and correction.
- Live driver location with throttling (adaptive interval), batching and retry/backoff. Server rejects implausible jumps and stale or out-of-order points. Driver tracking is only active when online or on a trip, with explicit background-location disclosure and consent.
- Offline-driver safety: **never infer availability from last-known location**. Availability requires a live heartbeat.
- Minimal location retention: configurable retention (e.g. trip points kept N days, then aggregated or deleted), access restricted and audited.
- Fallbacks when routing/maps fail: straight-line estimate clearly labelled, landmark text directions, call/chat contact, dispatcher assistance.

---

## 11. SAFETY, TRUST AND PRIVACY

- Passenger sees driver photo, name, rating, plate, vehicle make/colour **before boarding**.
- **Trip PIN** start verification; bypass only by an authorised, logged exception.
- Live **trip sharing** via secure, unguessable, expiring link; revocable; limited data.
- **SOS:** one-tap, visually distinct. It records an incident with location (if available), alerts the configured response channel (support console, SMS/WhatsApp to safety contacts), and shows local emergency numbers. The UI must **never claim** police or ambulance has been contacted unless a human or integration has confirmed it. Workflow documented in `docs/EMERGENCY_RESPONSE_PLAYBOOK.md`.
- Incident reporting (harassment, accident, misconduct, lost property), secure evidence store, escalation, investigation, driver suspension/reinstatement workflows, safety audit log.
- Privacy-preserving contact: masked calling/in-app chat (provider adapter, `PENDING INTEGRATION`, with in-app chat implemented).
- Abuse detection: cancellation abuse, fake-GPS indicators, promo/referral fraud, account farming, collusion patterns, risk scoring surfaced to staff.
- Mutual ratings with abuse safeguards. Block lists/safety restrictions respected by dispatch.

**Security baseline:** TLS everywhere, encryption at rest for sensitive columns (ID numbers, payout details, documents), OWASP ASVS-aligned (input validation, output encoding, CSRF protection for cookies, SSRF/path-traversal safe uploads, secure headers/CSP), parameterised queries only, dependency scanning, secrets scanning, rate limiting, brute-force protection, signed URLs, least-privilege DB roles, row-level security where practical, immutable audit log (append-only), backup and restore tested, DR runbook, incident-response procedure, data-retention schedule and privacy notice templates (Kinyarwanda and English).

---

## 12. NOTIFICATIONS, SUPPORT, GROWTH, CORPORATE, FLEET

### 12.1 Notifications
Channels: in-app, push, SMS, email, WhatsApp (flagged). Events: OTP/security, booking confirmed, driver assigned/arriving/arrived, trip start/complete, payment result, receipt, cancellation, refund, document expiry, payout, support updates, safety incidents. Admin-editable templates in `rw`/`en` with variables. Respect preferences, quiet hours (non-critical), provider rate limits and cost caps. Critical events fall back to SMS. Never include payment credentials or identity documents in notifications. Delivery log with retries and dead-letter handling.

### 12.2 Support centre
FAQ (i18n), in-app tickets and chat, categories (booking, payment, refund, driver complaint, lost item, safety), priority and escalation rules, SLA timers, internal notes, assignment, satisfaction survey. Agent search by booking ID, payment reference, passenger, driver or case ID, **permission-scoped**. Sensitive complaints visible only to authorised staff. Canned actions (refund request, fee waiver, re-dispatch) so routine issues need no manual DB edits.

### 12.3 Promotions, referrals, retention (flagged)
Referral codes (passenger and driver recruitment), first-ride offers, vouchers, loyalty points, campaigns, limited-time offers, surveys, rebooking shortcuts, ride packages/subscriptions (Phase 3). Each promotion defines validity, eligible users, services, zones, minimum fare, usage limits, budget and funding source (platform, driver, partner). Prevent self-referral, duplicate claims, abuse and unauthorised stacking. The UI shows which promotion applies and which conditions remain.

### 12.4 Fleet operator portal
Register a company/individual fleet, business verification documents, invite drivers, link drivers to vehicles, availability, trips and earnings views, vehicle/document expiry tracking, driver performance, exports, internal staff permissions, configurable fleet commission/revenue share, consolidated statements, fleet payouts. **Strict tenant isolation** (tested). A vehicle cannot be assigned to overlapping incompatible trips.

### 12.5 Corporate portal
Business registration and manual verification, employees, departments/cost centres, travel profiles, central booking on behalf of staff (and visitor airport pickups), approval workflows, monthly budgets, per-employee limits, allowed routes/times/categories/payment methods, PO/reference fields, recurring transport, expense reports, downloadable trip statements, consolidated invoices (PDF/CSV), credit terms only after manual approval (prepaid or pay-as-you-go by default), dedicated coordinator role. Spending limits enforced server-side at booking time. Ordinary passengers can never see corporate data.

---

## 13. USER INTERFACES

Design system: original Rwanda-inspired identity (no competitor assets), design tokens for colours, type, spacing, radius, elevation, light/dark, WCAG AA contrast, 48px minimum touch targets, high-contrast driver actions, visually distinct safety actions, helpful empty/loading/error/offline states on every screen, fast on low-end Android (small bundles, lazy loading, image compression, skeletons, minimal requests). Language switcher during onboarding and in settings. All strings via i18n keys.

**Passenger (mobile-first app + responsive web):** welcome/onboarding, language, registration + OTP, home (map, current location, pickup selector, destination search, recents, saved places Home/Work/School/Other, quick shortcuts, service categories with fares, scheduled rides, active trip card, promotions/referral, help/SOS, profile), destination search, vehicle selection, fare estimate and confirmation, driver matching, driver approaching (driver/vehicle/PIN/share/contact/cancel), active trip, payment and receipt, ratings, booking history, saved places, emergency contacts, privacy and data requests, support, settings.

**Driver (separate app/mode, clearly different look):** registration, document upload with expiry and status, vehicle setup, home (online toggle separate from eligibility banner, zone, offers with pickup distance/ETA/fare/**estimated earnings**, accept/reject with reason), navigation hand-off, PIN entry, start/complete, earnings (day/week/month), wallet and transactions, commission breakdown, cash-owed, payout requests/history, ratings, expiry alerts, incident/support/SOS. Minimal interaction while moving (large controls, voice/sound alerts, no data entry during a trip).

**Admin dashboard:** overview KPIs (registered passengers, drivers verified/pending/online, active bookings, completed/cancelled, average arrival time, fulfilment rate, payment success, GBV vs net revenue vs cash collected, driver earnings payable, refunds/disputes, support backlog, safety incidents, zone performance), live map of bookings and drivers, drivers (applications, document review, approve/reject/suspend/reinstate, expiry monitor, performance, appeals), passengers (profiles, restrictions, privacy requests), bookings (live, reassign, scheduled, cancel, dispute), pricing (services, fare rules with effective dates and approvals, zones, promotions, history), finance (transactions, reconciliation, refunds and payouts approval, outstanding balances, exports, ledger and audit), support and safety console, corporate and fleet management, settings (roles, templates, languages, providers, timeouts, document requirements, safety contacts, retention, feature flags, branding), integration-status page, audit log viewer. Destructive actions need typed confirmation and re-auth.

**Fleet portal and corporate portal:** as in 12.4 and 12.5, using the same design system.

---

## 14. BUILD ORDER (finish and test each before the next)

1. Repo, tooling, CI, Docker, config, migrations, i18n scaffold, design tokens.
2. Database schema (section 15) and seeds (Kigali zone, Moto/Standard services, fare rules, roles/permissions, test accounts).
3. Identity, OTP, sessions, MFA for staff, RBAC, audit log.
4. Catalogue, zones, pricing engine (with exhaustive unit tests), commission engine.
5. Driver onboarding, documents, vehicles, eligibility service, expiry jobs.
6. Maps provider interface and evaluation, location ingestion.
7. Bookings, state machine, idempotency, dispatch, offers, PIN, concurrency tests.
8. Payments abstraction, cash, MTN MoMo sandbox, callbacks, idempotency.
9. Ledger, earnings, payouts, refunds, reconciliation.
10. Passenger and driver apps wired to real APIs and realtime.
11. Admin dashboard, support, safety, notifications.
12. Corporate and fleet portals, promotions and referrals (flagged).
13. Offline/low-connectivity hardening, security review, load test, accessibility pass.
14. Documentation, deployment, status matrix.

---

## 15. DATA MODEL (minimum)

UUID primary keys, `created_at/updated_at` (UTC), soft-delete where lawful, FK constraints, CHECK constraints (e.g. amounts ≥ 0, balanced ledger), indexes (including GiST on geometry, partial unique indexes for "one active trip per driver/vehicle", unique provider references and idempotency keys). Integer RWF.

`users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `devices`, `otp_challenges`, `mfa_credentials`, `consents`, `privacy_requests`, `passenger_profiles`, `saved_places`, `emergency_contacts`, `driver_profiles`, `driver_documents`, `document_requirements`, `document_reviews`, `driver_status_history`, `vehicles`, `vehicle_documents`, `vehicle_categories`, `fleet_organizations`, `fleet_members`, `fleet_driver_assignments`, `fleet_agreements`, `corporate_accounts`, `corporate_members`, `corporate_policies`, `corporate_approvals`, `corporate_invoices`, `service_categories`, `service_zones`, `zone_services`, `pickup_points`, `pricing_rule_sets`, `pricing_rules`, `pricing_changes` (with approvals), `commission_rules`, `fare_quotes`, `fare_breakdowns`, `fare_offers` (negotiation), `bookings`, `booking_stops`, `booking_events`, `dispatch_offers`, `driver_availability`, `driver_locations` (partitioned/retention), `trip_locations`, `trip_shares`, `payments`, `payment_provider_events`, `refunds`, `ledger_accounts`, `ledger_entries`, `driver_earnings`, `payouts`, `payout_approvals`, `reconciliation_runs`, `reconciliation_items`, `promotions`, `promotion_redemptions`, `referrals`, `loyalty_ledger`, `ratings`, `support_cases`, `case_events`, `case_attachments`, `safety_incidents`, `notifications`, `notification_templates`, `notification_preferences`, `feature_flags`, `system_settings`, `translations`, `audit_logs` (append-only), `idempotency_keys`, `job_runs`.

Deliver `docs/ERD.md` (Mermaid), migrations, and DB-level tests (constraints, balanced ledger, concurrency).

---

## 16. API

`/api/v1`, JSON, OpenAPI-documented, versioned, paginated, consistent error model, idempotency keys on all unsafe money/booking endpoints, `Accept-Language` support.

Include at minimum: `auth/otp/request|verify`, `auth/refresh|logout`, `auth/mfa/*`, `users/me` (GET/PATCH/DELETE-request), `users/me/sessions`, `places`, `emergency-contacts`, `drivers/applications`, `drivers/documents`, `drivers/me/status|availability|location|earnings|payouts|wallet`, `vehicles`, `services`, `fares/estimate`, `bookings` (create/get/list/cancel/accept/reject/arrived/verify/start/complete/ratings/share/sos), `payments` + `payments/{id}` + `webhooks/payments/{provider}`, `receipts/{id}`, `businesses/*` (members, policies, bookings, invoices, statements), `fleets/*`, `promotions/validate`, `referrals`, `support/cases|messages`, `safety/incidents`, `notifications`, and the `admin/*` family (dashboard, drivers, passengers, bookings, dispatch, pricing, finance, reconciliation, refunds, payouts, support, safety, settings, roles, flags, audit, exports). Realtime channels: booking updates, driver offers, driver location, admin live map, support chat.

---

## 17. OFFLINE AND LOW CONNECTIVITY

Persist non-sensitive UI state, outbox queue for retries with exponential backoff + jitter, idempotent submissions, resume after app restart from server truth, clear offline banners, unconfirmed bookings labelled "not confirmed" until the server acknowledges, reconnect sync that never overwrites newer server state, SMS fallback for critical notifications, graceful map/GPS failure modes, small payloads (gzip, field selection), and fast first load.

---

## 18. TESTING (required, run in CI)

Unit: pricing, rounding, commission, state machine, eligibility, promo rules, ledger balancing.
Integration/API/DB: registration + OTP (expiry, resend, lockout), driver approval, expired-document dispatch block, availability freshness, booking creation + idempotency, dispatch/reassignment, **concurrent acceptance/assignment**, PIN start, cancellation rules, payment callback authenticity, **duplicate callbacks**, reconciliation, refunds, payout authorisation, RBAC and object-level isolation (passenger A vs B, fleet A vs B, corporate A vs B), corporate spending limits, privacy requests, offline/retry recovery.
E2E (Playwright and mobile-emulated): full journey passenger → driver → payment → receipt → rating → admin audit.
Plus: security tests (authz bypass, injection, upload abuse, rate limits), load test on dispatch, accessibility checks, test on representative low-end Android and multiple screen sizes.
Use realistic Kigali test data and sandbox payment credentials only.

---

## 19. DELIVERABLES

1. `docs/PRD.md` (concise)
2. `docs/SCREENS_AND_JOURNEYS.md`
3. `docs/PERMISSION_MATRIX.md`
4. `docs/ARCHITECTURE.md` with diagram
5. `docs/ERD.md`
6. Database schema + migrations + seeds
7. OpenAPI spec and `docs/API.md`
8. Working passenger and driver apps
9. Working admin dashboard
10. Fleet and corporate portals (foundation, flagged where Phase 2)
11. Pricing engine with admin configuration
12. Booking and dispatch workflow
13. Payment adapters (cash, MTN MoMo sandbox, Airtel skeleton)
14. Ledger and reconciliation workflow
15. Automated test suites with a pass report
16. `docs/SETUP_AND_DEPLOYMENT.md` (local, staging, production, backups, monitoring)
17. `docs/ENVIRONMENT_VARIABLES.md` + `.env.example` (no real secrets)
18. `docs/SECURITY_AND_PRIVACY.md`
19. `docs/SUPPORT_OPERATIONS_GUIDE.md` and `docs/EMERGENCY_RESPONSE_PLAYBOOK.md`
20. `docs/REGULATORY_AND_INTEGRATION_DEPENDENCIES.md`
21. `docs/FEATURE_STATUS.md` (implemented / tested / simulated / pending, per feature)
22. `docs/ASSUMPTIONS.md`

---

## 20. DEFINITION OF DONE

Demonstrate with seeded test accounts:

- A passenger registers via OTP and requests a Moto or Standard car trip with a valid fare estimate.
- Only eligible drivers receive offers. A driver accepts or rejects. The passenger sees the assignment, ETA and status in real time.
- Driver verifies the trip PIN, starts and completes. The final fare is consistent with the accepted quote.
- Cash is recorded as due/collected correctly, or a **sandbox MoMo** payment is verified server-side (callback or status check), exactly once.
- Commission, driver earnings, fleet share and platform revenue are correct and the ledger balances.
- Receipt issued. Both parties can rate. Both see appropriate trip records.
- Admin can verify drivers, manage bookings, handle complaints, change pricing (with approval), and investigate a payment exception. All financial adjustments are traceable.
- Unauthorised access to another user's, fleet's or business's data is blocked, and duplicate payments/bookings are rejected.
- The app recovers cleanly from simulated network loss.
- Critical workflows have passing automated tests. Setup, deployment and credential documentation are complete.
- `FEATURE_STATUS.md` honestly labels every feature.

**Start now:** inspect the environment, post the plan (architecture, data model, API list, sequence, limitations), then build step 1 and continue module by module.

---
