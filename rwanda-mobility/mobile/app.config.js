// Dynamic Expo config (replaces app.json; `npx expo prebuild` and EAS read this file).
// - Cleartext HTTP is OFF unless EXPO_PUBLIC_ALLOW_CLEARTEXT=1 (local dev, emulator, e2e). Production builds are https only.
// - Push notifications need an EAS project id: set EAS_PROJECT_ID (or run `eas init` and paste the id below). Without it the app skips push registration silently.
const allowCleartext = process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT === '1';
const easProjectId = process.env.EAS_PROJECT_ID || undefined;

module.exports = () => ({
  expo: {
    name: 'Abasare',
    slug: 'abasare',
    scheme: 'abasare',
    version: '0.6.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',   // follows the system; the in-app Settings can force light/dark (system bars follow the resolved theme)
    backgroundColor: '#F3F6FB',
    splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: '#FFFFFF' },
    ios: { supportsTablet: false, bundleIdentifier: 'rw.abasare.app' },
    android: {
      package: 'rw.abasare.app',
      versionCode: 8,
      adaptiveIcon: {
        backgroundColor: '#FFFFFF',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      permissions: [
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        // Driver trip tracking runs as a user-visible foreground service of type "location" (no ACCESS_BACKGROUND_LOCATION needed).
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
        'POST_NOTIFICATIONS',
        'CAMERA',
        'INTERNET',
        'ACCESS_NETWORK_STATE',
      ],
      blockedPermissions: [
        'SYSTEM_ALERT_WINDOW',
        'ACCESS_BACKGROUND_LOCATION',
        'RECORD_AUDIO',
        'READ_MEDIA_VIDEO',
        'READ_EXTERNAL_STORAGE',
        'WRITE_EXTERNAL_STORAGE',
      ],
      predictiveBackGestureEnabled: false,
      // QR request codes: abasare://r/<CODE> (the landing page https://<host>/r/<CODE> opens this via an Android intent).
      intentFilters: [{ action: 'VIEW', category: ['BROWSABLE', 'DEFAULT'], data: [{ scheme: 'abasare', host: 'r', pathPrefix: '/' }] }],
    },
    plugins: [
      'expo-secure-store',
      ['expo-local-authentication', { faceIDPermission: 'Abasare uses Face ID to unlock the app.' }],
      ['expo-location', { locationWhenInUsePermission: 'Abasare uses your location to set your pickup and match you with nearby drivers.', isAndroidForegroundServiceEnabled: true, isAndroidBackgroundLocationEnabled: false }],
      ['expo-image-picker', { cameraPermission: 'Used to photograph your driver documents.', photosPermission: 'Used to attach your driver documents.' }],
      ['expo-camera', { cameraPermission: 'Abasare uses the camera only to scan QR codes for your pickup point.', recordAudioAndroid: false }],
      ['expo-notifications', { color: '#0077B0' }],
      ['expo-build-properties', { android: { usesCleartextTraffic: allowCleartext, useLegacyPackaging: true, enableShrinkResourcesInReleaseBuilds: true, enableProguardInReleaseBuilds: true, enablePngCrunchInReleaseBuilds: true } }],
    ],
    web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
    ...(easProjectId ? { extra: { eas: { projectId: easProjectId } } } : {}),
  },
});
