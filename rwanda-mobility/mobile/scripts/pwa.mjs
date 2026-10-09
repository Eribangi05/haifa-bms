// Turns the web export into an installable web app (PWA): manifest, home-screen icons and the iPhone "Add to Home Screen" meta tags.
// Usage: node scripts/pwa.mjs <export-dir>      (run after `npx expo export --platform web --output-dir <export-dir>`)
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
const dir = process.argv[2] ?? 'dist'; const A = (f) => new URL('../assets/pwa/' + f, import.meta.url).pathname;
for (const f of ['manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) copyFileSync(A(f), `${dir}/${f}`);
const tags = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#0069A8" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Abasare" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="format-detection" content="telephone=no" />`;
const p = `${dir}/index.html`; let h = readFileSync(p, 'utf8');
if (!h.includes('manifest.webmanifest')) h = h.replace('</head>', `${tags}\n  </head>`);
writeFileSync(p, h); console.log('PWA files added to', dir);
