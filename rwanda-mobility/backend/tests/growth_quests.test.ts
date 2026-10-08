import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx, KCC } from './helpers.ts';

let t: Ctx; let Q: typeof import('../src/services/quests.ts'); let L: typeof import('../src/services/ledger.ts');
before(async () => { t = await boot(); Q = await import('../src/services/quests.ts'); L = await import('../src/services/ledger.ts'); });
after(async () => { await t.close(); });

async function trip(drv: any, service = 'moto') {
  await t.db.q('update driver_profiles set is_online=false where user_id <> $1', [drv.id]);   // only this driver can receive the offer
  await t.db.q('update driver_profiles set is_online=true where user_id = $1', [drv.id]);
  await t.api('POST', '/drivers/me/location', { token: drv.token, body: KCC });
  const p = await t.register('passenger');
  const b = await t.book(p.token, service, 'cash');
  assert.equal(b.res.status, 201, JSON.stringify(b.res.json));
  await t.runTrip(p, drv, b.res.json.booking.id);
  return b.res.json.booking.id as string;
}
const quest = (extra: any = {}) => ({ title_en: 'Two trips', title_rw: 'Ingendo ebyiri', title_fr: 'Deux courses', kind: 'trips', target: 2, window: 'daily', reward: 1500, active: true, ...extra });
const payable = async (id: string) => (await L.driverBalance(id)).payable;

test('seeded quests are inactive placeholders; admin CRUD is permission-gated and audited', async () => {
  const seeded = await t.db.q<any>('select * from driver_quests');
  assert.equal(seeded.length, 3); assert.ok(seeded.every((q: any) => !q.active && q.placeholder));
  const mgr = await t.staff('business_manager'), analyst = await t.staff('analyst');
  assert.equal((await t.api('GET', '/admin/quests', { token: analyst.token })).status, 403);
  const bad = await t.api('POST', '/admin/quests', { token: mgr.token, body: quest({ kind: 'streak', window: 'daily' }) });
  assert.equal(bad.status, 400);
  const c = await t.api('POST', '/admin/quests', { token: mgr.token, body: quest({ budget_cap: 3000, active: false }) });
  assert.equal(c.status, 200); assert.equal(c.json.active, false);
  const up = await t.api('PATCH', `/admin/quests/${c.json.id}`, { token: mgr.token, body: { reward: 2000 } });
  assert.equal(up.json.reward, 2000);
  assert.equal((await t.api('PATCH', `/admin/quests/${c.json.id}`, { token: mgr.token, body: { budget_cap: 1 } })).status, 200);   // spent is 0
  const list = await t.api('GET', '/admin/quests', { token: mgr.token });
  const row = list.json.quests.find((x: any) => x.id === c.json.id);
  assert.equal(row.budget_remaining, 1); assert.equal(row.spent, 0);
  assert.ok((await t.db.q<any>("select 1 from audit_logs where action='quest.updated' and entity_id=$1", [c.json.id])).length);
  await t.db.q('delete from driver_quest_awards'); await t.db.q('delete from driver_quests');
});

test('trips quest: credited once through the ledger, no double credit, budget respected, concurrency safe', async () => {
  await t.reset(); await t.db.q('delete from driver_quest_awards'); await t.db.q('delete from driver_quests');
  const mgr = await t.staff('business_manager');
  const q1_ = (await t.api('POST', '/admin/quests', { token: mgr.token, body: quest({ budget_cap: 3000 }) })).json;
  const d1 = await t.driver({ at: KCC });
  await trip(d1);
  const before_ = await payable(d1.id);
  const mid = await t.api('GET', '/drivers/me/quests', { token: d1.token, headers: { 'accept-language': 'fr' } });
  assert.equal(mid.json.quests[0].progress, 1); assert.equal(mid.json.quests[0].completed, false); assert.equal(mid.json.quests[0].title, 'Deux courses');
  await trip(d1);
  const earned = (await t.db.q<any>("select coalesce(sum(net),0)::int n from driver_earnings where driver_id=$1", [d1.id]))[0].n;   // cash trips are not settled yet
  assert.equal(await payable(d1.id) - before_, 1500);
  assert.equal((await t.db.q<any>('select count(*)::int n from driver_quest_awards where driver_id=$1', [d1.id]))[0].n, 1);
  void earned;
  // repeated and parallel evaluation never pays twice
  await Promise.all(Array.from({ length: 10 }, () => Q.evaluateDriver(d1.id)));
  await Q.sweepQuests(); await trip(d1);
  assert.equal((await t.db.q<any>('select count(*)::int n from driver_quest_awards where driver_id=$1', [d1.id]))[0].n, 1);
  assert.equal((await t.db.q<any>("select coalesce(sum(credit-debit),0)::int n from ledger_entries where account_code='DRIVER_PAYABLE' and owner_user_id=$1 and memo like 'quest bonus%'", [d1.id]))[0].n, 1500);
  assert.equal((await L.integrityReport()).balanced, true);
  assert.equal((await t.db.q<any>("select coalesce(sum(debit-credit),0)::int n from ledger_entries where account_code='INCENTIVE_EXPENSE'"))[0].n, 1500);
  const done = await t.api('GET', '/drivers/me/quests', { token: d1.token });
  assert.equal(done.json.quests[0].completed, true); assert.equal(done.json.quests[0].percent, 100);
  const hist = await t.api('GET', '/drivers/me/quests/history', { token: d1.token, headers: { 'accept-language': 'rw' } });
  assert.equal(hist.json.awards.length, 1); assert.equal(hist.json.awards[0].title, 'Ingendo ebyiri'); assert.equal(hist.json.awards[0].amount, 1500);
  assert.ok((await t.db.q<any>("select 1 from notifications where user_id=$1 and template_key='quest_bonus'", [d1.id])).length);
  // budget 3000 = two awards; the third driver is refused, spent never exceeds the cap
  const d2 = await t.driver({ at: KCC }); await trip(d2); await trip(d2);
  const d3 = await t.driver({ at: KCC }); await trip(d3); await trip(d3);
  assert.equal(await payable(d2.id) > 0, true);
  assert.equal((await t.db.q<any>('select count(*)::int n from driver_quest_awards where quest_id=$1', [q1_.id]))[0].n, 2);
  assert.equal((await t.db.q<any>('select spent from driver_quests where id=$1', [q1_.id]))[0].spent, 3000);
  const d3q = await t.api('GET', '/drivers/me/quests', { token: d3.token });
  assert.equal(d3q.json.quests[0].budget_exhausted, true); assert.equal(d3q.json.quests[0].completed, false);
  // admin sees budget usage and awards
  const aw = await t.api('GET', `/admin/quests/${q1_.id}/awards`, { token: mgr.token });
  assert.equal(aw.json.awards.length, 2);
  // authorization: passengers cannot use the driver endpoints
  const p = await t.register('passenger');
  assert.equal((await t.api('GET', '/drivers/me/quests', { token: p.token })).status, 403);
});

test('race for the last unit of budget: exactly one winner', async () => {
  await t.reset(); await t.db.q('delete from driver_quest_awards'); await t.db.q('delete from driver_quests');
  const mgr = await t.staff('business_manager');
  const drivers = [await t.driver({ at: KCC }), await t.driver({ at: KCC }), await t.driver({ at: KCC })];
  for (const d of drivers) { await trip(d); await trip(d); }   // no active quest yet, so nothing awarded
  const qq = (await t.api('POST', '/admin/quests', { token: mgr.token, body: quest({ budget_cap: 1500 }) })).json;
  await Promise.all(drivers.flatMap((d) => [Q.evaluateDriver(d.id), Q.evaluateDriver(d.id)]));
  assert.equal((await t.db.q<any>('select count(*)::int n from driver_quest_awards where quest_id=$1', [qq.id]))[0].n, 1);
  assert.equal((await t.db.q<any>('select spent from driver_quests where id=$1', [qq.id]))[0].spent, 1500);
  assert.equal((await L.integrityReport()).balanced, true);
});

test('earnings, peak-hours, streak kinds and service filter (fixed clock)', async () => {
  await t.reset(); await t.db.q('delete from driver_quest_awards'); await t.db.q('delete from driver_quests');
  const mgr = await t.staff('business_manager');
  const d = await t.driver({ at: KCC });
  const ids = [await trip(d), await trip(d), await trip(d)];
  const at = new Date('2026-10-14T10:00:00+02:00');                       // a Wednesday
  const days = ['2026-10-12', '2026-10-13', '2026-10-14'];
  for (let i = 0; i < 3; i++) await t.db.q("update bookings set completed_at=$2 where id=$1", [ids[i], `${days[i]}T08:30:00+02:00`]);
  await t.db.q("update bookings set final_fare = 40000 where id = any($1)", [ids]);
  await t.db.q("delete from driver_quest_awards");
  const mk = async (body: any) => (await t.api('POST', '/admin/quests', { token: mgr.token, body: quest(body) })).json;
  const earn = await mk({ kind: 'earnings', target: 100000, window: 'weekly', reward: 800 });
  const streak = await mk({ kind: 'streak', target: 3, window: 'weekly', reward: 700 });
  const peak = await mk({ kind: 'peak_hours', target: 3, window: 'weekly', reward: 600 });   // 08:30 is in the default rush hours
  const filt = await mk({ kind: 'trips', target: 1, window: 'weekly', reward: 500, service_ids: ['standard'] });
  const res = await Q.evaluateDriver(d.id, at);
  const won = res.filter((r) => r.result === 'awarded').map((r) => r.quest_id).sort();
  assert.deepEqual(won, [earn.id, streak.id, peak.id].sort());           // the 'standard'-only quest did not count moto trips
  assert.equal(res.find((r) => r.quest_id === earn.id)!.period, 'W:2026-10-12');
  assert.ok(!won.includes(filt.id));
  assert.equal((await Q.evaluateDriver(d.id, at)).filter((r) => r.result === 'awarded').length, 0);
  // daily window period keys are Kigali days
  assert.equal(Q.periodFor('daily', new Date('2026-10-14T23:30:00Z')).key, 'D:2026-10-15');   // 23:30 UTC is already the next day in Kigali
  assert.equal(Q.periodFor('weekly', new Date('2026-10-18T10:00:00+02:00')).key, 'W:2026-10-12');   // Sunday belongs to the week that started Monday
});

test('an unapproved driver is never paid', async () => {
  await t.reset(); await t.db.q('delete from driver_quest_awards'); await t.db.q('delete from driver_quests'); await t.db.q('delete from driver_quest_awards');
  const mgr = await t.staff('business_manager');
  const d = await t.driver({ at: KCC }); await trip(d); await trip(d);
  const qq = (await t.api('POST', '/admin/quests', { token: mgr.token, body: quest() })).json;
  await t.db.q("update driver_profiles set status='SUSPENDED' where user_id=$1", [d.id]);
  assert.deepEqual(await Q.evaluateDriver(d.id), []);
  assert.equal((await t.db.q<any>('select count(*)::int n from driver_quest_awards where quest_id=$1', [qq.id]))[0].n, 0);
});
