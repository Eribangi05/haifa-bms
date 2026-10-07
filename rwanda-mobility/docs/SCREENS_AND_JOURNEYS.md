# Screens and user journeys

## Android app (passenger and driver modes in one app)

| # | Screen | File | Notes |
|---|---|---|---|
| P01 | Welcome + language (Kinyarwanda/English) | `screens/auth.tsx` `Welcome` | Language switchable later in Profile |
| P02 | Phone number | `Phone` | +250 validation, optional referral code |
| P03 | OTP verification | `Otp` | Resend timer, lockout messages |
| P04 | Location disclosure | `passenger.tsx` `Home` (consent gate) | Records consent |
| P05 | Home: map, pickup (GPS/pin/landmark/note), destination search, saved, recent, popular, schedule, active-trip card, help, profile | `Home` | Drag pin to correct GPS; map tap sets destination; offline fallback chips |
| P06 | Ride options: services, ETA, fare, breakdown, promo, payment method (cash / MoMo / company), schedule | `Options` | "No drivers" shown honestly with alternatives; "estimate" wording |
| P07 | Live trip: searching, driver card (name, rating, vehicle, **plate**), **PIN**, map with driver, chat, share, cancel, SOS | `Track` | Unconfirmed-booking state when offline |
| P08 | Payment (cash due / MoMo number, waiting, failure fallback to cash) | `PayCard` | Server-verified; "test mode" banner when simulated |
| P09 | Receipt + rating + report a problem + rebook | `Done` | Rating goes through the offline outbox |
| P10 | Trip history | `shared.tsx` `History` | |
| P11 | Profile: name, language, notifications, emergency contacts, referral, companies, privacy requests, become a driver | `Profile` | |
| P12 | Support: FAQ, new case, my cases | `Support` | |
| P13 | SOS modal | `SosButton` | Red, separate from normal actions; never claims contact |
| D01 | Driver application: personal, vehicle, payout, **documents** (camera/gallery/PDF + expiry) | `driver.tsx` `Onboarding` | Statuses incl. info-required & rejection reason |
| D02 | Driver home: online toggle, eligibility reasons, location disclosure, document-expiry banners | `Working` | Online != allowed to work |
| D03 | Trip offers with **earnings before accepting**, pickup distance/ETA, countdown, accept / decline with reason | `OfferCard` | |
| D04 | Active trip: navigate, en-route, arrived, **PIN entry**, start, complete, cash confirm, no-show, cancel, SOS | `ActiveTrip` | Large buttons; "use only when stopped" |
| D05 | Earnings day/week/month, wallet, owed commission, payout request/history | `Earnings` | |
| A01 | Abasare mode on Home: car picker, Drive me home / By the hour (2-12 h), night note | `passenger.tsx` `Home` | Switch **Ride / Abasare** |
| A02 | My cars: add/remove, class, manual/automatic, insurance confirmation | `cars.tsx` | Also from Profile |
| A03 | Abasare price breakdown with return allowance/night/overtime rules + ownership & insurance attestation | `Options` | Confirm is blocked until attested |
| A04 | Live trip: driver photo, years driving, rating, **your plate**, check-in/check-out review with photos (Looks right / Report an issue) | `Track`, `HandoverReview` | |
| A05 | Abasare driver application: path choice (own vehicle / Abasare / both), skills, licence date, return mode, documents incl. police clearance | `driver.tsx` `Onboarding` | |
| A06 | Driver: accept-jobs toggles (Rides/Abasare), Abasare offer card, customer's-car details, **check-in/check-out form** (photos, odometer, fuel, notes), hourly timer, Moto ride home | `driver.tsx` | |
| Q01 | Scan a venue code: native QR camera (framing guide, torch, permission rationale + open-settings fallback), **type the code or paste the URL** (only option on web), venue confirmation card (name, pickup note, "Pickup point set", out-of-zone warning), then Home with pickup = venue and the code's default service | `scan.tsx` `Scan`, `ui/QrCamera.tsx` | Entry: "Scan a code" chip on Home (Ride and Abasare); deep link `abasare://r/<CODE>?svc=` (signed out: remembered through phone/OTP/consent); web: `/?code=<CODE>`. Booking carries `request_code` |
| B01 | Company booking | `Options` (company payment chip) + Profile | Cost centre, PO reference, limits enforced server-side |

## Admin console (`/admin/`)

(New: **Abasare** tab for applications; handover evidence on booking details.)

Overview KPIs - Live map - Bookings (search, timeline, assign, restart, PIN override, cancel, dispute, refund request) - Drivers (queue, documents with signed links, approve/reject/suspend/reinstate) - Passengers - Support (cases, internal notes, SLA) - Safety (SOS/incidents) - Pricing (fare rules, commissions with approval) - Promotions - Finance (ledger position, transactions, refunds, payouts, reconciliation, exports) - Business & fleets (verify, invoice, revenue share) - Privacy requests - Settings (integration status, flags, runtime settings, templates) - Audit log - Staff & roles.

## Key journeys

1. **Passenger first ride**: Welcome -> language -> phone -> OTP -> location consent -> pick destination -> options -> confirm -> searching -> driver assigned (PIN, plate) -> arrived -> PIN to driver -> trip -> complete -> pay -> rate.
2. **Driver onboarding**: become a driver -> application -> upload documents -> submit -> verifier reviews each document -> approves -> driver goes online (consent) -> receives offer -> accepts.
3. **Dispatch failure**: no drivers -> options screen shows alternatives; after max rounds booking becomes `NO_DRIVER_FOUND` and the passenger is notified (SMS, critical).
4. **Mobile money**: complete -> enter MoMo number -> server requests payment -> app polls -> provider confirms -> settled once; failed -> retry or pay cash.
5. **Refund**: support lead requests -> finance approver approves (different person) -> ledger reversal -> booking `REFUNDED/PARTIALLY_REFUNDED`.
6. **Payout**: driver requests -> finance reviews -> approver approves (large ones: different person) -> paid manually -> ledger cleared.
7. **Emergency**: SOS -> incident + urgent case + SMS to duty phones -> responder acknowledges -> calls user/112 -> resolves with facts.
8. **Offline**: booking submit with no network -> stored in outbox with an idempotency key, UI says "not confirmed" -> reconnect -> sent once.
9. **Venue QR**: scan (or open the link) -> [sign in first if needed; the code is remembered] -> venue card -> Home with the venue as pickup -> destination -> options -> booking stores `request_code_id`. Invalid/expired code shows the server-localised message; offline shows a retry.
