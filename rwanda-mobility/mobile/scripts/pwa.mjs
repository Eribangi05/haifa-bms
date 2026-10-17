// Turns the web export into an installable web app (PWA): manifest, home-screen icons and the iPhone "Add to Home Screen" meta tags.
// Usage: node scripts/pwa.mjs <export-dir>      (run after `npx expo export --platform web --output-dir <export-dir>`)
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
const dir = process.argv[2] ?? 'dist'; const A = (f) => new URL('../assets/pwa/' + f, import.meta.url).pathname;
for (const f of ['manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) copyFileSync(A(f), `${dir}/${f}`);
writeFileSync(`${dir}/sw.js`, readFileSync(A('sw.js'), 'utf8').replace('__VERSION__', new Date().toISOString().replace(/\D/g, '').slice(0, 14)));
const tags = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#0069A8" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Abasare" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="format-detection" content="telephone=no" />
    <meta name="description" content="Abasare: book a ride in Rwanda, hire a driver for your own car, or drive and earn. In Kinyarwanda, French and English." />
    <meta property="og:title" content="Abasare" />
    <meta property="og:description" content="Ride. Work. Explore. Book a moto or a car, or hire a verified driver for your own car." />
    <meta property="og:image" content="/icon-512.png" />
    <script>if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });</script>`;
const p = `${dir}/index.html`; let h = readFileSync(p, 'utf8');
if (!h.includes('manifest.webmanifest')) h = h.replace('</head>', `${tags}\n  </head>`);
writeFileSync(p, h); console.log('PWA files added to', dir);
