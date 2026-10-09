# Mobile navigation (0.7.0)

The app used to put almost everything on one long Home page. From 0.7.0 every area has its own screen, reachable in one tap from a **bottom tab bar**. The bar differs by mode; switching mode (Account tab) swaps it.

## Rider mode (5 tabs)

| Tab | What it shows | Data source |
|---|---|---|
| **Home** | Greeting, "Where to?" search, live trip card, quick actions (ride, Abasare, scan QR, scheduled rides, saved places, help), personal statistics (trips, km, spent, credit), safety card with emergency numbers, trending places, recent trips, driver invitation, a tip | `/bookings`, `/wallet`, `/places/popular`, `/config` |
| **Book** (map) | Map with pickup pin, ride / Abasare choice, destination search, pickup note, schedule, "See prices" | `/places`, `/coverage`, `/fares/estimate` (the existing booking flow) |
| **Trips** | Summary strip, filters (all / completed / upcoming / cancelled), trips grouped by day, tap for the trip and receipt | `/bookings?role=passenger` |
| **Wallet** | Credit balance and rewards, balance owed, spending this month / latest 50 trips / average fare, payment mix, month by month, payment history, claims | `/wallet`, `/users/me/debts`, `/bookings` |
| **Account** | Profile card, **language switcher**, edit profile (name, notifications, saved places, trusted contacts), my drivers, scheduled rides, my cars, credit, claims, settings (theme, text size, low-data, app lock), invite friends, help, USSD, sign out | `/users/me`, existing screens |

## Driver mode (5 tabs)

| Tab | What it shows |
|---|---|
| **Work** | Before approval: the driver application (path, details, documents, submit). After approval: Online/Offline switch, today's trips / earnings / rating, feedback, quests, demand map, trip offers, the active trip |
| **Trips** | Driver trip history with day groups, fares and what the driver earned |
| **Earnings** | Day / week / month earnings, commission, cash and Mobile Money collected, wallet, payout request and history |
| **Vehicle** | Driving record (rating, completed trips, status, badges), vehicle details (make, model, plate, seats), every required document with status and renewal upload, quests |
| **Account** | Same as the rider Account: language, profile, claims, settings, help, switch to rider mode, sign out |

## Driver categories

Drivers belong to one of two categories, and one person can be both. The app shows the category on the Jobs tab and on the Profile overview, and every page adapts to it.

| Category | Needs | Jobs received | Profile pages |
|---|---|---|---|
| **Owner-driver** (has a vehicle) | ID, licence, vehicle registration, insurance, photo | Ride requests in their own vehicle; may also apply for Abasare | Vehicle (details, ride history), Abasare ("Add Abasare" form), Documents |
| **Abasare driver** (no vehicle) | ID, licence with experience, police clearance, photo | Abasare jobs: driving a customer's own car, home or by the hour | Vehicle (explains none is needed), Abasare (skills, jobs), Documents |
| **Both** | Both sets | Ride and Abasare jobs, switchable on the Jobs tab | All pages populated |

Screens added for the categories: a **chooser** with two comparison cards and a five-step **application progress bar** (Choose, Details, Documents, Review, Approved); **guide pages** (4 pages for owner-drivers, 6 for Abasare drivers: check the car, drive, check out, return home, get paid); a four-page **Profile** (Overview, Vehicle, Abasare, Documents); **Apply for Abasare** for approved owner-drivers; **Earnings by job type** (rides vs Abasare); job-type filter and badges on the driver Trips tab.

An owner-driver can add Abasare to the same account. An Abasare driver who later buys a vehicle must ask support to add it (a new vehicle application on an approved account is not offered in the app yet).

## Rules of the navigation

* **One language** across the whole app; the Account tab switches it instantly.
* **Back**: Android back / gesture returns from a pushed screen; from any tab other than Home it goes to Home first; on Home it asks to press twice to exit (never a silent exit mid-flow).
* **State**: Home and Book stay mounted, so a half-made booking survives a look at another tab.
* **Safe areas**: the tab bar takes the bottom inset (gesture bar / 3-button navigation); screens above it do not add it again. The bar hides while the keyboard is open. Buttons above the bar (e.g. "See prices") stay clear of it. Layout is checked at six phone sizes, with and without simulated insets (`mobile/e2e/layout-e2e.mjs`).
* **Statistics are honest**: they are computed on the phone from the user's own latest 50 trips and wallet. "Trending places" are the platform's popular places, not a live ranking.
* Notifications and QR deep links open the right screen (the trip, or Book with the venue as pickup).

## Where the code is

`mobile/src/ui/TabBar.tsx` (bar, shell, pane), `mobile/src/ui/dash.tsx` (hero, stat tiles, quick actions, menu rows), `mobile/src/screens/tabs/` (Home, Wallet, Account, shells), `mobile/src/screens/history.tsx` (Trips), `mobile/src/screens/driver/vehicleTab.tsx`, `mobile/src/lib/stats.ts` (pure statistics, unit-tested), `mobile/src/lib/tripFeed.tsx` (one shared trip list per mode), strings in `mobile/src/lib/locales/r4.*.ts`.
