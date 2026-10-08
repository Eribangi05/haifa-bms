import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx, KCC, KIMIRONKO } from './helpers.ts';

let t: Ctx; let clear: () => void;
before(async () => { t = await boot(); clear = (await import('../src/services/heatmap.ts')).clearHeatmapCache; });
after(async () => { await t.close(); });

test('heat map: k-anonymity, intensity 0-1, hint keys, three windows, driver gets no counts, access rules', async () => {
  await t.reset();
  const drv = await t.driver({ at: KCC });
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) { const p = await t.register('passenger'); const b = await t.book(p.token, 'moto'); assert.equal(b.res.status, 201); ids.push(b.res.json.booking.id); }
  // one person asking repeatedly in another cell must stay hidden (k counts distinct people)
  const solo = await t.register('passenger');
  for (let i = 0; i < 4; i++) {
    const b = await t.book(solo.token, 'moto', 'cash', { estimate: { pickup: KIMIRONKO, dest: KCC } });
    assert.equal(b.res.status, 201, JSON.stringify(b.res.json));
    await t.api('POST', `/bookings/${b.res.json.booking.id}/cancel`, { token: solo.token, body: { reason: 'changed_mind' } });
  }
  // three unmatched requests in the busy cell, three the same hour last week
  await t.db.q("update bookings set status='NO_DRIVER_FOUND', driver_id=null, assigned_at=null where id = any($1)", [ids.slice(0, 3)]);
  await t.db.q("update bookings set requested_at = now() - interval '7 days' where id = any($1)", [ids.slice(3)]);
  clear();
  const r = await t.api('GET', '/drivers/me/heatmap', { token: drv.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.cell_size_m, 500); assert.ok(r.json.k_min >= 3);
  const now = r.json.windows.now.cells;
  assert.equal(now.length, 1, 'only the busy cell passes k=3');
  assert.equal(now[0].intensity, 1); assert.equal(now[0].hint, 'heat.unserved');
  assert.deepEqual(Object.keys(now[0]).sort(), ['hint', 'intensity', 'lat', 'lng']);             // no counts for drivers
  assert.ok(Math.abs(now[0].lat - KCC.lat) < 0.005 && Math.abs(now[0].lng - KCC.lng) < 0.005);
  assert.equal(r.json.windows.last_hour.cells.length, 1);
  assert.equal(r.json.windows.same_hour_last_week.cells.length, 0, 'only 2 people last week: suppressed');
  assert.ok(!JSON.stringify(r.json).includes('requests'));
  // admin version: counts, unmatched, cached
  const an = await t.staff('analyst');
  const a = await t.api('GET', '/admin/heatmap', { token: an.token });
  assert.equal(a.status, 200); assert.equal(a.json.windows.now.cells[0].requests, 3); assert.equal(a.json.windows.now.cells[0].unmatched, 3);
  const generated = a.json.generated_at;
  assert.equal((await t.api('GET', '/admin/heatmap', { token: an.token })).json.generated_at, generated, 'served from cache');
  // access: online approved drivers only
  await t.db.q('update driver_profiles set is_online=false where user_id=$1', [drv.id]);
  const off = await t.api('GET', '/drivers/me/heatmap', { token: drv.token, headers: { 'accept-language': 'fr' } });
  assert.equal(off.status, 403); assert.match(off.json.error.message, /chauffeurs approuvés/);
  await t.db.q('update driver_profiles set is_online=true where user_id=$1', [drv.id]);
  await t.db.q("update driver_profiles set status='SUSPENDED' where user_id=$1", [drv.id]);
  assert.equal((await t.api('GET', '/drivers/me/heatmap', { token: drv.token })).status, 403);
  const p = await t.register('passenger');
  assert.equal((await t.api('GET', '/drivers/me/heatmap', { token: p.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/heatmap', { token: p.token })).status, 403);
  assert.equal((await t.api('GET', '/drivers/me/heatmap')).status, 401);
});

test('heat map: k can never be lowered below 3', async () => {
  const sa = await t.staff('super_admin');
  const r = await t.api('PUT', '/admin/settings/heatmap.k_min', { token: sa.token, body: { value: 1 } });
  assert.equal(r.status, 400);
  assert.equal((await t.api('PUT', '/admin/settings/heatmap.k_min', { token: sa.token, body: { value: 5 } })).status, 200);
  await t.api('DELETE', '/admin/settings/heatmap.k_min', { token: sa.token });
});
