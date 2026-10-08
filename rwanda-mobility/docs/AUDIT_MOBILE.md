# Mobile app audit (Abasare, Expo SDK 57 / React Native 0.86)

Scope: every screen, component and lib in `mobile/`. Method: read all code, run the six existing browser e2e scripts as a baseline, fix, add tests, re-run everything. **No device or emulator was available**: everything below is verified by TypeScript, unit tests (Node) and the browser e2e suite against the web build (react-native-web) with a real backend. Native-only behaviour (Android back gesture, keyboard resize, foreground service, camera, notifications, edge-to-edge bars) is reasoned from the code and from a throw-away `expo prebuild` output, and is listed under "Not verified".

## Findings

Severity: **H** = data loss / user stuck / safety or money risk, **M** = wrong or confusing behaviour, **L** = polish or hardening.

| ID | Sev | Screen / module | Finding | Status |
|---|---|---|---|---|
| F01 | H | `net.ts` outbox | `flush()` kept a stale copy of the queue and re-saved it after awaiting the network: a booking or rating enqueued during a flush was silently dropped. | Fixed: all queue mutations serialised; flush re-reads the queue. Unit-tested. |
| F02 | H | Boot (`app.tsx`) | When the session was revoked during boot, the cached profile still sent the user to Home with `me = null` (half signed in). | Fixed: boot re-checks the token store; `authLost` clears the cached profile, shows "session ended". |
| F03 | H | Boot | Boot waited for `/config` and `/users/me` with 4 x 12 s GET retries: up to about a minute of spinner on a slow/no network, and no offline start. | Fixed: cached profile and config start the app at once; fresh data loads in the background; profile is fetched when the network returns. |
| F04 | H | Navigation | Android back from Track/Options/Scan (stack reset to one entry) exited the app silently; no back control on several screens; no exit confirmation on Home. | Fixed: `useBackHandler` for sheets/steps, pop, then Home (or press twice to exit). Header **Back** (44 px, labelled) on every non-root screen. |
| F05 | H | Driver | Opening Help (or any screen) unmounted the driver home, which stopped the location watch and the Android foreground service while the driver was still online or on a trip. | Fixed: `DriverTracker` (mounted at app level) owns location sharing; also restarts the service if the OS stopped it (30 s check). |
| F06 | H | Driver | "Go online" without location permission or with GPS off: the driver appeared online but was never sent offers/visible. | Fixed: permission + services checked first; recovery card (Allow / Open settings / GPS off); "no GPS signal" banner when fixes stop. |
| F07 | H | All screens | Content under the notch/status bar and CTAs under the gesture/3-button bar (Home, Options, Track, driver, Profile... used a bare `View`; only a few used `SafeAreaView`). | Fixed: single `Screen` shell applies all four insets; footer padding `max(inset, 12)`; modals have their own provider; toast and SOS respect insets. Verified at 6 sizes with simulated insets. |
| F08 | H | Track (offline booking) | If the queued request was rejected by the server, the "not confirmed" spinner stayed forever. | Fixed: after the outbox drains with no booking, an explicit "request not sent" state with Book again. |
| F09 | M | Pay (MoMo) | Pending payment had no time limit and no way out; after an app restart the pending state was not re-checked. Server idempotency for retried POST /payments verified (backend reuses the live payment). | Fixed: pending -> "still waiting" help state after 90 s (check again / pay cash); status always from the server; polling resumes from `booking.payment`. `payUi` unit-tested. |
| F10 | M | Several | Raw or English text: status code shown as `DRIVER_ASSIGNED`-style text on Home, "Fleet invitation", "Damage noted", vehicle type words, and network errors ("No connection", "Request timed out", "Signed out") in toasts. | Fixed: all via `t()`/`label()`; `errorText` maps network/timeout/session/server to localised copy. Unit-tested. |
| F11 | M | Track | REFUNDED / PARTIALLY_REFUNDED trips were titled "Trip cancelled". | Fixed (`tripTitleKey`, tested). |
| F12 | M | Track, handover | Driver/handover photo URLs carry a short-lived token that changes on every 3 s poll, so images reloaded and flickered. | Fixed: `RemoteImage` keeps one URL for ~4 min. |
| F13 | M | `usePoll` | Polling continued while the app was in the background (battery, data, token traffic). | Fixed: pauses in background, resumes immediately on return. |
| F14 | M | `useAsync`, nav | A second tap while an action ran started a second one; double tap pushed the same screen twice. | Fixed: re-entrant calls ignored; identical consecutive `push` ignored. |
| F15 | M | Permissions | Location denied/blocked/GPS off: toast only. Camera denied: silent. Notifications refused: no way to know. | Fixed: recovery cards with Open settings (location, GPS), camera explanation + settings, notification status in Profile. |
| F16 | M | Forms | No next-field/return keys; impossible dates accepted (`2024-02-31`); licence date in the future; national ID and emergency-contact phone unvalidated; fallback ID `00000000` could be sent. | Fixed: `useFormFocus`, `isIsoDate`, ID/phone validation with inline messages. Unit-tested. |
| F17 | M | App | `Text.defaultProps.maxFontSizeMultiplier` is ignored by React 19, so the font-scale cap never applied. | Fixed: `Text` wrapper from `ui/components` (and `Field`). |
| F18 | M | `net.ts` | A 401 whose token refresh failed only because the phone was offline was reported as "Signed out". | Fixed: reported as a network error; the session is kept. Tested. |
| F19 | L | Toast, SOS | Overlapping toasts cleared each other early; SOS could create two incidents on retry; SOS location could hang; phone-call failure silent. | Fixed (timer ref; one idempotency key per opening; 5 s location timeout; localised failure text and "sent without location" notice). |
| F20 | L | Sign-out | Queued outbox items survived sign-out and could run as the next user. | Fixed: cleared on sign-out; kept on 401 (not dropped as "rejected"). |
| F21 | L | Profile | "Request a copy of my data" showed the account-deletion message. | Fixed. |
| F22 | L | Scan | The camera reports the same frame many times a second; an invalid code flickered the error. | Fixed (2.5 s repeat filter). |
| F23 | L | Driver offers | At 0 s the offer stayed until the next poll; cancel after accept used a 3-button OS alert. | Fixed: refresh at expiry, "expired" state; inline reason list. |
| F24 | L | Handover / documents | Photo or document failure only showed a generic toast. | Fixed: explicit failed banner; counts come from the server so partial uploads resume; expiry date validated. |
| F25 | L | History | Only the latest 50 trips, no paging. | Not fixed: the API cursor uses `created_at` while the list shows `requested_at`; needs a backend-agreed cursor. |
| F26 | L | Tooling | No ESLint/Prettier. | Not added (cannot be done without new dev dependencies and a baseline cleanup that could break the build). |
| F27 | L | Haptics | `expo-haptics` is not a dependency. | Skipped as instructed. |

## Display and navigation on many phones

Reported problem: on some phones users cannot find a back button, buttons sit behind the system buttons or gesture bar, and content slides under the status bar or notch.

What changed:

* **`Screen` shell** (`ui/components.tsx`) used by every screen: top inset applied inside `Header`; left/right insets; sticky `footer` with padding `max(inset.bottom, 12) + 4`; scroll content bottom padding `inset.bottom + 24`; `KeyboardAvoidingView` (self-correcting when the window also resizes), `automaticallyAdjustKeyboardInsets`, `keyboardShouldPersistTaps`; pull-to-refresh; content capped at 640 px on tablets/foldables (header, body and footer).
* **Back control**: `Header` renders a labelled "< Back" (localised) pressable, minimum 44 px, top-left, on every non-root screen; the title wraps to two lines below it so long Kinyarwanda/French titles never clip. Android system back: `useBackHandler` closes sheets (scan result, car form) first, modals close through `onRequestClose`, then pop; at a one-entry stack (e.g. Track after booking) it returns Home; on Home/driver home press twice within 2 s to exit; Welcome exits; Phone returns to Welcome. Driver mode is never left by accident (header back asks when online; system back never switches mode).
* **Modals** (`AppModal`): own `SafeAreaProvider`, `statusBarTranslucent` + `navigationBarTranslucent`; used by chat and SOS.
* **Primary actions in the footer** with `testID="cta"` on Welcome, Phone, Otp, Home, Options, Support, Scan, Cars, driver application, chat.
* **Flexible sizes**: maps/hero blocks use `useProportionalHeight(frac, min, max)` instead of fixed pixels; service cards and welcome features stack below 340 px; header actions wrap; `Text` caps font scale at 1.4.
* **Android system bars** (checked in a temporary `expo prebuild`, `android/` untouched): `edgeToEdgeEnabled=true`, transparent status and navigation bars, `adjustResize`. Added `expo-system-ui` + `backgroundColor` so the light-only setting (`userInterfaceStyle: light`) is applied to the bars and their icons stay dark on our light backgrounds even when the phone is in dark mode.
* **Test harness**: web-only `?insets=top:44,bottom:48,left:0,right:0` overrides the safe-area insets (`ui/insets.tsx`, remembered in `sessionStorage`; ignored on native). `e2e/layout-e2e.mjs` loads Welcome, Phone, Home, Profile, Support, History, Scan, Abasare home, Cars, Cars form, Options and the driver home at 320x568, 360x640, 360x800, 393x852, 412x915 and 768x1024, each with and without simulated insets, and asserts: header content below the top inset, back control present/44 px/inside the safe area on non-root screens, CTA and footer inside the viewport and above the bottom inset, no horizontal overflow, footer column capped on tablet. Screenshots: `/tmp/shots/layout-*.png`.

## Premium polish (summary)

Design tokens (`SP`, `R`, `FS`, `SHADOW`) and shared parts (`ListRow`, `EmptyState` with emoji/shape illustration, `SectionTitle`, `Sheet`, `ProgressBar`, `PermissionCard`, `SkeletonCard`, `Toast`). Home: greeting, invite/promo banner slot, Ride/Abasare service cards, QR shortcut, saved-place shortcuts (with "save as Home/Work"), recents, recent trips with one-tap rebook, schedule chips, sticky "See prices". Track: map plus bottom-sheet driver card, ETA ("about N min", hidden when the driver position is older than 2 min), route progress bar, large plate, stale-connection banner. History grouped by day with status icons and pull-to-refresh. Receipt expandable with fare lines. Saved places management in Profile.

## Code organisation

`passenger.tsx` (412 lines), `driver.tsx` (322) and `shared.tsx` split into `screens/passenger/*`, `screens/driver/*`, `history`, `profile`, `support`, `sos`. New: `lib/types.ts` (API payload types), `lib/format.ts`, `lib/trip.ts`, `lib/errors.ts` (pure, unit-tested), `lib/hooks.ts` (`useLocate`, `useTrip`), `lib/driverTracking.tsx`, `ui/insets.tsx`, `ui/AppModal.tsx`. `any` on API payloads reduced from many to a handful (screens now use the shared types).

## Verified OK (no change needed)

Idempotency keys on booking creation and server-side reuse for MoMo; PIN flow; outbox ordering and single flight; deep link `?code=` / `abasare://r/CODE` with pending code across sign-in; token storage in SecureStore; SOS wording never claims contact; language purity in rw/fr (i18n e2e); 44 px touch targets (responsive e2e).

## Results

`npx tsc --noEmit` clean; `npm test` 29 pass / 0 fail (net + outbox 13, codes, format, trip/payment/errors). Browser e2e against a scratch database (`rm_e2e_mobile`, backend with migrations 001-016 applied): `app` all steps OK, `driver` all OK, `abasare` all OK, `scan` OK in rw/fr/en, `i18n` OK (fr, rw), `responsive` all clean (360/320 px, font zoom 1.3), `layout` all clean (248 checks: 12 screens x 6 viewports x with/without insets); no browser console errors. Baseline before the audit: all scripts passed individually (a run of several scripts in parallel on one database flaked, so run them one after another).

## Not verified (needs a device)

Android hardware/gesture back behaviour; keyboard resize vs `KeyboardAvoidingView` under edge-to-edge (designed to be self-correcting, unconfirmed); foreground service survival and the 30 s restart check; camera/QR scanning; notification permission flow and taps; dark-mode system-bar icon colour with `expo-system-ui`; foldable posture changes; real GPS/permission dialogs; image picker on Android; the `navigationBarTranslucent` modal behaviour on older Android versions.

## Prioritised recommendations

1. Run the app on 3 physical phones (small 320 px, tall gesture-nav, 3-button nav) and an Android 15 emulator; walk `layout-e2e` screens by hand, especially keyboard on Phone/Support/Cars.
2. Add a backend-supported pagination cursor for trip history (F25).
3. Add `react-native-keyboard-controller` only if the keyboard check above fails.
4. Add ESLint + Prettier with a one-time formatting commit (F26).
5. Replace OpenStreetMap raster tiles in the WebView with a hosted tile service before scale (existing note in `MAP_PROVIDER_EVALUATION.md`).
6. Optional: `expo-haptics` for accept/arrive/confirm feedback (F27).
7. Move the ETA to the server (traffic-aware) once a routing provider exists; the client estimate is straight-line x 1.3 at 22 km/h and is labelled as an estimate.
