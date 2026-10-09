# Mobile code map

Where things live in `mobile/src` (renamed from the old `r1`, `r2`, `r3` round names to names that say what they do).

| Folder | What is inside |
|---|---|
| `screens/` | Top-level screens: `auth`, `history`, `invite` (referral), `profile`, `support`, `sos`, `scan`, `cars` |
| `screens/passenger/` | Rider booking flow: `home`, `options`, `track`, `tripParts`, `usePlaces` |
| `screens/driver/` | Driver app: `onboarding`, `working` (go online, offers), `offer`, `activeTrip`, `earnings`, `profileTab`, vehicle application |
| `screens/tabs/` | The bottom-tab shells for riders and drivers, and the tab pages (`overview`, `wallet`, `account`) |
| `screens/trust/` | Trust and safety: contacts, share trip, rate and tip, favourite drivers, feedback, appearance and low-data settings, navigation hand-off |
| `screens/growth/` | Guest rides, recurring rides, quests, demand heat map, guest contact |
| `screens/money/` | Credit, deposit, claims, USSD card, receipt lines |
| `ui/` | Shared components (`components`, `TabBar`, `icons`, `MapView`), the map page (`mapHtml`) |
| `lib/` | Plain logic and services: `net` (API client with outbox), `app` (state and navigation), `cache` (offline cache), `flags`, `trustApi`, `growthApi`, `moneyFmt`, `stats`, `driverKind`, `shareLinks` |
| `lib/locales/` | `en.ts`, `rw.ts`, `fr.ts` combine one base file with the feature files in `features/` (`trust`, `growth`, `money`, `tabs`, `drivers`, `brand`, `social`). Every key exists in all three languages (checked by the type system). String keys keep their old prefixes (`r1.*`, `r2.*`, `cr.*`) so saved translations and tests stay valid. |
