# Building the Android app

## Dev loop (emulator or device)

```bash
cd mobile && npm install
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080 npx expo start --android   # emulator reaches the host at 10.0.2.2
```
Physical device on the same Wi-Fi: use `http://<your-LAN-IP>:8080`. The backend must be running (`npm run dev`), seeded, with `OTP_DEV_ECHO=true` so the OTP appears on the OTP screen in test builds.

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
Before releasing: set `EXPO_PUBLIC_API_URL` to your HTTPS API (in `eas.json`), set `usesCleartextTraffic` to `false` in `app.json`, replace the placeholder icon/splash in `assets/`, bump `versionCode`, complete Play's Data safety form (location, camera/photos, phone number, financial info), publish the privacy policy URL.

## Permissions requested

`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` (foreground only), `CAMERA` (driver documents), `INTERNET`, `ACCESS_NETWORK_STATE`. Background location and storage permissions are explicitly blocked in `app.json`.

## Device test plan (not yet executed)

1. Fresh install -> language -> OTP -> location consent. 2. Book with GPS on/off, drag pin, map tap, landmark chips. 3. Toggle airplane mode during "Confirm request": expect "not confirmed", then a single booking after reconnect. 4. Driver: apply, upload each document via camera/gallery/PDF, go online, receive offer on a second device, complete a trip with PIN. 5. MoMo payment in test mode, failure -> cash fallback. 6. SOS flow and calls (`tel:112`). 7. Kill and reopen the app mid-trip: state resumes. 8. Test on a 2 GB RAM Android 10 phone and a small (360x640) screen; TalkBack labels; large font setting.
