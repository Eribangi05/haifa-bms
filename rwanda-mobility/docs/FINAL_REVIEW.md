# Final review: Abasare against the master prompt and the Rwandan market

Basis: the code and `FEATURE_STATUS.md` as they stand, and the competitor notes supplied by the owner. Competitor claims are not re-verified here; check them before launch. Known gaps (real SMS, MoMo, push credentials, paid hosting) are left out on purpose.

## 1. Is the master prompt a good prompt for a competitive app?

It is a strong **requirements checklist** and a weak **competitive brief**.

What it does well: it insists on working software over mockups, honest labelling (implemented, tested, simulated, pending), server-side state machines, an auditable ledger in integer RWF, safety as a core requirement, and a lean modular monolith. Those rules are the reason this project did not end up with fake payments or fake drivers.

What it lacks:

1. **No competitive thesis.** It lists what a ride-hailing app has. Nothing says why a rider or a driver leaves YEGO or a moto cooperative for Abasare. Add one paragraph: "We win on X, Y, Z" (for example: lowest driver commission, fastest pickup in named Kigali zones, the only app where you can hire a driver for your own car).
2. **No measurable targets.** Add numbers to aim for in the pilot: median pickup time, fulfilment rate, driver take-home per hour, payout time, support first response. Without targets "competitive" cannot be tested.
3. **Too much in one pass.** Corporate, fleet, scheduled, airport, cargo and loyalty at once produce wide and shallow software. Cap the first release to moto and car in Kigali and say so.
4. **Generic, not Rwandan.** Missing: moto-specific rules (passenger helmet, one passenger, plate and rider identity shown), moto cooperatives as a supply channel, RURA licensing, RRA tax receipts (EBM) and VAT, the data protection law (Law 058/2021) and registration with the regulator, landmark-first addressing (partly there), USSD and feature phones (built here, absent from the prompt), airtime and data cost for drivers, and informal price bargaining that moto users expect.
5. **No supply-side plan.** Ride-hailing is won on driver supply. The prompt has onboarding forms but no recruitment, retention, incentive or cooperative strategy.
6. **No go-to-market or pilot design.** One district, 50 to 100 drivers, a fixed duration, success criteria.
7. **Stack preferences are optional, not requirements.** Next.js, NestJS, PostGIS and Redis are not needed for a pilot. The current Fastify and Postgres monolith is the right size.

Verdict: keep the prompt as the compliance and quality checklist. Pair it with a one-page competitive brief and a pilot plan.

## 2. Where Abasare stands against it

Built and tested beyond the prompt: the Abasare model (a driver for your own car), USSD booking, low-data mode, quests and badges, claims workflow, tips, trusted-contact sharing, route-deviation checks, request codes at venues, nine-role console with TOTP, owner revenue page, demo data, web app.

Built to the prompt: phone OTP, dispatch with offers and timeouts, trip PIN, fare breakdown and pricing rules, ledger, commission, payouts workflow, disputes, support, SOS, referrals, loyalty, recurring rides, fleet and corporate APIs, audit trail, rw/fr/en.

Not built or only partly built:

| Prompt item | State |
|---|---|
| Negotiated or proposed fares | Not built (flag reserved) |
| Fleet and corporate **portals** | APIs and basic mobile/console screens only, no dedicated web portal |
| Cargo, courier, accessible transport | Not built |
| Email verification, Google/Apple sign-in | Not built |
| Prepaid wallet, cards | Not built (legal review) |
| Realtime (WebSocket or push) | Polling today; push needs credentials |
| Airtel Money | Stub |
| iOS native | Not built; web app covers iPhone |

## 3. Review as a Rwandan driver

What a moto or cab driver judges the app on, in order:

1. **Do I get paid fast and in full?** Instant or same-day MoMo payout and a visible commission. Payout disbursement is still pending integration, and tariffs and commission are placeholders. Set them from a real market check, and launch with a commission clearly below the competitors you verified.
2. **Do offers reach me in time?** The offer window is 20 s. If the app learns of an offer by polling, a driver loses jobs that never reached the screen. Push with high priority, or a held connection for online drivers, is the most important technical upgrade.
3. **Is the pickup worth driving to?** Show pickup distance and time, fare and net earnings on the offer (done) and compensate long unpaid pickups (cancel fee exists; consider a pickup distance supplement beyond a set distance).
4. **Is my data bundle and battery safe?** Low-data mode exists. Test battery drain of background tracking on a cheap Android phone for a full shift.
5. **Am I treated fairly?** Clear reasons for suspension, an appeal path (exists), no penalty for network-caused misses (stated in the prompt; confirm in the rules engine).
6. **Am I safe?** Night rides, passenger verification, a driver SOS, and the ability to rate passengers. Confirm each is reachable in two taps.
7. **Can I work if my phone is basic?** USSD helps riders; drivers still need a smartphone. Fine for pilot.

## 4. Review as a rider

1. First booking in under a minute, with no map skill needed: landmarks, village search, pickup pin correction (done).
2. A truthful "no driver" experience with alternatives (done in part; verify the alternatives list on device).
3. Moto trust: show plate, driver photo, helmet availability, PIN (mostly done). Add a visible **helmet and one-passenger** rule to the moto confirmation.
4. Negotiation: many Rwandan moto riders expect to bargain. A bounded counter-offer (for example within 15 percent of the fare, driver accepts or declines, both confirm before the PIN) would remove the main reason to go back to street hiring. Keep fixed pricing as the default.
5. Cash is the norm: cash flow and receipts are in place.

## 5. Priorities

**P0, before any real pilot**
1. Test the Android build on three real phones (low, mid, high end): background location, battery, push, map, camera, offline recovery. This has never been done and will find bugs (the UI end-to-end run already did once).
2. Always-on hosting: the free plan sleeps and cold starts take tens of seconds, which kills dispatch. Paid web service, paid database with automatic backups, and an alert if `/ready` fails.
3. Realtime offers: push for offers and arrivals, shorter polling during an active trip.
4. Set real tariffs, commission and eligibility thresholds from market research.
5. Legal checklist with an adviser: RURA permission, insurance, tax receipts, data protection registration, driver contracts.

**P1, first month of pilot**
6. Bounded fare counter-offer, behind a feature flag.
7. Moto safety rules on screen (helmet, one passenger) and a driver-side passenger rating.
8. Fleet and corporate web portals, built on the web app (same origin, now simple): members, budgets, invoices, trips, CSV.
9. Pickup distance supplement and waiting charge review.
10. Driver retention: weekly statement push, streak bonus, payout speed shown in app.

**P2, later**
11. Courier and parcel by moto (fastest revenue with the supply already onboarded).
12. Airtel Money, cards, prepaid wallet after legal review.
13. Email verification and social sign-in.
14. Native iPhone app (Apple Developer account).
15. Accessible transport and school/staff transport through licensed operators.

## 6. Readiness

Ready to demonstrate: yes. Ready for a supervised pilot of 50 to 100 drivers in one district: after P0 items 1 to 5. Ready for public launch: no, and no honest review could say yes before real-device testing and payment and SMS integrations.

## 7. Suggested competitive brief to add to the master prompt

"Abasare wins in Kigali on: (1) the lowest disclosed commission with same-day payout, (2) pickup in under N minutes in named zones, (3) the only app where you can hire a driver for your own car, (4) works on weak networks and by USSD, (5) a human support reply within M minutes. Pilot: one district, 100 drivers, 8 weeks. Success: fulfilment above X percent, driver weekly retention above Y percent, payment success above Z percent."
