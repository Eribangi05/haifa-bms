# Proposed features (for the owner to choose)

Effort: **S** = days, **M** = 1-2 weeks, **L** = several weeks. "Needs" lists anything outside the code (accounts, partners, legal). Nothing here is built yet. Tier A = best value for the money, B = strong, C = later.

## Rider experience (what makes customers like the app)
| # | Feature | Why it matters here | Effort | Needs | Tier |
|---|---|---|---|---|---|
| 1 | **Ride for someone else** (book for a family member or guest; they get an SMS with driver, plate and PIN; you can follow the trip) | Very common in Rwanda (parents, visitors, employees); no extra app needed for the passenger | M | SMS gateway | A |
| 2 | **Live trip sharing + trusted contacts that auto-notify** when a trip starts and ends | Safety is the top reason people choose one app over another; builds on the existing share link and emergency contacts | S | SMS gateway | A |
| 3 | **Tips and ratings with tags** ("clean car", "polite", "safe driving"); favourite drivers and "do not match again" | Raises driver quality and retention; cheap to build | S | none | A |
| 4 | **Wallet / saved MoMo numbers and one-tap pay** (top-up, refunds to wallet, promo credit) | Faster checkout and fewer failed payments; unlocks loyalty | L | MTN contract, legal review | B |
| 5 | **Scheduled and recurring rides** (every weekday 7:00 to work; weekly Abasare for events) | Commuters and families; predictable income for drivers | M | none | A |
| 6 | **Multi-stop trips and round trips** (wait and return, errands) | Competes with informal moto and taxi practice; fits Abasare hourly hire | M | pricing rules | B |
| 7 | **Airport, intercity and fixed-price routes** (Kigali airport, Musanze, Huye, Rubavu) | High value trips; clear fixed prices build trust | M | price list from owner | A |
| 8 | **Loyalty and rewards** (points, tiers, ride streaks, referral rewards) | Cheap way to keep riders; uses existing promo engine | M | none | B |
| 9 | **Subscription passes** (monthly commuter pass, corporate packages, Abasare packs) | Predictable revenue; discounts for regular riders | M | pricing/legal | B |
| 10 | **Dark mode, large-text mode, app lock with fingerprint** | Looks modern, helps accessibility and privacy | S | none | A |

## Reaching everyone in Rwanda
| # | Feature | Why | Effort | Needs | Tier |
|---|---|---|---|---|---|
| 11 | **USSD / SMS booking for feature phones** (`*xxx#` or text a code) | Large share of users have no smartphone or data; big market advantage | L | telecom USSD shortcode and aggregator | B |
| 12 | **Low-data mode and offline-first** (cached maps, compressed images, tiny requests) | Data costs matter; poor coverage outside Kigali | M | none | A |
| 13 | **WhatsApp booking and support bot** | Where customers already are | M | WhatsApp Business API account | C |
| 14 | **Voice prompts in Kinyarwanda** for drivers (new offer, arrived) | Safer driving, accessible to low-literacy users | M | audio recordings | C |

## Abasare (hire a driver for your own car)
| # | Feature | Why | Effort | Needs | Tier |
|---|---|---|---|---|---|
| 15 | **Damage claim and insurance workflow** (timestamped photos, claim form, partner insurer) | Trust is the main barrier for owners; resolves the open liability question | L | insurer partnership, legal | A |
| 16 | **Pre-trip checklist and live trip report** (fuel, odometer, route, stops, speed alerts) | Owners feel in control of their car | M | none | A |
| 17 | **Driver ratings by owners with verified badges** (licence checked, police clearance, years of experience, training done) | Core to trust and pricing | S | verification process | A |
| 18 | **Pay before trip / deposit hold** with MoMo | Prevents unpaid hires and no-shows | M | MTN go-live | B |
| 19 | **Auto-dispatched return moto** for the driver after drop-off | Lowers driver cost and waiting; makes the service faster | M | none | B |

## Driver side (supply wins the market)
| # | Feature | Why | Effort | Needs | Tier |
|---|---|---|---|---|---|
| 20 | **Earnings goals, daily bonuses and quests** ("5 trips today: +3,000 RWF") | Keeps drivers online at peak times | M | budget | A |
| 21 | **Demand heat map and hot zones** | Drivers go where trips are; shorter pickup times | M | none | A |
| 22 | **Instant or scheduled payouts to MoMo** | The thing drivers value most after the fare | L | MTN disbursements go-live | B |
| 23 | **Driver academy** (short video lessons, safety quiz, rating tips) with a badge | Quality and fewer incidents | M | content | C |
| 24 | **Vehicle and expense tracker** (fuel, service reminders, document renewals) | Sticks drivers to the app; helps insurance and licence compliance | S | none | B |
| 25 | **Navigation hand-off** (Google Maps/Waze deep link) with live ETA to the rider | Reduces cancellations | S | none | A |

## Safety and trust
| # | Feature | Why | Effort | Needs | Tier |
|---|---|---|---|---|---|
| 26 | **Route deviation and long-stop alerts** with "Are you OK?" prompt | Real safety improvement beyond the SOS button | M | none | A |
| 27 | **Women-rider preference and night-trip safeguards** | Matches rider expectations | S | enough women drivers | B |
| 28 | **Masked in-app calling** (numbers stay private) | Privacy for both sides | M | telecom/voice provider | B |
| 29 | **Trip audio recording (opt-in)** | Deters incidents, evidence | L | legal review | C |

## Business and operations
| # | Feature | Why | Effort | Needs | Tier |
|---|---|---|---|---|---|
| 30 | **Venue partner portal** (hotels, malls, bars, event organisers: their own QR codes, request history, bill-to-room or monthly invoice) | Extends the QR feature into a B2B channel | M | partners | A |
| 31 | **Campaign manager** (SMS/push broadcasts, promo codes for segments, scheduled) | Growth without a developer | M | SMS/push accounts | A |
| 32 | **Fraud and quality scoring** (cancellation abuse, GPS spoofing, fake documents, promo abuse) | Protects margins and trust | M | none | B |
| 33 | **Analytics and exports** (cohorts, funnels, heat maps, driver quality, finance summaries, scheduled email reports) | Owner decision-making | M | none | A |
| 34 | **Receipts as PDF by email/WhatsApp; corporate expense reports** | Business customers expect it | S | email provider | B |
| 35 | **Multi-city and multi-country settings** (zones, currencies, languages per city) | Growth beyond Kigali | L | none | C |

## Suggested sequence if we build in rounds
1. **Round 1 (trust and delight, mostly no outside dependencies):** #2 live sharing, #3 tips/tags, #10 dark mode/app lock, #25 navigation, #26 deviation alerts, #17 owner ratings and badges, #12 low-data mode.
2. **Round 2 (growth):** #1 ride for someone else, #5 recurring rides, #7 airport and intercity, #20 driver quests, #21 heat map, #30 venue portal, #31 campaign manager.
3. **Round 3 (money and reach):** #4 wallet, #18 deposits, #22 instant payouts, #15 insurance workflow, #11 USSD.
