# Feature round 2: growth and partners (backend contract for the mobile app)

Everything below is implemented in `backend/` (migrations 011-013) and the admin console (`views-growth.js`, `views-partner.js`).
Honest labels: **SMS and push delivery is SIMULATED** until providers are connected (`SMS_PROVIDER`, `PUSH_PROVIDER`). Seeded prices, routes and bonuses are **PLACEHOLDERS** (flagged `placeholder: true`, switched off).
All errors use the usual `{ error: { code, message } }`; `message` follows `Accept-Language` (rw, fr, en) and never mixes languages. Money is integer RWF.

## Migrations
| File | Content |
|---|---|
| `011_guest_schedules_fixed_routes.sql` | `bookings.guest_name/guest_phone/guest_lang/guest_purged_at`, `guest_messages`, `ride_schedules`, `ride_schedule_runs`, `fixed_routes` |
| `012_quests_campaigns.sql` | ledger account `INCENTIVE_EXPENSE`, `driver_quests` (+3 inactive PLACEHOLDER rows), `driver_quest_awards`, `campaigns`, `campaign_recipients` |
| `013_partners.sql` | `partners`, `partner_users`, `request_codes.partner_id/bill_to_partner`, `bookings.partner_id/partner_billed`, `staff_invites.partner_id`, `corporate_accounts.partner_id`; `user_roles.role` CHECK list replaced by a foreign key to `roles` so new roles need no migration |

Placeholder fixed routes (Kigali Airport - centre 8,000; Kigali - Musanze 60,000; Huye 90,000; Rubavu 110,000) are seeded **inactive** by `seedGrowth()` (called at the end of `seedCore`).

## 1. Ride for someone else
`POST /bookings` accepts, in addition to the existing body:
```json
{ "quote_id": "...", "payment_method": "cash",
  "for_guest": { "name": "Bob Mugabo", "phone": "0788123456", "language": "fr" } }
```
`language` (rw|fr|en) is the language of the guest's SMS; default = the booker's language. The booker stays passenger and payer; cancellation and fees apply to the booker. Normal rides only (`guest_not_allowed` for Abasare).
Response `booking.guest` (booker / staff view): `{ "name": "Bob Mugabo", "phone_masked": "+25078****456", "language": "fr", "purged": false }`. The full phone is never returned to the booker.
* SMS to the guest (template `guest_assigned` when a driver accepts, `guest_arrived` on arrival, `guest_cancelled` if the booker cancels after the guest was told): driver first name, plate, trip PIN and a live-share link (`/share/<token>`, no sign-in).
* Driver view of the booking: `passenger.first_name` is the guest's first name and `guest: { "first_name": "Bob", "can_contact": true }`. `POST /bookings/:id/guest-contact` (driver, assigned, trip active) returns `{ "first_name": "Bob", "phone": "+250788123456" }` and logs the access; after the trip it answers 409 `guest_contact_unavailable`.
* PIN: the trip PIN is the same as for a passenger (4 digits, 5 attempts).
* Limits (settings `guest.*`): open guest trips per booker 3, per booker per day 5, per guest number per day 3 (409 `guest_limit_active|daily|phone`); own number refused (`guest_same_as_booker`).
* Retention: guest name and phone are erased `retention.guest_days` (default 7) after the trip ended (job `retention`); SMS bodies are erased once sent.

## 2. Recurring rides
All endpoints: rider token (role passenger).
| Method and path | Purpose |
|---|---|
| `POST /ride-schedules` | create (201) |
| `GET /ride-schedules`, `GET /ride-schedules/:id` | list / detail with `next_occurrence` and `recent_runs` |
| `PATCH /ride-schedules/:id` | `label, days_of_week, local_time, end_date, payment_method, skip_dates` |
| `DELETE /ride-schedules/:id` | ends the plan |
| `POST /ride-schedules/:id/pause` / `resume` | |
| `POST /ride-schedules/:id/skip-next` | adds the next date to `skip_dates`; cancels that day's booking if already created (free) |
| `POST /ride-schedules/:id/accept-price` | accept the latest re-quote after a price-change notice |
```json
{ "label": "Commute", "service_id": "moto", "pickup": {"lat":-1.954,"lng":30.0927,"name":"Home"}, "dest": {"lat":-1.9496,"lng":30.1262,"name":"Work"},
  "days_of_week": [1,2,3,4,5], "local_time": "07:30", "start_date": "2026-10-12", "end_date": null, "payment_method": "cash" }
```
Abasare plans add `customer_vehicle_id`, optional `hours`, and `owner_attested: true`. `days_of_week` 0 = Sunday; `local_time` is Africa/Kigali. The response carries `expected_total` (the agreed price) and `next_occurrence` (ISO, UTC).
A job (every minute) books the real `SCHEDULED` booking `schedule.lookahead_hours` (24) ahead, never closer than `schedule.min_lead_min` (30), after a fresh quote. If the price differs from `expected_total` by more than `schedule.price_tolerance_pct` (15 %) or nothing is available, **nothing is booked** and the rider gets a notification (`schedule_price_changed` / `schedule_no_coverage`, in-app, push, SMS). The job is idempotent per plan and date (unique run row plus the booking idempotency key `sched-<id>-<date>`); coverage failures are retried until shortly before the start.

## 3. Fixed-price routes
`POST /fares/estimate` is unchanged for the client, but when pickup and destination match an **active** fixed route (either direction if bidirectional, inside the circles, inside the validity window) an extra option is returned next to the metered option of the same service:
```json
{ "service_id": "standard", "fixed_price": true, "fixed_route": { "id": "...", "name_en": "Kigali Airport - City centre", "name_rw": "...", "name_fr": "Aéroport de Kigali - Centre-ville" },
  "quote_id": "...", "fare": { "subtotal": 9000, "tax": 1620, "total": 10620, "lines": [
    { "code": "fixed_route", "label_en": "Fixed price: Kigali Airport - City centre", "label_rw": "Igiciro kidahinduka: ...", "label_fr": "Prix fixe : Aéroport de Kigali - Centre-ville", "amount": 9000 },
    { "code": "tax", "label_en": "Tax", "label_rw": "Umusoro", "label_fr": "Taxe", "amount": 1620 } ] } }
```
Booking uses the normal `quote_id` flow. The price is the **fare subtotal**: tax (pricing rule) is added and commission is taken on it as for metered fares. Intercity options are offered even when the destination is outside the service zone.
Admin (`pricing.manage` to edit, `pricing.approve` to approve; audited): `GET/POST /admin/fixed-routes`, `PATCH /admin/fixed-routes/:id`, `POST .../:id/approve` (body `confirm_placeholder_price`), `POST .../:id/reject`. A price change or switching a route on is a *pending* change that a second person approves (setting `pricing.self_approval`); switching off is immediate. Approving a PLACEHOLDER route without setting its price is refused (`placeholder_price`).

## 4. Driver quests
Driver token. Titles/descriptions come in all three languages plus `title`/`description` in the request language.
* `GET /drivers/me/quests`
```json
{ "quests": [ { "id": "...", "kind": "trips", "window": "daily", "target": 5, "reward": 1500, "title": "Cinq courses aujourd'hui", "title_rw": "...", "title_fr": "...", "title_en": "...",
    "period": { "key": "D:2026-10-12", "starts_at": "...", "ends_at": "..." }, "progress": 3, "percent": 60, "completed": false, "budget_exhausted": false, "placeholder": false } ] }
```
* `GET /drivers/me/quests/history` -> `{ "awards": [ { "quest_id", "period_key", "amount", "progress", "created_at", "title" } ] }`.
* Kinds: `trips` (completed trips), `earnings` (sum of final fares), `streak` (consecutive Kigali days with a trip; weekly only), `peak_hours` (trips completed in `quests.peak_hours`, default 07-08 and 17-18). Windows: `daily` (Kigali day) or `weekly` (Monday-Sunday). Optional service filter, date range, budget cap.
* Completing a quest credits `reward` once per quest, driver and period: ledger `Dr INCENTIVE_EXPENSE / Cr DRIVER_PAYABLE`, evaluated when a trip completes and by a 5-minute sweep; exhausted budget means no award. Notification `quest_bonus`.
* Admin (`growth.manage`): `GET/POST /admin/quests`, `PATCH /admin/quests/:id`, `GET /admin/quests/:id/awards` (budget `spent`, `budget_remaining`).

## 5. Demand heat map
* `GET /drivers/me/heatmap` (approved **and online** drivers, else 403 `heatmap_unavailable`):
```json
{ "cell_size_m": 500, "k_min": 3, "generated_at": "...", "windows": {
  "now": { "minutes": 15, "cells": [ { "lat": -1.95375, "lng": 30.09225, "intensity": 1, "hint": "heat.unserved" } ] },
  "last_hour": { "minutes": 60, "cells": [] }, "same_hour_last_week": { "minutes": 60, "offset_days": 7, "cells": [] } } }
```
`hint` keys for the client to localise: `heat.unserved` (many requests without a driver), `heat.high`, `heat.busy`, `heat.some`. No counts for drivers.
* `GET /admin/heatmap` (`analytics.view`): same plus `requests` and `unmatched` per cell.
* Privacy: cells with fewer than `heatmap.k_min` (default and minimum 3) **distinct requesters** are never returned; scheduled bookings are excluded; result cached `heatmap.cache_s` (60 s).

## 6. Campaigns (admin, permission `growth.manage`)
`GET/POST /admin/campaigns`, `GET/PATCH /admin/campaigns/:id` (draft only), `POST /admin/campaigns/preview` `{channel, segment}`, `POST .../:id/schedule` `{scheduled_at?}`, `POST .../:id/cancel`, `POST .../:id/test-send` `{lang}`.
```json
{ "name": "Welcome back", "channel": "sms", "segment": { "type": "inactive_passengers", "days": 30 },
  "title_rw": "...", "title_fr": "...", "title_en": "...", "msg_rw": "...", "msg_fr": "...", "msg_en": "..." }
```
Segments: `all_passengers`, `all_drivers`, `inactive_passengers{days}`, `corporate_members{corporate_id?}`, `zone{zone_id,role}`, `language{lang,role?}`, `phone_list{phones[]}` (registered users only), `abasare_owners`. Status: draft, scheduled, sending, done, cancelled; `stats` = targeted, sent, skipped_optout, skipped_cap, skipped_no_channel, skipped_no_consent.
Rules: all three languages required; each person receives only the text of their own language (unsupported `sw` falls back to rw); only users with `notif_prefs.marketing = true` (opt-in; re-checked at send time); no sending 21:00-07:00 Kigali (`campaign.quiet_*`); one row per person per campaign; at most `campaign.max_per_user_per_day` (1) marketing messages per rolling 24 h across campaigns; batches of `campaign.batch_size`; audience over `campaign.max_recipients` refused. Delivery through the `notifications` table (SMS and push workers); in-app copy for push and inapp channels. Everything is audited.

## 7. Venue partners
* Admin (`partners.manage`, business_manager and super_admin): `GET/POST /admin/partners`, `GET/PATCH /admin/partners/:id`, `POST /admin/partners/:id/codes` `{code_id, bill_to_partner}`, `DELETE .../codes/:codeId`, `POST .../invite` `{email,name}` (staff invite flow, role `partner_manager`, bound to the partner on activation), `GET .../statement?month=YYYY-MM`, `POST .../invoice` `{month}`. The generic `/admin/staff/invites` refuses the partner role.
* Partner portal (`partner.portal`, role `partner_manager`; the partner is resolved from the session, never from the request): `GET /partner/me`, `/partner/codes`, `/partner/requests?limit&before`, `/partner/statement?month=`. Responses contain no rider, guest or driver identity.
* Billing: a booking sent with `payment_method: "partner"` and a `request_code` whose code has `bill_to_partner` is created as a corporate-method booking against the partner's hidden corporate account (`payer_type: corporate`, `partner_billed: true`): no personal charge, ledger `CORPORATE_RECEIVABLE`, monthly invoice in `corporate_invoices` (unique per period). Guards: partner active, `billing_terms.max_fare`, `billing_terms.monthly_cap`, `partner.max_billed_per_user_per_day`.

## Settings added (group "Growth & partners", all editable in the console)
`guest.max_active_per_user` 3, `guest.max_per_user_per_day` 5, `guest.max_per_phone_per_day` 3, `retention.guest_days` 7, `schedule.max_active_per_user` 5, `schedule.lookahead_hours` 24, `schedule.price_tolerance_pct` 15, `schedule.min_lead_min` 30, `quests.peak_hours` [7,8,17,18] (PLACEHOLDER), `heatmap.k_min` 3, `heatmap.cache_s` 60, `campaign.batch_size` 200, `campaign.max_recipients` 5000, `campaign.max_per_user_per_day` 1, `campaign.quiet_start_hour` 21, `campaign.quiet_end_hour` 7, `partner.max_billed_per_user_per_day` 4.

## New permissions and role
`growth.manage` and `partners.manage` (business_manager), `partner.portal` (new role `partner_manager`, added to `STAFF_ROLES`). Admin console mirror in `core.js` updated; tabs: Fixed-price routes, Driver quests, Campaigns, Demand map, Venue partners, and "Your venue" for partner managers.

## Jobs added (in `jobs.ts` via `registerGrowthJobs`)
`guest-sms` 5 s, `ride-schedules` 60 s, `quests` 5 min, `campaigns` 30 s; retention extended (`growthRetention`).

## Notification templates added (rw/fr/en)
`guest_assigned`, `guest_arrived`, `guest_cancelled`, `schedule_booked`, `schedule_price_changed`, `schedule_no_coverage`, `quest_bonus`, `campaign`.

## Caveats
* Guest SMS and campaign SMS/push go through the simulated providers until connected; nothing leaves the server in dev/test.
* Quest bonuses are credited when the trip completes (before cash is collected); a later refund does not claw the bonus back.
* "Same hour last week" is a 60-minute window centred on this moment one week ago; "now" is the last 15 minutes.
* The marketing default (`notif_prefs.marketing = false`) means an audience is empty until riders opt in (the mobile app needs a toggle).
* Partner-billed rides: the rider's cancellation fee (if any) is still a personal debt of the rider.
* The heat map hints and campaign texts are not auto-translated: hints are keys, campaign texts are written per language by staff.
