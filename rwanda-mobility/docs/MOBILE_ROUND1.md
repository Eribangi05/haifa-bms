# Mobile Round 1 progress notes

Own scratch DB `rm_e2e_m1`, backend :8101 (PID in /tmp/rm-m1-backend.pid), web :8111 serving /tmp/rm-web-r1. Strings: only locales/r1.{en,rw,fr}.ts, GENERATED from scratchpad/gen.py + str/*.py (if lost, edit the r1 files directly).

Status (code written, tsc clean, unit tests green; e2e not yet run):
- [x] 8 Appearance/privacy: lib/palette.ts, prefs.ts, appearance.ts, lock.ts, biometric.ts; ui/theme.ts (mutable C + applyPalette), ui/AppLock.tsx, screens/trust/appearance.tsx, net.ts `lowData` option (x-lite + ETag/304), usePoll x2.5 in low-data, RemoteImage/MapBox lite, App.tsx remount key on theme change.
- [x] 3 Rate+tags+tip: screens/trust/rate.tsx (route r1rate), Done card stars open it; driver feedback: screens/trust/feedback.tsx (button in driver Working).
- [x] 4 Favourites/blocked: screens/trust/favouriteDrivers.tsx (R1DriverPrefs on Done + rate screen; My drivers in Profile), Options switch prefer_favourite.
- [x] 6 Badges: screens/trust/badges.tsx used in DriverCard + My drivers + feedback.
- [x] 1 Trusted contacts (screens/trust/contacts.tsx in Profile), [x] 2 Share mgmt (screens/trust/shareTrip.tsx modal from Track share chip, incl. per-trip auto_share + safety_checks switches), [x] 5 Safety check (screens/trust/safety.tsx R1SafetyLayer on Track, push routing in lib/push.ts via lib/r1.ts safetyRoute), [x] 7 Nav hand-off (screens/trust/navHandoff.tsx in driver activeTrip) + R1DriverEta countdown on Track.
- [ ] e2e/r1-e2e.mjs, regression runs, docs rows.

Backend gap found: passenger booking view has NO driver id (`driver.id`), so favourite/block buttons on a finished trip are hidden unless the server adds it (code reads driver.id / driver.driver_id / driver_id). Push data carries `template_key` (+ref), not booking_id: routing uses template_key and Track falls back to the active booking.
- ALL DONE: r1 (rw+fr), app, driver, abasare, scan, i18n, responsive, layout, r2, r3 e2e exit 0 on one stack (rm_e2e_m1:8101/8111); tsc clean; npm test green. Docs rows added.
