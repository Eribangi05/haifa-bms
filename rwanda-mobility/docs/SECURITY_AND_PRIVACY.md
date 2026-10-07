# Security and privacy

> This describes what is **implemented in code** and what an operator must still do. It is not a certification or a legal opinion.

## Implemented controls

| Area | Control | Evidence |
|---|---|---|
| Authentication | SMS OTP (6 digits, 5-min expiry, HMAC-hashed at rest, single use, 5 attempts, resend cooldown, per-phone and per-IP hourly caps); device-velocity check on registration | `tests/auth.test.ts` |
| Sessions | 15-min access JWT, 30-day rotating refresh token (hash stored); **refresh-token reuse revokes all sessions**; list/revoke devices; server checks session validity on every request | `auth.test.ts` |
| Staff | Email + scrypt password + **mandatory TOTP**; 5 failures lock 15 min; no hint which factor failed; 8-hour sessions; every login/failure audited | `auth.test.ts` |
| Authorisation | Role -> permission map enforced in route guards; object-level checks for bookings, fleets, companies; 404 (not 403) for other people's objects | `security.test.ts`, `business.test.ts` |
| Maker-checker | Fare/commission changes, refunds, large payouts, regulated flags require a second person | `security.test.ts`, `finance.test.ts` |
| Input | zod validation on every body/query/param; parameterised SQL only; strict unknown-field rejection on profile updates | all routes |
| Uploads | 5 MB cap, magic-byte sniffing (JPEG/PNG/PDF only), **declared type must match content, structure validated (JPEG markers, PNG chunk CRCs, PDF trailer), trailing-data polyglots, script markers and PDF active content (`/JavaScript`, `/Launch`, embedded files) rejected, image dimension sanity, pluggable `scanFile` hook with optional ClamAV (`CLAMAV_HOST`, fail closed)** (`services/scan.ts`), random server-side names, private directory mode 0600, **signed 5-minute links**, path-traversal guard | `drivers.test.ts` |
| Data at rest | National ID, emergency contact, MFA secrets AES-256-GCM encrypted; passwords scrypt; OTPs, refresh tokens hashed; PINs derived (never stored) | `util/crypto.ts` |
| Money integrity | Integer RWF; balanced immutable ledger; idempotent payments; provider-verified status | `finance.test.ts`, `journey.test.ts` |
| Audit | Append-only `audit_logs` (DB trigger blocks UPDATE/DELETE); admin reads of driver/user/case records are themselves audited; exports audited | `security.test.ts` |
| Transport | HSTS in production; `nosniff`, `no-referrer`, `X-Frame-Options`; `Cache-Control: no-store` on API; admin console CSP (a `<meta>` tag in `admin-web/index.html`: scripts from this origin only, map tiles from OpenStreetMap only; framing is blocked by the `X-Frame-Options: DENY` response header) | `app.ts`, `admin-web/index.html` |
| Abuse | Global per-IP rate limit; stricter per-route limits on OTP, client-error reports, uploads, bookings, payments and estimates (per user where signed in); CSV formula-injection neutralised; generic 500s with a request id (no stack traces) | `security.test.ts` |
| Safety | Trip PIN (derived, 5 attempts then lock, logged override only), live-share links (random, expiring, revocable, no phone numbers), SOS records and never claims an agency was contacted, safety blocks removed from dispatch | `journey.test.ts`, `security.test.ts` |

## Privacy by design

* **Minimal collection**: passengers need only a phone number; driver documents only at driver onboarding.
* **Location**: passengers' location is used for the request (and shared only with the assigned driver as a pickup point). Driver position is stored as *latest position* for dispatch; a **trail is stored only while a driver has an active trip** and deleted after `retention.location_days`. **Drivers only, Android only:** while a driver is online or on a trip, location continues when the app is in the background through a user-visible **foreground service** (type `location`, persistent notification in the driver's language) started with `expo-task-manager`/`expo-location`. It is started only from the foreground after the driver accepts an in-app prominent disclosure (`rm_drv_bg_consent`, recorded server-side as consent `background_location` v2), posts at most one fix every ~5 s, stops when the driver goes offline, leaves driver mode, signs out or loses the session, and stops if the app is swiped away (`killServiceOnDestroy`). It never runs for passengers, web or iOS. `ACCESS_BACKGROUND_LOCATION` is **not** requested (still in `blockedPermissions`): a foreground service started while the app is visible does not need it on Android 10+. Status: IMPLEMENTED, not run on a device.
* **Push tokens and crash reports**: the Expo push token is sent to `POST /users/me/push-token` after the user accepts a notification rationale (once) and deleted on sign-out. Client errors go to `POST /client-errors` with a scrubbed, truncated message/stack (phone numbers, emails and tokens removed), app version, platform, screen name and language only; at most 5 per session; no user content.
* **Contact privacy**: drivers never receive a passenger's phone number; passengers never receive a driver's. Use in-app chat. (Masked calling = pending integration.)
* **Consent records** (`consents`): terms/privacy at sign-up; location and background-location disclosures are timestamped when accepted.
* **Data-subject requests**: users can file access/correction/deletion/deactivation requests (30-day due date); staff with `privacy.handle` export a user's data or execute deletion, which erases PII, revokes sessions, removes documents, and **keeps anonymised financial records** for accounting. Deletion is refused while trips or balances are open.
* **Analytics** are aggregate-only; the `analyst` role has no access to bookings or finance detail.

* **Abasare evidence**: handover photos (which may show personal items) are stored privately, shown only to the owner, the assigned driver and staff via 5-minute signed links, and **purged after `retention.handover_days` (90) unless a case is open**. Police clearance is a mandatory expiring document; driver identity (photo, name, experience) is shown to the owner before keys are handed over.

## What the operator must still do (not in code)

1. Register/notify the Data Protection and Privacy Office as required, appoint a data-protection contact, publish a Kinyarwanda/English privacy notice, and decide hosting location lawfully.
2. Provision TLS, a WAF/CDN if desired, centralised log retention, vulnerability scanning of dependencies and containers, and secret rotation.
3. Run a penetration test before public launch; subscribe to security advisories for Node, Fastify, PostgreSQL and Expo.
4. Define breach-notification and incident-response procedures (see below) and rehearse them.
5. Run a ClamAV daemon (or another scanner via `setScanner`) and set `CLAMAV_HOST`; the built-in structural checks are not a malware engine.
6. Move trip-share and document access behind your CDN with short TTLs if traffic requires.

## Incident response (outline)

1. **Detect** (alerts, user report) -> **Triage** severity (data exposure? money? safety?). 2. **Contain**: revoke sessions (`Admin -> Staff -> Revoke`), rotate secrets, disable payment flags, suspend affected accounts. 3. **Eradicate/Recover** from backups if needed. 4. **Notify**: regulators/users/provider as the law and contracts require (confirm timelines with counsel). 5. **Review**: write a post-mortem and add a regression test.

## Known limitations (honest list)

* Client error reports are scrubbed with pattern matching (tokens, JWTs, phone numbers, e-mail, long numbers); patterns can miss unusual personal data, so treat the table as sensitive and keep the short retention.
* Push payloads carry the notification title/body (trip references, driver first name and plate): they pass through the push provider and the OS notification tray; users can switch push off (`notif_prefs.push`) except for critical safety/trip events.
* Staff tokens are held in `sessionStorage` in the console; a strict CSP is set but XSS would be impactful: the console loads no third-party script (Leaflet is vendored in `admin-web/vendor/leaflet`, with its licence) and a CSP limits scripts to the same origin, but the CSP allows inline *styles* (the map library needs them). The access token lives only for the browser tab; closing the tab signs the person out. The console never shows another person's authenticator secret.
* OTP SMS pumping protection is rate-based only; add provider-side spend caps.
* No device-attestation or fake-GPS detection beyond plausibility checks (speed, out-of-order, arrival radius).
* Email addresses are stored but **email verification is not implemented**.
* Password reset for staff is manual (super admin re-creates the account).


## Staff onboarding and MFA
Staff are created only by invitation: an admin enters name, email and role and receives a one-time link (48 hours, single use, stored hashed). The invitee opens it, chooses their own password and scans their own authenticator QR code, then proves it with a first code. The server never returns the invitee's secret to the inviting admin. A lost authenticator is recovered with the one-time `ADMIN_MFA_RESET_*` variables (see ENVIRONMENT_VARIABLES.md).
