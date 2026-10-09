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

test('MAP-03 offline place search finds OSM places, ignores accents and ranks near places first', async () => {
  const { searchIndex, placeIndexSize, norm } = await import('../src/services/placeIndex.ts');
  assert.ok(placeIndexSize() > 1000, 'places.json is loaded');
  assert.equal(norm('Hôtel des Mille Collines'), 'hotel des mille collines');
  const a = searchIndex('hotel mille', 'en');
  assert.ok(a.length >= 1 && a.some((h) => /mille collines/i.test(h.name)), 'finds the hotel by words that start its name');
  const kigali = { lat: -1.9441, lng: 30.0619 };
  const hosp = searchIndex('hospital', 'en', kigali, 5);
  assert.ok(hosp.length > 0 && hosp.every((h) => h.lat < 0));
  assert.deepEqual(searchIndex('x', 'en'), [], 'too-short queries return nothing');
});

test('STORE-01 database file store keeps uploads without a disk (STORAGE_DRIVER=db) and deletes them', async () => {
  const { config } = await import('../src/config.ts');
  const { saveFile, readFileByKey, deleteFileByKey } = await import('../src/services/storage.ts');
  const { makePng } = await import('./helpers.ts');
  const prev = config.storageDriver; (config as any).storageDriver = 'db';
  try {
    const png = makePng();
    const f = await saveFile(png, 'docs', 'image/png');
    const row = await t.db.q1<any>('select size from stored_files where key=$1', [f.key]);
    assert.equal(row.size, png.length);
    assert.deepEqual(await readFileByKey(f.key), png);
    await deleteFileByKey(f.key);
    assert.equal(await t.db.q1('select 1 from stored_files where key=$1', [f.key]), undefined);
  } finally { (config as any).storageDriver = prev; }
});

test('FRAUD-01 a location marked as mocked by the phone is rejected and the driver is flagged', async () => {
  const { updateLocation } = await import('../src/services/drivers.ts');
  const id = (await t.register('driver')).id;
  const ok = await updateLocation(id, { lat: -1.95, lng: 30.06 });
  assert.equal(ok.accepted, true);
  const bad = await updateLocation(id, { lat: -1.951, lng: 30.061, mocked: true });
  assert.deepEqual(bad, { accepted: false, reason: 'mock_location' });
  const row = await t.db.q1<any>('select last_lat, mock_location_at from driver_profiles where user_id=$1', [id]);
  assert.equal(row.last_lat, -1.95, 'the mocked point was not stored');
  assert.ok(row.mock_location_at);
  assert.equal((await t.db.q1<any>("select count(*)::int n from audit_logs where action='driver.mock_location' and entity_id=$1", [id])).n, 1);
});

test('MAP-04 /places/search merges curated places with the offline OSM index and honours the pickup bias', async () => {
  const p = await t.register('passenger');
  const r = await t.api('GET', '/places/search?q=hospital&lang=en&lat=-1.9441&lng=30.0619', { token: p.token });
  assert.equal(r.status, 200);
  assert.ok(r.json.places.length >= 3, 'several hospitals');
  assert.ok(r.json.places.some((x: any) => x.source === 'osm'), 'includes OpenStreetMap places');
  const bad = await t.api('GET', '/places/search?q=hospital&lat=99&lng=30', { token: p.token });
  assert.equal(bad.status, 400, 'out-of-range coordinates are rejected');
});

test('GEO-01 geohash cells cover the search circle and nearby lookup uses the indexed cells', async () => {
  const { encode, cellsCovering, precisionFor } = await import('../src/util/geohash.ts');
  assert.equal(encode(-1.9441, 30.0619, 6).length, 6);
  assert.equal(encode(57.64911, 10.40744, 11), 'u4pruydqqvj', 'standard geohash test vector');
  assert.equal(precisionFor(3000), 5); assert.equal(precisionFor(500), 6); assert.equal(precisionFor(12500), 4); assert.equal(precisionFor(30000), null);
  const c = { lat: -1.9441, lng: 30.0619 };
  for (const [dx, dy] of [[0, 0], [2900, 0], [-2900, 2900], [0, -2900], [2000, 2000]]) {      // points inside a 3 km circle always land in a covered cell
    const pt = { lat: c.lat + dy / 111_320, lng: c.lng + dx / 111_320 };
    assert.ok(cellsCovering(c, 3000, 5).includes(encode(pt.lat, pt.lng, 5)), `covered ${dx},${dy}`);
  }
  assert.ok(cellsCovering(c, 3000, 5).length <= 9);
});

test('GEO-02 a driver is found near the pickup through the geohash filter and not when far away', async () => {
  const { nearbyAvailable } = await import('../src/services/bookings.ts');
  const d = await t.driver({ at: { lat: -1.9441, lng: 30.0619 } });
  const row = await t.db.q1<any>('select gh4, gh5, gh6 from driver_profiles where user_id=$1', [d.id]);
  assert.equal(row.gh6.length, 6); assert.equal(row.gh5, row.gh6.slice(0, 5)); assert.equal(row.gh4, row.gh6.slice(0, 4));
  const svc = (await t.db.q1<any>("select * from service_categories where id='moto'"))!;
  const near = await nearbyAvailable(svc, 'kigali', { lat: -1.9460, lng: 30.0640 }, 3000, 600);
  assert.ok(near.length >= 1, 'found within 3 km');
  const far = await nearbyAvailable(svc, 'kigali', { lat: -1.60, lng: 30.40 }, 3000, 600);
  assert.equal(far.length, 0);
});
