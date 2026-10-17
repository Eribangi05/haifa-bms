# Abasare web app

The same app as the phone, running in a browser. It is an installable web app (PWA) served by the API itself at the root address, so there is nothing extra to host: https://abasare-api.onrender.com/ opens the app, `/admin/` opens the operations console.

## Who it is for

- Riders who do not want to install anything (book, track, pay, rate, share a trip).
- Anyone on an iPhone, until a native iPhone app exists: open the address in Safari, tap Share, then Add to Home Screen.
- Owners and partners who want to demo the app on a laptop.

## Install

- Android (Chrome): menu, Install app.
- iPhone (Safari): Share, Add to Home Screen.
- Computer (Chrome, Edge): install icon in the address bar.

## Limits compared with the Android app

- Drivers: the tab must stay open and on screen to share the location. There is no background tracking and no push notification, so the Android app remains the right tool for working drivers.
- No camera QR scan and no native share sheet on some browsers; the code can be typed.
- Map and tiles load from the same server, so the first visit needs a connection. Screens already opened keep working offline for the shell only.

## Build

From `mobile/`:

```
npm run build:web
```

which runs `EXPO_PUBLIC_API_URL=self EXPO_PUBLIC_ALLOW_CLEARTEXT=0 npx expo export --platform web --output-dir ../backend/web-app` followed by `node scripts/pwa.mjs ../backend/web-app`. `self` makes the app call the origin it was loaded from. Commit `backend/web-app/` so Render serves it.

## Hosting and caching

`backend/src/app.ts` serves `backend/web-app/` at `/`. Hashed files under `/_expo/static/` and `/assets/` are cached for a year. `index.html`, `manifest.webmanifest` and `sw.js` are always revalidated, so a new release is picked up on the next visit. The service worker stamps a new cache version at every build and never touches API, console, map or share routes.
