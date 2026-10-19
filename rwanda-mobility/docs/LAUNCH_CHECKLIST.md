# Launch checklist (what is left, in order)

Status words follow `FEATURE_STATUS.md`. Items marked **YOU** need accounts, money or legal decisions that only the owner or the client can provide. Do the stages in order: a later stage assumes the earlier ones are done.

## Stage 0. Where things stand (staging)
The service on Render runs in **staging mode**: `APP_ENV=staging`, `OTP_DEV_ECHO=true` (the sign-in code is returned in the API reply and shown in the app), MoMo in `sandbox` (test money, labelled "test mode" in the apps), SMS and push simulated, free hosting that sleeps, and a free database that expires 30 days after creation. This is right for demos with demo data. It is **not safe for real riders**: anyone who knows a phone number can sign in as that person.

## Stage 1. Get ready (no real users yet)
- [ ] **YOU** Hosting: paid Render web service (always on) and a paid Postgres with automatic backups. Or the `deploy/docker-compose.yml` stack with HTTPS. Back up the documents store too (`STORAGE_DIR` or the database when `STORAGE_DRIVER=db`).
- [ ] **YOU** SMS gateway account. Set `SMS_PROVIDER=http`, `SMS_HTTP_URL`, `SMS_HTTP_TOKEN`, then send a real test code to your own phone.
- [ ] **YOU** Push: a Firebase project and an Expo `projectId`, then `PUSH_PROVIDER=expo`. Test with the app closed.
- [ ] **YOU** Real tariffs, commission, night window and cancellation fees in the console (Pricing, Settings). Done for tariffs: check commission and thresholds too.
- [ ] **YOU** Legal: transport and RURA licensing, insurance for owners' cars (Abasare), data-protection registration, final terms and privacy notice in three languages, tax receipts. Proposed fares (`pricing.negotiated`) and parcels stay off until this is settled.
- [ ] **YOU** Rotate the MySQL password in the old `index.php` and remove the file from the repository history if the repo is shared.
- [ ] **YOU** Map tiles: free OpenStreetMap tiles are not allowed at production scale. Choose a paid provider (small change in `mapHtml.ts`) or keep the own PMTiles map.
- [ ] Test the 0.9.9 APK on **three real phones** (low, mid, high end): sign-up, booking, SOS, a driver online for a full shift with the screen locked, battery, offline recovery, camera, map.

## Stage 2. Switch to production (do these together, in this order)
1. Take a backup of the staging database.
2. In Render, set `NODE_ENV=production` and a strong `JWT_SECRET` and `FILE_SIGNING_SECRET`; set `PUBLIC_BASE_URL` to the real address.
3. Set the SMS variables from Stage 1 and confirm a real code arrives.
4. **Remove `OTP_DEV_ECHO` and `APP_ENV=staging`.** After this the code is only sent by SMS. Do not do this before step 3 or nobody can sign in.
5. Remove `BOOTSTRAP_ADMIN_PASSWORD`. Add real staff through Staff, Invite staff member, and write down who holds the lost-authenticator recovery (runbook section 4).
6. Set `TRUST_PROXY=1` behind the host's proxy. Make sure `CORS_ORIGINS` lists only your own addresses.
7. Clear the demo data (console, Demo data, Remove) before real users arrive.
8. MoMo: set `MOMO_MODE=live`, `MOMO_CURRENCY=RWF`, the MTN production keys and a secret `MOMO_CALLBACK_TOKEN` of at least 16 characters, and `MOMO_CALLBACK_URL`. The apps drop the "test mode" label by themselves. Make one small real payment and one refund before opening to riders.
9. Build the release APK with `EXPO_PUBLIC_API_URL=https://<your api>` and sign it with your own key (**YOU** create the release keystore or use Play App Signing; today the APK is debug-signed).
10. Turn on the uptime workflow variable `ABASARE_API_URL` if the address changed, and set up the alerts in runbook section 8.

## Stage 3. Closed pilot
- [ ] One district, about 20 to 100 drivers and 50 or more riders, support staff on the console, a daily look at support cases and client errors.
- [ ] Measure: time to first driver, fulfilment rate, cancellation reasons, payment success, driver earnings per hour, payout time. Compare with the targets in `FINAL_REVIEW.md`.
- [ ] Decide, from the pilot, whether to switch on parcels and proposed fares.

## Stage 4. Public launch
- [ ] Play Store: privacy policy URL, data-safety form, background-location declaration (`ANDROID_BUILD.md`), real-device screenshots, listing copy (`store/LISTING.md`).
- [ ] Native iPhone app: Apple Developer account, then `IOS_BUILD.md`. Until then iPhone users use the web app.
- [ ] Native-speaker review of Kinyarwanda and French texts.
- [ ] Airtel Money, once approved.
