import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });

test('web app: served at the root as an installable PWA without shadowing the API, console or health routes', async () => {
  const get = (url: string) => t.app.inject({ method: 'GET', url });
  const home = await get('/');
  assert.equal(home.statusCode, 200);
  assert.match(home.headers['content-type'] as string, /text\/html/);
  assert.match(home.payload, /manifest\.webmanifest/);
  assert.equal(home.headers['cache-control'], 'no-cache', 'the page itself is always revalidated so a new release is picked up');
  const mf = await get('/manifest.webmanifest');
  assert.equal(mf.statusCode, 200);
  assert.equal(JSON.parse(mf.payload).start_url, '/');
  const sw = await get('/sw.js');
  assert.equal(sw.statusCode, 200);
  assert.doesNotMatch(sw.payload, /__VERSION__/, 'the cache version is stamped at build time');
  assert.equal((await get('/health')).statusCode, 200);
  assert.equal((await get('/admin/')).statusCode, 200);
  const nope = await get('/api/v1/nope');
  assert.equal(nope.statusCode, 404);
  assert.match(nope.headers['content-type'] as string, /json/);
  assert.equal((await t.app.inject({ method: 'GET', url: '/../package.json' })).statusCode >= 400, true, 'no path traversal');
});

test('web app: the browser may use location and camera on its own origin only', async () => {
  const r = await t.app.inject({ method: 'GET', url: '/' });
  assert.match(r.headers['permissions-policy'] as string, /geolocation=\(self\)/);
  assert.doesNotMatch(r.headers['permissions-policy'] as string, /microphone=\(self/);
});

test('business portal: served at /business/ with its scripts, and the page cannot run anything but its own files', async () => {
  const get = (url: string) => t.app.inject({ method: 'GET', url });
  const page = await get('/business/');
  assert.equal(page.statusCode, 200);
  assert.match(page.payload, /script-src 'self'/);
  assert.equal((await get('/business/app.js')).statusCode, 200);
  assert.equal((await get('/business/i18n.js')).statusCode, 200);
  assert.equal((await get('/business')).statusCode, 302);
});
