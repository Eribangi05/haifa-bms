# Launch checklist (what is left, in order)

Status words follow `FEATURE_STATUS.md`. Items marked **YOU** need accounts, money or legal decisions that only the owner/client can provide.

## A. Before any real user
- [ ] **Install and test the APK on real phones** (a cheap low-RAM Android 8-10 phone, a mid-range one, one emulator). Walk: sign-up, booking, tracking, SOS, driver online with screen locked, Abasare handover with real camera. Fix what breaks. (Not yet done: only the browser build of the screens has been exercised.)
- [ ] **Deploy** with `deploy/docker-compose.yml` (HTTPS via Caddy; copy `deploy/.env.example`, fill every value), real secrets, `TRUST_PROXY=1`, a persistent volume for uploaded documents, nightly `deploy/backup.sh` copied off-host, and a **restore drill that you have actually run** ([`OPERATIONS_RUNBOOK.md`](OPERATIONS_RUNBOOK.md)). `APP_ENV` and `OTP_DEV_ECHO` must not be set. Keep `DATA_ENC_KEY` in a separate password manager entry.
- [ ] Remove `BOOTSTRAP_ADMIN_PASSWORD` after the first start, add real staff through **Staff -> Invite staff member**, and write down who holds the recovery procedure for a lost authenticator (runbook section 4).
- [ ] Set up the alerts in runbook section 8 (uptime on `/ready`, stuck payments, failed SMS, open SOS).
- [ ] Build the release with `EXPO_PUBLIC_API_URL=https://<your api>`; cleartext HTTP is off by default.
- [ ] **YOU** Create the release keystore / Play App Signing (the APK is debug-signed).
- [ ] **YOU** Rotate the MySQL password in the legacy `index.php` (treat it as leaked) and remove the file from the repository history if the repo is shared.
- [ ] **YOU** SMS gateway account (OTP cannot reach real phones until `SMS_PROVIDER` is configured).
- [ ] **YOU** MTN MoMo sandbox then production credentials; Airtel later.
- [ ] **YOU** Firebase project / EAS `projectId` so push notifications can be delivered (backend and app code are ready).
- [ ] **YOU** Map tiles: free OpenStreetMap tiles are not allowed for production-scale use. Choose a paid tile provider or Google Maps (key needed; integration is a small change in `mapHtml.ts`/`MapView`). The operations console's Live map uses the same free tiles (`admin-web/views-ops.js`, plus the `img-src` rule in `admin-web/index.html`): change both when you switch provider.

## B. Business and legal (**YOU**)
- [ ] Transport / RURA licensing for moto, taxi and hire-with-driver; data-protection registration; terms and privacy notice (final text, three languages).
- [ ] Insurance and liability model for Abasare drivers driving owners' cars (open questions in `ABASARE.md` section 6).
- [ ] Final tariffs, commission, night window, cancellation fees (current numbers are placeholders).
- [ ] Police-clearance and licence-check process for Abasare applicants; support staff roster and escalation numbers.

## C. Pilot
- [ ] Closed pilot: ~20 drivers + ~50 riders/owners in one zone, ops staff on the console, daily review of support cases and client errors (`GET /admin/client-errors`; no console page yet).
- [ ] Collect: time-to-match, cancellation reasons, payment failures, handover disputes.

## D. Play Store
- [ ] Privacy policy URL, data-safety form, background-location / foreground-service declaration (see `ANDROID_BUILD.md`), real-device screenshots, listing copy (`store/LISTING.md`), assets (`store/`).
