# Abasare test build: guide for testers

**Build:** Abasare 0.4.0 (Android 7 or newer, works on 32-bit and 64-bit phones). **Server:** staging only, so **no real money moves and no real SMS is sent**.

## Install (2 minutes)
**Which file?** Most phones from the last ~6 years: `Abasare-0.4.0-arm64-v8a.apk`. Older or very cheap phones (32-bit): `Abasare-0.4.0-armeabi-v7a.apk`. If one says "app not installed" or crashes on start, try the other.

1. Copy the right `.apk` to the phone (WhatsApp, Bluetooth, USB cable or Google Drive link).
2. Tap the file. If Android says "install blocked", tap **Settings** and allow **Install unknown apps** for the app you opened the file from (Files, WhatsApp or Chrome), then go back and tap **Install**.
3. If Play Protect warns that the app is not verified, tap **More details → Install anyway**. This is normal for test builds that are not on the Play Store.
4. Open **Abasare**. The first request after a quiet period can take up to a minute while the server wakes up.

## Sign in
- Pick your language (Kinyarwanda, Français or English) and enter your mobile number.
- **The one-time code is shown on screen** in a yellow box (no SMS is sent in this test build). Type it in.

## What to try
- **Passenger:** book a moto, watch the status steps, check the price breakdown, cancel a trip, try SOS (it only records an alert in this build).
- **Pay:** cash, or MTN Mobile Money using MTN's **sandbox** test number only (ask the project owner for it). Amounts may show in EUR because the sandbox only accepts EUR.
- **Abasare:** add your car (Profile → My cars), book "Drive me home" or "By the hour", and review the car check photos.
- **Driver:** Profile → Start driver application. The project owner approves it in the admin console, then Go online.
- Switch language in Profile and make sure the screens never mix two languages.

## Please report
Screenshot + what you tapped + the time + the phone model and Android version. Anything confusing, slow or wrongly translated counts.

## Known limits of this build
No real SMS or MoMo, push notifications are not delivered yet, maps use free tiles, and driver location sharing with the screen locked has not been tested on many phones.
