# Round 1 features: safety, trust, tips, low data

API contract for the mobile app. All routes are under `/api/v1` unless stated. Auth is the normal bearer token. Errors keep the usual shape `{ "error": { "code", "message", "details" } }` with `message` in the caller's `Accept-Language` (rw / fr / en, never mixed).

**Honest labels.** SMS and push delivery is **SIMULATED** until real providers are connected (`SMS_PROVIDER=console`, `PUSH_PROVIDER=none`): rows are queued and "sent" to the in-memory outbox. MoMo tips run against the MoMo simulator until live credentials exist. No safety feature ever claims that police, an ambulance or any agency was contacted.

Migrations: `009_safety_sharing.sql`, `010_trust_tips.sql` (additive, idempotent). Library added: `@fastify/compress` 9.2.0.

## 1. Trusted contacts that auto-notify

The existing emergency-contact routes are `/users/me/emergency-contacts` (not `/users/me/contacts`).

```
GET    /users/me/emergency-contacts
POST   /users/me/emergency-contacts   { "name":"Maman", "phone":"0788111222", "notify_on_trip":true, "lang":"fr" }
PATCH  /users/me/emergency-contacts/:id   { "name"?, "notify_on_trip"?, "lang"? }
DELETE /users/me/emergency-contacts/:id
GET/PATCH /users/me/safety-prefs   { "auto_share": true }        // passenger master switch (default true)
PATCH  /bookings/:id/safety-settings   { "auto_share"?: false, "safety_checks"?: false }   // per trip
```
Response contact: `{ "id","name","phone":"+250788111222","notify_on_trip":true,"lang":"fr" }` (`lang` default `rw`, one of rw/fr/en).

Behaviour: when a trip becomes IN_PROGRESS (PIN start or staff PIN override) every contact with `notify_on_trip` gets one SMS in **the contact's own language**: passenger first name, driver first name, plate and a **personal live-share link** (`/share/<token>?lang=fr`). On completion the same contacts get "arrived safely". A contact receives each message at most once per trip. Nothing is sent when the contact did not opt in, the passenger's `auto_share` is off, the trip's `auto_share` is off, or the number is opted out. The passenger's surname and phone are never included.

Opt-out: the share page has a "Stop these messages" button (`POST /share/:token/stop`, public, rate limited) that records the number in `sms_opt_outs`, switches `notify_on_trip` off for that number and revokes its links. Staff can add or remove opt-outs (`/admin/safety/opt-outs`, permission `safety.respond`).

Implementation note: contact SMS rows live in `notifications` with `to_phone`; they never appear in the passenger's in-app list.

## 2. Live share v2

```
POST   /bookings/:id/share   { "ttl_minutes":240, "hide_destination":false } -> { "url","token","expires_at","hide_destination" }
GET    /bookings/:id/shares  -> { "shares":[{ "id","created_at","expires_at","revoked_at","auto","hide_destination","contact_name" }] }
DELETE /bookings/:id/share/:shareId       // revoke one link
DELETE /bookings/:id/share                // revoke all (existing)
GET    /share/:token   (Accept: application/json)   // public, no login
```
Public JSON (no phone, no passenger identity, no fare):
```json
{ "status":"IN_PROGRESS","live":true,"ended":false,"destination":"Kimironko",
  "driver":{ "first_name":"Eric","plate":"RD123A","vehicle":"White Toyota Test" },
  "location":{ "lat":-1.95,"lng":30.09,"at":"2026-10-08T10:00:00Z","stale":false },
  "eta_s":420,"eta_target":"destination","updated_at":"...","expires_at":"...","poll_after_s":10,"can_stop":true }
```
`eta_target` is `pickup` before boarding, `destination` during the trip. `stale` is true when the last position is older than 90 s. Expiry: the link stops working `share.expiry_after_trip_min` (default 60) minutes after the trip ends (or at its own `expires_at`, whichever is first). Revoked/expired links answer 404. HTML page (`Accept: text/html`, `?lang=`): auto-refreshes (pauses in a hidden tab, stops after the trip ends), shows ETA, vehicle and plate, status, "updated at", a stale-position warning; fully localised in rw/fr/en.

## 3. Tags and tips

`GET /config` now includes:
```json
{ "rating_tags": { "ride":[{ "id":"clean_car","kind":"positive","scope":"ride","label":{"rw":"Imodoka isukuye","fr":"Voiture propre","en":"Clean car"} }, ...],
                   "abasare":[{ "id":"careful_driving", ... }, ...] },
  "tips": { "enabled":true,"min_amount":100,"max_amount":20000,"methods":["cash_tip","mtn_momo"],"commission":0 },
  "safety": { "checks_enabled":true,"response_wait_min":3 } }
```
Ride tags: positive `clean_car polite safe_driving knows_route on_time helpful`; negative `unsafe rude dirty_car late bad_route`. Abasare bookings (own car) use `careful_driving punctual car_care respectful` plus the negatives `unsafe rude late`. Unknown tags: `400 invalid_tag`.

```
POST /bookings/:id/ratings  { "score":5, "comment"?, "tags":["polite","clean_car"],
                              "tip"?: { "amount":1000, "method":"mtn_momo", "msisdn":"0788123456" } }
POST /bookings/:id/tip      { "amount":500, "method":"cash_tip" }
GET  /bookings/:id/tip      -> { "tip": { "amount","method","status" } | null }
GET  /drivers/me/feedback   -> { "rating_avg","rating_count","tags":{"polite":4},"tips":{"tips","momo_total","cash_total_informational"},"badges":[...],"catalogue":{...} }
```
Tip response: `{ "id","booking_id","amount":1000,"method":"mtn_momo","status":"SUCCESS|PENDING|FAILED|recorded","payment_id","note" }`.

* `mtn_momo`: a separate `payments` row of **kind `tip`**, never part of the fare; on success a balanced ledger transaction debits `PROVIDER_CLEARING` and credits `DRIVER_PAYABLE` (owner = driver) for **100%**: no commission, no fleet share. Processor fee, if any, is the platform's cost. Poll `GET /payments/:id` like a fare payment. A FAILED/CANCELLED tip can be retried.
* `cash_tip`: informational only (booking event `cash_tip`, no payment, no ledger): the cash went hand to hand.
* Guards: tips enabled; trip completed and within 7 days; passenger only; **one tip per booking** (`tip_exists`); `tip_too_low` / `tip_too_high` with `details.min|max`; mobile-money number validated; route rate limit `TIP_RATE_MAX` (6/min). When a tip rides on the rating request the rating is saved first; if the tip is then refused the error is returned and the tip can be retried with `POST /bookings/:id/tip`.
* Fare payment flows ignore tip payments (`kind='fare'` filters in booking view, receipts, switch method, refunds, reports).

## 4. Favourite and blocked drivers

```
GET    /users/me/drivers                  -> { "drivers":[{ "driver_id","kind":"favourite|blocked","first_name","rating_avg","trips_together","badges"? }] }
PUT    /users/me/drivers/:driverId  { "kind":"favourite" }   // 409 not_ridden unless you completed a trip with this driver
DELETE /users/me/drivers/:driverId
POST   /bookings  { ..., "prefer_favourite": false }          // default true
```
Private to the passenger: the driver is never told. Dispatch (and the supply count in fare estimates) excludes blocked drivers. Favourites rank as if `dispatch.favourite_boost_s` seconds closer (default 240; 0 = off; applied as ~7 m per second under the `nearest` strategy). Limit 100 entries.

## 5. Route deviation and long-stop safety

Job `safety-checks` (every 30 s, advisory-locked, idempotent) looks at IN_PROGRESS trips (not hourly Abasare hire). Settings (Settings page, group Safety & tracking): `safety.checks_enabled`, `safety.deviation_corridor_m` (700), `safety.road_factor_pct` (150), `safety.stop_minutes` (10), `safety.stop_radius_m` (75), `safety.check_interval_s` (60), `safety.response_wait_min` (3), `safety.recheck_cooldown_min` (10), `safety.max_alerts_per_trip` (3).

* Deviation: `excess = d(pickup,P) + d(P,dest) - d(pickup,dest)` (haversine) against `2*corridor + straight*(road_factor-100)/200`; needs a location fresher than 2 min; not judged within 150 m of the destination.
* Long stop: every recorded location of the last `stop_minutes` within `stop_radius_m` of the latest one.
* Creates a `safety_alerts` row, notifies the passenger (templates `safety_check_deviation` / `safety_check_stop`, critical, in-app + push + SMS, in their language: "Are you OK?").
```
GET  /bookings/:id/safety-check    -> { "open": { "id","kind","status":"asked","asked_at","respond_by" } | null }
POST /bookings/:id/safety-check/respond  { "answer":"ok"|"help" }  -> { "status":"ok"|"escalated","case_open":bool }
```
`help`, or no answer by `respond_by`, **escalates**: a `safety_incidents` row (kind `sos`, ref `SOS-...`) plus an urgent, sensitive `support_cases` row (category `safety`), the configured `safety.escalation_contacts` get an SMS (best effort), and the passenger gets `safety_escalated` ("no one has confirmed contact with you yet; call 112 / 912"). A late "ok" after escalation is added as an internal case note and does not close the case. A trip that ends while a check waits closes the alert (`trip_ended`). After "ok" the same kind of check pauses for the cooldown. Passengers disable checks per trip with `PATCH /bookings/:id/safety-settings {"safety_checks":false}`; staff disable globally with the setting.

Staff (`safety.respond`): `GET /admin/safety/alerts?status=`, `POST /admin/safety/alerts/:id/resolve {"note"}`.

## 6. Abasare owner ratings and verified badges

Owners rate through the same `POST /bookings/:id/ratings` with Abasare tags (section 3). Badges are **computed**, never stored (except training), and only for APPROVED drivers:

| id | rule |
|---|---|
| `licence_verified` | approved, current `driving_licence` document |
| `experience` (tier 2/5/10) | licence_verified AND `abasare_skills.licence_since` (declared on the Abasare application, checked against the document by the verifier) |
| `police_clearance_valid` | approved, unexpired `police_clearance` document |
| `trips_completed` (tier 25/100/500/1000) | `driver_profiles.completed_count` |
| `top_rated` | rating_avg >= 4.8 and rating_count >= 10 |
| `training_completed` | staff grant, audited, revocable |

Badge object: `{ "id","tier"?,"label":{"rw","fr","en"} }`. Shown at `driver.badges` in the passenger/staff booking view while the trip is active (passenger-side "offers" do not exist: dispatch offers go to drivers), in `GET /users/me/drivers` for favourites, and in `GET /drivers/me/feedback`.

Staff: `GET /admin/drivers/:id/badges` (`drivers.view`), `POST /admin/drivers/:id/training {"granted":true,"reason":"..."}` (`drivers.review`, reason >= 5 characters, audit `driver.training_granted|revoked`).

## 7. Low-data mode

* **Compression**: `@fastify/compress` (br/gzip/deflate) on responses over 512 bytes when the client sends `Accept-Encoding`.
* **ETag**: `GET /bookings/:id` and `GET /drivers/me/offers` return a weak `ETag` and `Cache-Control: private, no-cache`; send `If-None-Match` to get `304` with an empty body. The tag covers the content (including driver position/ETA) and rotates every 2 minutes so a cached signed photo URL never outlives its 5-minute validity.
* **Lite**: `?lite=1` or header `x-lite: 1` on `GET /bookings/:id`, `/bookings`, `/bookings/active`, `/drivers/me/offers`, `POST /fares/estimate`. Same keys for everything the app needs; removed: itemised `fare_breakdown`, signed `photo_url`, null timestamps/cancel fields, Abasare handover photos/notes, offer car details, and in the estimate the per-line fare breakdown and the three name fields (replaced by `name` in the request language). Lite responses carry `"lite": true`.

Measured with the test fixture (`tests/round1.test.ts` prints it): booking view 1820 B full, 999 B lite, 885 B full+gzip; fare estimate (one service) 2101 B full, 818 B lite; offers 543 B full, 379 B lite. Real trips with photos and Abasare handovers save more.

## 8. Navigation hand-off and live ETA

Driver view (`GET /bookings/:id` as the driver, active trips) gains:
```json
"navigation": { "target":"pickup",
  "pickup":{ "lat":-1.954,"lng":30.0927,"name":"KCC","google_maps":"https://www.google.com/maps/dir/?api=1&destination=-1.954,30.0927&travelmode=driving","waze":"https://waze.com/ul?ll=-1.954,30.0927&navigate=yes","geo":"geo:-1.954,30.0927?q=-1.954,30.0927" },
  "destination":{ ... }, "eta_to_pickup_min":4, "eta_to_destination_min":null }
```
Passenger view gains `driver_eta_s` and `driver_eta_target` (`pickup` before boarding, `destination` in progress; null when the driver's location is older than 5 minutes). Both use the dispatch ETA logic (straight line x 1.5 road factor / vehicle speed) from the driver's latest location, so they refresh as the app polls (use the ETag).

## Admin console

New tab **Trust and safety** (`admin-web/views-safety.js`; visible with `safety.respond` or `drivers.view`): safety checks list with status/response and resolve, opt-outs, tag counts per driver, tip totals, favourite/blocked counts per driver, badge viewer and training grant/revoke.

## Admin endpoints added

`GET /admin/safety/alerts`, `POST /admin/safety/alerts/:id/resolve`, `GET|POST /admin/safety/opt-outs`, `DELETE /admin/safety/opt-outs/:phone` (safety.respond); `GET /admin/trust/tags|tips|favourites`, `GET /admin/drivers/:id/badges` (drivers.view); `POST /admin/drivers/:id/training` (drivers.review). No new permissions: `rbac.ts` is unchanged.

## Caveats

* Contact SMS bodies contain the personal capability link (stored in `notifications.body`, purged by the notification retention job).
* `experience` relies on the declared licence date; it is only shown when the licence document is approved.
* Trusted contacts are not alerted automatically on escalation (only staff escalation contacts are); this is a product decision to take.
* Deviation uses straight-line geometry with a road-factor allowance, not a routed path: dense winding roads may need a larger corridor.
