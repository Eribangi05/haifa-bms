# Abasare on iPhone

**Status: prepared and checked as far as this environment allows; the installable iPhone app still has to be built with your Apple and Expo accounts.** The app is written once in React Native / Expo (TypeScript) and the same screens, navigation, translations, icons and API client run on iOS. What is missing is Apple-specific set-up, a first iOS build, and testing on real iPhones. **Nothing below has been built or run on an iPhone yet**: the build environment used so far (Linux) cannot produce iOS apps, so expect a short round of fixes after the first iPhone test.

## Free option now: the web app on iPhone (no Apple membership)
Until the Apple membership is paid, iPhone users can use Abasare as a **web app**, installed from Safari: open the app's web address, tap **Share**, then **Add to Home Screen**; it gets the Abasare icon and opens full screen like an app. It is the same code and the same screens as the Android app. `render.yaml` defines a free Render static site (`abasare-app`) that builds it (`npm run web:pwa` builds it by hand); the app shows a short "how to install" card on iPhone Safari.

What it cannot do compared with the real iPhone app:
* **No background location**: a driver's position is shared only while the app is open and on screen. **Drivers should use Android.** Riders are not affected.
* **No push notifications** (they need a native app or Web Push, which is not built).
* **QR scanning**: Safari has no built-in code detector, so riders type the code instead of scanning.
* It is not listed in the App Store, so customers must be given the web address (share it by WhatsApp, a poster QR code, or a link on the venue page).

## What you need for the real iPhone app (owner)
| Item | Cost / effort |
|---|---|
| **Apple Developer Program** membership (as a person or company) | about US$99 per year; company enrolment needs a D-U-N-S number and can take days |
| An **Expo (EAS) account** | free tier is enough to start; builds run on Expo's Mac servers, so **no Mac is required** |
| Test iPhones | TestFlight (recommended) or ad-hoc devices registered with `eas device:create` |
| Apple push key (APNs) | created once in the Apple developer portal; EAS stores it |

## Steps
1. Enrol in the Apple Developer Program; create the app record "Abasare" in App Store Connect with bundle id `rw.abasare.app`.
2. In `mobile/`: `npx eas-cli login`, `eas init` (put the project id in `EAS_PROJECT_ID`), then `eas credentials` to let EAS create the certificates and the APNs key.
3. Build: `eas build --platform ios --profile production` (about 15 to 25 minutes in the cloud). Set `EXPO_PUBLIC_API_URL` in `eas.json` to the HTTPS API first.
4. Upload to TestFlight: `eas submit --platform ios`. Invite testers by e-mail; they install through the TestFlight app (iPhones cannot install a loose file the way Android does).
5. When testing is done, submit for App Store review (screenshots for 6.7-inch and 6.1-inch iPhones, privacy policy URL, privacy "nutrition label": location, phone number, photos, identifiers).

## Checked here (Linux)
* The JavaScript bundle compiles for iOS (`npx expo export --platform ios`, also run by CI on every push).
* `npx expo prebuild --platform ios` generates the Xcode project with the right bundle id, the location strings and the `location` background mode.
* Not possible here: compiling with Xcode, signing, running on a simulator or an iPhone.

## Why I could not hand you an .ipa
An iPhone app can only be compiled on Apple's toolchain and signed with **your** Apple Developer certificate; installing it also needs TestFlight or registered devices. Those need your Apple ID (with two-step verification) and your Expo account, which must not be shared in chat. Everything else is ready, so building is three commands run by you (or by me in a session where you have logged in).

## Already prepared
`mobile/app.config.js` has the iOS block (bundle id `rw.abasare.app`, build number, export-compliance flag) and the permission texts for location, camera, photos and Face ID; `eas.json` has iOS build profiles; the sign-in (phone OTP), booking, payments, trips, wallet, invite sharing (WhatsApp, message, e-mail, system share sheet) and the support contact use only cross-platform code. Apple's rule that apps with accounts must let users request deletion is met (Account > Edit profile > privacy requests).

## Known work for iOS (to do after the first build)
* **Driver tracking in the background.** On Android a visible foreground service keeps sharing the driver's position with the screen locked. On iPhone the app now enables the `location` background mode, asks the driver for "Always" access, and shows iOS's blue status-bar indicator while tracking (code in `mobile/src/lib/bgLocation.ts`). **Not yet tested on a device.** If a driver declines "Always", location is shared only while the app is open. Apple reviews this permission closely: keep the in-app disclosure (it exists) and give a short justification in the review notes. Rider features are not affected.
* **Push notifications**: needs the APNs key above and a real device to test (not the simulator).
* **Maps / QR / camera / Face ID app lock**: expected to work, to be checked on a device.
* **"Call" buttons**: `tel:` links open the iPhone dialer; to verify on a device.
* **Review risks**: reviewers sign in with a phone number and a one-time code, so provide a **demo account** (a test phone number whose code does not depend on SMS) in the review notes; staging with simulated payments must not be the reviewed build.
* **Payments**: rides are physical services paid by cash or Mobile Money, so Apple's in-app purchase rule does not apply.

## Honest estimate
With the accounts ready: about 2 to 4 working days for the first TestFlight build plus fixes, and about 1 to 2 weeks for App Store review and the driver background-location justification. Ongoing: every release must be built and uploaded twice (Android and iOS) and tested on both.
