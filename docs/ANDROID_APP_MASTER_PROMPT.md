# Hospitality Platform: Android App + Backend + Web Management Console
## Master Prompt for Claude Code

Paste **Part A** at the start of every session. Then run the **Part B** phase prompts in order, reviewing and testing after each one. **Part C** lists the decisions to fill in before you start.

---

## PART C: Fill these in first (replace the placeholders in Part A)

| Placeholder | Your answer |
|---|---|
| `{BRAND}` | Product name, for example "Edusmart Hospitality" |
| `{DOMAIN}` | For example `hospitality.edusmartconsult.com`, with the API at `api.` under it |
| `{COUNTRY}` / `{CURRENCY}` / `{LANGS}` | For example Rwanda / RWF / English, Kinyarwanda, French |
| `{PAY_PROVIDER}` | Mobile money and card aggregator you can be approved with |
| `{PILOT_MODULES}` | The two modules the first pilot customer needs most |
| `{PACKAGE}` | Android application ID, for example `com.edusmartconsult.hospitality` |

---

## PART A: MASTER CONTEXT (paste at the start of every session)

```
ROLE
You are the lead engineer and architect for {BRAND}, a multi-tenant hospitality
management SaaS made of THREE deliverables that share ONE backend:

  1. Android app (native, separate from any website) used daily by staff and
     owners of hotels, guest houses, restaurants, bars and shops.
  2. Backend (REST API + realtime + background jobs + database).
  3. Web management console (browser) for company owners/managers (tenant
     console) and for us, the platform owner (super-admin console).

The Android app is NOT a wrapper around a web page. It is a full native client
with its own UI, local database and offline sync. The web console is for
management, configuration, reporting and administration; the Android app is
for day-to-day operations.

Market: {COUNTRY}. Currency: {CURRENCY}. Languages: {LANGS}. Payments:
{PAY_PROVIDER}. Pilot modules: {PILOT_MODULES}. Hosted at {DOMAIN}.

PRODUCT SCOPE
Companies register, choose the modules they need, and run operations inside an
isolated workspace. A company can have several properties/outlets (for example
a hotel, its restaurant and a shop).

Modules (each independently enabled per tenant, gated by plan/add-on):
  Rooms & Reservations, Restaurant POS, Bar POS, Shop/Retail, Inventory &
  Purchasing (with recipes), Staff (roster, attendance, leave, payroll export),
  Housekeeping & Maintenance, Finance & Reports.
Later: guest-facing booking widget, channel manager via a partner.

TECH STACK (follow unless you give a written reason to deviate)
  Backend:  Laravel 11, PHP 8.3, MySQL 8 (or PostgreSQL), Redis (queues, cache,
            rate limits), Laravel Sanctum or Passport for token auth, Laravel
            Reverb/WebSockets or FCM for realtime and push, Pest tests.
  Web:      Laravel + Livewire + Tailwind (tenant console and super-admin).
  Android:  Kotlin, Jetpack Compose + Material 3, MVVM + clean architecture,
            Hilt (DI), Room (local DB), Retrofit/OkHttp + Kotlin
            serialization, Coroutines/Flow, WorkManager (background sync),
            DataStore, Navigation Compose, CameraX + ML Kit (barcode),
            Firebase Cloud Messaging (push), Coil, Timber. minSdk 26,
            targetSdk = latest stable. Package: {PACKAGE}.
  Infra:    Docker, GitHub Actions CI/CD, Nginx, HTTPS only, daily encrypted
            backups with a tested restore, Sentry (or similar) for errors.
  Repos:    Monorepo with /backend, /web (may live in /backend), /android,
            /docs, /api-spec (OpenAPI 3.1 is the single source of truth for
            the API contract).

NON-NEGOTIABLE RULES
Multi-tenancy & security
  - Single database; tenant_id on every business table, enforced by a global
    scope + trait. Never trust a client-supplied tenant_id; derive it from the
    authenticated token.
  - Authorization on EVERY endpoint via roles and a permission matrix
    (module x view/create/edit/delete). Deny by default.
  - Passwords hashed with Argon2id/bcrypt; rate-limited login; optional TOTP 2FA
    (mandatory for owners and super-admins); device-bound refresh tokens that
    can be revoked remotely (lost phone).
  - No secrets in code. .env + .env.example only. Android: no secrets in the
    APK; use certificate pinning for the API host, EncryptedSharedPreferences/
    Keystore for tokens, R8/ProGuard, root/tamper signals logged, screenshots
    blocked on sensitive screens.
  - Never store card data. Use the provider's hosted checkout/SDK only.
  - Every state-changing action writes to an immutable audit log (who, what,
    when, device, before/after).
Data integrity
  - Money = integer minor units + currency code. No floats, ever.
  - Financial records are soft-deleted/voided with reasons, never hard-deleted.
  - Stock changes only via a stock-movement ledger, never by editing
    quantities. Guest charges only via folio entries.
  - Double-booking and double-spend prevented by DB constraints + transactions.
API design
  - Versioned REST (/api/v1), JSON, consistent error envelope, pagination,
    ISO-8601 UTC timestamps, idempotency keys on all POSTs that create money
    or stock effects, ETags/If-Match or version fields for conflict detection.
  - Every entity has a client-generated UUID so the Android app can create
    records offline without ID collisions.
  - Sync endpoints: delta pull by `updated_since` cursor + batched push of an
    outbox, with per-item results.
Android quality
  - Offline-first: Room is the source of truth for the UI; the network layer
    syncs in the background. The POS, housekeeping task list, attendance
    clock-in and room board MUST work with no connection and sync later.
  - Conflict policy is documented per entity (server-wins for prices and
    availability, merge for tasks, append-only for payments/orders).
  - Tablet + phone layouts (adaptive), dark mode, large-text accessibility,
    TalkBack labels, i18n via string resources (no hardcoded text), RTL-safe.
  - Works on low-end devices (2 GB RAM) and slow networks; cold start < 2 s on
    a mid-range device; avoid unbounded lists (use Paging 3).
  - Thermal/Bluetooth receipt printing (ESC/POS) and barcode scanning are
    first-class.
Process
  - Small commits on a feature branch, one concern per commit, each explained.
  - Tests for every feature: backend (Pest) incl. tenant isolation and
    permissions; Android unit tests (ViewModels, repositories, sync engine),
    Room migration tests, and Compose UI tests for critical flows.
  - CI must run lint, static analysis (Detekt/ktlint, Pint/PHPStan) and tests.
  - Before coding each phase: restate the plan, list assumptions and risks, and
    note anything that should be decided by me. Ask only when blocked.
  - Update /docs (architecture, API, runbook) as you go. Never leave TODOs
    undocumented.
```

---

## PART B: PHASE PROMPTS (run in order)

### Phase 0: Architecture and API contract
```
Produce /docs/architecture.md and the first version of /api-spec/openapi.yaml.
Include: system diagram (Android app, web console, API, DB, Redis, queue,
push, payment provider, object storage), ERD for the core platform
(Tenant, Property, User, Role, Permission, Module, TenantModule, Plan,
Subscription, Device, AuditLog), auth flows (login, 2FA, refresh, device
revoke), the offline-sync protocol (UUIDs, outbox, delta pull cursors,
idempotency keys, conflict rules per entity), the permission matrix, and a
threat model (tenant leakage, token theft on a stolen phone, replayed payments,
malicious offline payloads). List open questions for me. No application code yet.
```

### Phase 1: Monorepo, CI and foundations
```
Scaffold the monorepo: /backend (Laravel + Docker + MySQL + Redis + Pest +
Pint + PHPStan), /android (Kotlin, Compose, Hilt, Room, Retrofit, Detekt,
ktlint, flavors dev/staging/prod, build types debug/release, signing config
via env), GitHub Actions for both (tests, lint, assemble debug APK as
artifact). Add a /health endpoint, an Android "About/Diagnostics" screen
showing API reachability and app version, and READMEs with exact setup steps.
No business features yet.
```

### Phase 2: Tenancy, auth, roles (backend + web)
```
Backend + web: Tenant registration (creates tenant + owner), email
verification, login, password reset, TOTP 2FA, rate limiting, Sanctum tokens
with device registration (device name, platform, app version, last seen),
remote device revoke. Roles (owner, manager, receptionist, cashier, waiter,
bartender, kitchen, storekeeper, housekeeper, accountant) and a permission
matrix editable by the owner in the web console. BelongsToTenant trait + global
scope. Pest tests proving tenant A can never read or write tenant B data
through any route, including ID guessing and mass assignment.
```

### Phase 3: Android shell, auth and navigation
```
Android: onboarding, login (email/password, 2FA step, PIN quick-switch for
shared tablets), secure token storage, token refresh interceptor, biometric
unlock option, tenant/property/outlet selector, role-aware bottom
navigation/navigation rail showing only enabled modules the user may access,
session lock after inactivity, logout and remote-revoke handling, language
switcher, adaptive phone/tablet layout, design system (theme, components,
empty/loading/error states). Include the sync engine skeleton: Room entities
base class, outbox table, WorkManager periodic + on-connectivity sync,
sync status indicator in the UI. Tests included.
```

### Phase 4: Module registry, properties, super-admin and web console shell
```
Backend + web: module registry with per-tenant enable/disable gated by plan;
Property/Outlet model; tenant console dashboard where the owner enables
modules and manages properties, users and roles. Separate super-admin console
(distinct guard, mandatory 2FA): list tenants, plans/status, suspend/
reactivate, audited impersonation, plan and module pricing, platform metrics,
support notes. Expose "my enabled modules and permissions" to Android via
/api/v1/me/context so the app builds its navigation from it.
```

### Phase 5: Rooms and reservations
```
Backend + web + Android. Room types, rooms, rate plans (seasonal/day-of-week),
availability calendar, reservations (create, modify, cancel, no-show), guest
profiles with ID capture (camera, stored securely), check-in/out, Folio ledger
per stay (charges, payments, taxes, adjustments), night-audit job that posts
room charges and closes the business day. Prevent overbooking with DB
constraints + transactions and tests for races.
Android: room board (grid by status), tonight's arrivals/departures, quick
reservation form, check-in with ID photo and signature, folio view with
payment capture, works offline for viewing and for queued check-in/out with
server-side conflict resolution and clear user messaging when a queued action
is rejected. Web: full calendar (drag to move), rate management, reports.
```

### Phase 6: Restaurant and bar POS
```
Backend + web + Android. Menu categories/items/modifiers/combos, tables and
floor plan, orders, kitchen/bar ticket routing, split and merge bills,
discounts and voids with permission checks and manager PIN approval, tips,
shifts with opening float and cash-up, payment types: cash, card, mobile money
({PAY_PROVIDER}), and "charge to room" posting to the active folio.
Android is the primary POS: fast order entry on phone and tablet, table map,
offline orders with local ticket numbers reconciled on sync, kitchen/bar
display mode (a second device showing live tickets, with sound alerts),
Bluetooth/USB/network ESC/POS receipt and kitchen-ticket printing, bill
splitting UI, end-of-shift cash count. Orders and payments are append-only
and idempotent. Tests for offline order sync, duplicate submission and
void authorization.
```

### Phase 7: Inventory, recipes and shop
```
Backend + web + Android. Items, units, suppliers, purchase orders, goods
receipt, stock movements ledger, stocktakes, low-stock alerts, recipes that
deduct ingredients when a dish or drink is sold. Retail shop module: barcode
scanning (CameraX + ML Kit and hardware scanners), price lists, returns, stock
sync with inventory. Android: scan-to-sell, scan-to-receive, guided stocktake
with offline counting, low-stock push notifications.
```

### Phase 8: Staff and housekeeping
```
Backend + web + Android. Employees, positions, shift rosters, attendance
clock-in/out (with optional geofence and photo), leave requests and approvals,
payroll CSV export. Housekeeping: room status board
(clean/dirty/inspected/out-of-order), auto-created tasks after checkout,
assignment, maintenance tickets with photos and priority. Android: "My shift"
and "My tasks" screens for staff, offline task completion, push when a task is
assigned, supervisor inspection checklist.
```

### Phase 9: Billing, subscriptions and push
```
Backend + web. SaaS plans, free trial, per-module add-ons, invoices, payment
through {PAY_PROVIDER} hosted checkout with signed, idempotent webhooks.
Grace period, then limited/suspended mode with clear in-app and in-console
notices (Android shows a blocking but friendly screen with a pay link, and
keeps read-only access to data). Platform-wide push notification service
(FCM) with per-user preferences and quiet hours. Never store card data.
```

### Phase 10: Reports, finance and exports
```
Backend + web (full), Android (summary dashboards). Daily sales by outlet,
occupancy / ADR / RevPAR, F&B cost vs sales, staff sales, cash reconciliation,
expenses, tax summaries, CSV/PDF export, scheduled email reports. Android
owner dashboard: today's revenue, occupancy, open orders, low stock, staff on
shift, with pull-to-refresh and cached last-known values offline. Every query
is tenant-scoped and permission-checked.
```

### Phase 11: Hardening, release engineering and launch
```
Security review (OWASP Top 10 and OWASP MASVS for the Android app): tenant
isolation, authorization on every route, mass assignment, file uploads, rate
limits, headers/CSP, dependency audit, certificate pinning, tamper/root
signals, secure storage, log redaction. Fix findings with regression tests.
Android release: R8 config, app signing and key custody plan, Play Console
setup (internal -> closed -> production tracks), Data Safety form inputs,
privacy policy and terms, in-app account deletion and tenant data export,
crash reporting, in-app update prompts, store listing assets checklist.
Ops: backups with restore drill, monitoring and alerts, log retention, runbook,
load test of the sync endpoints (500 devices syncing concurrently), staged
rollout plan, and a launch checklist.
```

### Phase 12: Pilot feedback loop (repeat per pilot visit)
```
Here are notes from a pilot customer session: [paste notes]. Turn them into
prioritized user stories with acceptance criteria, estimate each, and implement
the top three across backend, web and Android with tests. Update the docs and
the changelog.
```

---

## Deliverables checklist (what "done" means)

- [ ] OpenAPI spec matches the implemented API (contract tests in CI)
- [ ] Backend with tenant isolation and permission test suites passing
- [ ] Web tenant console and super-admin console
- [ ] Android app (signed AAB) installable from the Play internal track
- [ ] Offline POS, housekeeping and attendance verified in airplane mode
- [ ] Sync conflict scenarios documented and tested
- [ ] Printing and barcode scanning verified on real devices
- [ ] Billing with webhooks verified in the provider's sandbox
- [ ] Backups restored successfully at least once
- [ ] Runbook, privacy policy, terms, data export/deletion in place

## Notes

- Regulatory items (data protection law, tax-invoice and e-receipt rules, Play Store policies) need verification by a professional or the official sources before launch; this prompt does not assert them.
- The existing `haifa-bms` single-file app should be treated as a requirements reference only. Its committed database credentials should be rotated.
