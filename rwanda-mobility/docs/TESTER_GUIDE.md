# Abasare 0.6.0: test guide

**File:** `Abasare-0.6.0-arm64-v8a.apk` (one file, about 17 MB, for 64-bit Android 7 or newer: almost every phone made in the last six years). **Server:** staging only, so **no real money moves and no real SMS is sent**.

## Install
1. Copy the `.apk` to the phone (USB cable, WhatsApp, Bluetooth or a Drive link).
2. Tap the file. If Android blocks it, tap **Settings** and allow **Install unknown apps** for the app you opened it from, then tap **Install**.
3. If Play Protect warns, tap **More details, then Install anyway** (normal for test builds).
4. The first request after a quiet period can take up to a minute while the staging server wakes up.

## Sign in
Choose the language (Kinyarwanda, Français or English), enter your mobile number. The one-time code **appears on screen** in a yellow box (no SMS is sent in this build).

## What to try (tick as you go)
**Everyone**
- [ ] Back arrow on every screen except Home; Android back/gesture goes back one step; on Home it asks to press again to exit
- [ ] Buttons are fully visible above the phone's bottom buttons; nothing hidden under the top bar or notch; the keyboard never hides the field you type in
- [ ] Profile > Settings: dark mode, large text, low-data mode, app lock (fingerprint/PIN)
- [ ] Switch language and check no screen mixes two languages

**Passenger**
- [ ] Book a moto or car; fixed-price route option if one is active; "Book for someone else" with a guest name and number
- [ ] Repeat a ride (recurring), then pause, skip and end it
- [ ] Track: driver card with badges, live ETA, share this trip (hide destination, revoke), "Are you OK?" prompts
- [ ] After a trip: stars, tags, tip, add to favourites or block the driver
- [ ] Profile: Trusted contacts (notify when my trip starts), My drivers, My credit and loyalty, My claims
- [ ] Pay with credit (all or part), cash, or MTN Mobile Money sandbox number (ask the owner)
- [ ] Scan a venue QR code (Home > Scan a code) or type the code

**Abasare (owner)**
- [ ] Add a car, book Drive me home or By the hour, review the car check photos, rate with Abasare tags, pay a deposit if the owner enabled it, file a claim

**Driver** (the owner approves your application in the admin console first)
- [ ] Go online (location sharing continues with the screen locked), accept an offer, navigation buttons (Google Maps / Waze), PIN start
- [ ] Quests and bonuses, "Where to go" demand map, My feedback, Claims about me

## Please report
Screenshot, what you tapped, the time, the phone model and the Android version. Anything slow, confusing or wrongly translated counts.

## Known limits of this build
No real SMS or MTN payments (simulated), push notifications are not delivered yet (needs Firebase), map tiles use the free provider, and the app has not yet been tested on many physical phones. USSD booking needs a telecom shortcode.
