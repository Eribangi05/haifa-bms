# Building the Android app

## Dev loop (emulator or device)

```bash
cd mobile && npm install
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 npx expo start --android   # emulator reaches the host at 10.0.2.2
```
Physical device on the same Wi-Fi: use `http://<your-LAN-IP>:8080`. The backend must be running (`npm run dev`), seeded, with `OTP_DEV_ECHO=true` so the OTP appears on the OTP screen in test builds.

Before a build: `npm run typecheck && npm test` (28 unit tests; CI runs both, plus an Android bundle export).

Because the app uses native modules (secure store, location, camera, WebView) it needs a **development build** or release APK, not Expo Go.

## Local release APK (what was verified in the build environment)

Requirements: JDK 17+ (21 used), Android SDK (platform 35, build-tools 35, platform-tools; NDK/CMake are auto-installed by Gradle after licences are accepted), Node 22.

```bash
export ANDROID_HOME=/opt/android-sdk        # wherever your SDK lives
cd mobile
npx expo prebuild --platform android        # generates android/ (git-ignored; never hand-edit)
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# output: android/app/build/outputs/apk/release/app-release.apk
```
Use `-PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64` for a universal build (larger, slower). The default Expo release build is signed with the **debug keystore**: fine for testing, **not for the Play Store**.

Network note: if Gradle fails with HTTP 429 from Maven Central, add Google's mirror (`https://maven-central.storage-download.googleapis.com/maven2/`) in `~/.gradle/init.gradle`, lower `org.gradle.workers.max`, and re-run (downloads are cached).

## Play Store / EAS

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile production   # AAB, managed signing keys
npx eas-cli@latest submit --platform android
```
Before releasing: set `EXPO_PUBLIC_API_URL` to your HTTPS API (in `eas.json`), make sure the build has **no** cleartext traffic (see below), replace the placeholder icon/splash in `assets/`, bump `versionCode`, complete Play's Data safety form (location, camera/photos, phone number, financial info), publish the privacy policy URL.

## Cleartext HTTP (local dev only)

The config lives in `app.config.js` (it replaces `app.json`; `npx expo prebuild` and EAS read it). `usesCleartextTraffic` is **false** unless `EXPO_PUBLIC_ALLOW_CLEARTEXT=1` is set at prebuild/build time. Use it only for emulator/e2e builds against `http://10.0.2.2:8080`:

```bash
EXPO_PUBLIC_ALLOW_CLEARTEXT=1 EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 npx expo prebuild --platform android --clean
```
`eas.json` sets it to `1` for the `development` profile only; `preview` and `production` set it to `0` and must use an https `EXPO_PUBLIC_API_URL`. A local `gradlew assembleRelease` for a device that talks to a plain-http backend therefore needs the flag; a Play build must not have it.

## Push notifications (needs one-time setup)

Add the EAS project id (`eas init`, then `EAS_PROJECT_ID=<id>` in the build env, read by `app.config.js` into `extra.eas.projectId`) and an FCM `google-services.json` (`android.googleServicesFile`) uploaded to EAS credentials. Without a project id the app skips push registration silently (console warning). Channels: `default` (high) and `offers` (high, drivers).

## Play Console declarations: background location and foreground service

* **Permissions declaration form**: the app does **not** declare `ACCESS_BACKGROUND_LOCATION`, so the "background location" access form is not required. Driver tracking runs as a foreground service.
* **Foreground service declaration** (Policy > App content): type **Location**, permission `FOREGROUND_SERVICE_LOCATION`. Core feature: a driver who is online or on a trip shares their position with passengers and dispatch while the app is in the background; the service shows a persistent notification and stops when the driver goes offline. Provide a short screen recording: driver accepts the disclosure, taps Go online, switches to another app, notification visible, taps Go offline, notification disappears.
* **Prominent disclosure**: shown in the driver Home card before first use (strings `drv.location.*`, `drv.bg.*`, all three languages) with an explicit "I agree" button; the privacy policy must repeat it.
* **Data safety form**: location (approximate and precise) collected, not sold, used for app functionality; also device push token (device IDs) and crash diagnostics.

## Deep link for QR request codes
`app.config.js` declares an Android intent filter for `abasare://r/<CODE>` (VIEW, BROWSABLE, DEFAULT). The backend landing page `https://<host>/r/<CODE>` opens it with an `intent://` link for package `rw.abasare.app`. Test on a device: `adb shell am start -a android.intent.action.VIEW -d "abasare://r/<CODE>?svc=ride" rw.abasare.app`. Not yet run on a device.

## Permissions requested

`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` (driver tracking service), `POST_NOTIFICATIONS`, `CAMERA` (driver documents and scanning venue QR codes; the `expo-camera` plugin is configured with `recordAudioAndroid: false`, `RECORD_AUDIO` stays blocked), `INTERNET`, `ACCESS_NETWORK_STATE`. `ACCESS_BACKGROUND_LOCATION` and storage permissions are explicitly blocked in `app.config.js`.

## Device test plan (not yet executed)

1. Fresh install -> language -> OTP -> location consent. 2. Book with GPS on/off, drag pin, map tap, landmark chips. 3. Toggle airplane mode during "Confirm request": expect "not confirmed", then a single booking after reconnect. 4. Driver: apply, upload each document via camera/gallery/PDF, go online, receive offer on a second device, complete a trip with PIN. 5. MoMo payment in test mode, failure -> cash fallback. 6. SOS flow and calls (`tel:112`). 7. Kill and reopen the app mid-trip: state resumes. 8. Test on a 2 GB RAM Android 10 phone and a small (360x640) screen; TalkBack labels; large font setting.
