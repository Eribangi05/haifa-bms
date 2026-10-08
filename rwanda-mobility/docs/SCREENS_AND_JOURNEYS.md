# Screens and user journeys

## Android app (passenger and driver modes in one app)

| # | Screen | File | Notes |
|---|---|---|---|
| P01 | Welcome + language (Kinyarwanda/English) | `screens/auth.tsx` `Welcome` | Language switchable later in Profile |
| P02 | Phone number | `Phone` | +250 validation, optional referral code |
| P03 | OTP verification | `Otp` | Resend timer, lockout messages |
| P04 | Location disclosure | `passenger/home.tsx` (consent gate) | Records consent |
| P05 | Home: map, pickup (GPS/pin/landmark/note), destination search, saved, recent, popular, schedule, active-trip card, help, profile | `passenger/home.tsx` | Drag pin to correct GPS; map tap sets destination; offline fallback chips |
| P06 | Ride options: services, ETA, fare, breakdown, promo, payment method (cash / MoMo / company), schedule | `passenger/options.tsx` | "No drivers" shown honestly with alternatives; "estimate" wording |
| P07 | Live trip: searching, driver card (name, rating, vehicle, **plate**), **PIN**, map with driver, chat, share, cancel, SOS | `passenger/track.tsx` | Unconfirmed-booking state when offline |
| P08 | Payment (cash due / MoMo number, waiting, failure fallback to cash) | `passenger/tripParts.tsx` `PayCard` | Server-verified; "test mode" banner when simulated |
| P09 | Receipt + rating + report a problem + rebook | `passenger/tripParts.tsx` `Done` | Rating goes through the offline outbox |
| P10 | Trip history | `history.tsx` | |
| P11 | Profile: name, language, notifications, emergency contacts, referral, companies, privacy requests, become a driver | `profile.tsx` | |
| P12 | Support: FAQ, new case, my cases | `support.tsx` | |
| P13 | SOS modal | `sos.tsx` | Red, separate from normal actions; never claims contact |
| D01 | Driver application: personal, vehicle, payout, **documents** (camera/gallery/PDF + expiry) | `driver/onboarding.tsx` | Statuses incl. info-required & rejection reason |
| D02 | Driver home: online toggle, eligibility reasons, location disclosure, document-expiry banners | `driver/working.tsx` | Online != allowed to work |
| D03 | Trip offers with **earnings before accepting**, pickup distance/ETA, countdown, accept / decline with reason | `driver/offer.tsx` | |
| D04 | Active trip: navigate, en-route, arrived, **PIN entry**, start, complete, cash confirm, no-show, cancel, SOS | `driver/activeTrip.tsx` | Large buttons; "use only when stopped" |
| D05 | Earnings day/week/month, wallet, owed commission, payout request/history | `driver/earnings.tsx` | |
| A01 | Abasare mode on Home: car picker, Drive me home / By the hour (2-12 h), night note | `passenger/home.tsx` | Switch **Ride / Abasare** |
| A02 | My cars: add/remove, class, manual/automatic, insurance confirmation | `cars.tsx` | Also from Profile |
| A03 | Abasare price breakdown with return allowance/night/overtime rules + ownership & insurance attestation | `passenger/options.tsx` | Confirm is blocked until attested |
| A04 | Live trip: driver photo, years driving, rating, **your plate**, check-in/check-out review with photos (Looks right / Report an issue) | `passenger/track.tsx`, `passenger/tripParts.tsx` | |
| A05 | Abasare driver application: path choice (own vehicle / Abasare / both), skills, licence date, return mode, documents incl. police clearance | `driver/onboarding.tsx` | |
| A06 | Driver: accept-jobs toggles (Rides/Abasare), Abasare offer card, customer's-car details, **check-in/check-out form** (photos, odometer, fuel, notes), hourly timer, Moto ride home | `driver/handover.tsx`, `driver/activeTrip.tsx` | |
| Q01 | Scan a venue code: native QR camera (framing guide, torch, permission rationale + open-settings fallback), **type the code or paste the URL** (only option on web), venue confirmation card (name, pickup note, "Pickup point set", out-of-zone warning), then Home with pickup = venue and the code's default service | `scan.tsx` `Scan`, `ui/QrCamera.tsx` | Entry: "Scan a code" chip on Home (Ride and Abasare); deep link `abasare://r/<CODE>?svc=` (signed out: remembered through phone/OTP/consent); web: `/?code=<CODE>`. Booking carries `request_code` |
| B01 | Company booking | `Options` (company payment chip) + Profile | Cost centre, PO reference, limits enforced server-side |

## Cross-cutting behaviour of every mobile screen

* **One screen shell** (`ui/components.tsx` `Screen`): safe-area insets on all four sides (notch, gesture bar, 3-button bar), header with a labelled 44 px **Back** control at top-left, sticky footer for the primary action (`max(inset.bottom, 12) + gap`), keyboard avoidance, pull-to-refresh and a 640 px content column on tablets/foldables.
* **Back**: header Back on every non-root screen; Android system back/gesture closes sheets and modals first (`useBackHandler`), then pops; on Home (and driver home) a second press within 2 s exits; from the middle of a flow (e.g. Track after booking) it returns Home instead of closing the app.
* **Permissions**: location (denied / blocked / GPS off) shows a recovery card with Allow or Open settings; camera refusal explains and offers settings; notifications refusal is shown in Profile.
* **Errors** are never raw: network, timeout, session and server problems use the app language (`err.*`); API errors use the server's localised message.

## Admin console (`/admin/`)

English only; the menu shows only the pages the signed-in role may use (see `SUPPORT_OPERATIONS_GUIDE.md` for the role table). Same layout on laptop, tablet (drawer menu) and phone; light and dark theme.

* **Operations**: Overview (needs-attention cards, KPIs with change vs the previous period and 7-day trends, zone table) - Live map (drivers and active bookings, refreshed every 5 s) - Bookings (search, status filter, timeline, assign from a driver list, restart, PIN override, cancel, dispute, refund request) - Drivers (queue, documents with signed links, approve/reject/suspend/reinstate, only the actions valid for the current status) - **Abasare** (applications; handover evidence on booking details) - Safety (SOS/incidents).
* **People and support**: Passengers - Support (cases, internal notes, SLA) - Privacy requests.
* **Money**: Finance with sub-pages: Ledger and exports, Transactions, Refunds, Payouts, Cancellation fee debts, Reconciliation.
* **Business**: Pricing (fare rules, peak/off-peak windows, commissions with approval) - Services (per zone) - Promotions - Request codes (venue QR posters) - Business & fleets (verify, invoice, revenue share).
* **Administration**: Settings (integration status, flags, runtime settings, templates) - Audit log (click a row for before/after) - Staff & roles (invite by link, revoke sessions, disable).

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
10. **Pay with credit (mobile, round 3)**: Home (credit chip) -> My credit (balance, statement, loyalty tier ring, redeem points in steps of 100) -> Options: "Use my credit" (all, or part with cash/MoMo for the rest, breakdown before confirming) -> booking reserves credit -> trip -> Done shows credit used and the remainder.
11. **Abasare deposit (mobile, round 3)**: Options -> confirm -> Track shows "Deposit needed" (amount, pay by credit or MoMo, pending / slow / failed / retry, cancel returns the deposit as credit) -> after the server confirms payment the booking is dispatched -> at completion the receipt shows the deposit used (excess returned as credit).
12. **Claim (mobile, round 3)**: finished trip (Done card or History) -> Report a problem -> type, description, amount, photos -> My claims (status chips, due times) -> claim detail (timeline, evidence, before/after handover photos for Abasare, staff decision, settlement) -> the other party replies from "Claims about me" (driver mode) or Profile -> claimant answers a request for more information or withdraws. Push taps on `claim_*` notifications open My claims.
13. **Book without data**: Profile and Help show the USSD card (shortcode only if `/config` exposes one; otherwise generic text).

14. **Ride for someone else (mobile, round 2)**: Home ("For someone else" chip) or Options -> "Book for someone else" -> guest name, phone, SMS language -> confirm -> Track shows who the ride is for; the guest gets SMS with driver, plate, PIN and a tracking link; the driver sees the guest's first name and may tap Contact guest only during the trip. Not available for Abasare.
15. **Recurring ride (mobile, round 2)**: Options -> "Repeat this ride" (days, time, start/end date) -> Save -> Recurring rides (also from Home and Profile): pause/resume, skip next, end, accept a new price when the fare changed; warnings when no driver was available. Screens: `screens/r2Schedules.tsx`, `passenger/r2Repeat.tsx`, `passenger/r2Guest.tsx`.
16. **Driver quests and demand map (mobile, round 2)**: Driver home -> Quests & bonuses card (full screen: progress, deadline, history, celebration) and, when online, "Where to go" (heat cells now / last hour / same hour last week; hints only, no counts). Screens: `driver/r2Quests.tsx`, `driver/r2Heatmap.tsx`.
17. **Marketing consent (mobile, round 2)**: Profile > Notifications > "Offers and news from Abasare" (off by default; explains SMS/push and quiet hours 21:00-07:00).
