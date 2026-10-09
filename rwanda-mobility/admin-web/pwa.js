'use strict';
// Makes the console installable (home-screen icon, own window). The service worker only caches the page shell.
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}));
