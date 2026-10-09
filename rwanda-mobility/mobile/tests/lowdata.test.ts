import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, type Tokens } from '../src/lib/net.ts';
import { DARK, LIGHT, TEXT_PAIRS, contrast, fontCap, resolveTheme } from '../src/lib/palette.ts';
import { parsePrefs, DEFAULT_PREFS } from '../src/lib/prefs.ts';

const ts = () => { let cur: Tokens | null = { access_token: 'tok-abcdefghijklmnop', refresh_token: 'r' }; return { get: async () => cur, set: async (n: Tokens | null) => { cur = n; } }; };
const mk = (fetchImpl: any, lowData: () => boolean) => createClient({ baseUrl: 'http://x', tokens: ts(), deviceId: 'd', lang: () => 'fr', fetchImpl, sleep: async () => {}, lowData });

test('low-data off: no x-lite, no ETag headers', async () => {
  const seen: any[] = []; const c = mk(async (_u: string, init: any) => { seen.push(init.headers); return new Response('{"a":1}', { status: 200, headers: { etag: 'W/"1"' } }); }, () => false);
  await c.get('/bookings/1'); await c.get('/bookings/1');
  assert.equal(seen[0]['x-lite'], undefined); assert.equal(seen[1]['if-none-match'], undefined);
});

test('low-data on: x-lite on every request, ETag round trip with 304 reusing the cached body', async () => {
  const seen: any[] = []; let n = 0;
  const c = mk(async (_u: string, init: any) => { seen.push(init.headers); n++; return n === 1 ? new Response('{"a":1}', { status: 200, headers: { etag: 'W/"1"' } }) : new Response(null, { status: 304 }); }, () => true);
  assert.deepEqual(await c.get('/bookings/1'), { a: 1 });
  assert.deepEqual(await c.get('/bookings/1'), { a: 1 });
  assert.equal(seen[0]['x-lite'], '1'); assert.equal(seen[0]['if-none-match'], undefined);
  assert.equal(seen[1]['if-none-match'], 'W/"1"');
  c.clearCache(); await assert.rejects(() => c.get('/bookings/1'));   // 304 without a cache entry is not a success
});

test('low-data switch applies immediately (read per request) and POST never uses ETag', async () => {
  let on = false; const seen: any[] = [];
  const c = mk(async (_u: string, init: any) => { seen.push(init.headers); return new Response('{}', { status: 200, headers: { etag: 'W/"2"' } }); }, () => on);
  await c.get('/x'); on = true; await c.post('/y', {}); await c.get('/x');
  assert.equal(seen[0]['x-lite'], undefined); assert.equal(seen[1]['x-lite'], '1'); assert.equal(seen[1]['if-none-match'], undefined); assert.equal(seen[2]['if-none-match'], undefined);
});

test('both palettes reach 4.5:1 for every text/background pair', () => {
  for (const [name, pal] of [['light', LIGHT], ['dark', DARK]] as const)
    for (const [fg, bg] of TEXT_PAIRS) assert.ok(contrast(pal[fg], pal[bg]) >= 4.5, `${name}: ${fg} on ${bg} = ${contrast(pal[fg], pal[bg]).toFixed(2)}`);
  assert.equal(Object.keys(LIGHT).join(), Object.keys(DARK).join());
});

test('theme resolution and font cap', () => {
  assert.equal(resolveTheme('system', 'dark'), 'dark'); assert.equal(resolveTheme('system', null), 'light'); assert.equal(resolveTheme('light', 'dark'), 'light');
  assert.ok(Math.abs(fontCap(true) * 1.25 - 1.4) < 1e-9); assert.equal(fontCap(false), 1.4);
});

test('stored appearance prefs parse defensively', () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS); assert.deepEqual(parsePrefs('{bad'), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('{"theme":"dark","largeText":true,"lowData":true,"lockEnabled":true,"lockMinutes":5}'), { ...DEFAULT_PREFS, theme: 'dark', largeText: true, textScale: 1.25, lowData: true, lockEnabled: true, lockMinutes: 5 });   // an older install that only had large text on/off becomes the 'large' size
  assert.equal(parsePrefs('{"theme":"neon","lockMinutes":7}').theme, 'system'); assert.equal(parsePrefs('{"lockMinutes":7}').lockMinutes, 7, 'any whole number of minutes up to 120 is allowed'); assert.equal(parsePrefs('{"lockMinutes":500}').lockMinutes, 1);
  assert.equal(parsePrefs('{"textScale":1.5,"timeFormat":"12h","weekStart":0,"soundVolume":0.5,"vibrate":false}').timeFormat, '12h'); assert.equal(parsePrefs('{"textScale":3}').textScale, 1);
});
