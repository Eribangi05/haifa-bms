# Product requirements (concise)

## Vision
A trusted ride marketplace for Rwanda (Kigali first): verified drivers, transparent fares, reliable matching, fair earnings, and operation on affordable phones and variable networks. Currency RWF; languages Kinyarwanda and English (French/Kiswahili ready).

## Users
Passengers; independent drivers; fleet operators; corporate customers; operations staff (dispatch, verification, support, finance, business, analytics, admin).

## Principles
1. Safety and trust (verified drivers, trip PIN, live sharing, SOS).  2. Transparent pricing and payments (estimate vs final, itemised, immutable quotes).  3. Fast, reliable matching (eligibility from real heartbeats, not old locations).  4. Fair to drivers and fleets (excused rejections, visible earnings before accepting, commission transparency).  5. Works offline-ish (retries, idempotency, resumable state).

## MVP scope (built)
Phone/OTP sign-up; driver onboarding with documents and review; Moto + Standard car; map/landmark pickup, fare estimate with breakdown; dispatch with offers, accept/reject, reassignment; state machine; trip PIN; live driver position (polling); cash + MTN MoMo (simulator/sandbox-ready); commission, earnings, ledger, payouts, refunds, reconciliation; ratings; cancellation rules; support cases + FAQ; SOS and trip sharing; admin console; corporate accounts and fleets (foundation); promotions/referrals; scheduled rides; audit log; reports.

## Abasare (client request): drivers for the customer's own car
Included in the MVP as a second service line: verified **Abasare** drive the customer's own car (drive-me-home or hourly), with skill-matched dispatch, itemised pricing (return allowance, night band), a **car check-in/check-out record**, stronger vetting (police clearance), company billing, and a one-tap Moto ride home for the driver. Design, research and open questions: `ABASARE.md`.

## Built but behind flags / off by default
Airtel Money (skeleton), negotiated fares, surge pricing, wallet (not built), automated payouts, Google/Apple sign-in, WhatsApp. Services Comfort/Family/Airport/Intercity/Goods/Cargo exist in the catalogue, **disabled** until priced and approved.

## Deferred (not built)
Email verification, push notifications (FCM), masked calling, in-app voice, identity-verification API, WebSocket streaming, iOS build/testing, loyalty points & subscriptions, chauffeur hire, school/staff transport, accessible-transport workflows, multi-city admin tooling, automated cancellation-fee collection, background location tracking.

## Functional requirements (traceability)

| Req | Where | Test |
|---|---|---|
| Phone + OTP, limits, recovery of sessions | `services/auth.ts` | `auth.test.ts` |
| Separate roles, backend RBAC, staff MFA | `rbac.ts`, `guards.ts` | `auth.test.ts`, `security.test.ts` |
| Service catalogue, zones, availability only when real drivers exist | `routes/catalog.ts`, `services/bookings.ts` | `journey.test.ts`, `drivers.test.ts` |
| Fare engine (base/distance/time/min/waiting/airport/scheduled/tax/rounding/promo) | `services/pricing.ts` | `pricing.test.ts` |
| Booking lifecycle + valid transitions, concurrency, idempotency | `services/bookingMachine.ts`, `bookings.ts`, `dispatch.ts` | `journey.test.ts`, `pricing.test.ts` |
| Dispatch strategies, eligibility, fairness, manual assign | `services/dispatch.ts` | `journey.test.ts`, `drivers.test.ts` |
| Driver verification workflow, expiry, auto-ineligibility | `services/drivers.ts`, `routes/admin.ts` | `drivers.test.ts` |
| Payments: provider-verified, idempotent, cash due, reconciliation | `services/payments.ts`, `finance.ts` | `journey.test.ts`, `finance.test.ts` |
| Ledger, earnings, commission, payouts, refunds, adjustments | `services/ledger.ts`, `commission.ts`, `finance.ts` | `finance.test.ts` |
| Safety: PIN, share, SOS, blocks | `services/bookings.ts`, `routes/support.ts` | `journey.test.ts`, `security.test.ts` |
| Corporate limits & isolation; fleets & isolation | `routes/business.ts` | `business.test.ts` |
| Privacy: access, deletion, consent | `services/privacy.ts` | `security.test.ts` |
| Weak connectivity: retries, outbox, refresh, idempotent submit | `mobile/src/lib/net.ts` | `mobile/tests/net.test.ts`, `journey.test.ts` (idempotency) |

## Success metrics
Registration -> first request conversion; time to assignment; fulfilment rate; driver arrival time; cancellation rates; payment success; GBV vs commission revenue vs cash collected; complaint resolution time; safety incident frequency. All available on the Overview tab / `GET /admin/dashboard`, `GET /admin/analytics` (aggregate, no PII).

## Phases
**Pilot (now)**: Kigali, Moto + Standard, cash + MoMo, verified drivers only.  **Next**: Airtel, Comfort/Airport/Scheduled at scale, automated payouts, push notifications, fleet payouts, richer fraud tooling.  **Later**: more cities, intercity, cargo/delivery, subscriptions/loyalty, additional languages, regional markets.
