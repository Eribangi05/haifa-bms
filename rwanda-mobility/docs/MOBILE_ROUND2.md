# Mobile round 2: progress notes (not run on a device)
- [x] Foundations: `src/lib/growthApi.ts` (pure logic), strings in `locales/features/growth.{en,rw,fr}.ts`.
- [x] Items 1-6 UI built: `passenger/r2Guest.tsx`, `r2Repeat.tsx`, `screens/growth/schedules.tsx`, `driver/r2Quests.tsx`, `r2Heatmap.tsx`, `r2GuestContact.tsx`; MapBox `heat` prop; routes `schedules|quests|heatmap` in App.tsx; marketing switch in Profile; fixed-price badge in Options (selection by `optKey`).
- [x] Unit tests `tests/r2.test.ts`.
- Inbox (item 6b): SKIPPED. The contract (FEATURE_ROUND2.md) defines no inbox endpoint and the app does not use `/notifications` (the backend has `GET /notifications` for channel in_app, unused by mobile).
- [ ] e2e `e2e/r2-e2e.mjs` and regression runs.
- e2e (`mobile/e2e/r2-e2e.mjs`): rw guest flow passes (switch, validation, booking, SMS record, driver first name, contact during trip only, history). Rest of the flows being verified. Scratch DB `rm_e2e_m2`, backend :8102, web :8112 (/tmp/rm-web-r2).
- [x] e2e r2 passes (rw+fr, 28 steps). Docs rows added. Regression of existing e2e scripts: see final report.
