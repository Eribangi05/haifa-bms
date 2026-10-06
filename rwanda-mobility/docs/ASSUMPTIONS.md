# Assumptions (all configurable; change in Settings or the database)

| Area | Assumption | Where to change |
|---|---|---|
| Launch zone | Kigali = coarse bounding polygon (lng 29.97-30.22, lat -2.06 to -1.84). Replace with a surveyed boundary. | Admin API `PUT /admin/zones/:id` |
| Tariffs | Moto 400 base + 250/km + 20/min, min 800; Standard 1000 + 700/km + 40/min, min 2000; others similar. **Placeholders**, not market-validated or regulatory-approved. Rounding to nearest 50 RWF; tax 0%. | Fare rules (maker-checker) |
| Commission | 15% default, 12% for moto. | Commission rules (maker-checker) |
| Pricing model | Platform-calculated from an approved schedule. Negotiated fares and surge: built hooks only, **off**. | Feature flags |
| Quote lifetime | 10 minutes. | `booking.quote_ttl_s` |
| Dispatch | Sequential offers (group size 1), 20 s timeout, 4 rounds, radius 3 km growing by 2 km to 12 km, heartbeat <= 60 s. | `dispatch.*` |
| Cancellation | Free for 120 s after assignment, then 500 RWF; no-show after 5 min wait = 1000 RWF; **fees are recorded on the booking but not yet charged automatically** (collection mechanism pending a policy decision). No fee when the driver is at fault. | `booking.*` |
| Arrival | Driver can mark arrival only within 500 m of pickup with a fresh (< 2 min) GPS fix. | `services/bookings.ts` |
| Trip PIN | 4 digits derived from booking id; 5 wrong tries lock it; override only by dispatcher with reason. | |
| Waiting charge | Per-rule free minutes (3) then per-minute rate. | Fare rule |
| Payout policy | Min 5,000 RWF, fee 0, >= 200,000 RWF needs review + different approver. | `payout.*` |
| Refund policy | Always two people; MoMo refunds are recorded in the ledger and paid out manually (`manual_provider_payout_required`). | |
| Rating | 1-5 stars, mutual; passenger rating of a driver updates the driver's average. | |
| Road factor | Road distance = straight line x 1.5 (measured 1.51 on 5 routes). Durations use 24 km/h (car) / 28 km/h (moto) average - recalibrate with real trips. | `services/maps.ts` |
| Phone prefixes | 072, 073, 078, 079 accepted. | `util/phone.ts` |
| Languages | Kinyarwanda (default) and English; French/Kiswahili supported by the schema and templates once translations exist. Kinyarwanda strings were written without a native-speaker review. | `mobile/src/lib/i18n.ts`, `services/i18n.ts` |
| Time | Stored UTC, displayed in Africa/Kigali. | |
| Currency | RWF integers; MTN sandbox needs `MOMO_CURRENCY=EUR`. | |
| Emergency numbers | Police 112, Ambulance 912, Traffic police 113 (verify before launch). | `/config` |
| Documents | Mandatory: national ID, driving licence, profile photo, vehicle registration, insurance (+ inspection for cars); transport permit optional. | `document_requirements` table |
| Retention | Location trail 30 days; OTP rows 2 days. | `retention.*` |
| Abasare tariffs | Drive me home 2,000 + 300/km + 100/km return allowance (min 4,000), night band 22:00-05:00 +1,000; hourly 4,000/h (min 2 h, 3,500/h from 8 h), overtime 2,500 per 30 min after 10 min grace. Based on the 5,000-7,000 RWF reported for night trips; **not validated**. | Fare rules (maker-checker) |
| Abasare commission | 12% introductory. | Commission rules |
| Abasare driver rules | Licence held >= 2 years, mandatory documents: national ID, driving licence, photo, police clearance (expiry required). | `abasare.min_licence_years`, `document_requirements` (type `abasare`) |
| Handover | >= 2 photos at check-in and check-out; owner may report an issue up to 30 min after drop-off; photos purged after 90 days unless a case is open. | `abasare.min_photos`, `abasare.issue_window_min`, `retention.handover_days` |
