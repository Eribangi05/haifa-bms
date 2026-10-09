import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

// The Rwanda base map (PMTiles + MapLibre + fonts) is served as public static files with HTTP range support (docs/MAP.md).
let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });

test('MAP-01 the PMTiles file answers range requests with a valid PMTiles header', async () => {
  const r = await t.app.inject({ method: 'GET', url: '/map/rwanda.pmtiles', headers: { range: 'bytes=0-126', 'accept-encoding': 'gzip' } });
  assert.equal(r.statusCode, 206);
  assert.equal(r.rawPayload.length, 127);
  assert.equal(r.rawPayload.subarray(0, 7).toString(), 'PMTiles');
  assert.equal(r.rawPayload[7], 3, 'PMTiles spec version 3');
});

test('MAP-02 libraries and fonts are served; the map is not rate limited', async () => {
  for (const u of ['/map/lib/maplibre-gl.js', '/map/lib/pmtiles.js', '/map/lib/maplibre-gl.css', '/map/fonts/Noto%20Sans%20Regular/0-255.pbf']) {
    const r = await t.app.inject({ method: 'GET', url: u });
    assert.equal(r.statusCode, 200, u);
  }
  const r = await t.app.inject({ method: 'GET', url: '/map/lib/pmtiles.js' });
  assert.equal(r.headers['x-ratelimit-limit'], undefined);
});
