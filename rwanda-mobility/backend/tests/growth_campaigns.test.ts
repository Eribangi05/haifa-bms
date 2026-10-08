import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx, KCC } from './helpers.ts';

let t: Ctx; let C: typeof import('../src/services/campaigns.ts'); let outbox: { to: string; text: string }[]; let flushSms: () => Promise<number>;
before(async () => { t = await boot(); C = await import('../src/services/campaigns.ts'); outbox = (await import('../src/providers/sms.ts')).outbox; flushSms = (await import('../src/services/notify.ts')).flushSms; });
after(async () => { await t.close(); });

const DAY = new Date('2026-10-14T10:00:00+02:00'), NIGHT = new Date('2026-10-14T22:30:00+02:00'), EARLY = new Date('2026-10-14T06:30:00+02:00');
const msg = (extra: any = {}) => ({ name: 'Promo', channel: 'sms', segment: { type: 'all_passengers' },
  title_rw: 'Igabanywa', title_fr: 'Remise', title_en: 'Discount', msg_rw: 'Igabanywa rya 20% kuri urugendo rwawe.', msg_fr: 'Remise de 20 % sur votre course.', msg_en: '20% off your next ride.', ...extra });
async function user(lang: string, prefs: any) {
  const u = await t.register('passenger');
  await t.db.q('update users set preferred_language=$2, notif_prefs=$3 where id=$1', [u.id, lang, JSON.stringify({ push: true, sms: true, email: false, marketing: false, ...prefs })]);
  return u;
}
const notifs = (id: string, ch = 'sms') => t.db.q<any>("select * from notifications where user_id=$1 and template_key='campaign' and channel=$2", [id, ch]);

test('validation: all three languages are required; permission; audit', async () => {
  const mgr = await t.staff('business_manager'), an = await t.staff('analyst');
  assert.equal((await t.api('POST', '/admin/campaigns', { token: an.token, body: msg() })).status, 403);
  const { msg_fr: _drop, ...noFr } = msg();
  assert.equal((await t.api('POST', '/admin/campaigns', { token: mgr.token, body: noFr })).status, 400);
  assert.equal((await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg({ msg_en: '   ' }) })).status, 400);
  assert.equal((await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg({ msg_en: 'x'.repeat(321) }) })).status, 400);   // SMS length
  assert.equal((await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg({ segment: { type: 'nope' } }) })).status, 400);
  const ok = await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg() });
  assert.equal(ok.status, 200); assert.equal(ok.json.status, 'draft');
  assert.ok((await t.db.q<any>("select 1 from audit_logs where action='campaign.created' and entity_id=$1", [ok.json.id])).length);
});

test('audience preview counts consent, channel and language; segments', async () => {
  const mgr = await t.staff('business_manager');
  await t.db.q("update users set notif_prefs = notif_prefs || '{\"marketing\":false}'");
  const a = await user('rw', { marketing: true }), b = await user('fr', { marketing: true }), c = await user('en', { marketing: true }), d = await user('sw', { marketing: true });
  await user('en', { marketing: false }); await user('fr', { marketing: true, sms: false });
  void a; void b; void c; void d;
  const p = await t.api('POST', '/admin/campaigns/preview', { token: mgr.token, body: { channel: 'sms', segment: { type: 'all_passengers' } } });
  assert.deepEqual(p.json, { matched: 6, eligible: 4, skipped_no_consent: 2, by_language: { rw: 2, fr: 1, en: 1 } });   // sw falls back to rw
  const push = await t.api('POST', '/admin/campaigns/preview', { token: mgr.token, body: { channel: 'push', segment: { type: 'all_passengers' } } });
  assert.equal(push.json.eligible, 5);
  const lang = await t.api('POST', '/admin/campaigns/preview', { token: mgr.token, body: { channel: 'inapp', segment: { type: 'language', lang: 'fr' } } });
  assert.equal(lang.json.matched, 2);
  const ph = await t.api('POST', '/admin/campaigns/preview', { token: mgr.token, body: { channel: 'sms', segment: { type: 'phone_list', phones: [a.phone, '0788000999', 'garbage'] } } });
  assert.equal(ph.json.matched, 1);
  const inactive = await t.api('POST', '/admin/campaigns/preview', { token: mgr.token, body: { channel: 'sms', segment: { type: 'inactive_passengers', days: 30 } } });
  assert.equal(inactive.json.matched, 6);
  assert.equal((await t.api('POST', '/admin/campaigns/preview', { token: mgr.token, body: { channel: 'sms', segment: { type: 'abasare_owners' } } })).json.matched, 0);
  assert.equal((await t.api('POST', '/admin/campaigns/preview', { token: mgr.token, body: { channel: 'sms', segment: { type: 'all_drivers' } } })).json.matched, 0);
  assert.equal((await t.api('POST', '/admin/campaigns/preview', { token: mgr.token, body: { channel: 'sms', segment: { type: 'zone', zone_id: 'kigali' } } })).json.matched, 0);
  assert.equal((await t.api('POST', '/admin/campaigns/preview', { token: mgr.token, body: { channel: 'sms', segment: { type: 'corporate_members' } } })).json.matched, 0);
});

test('send: own language only, opt-out, quiet hours, batches, dedupe and daily cap, rate caps; delivery through the SMS worker', async () => {
  const mgr = await t.staff('business_manager');
  await t.db.q("update users set notif_prefs = notif_prefs || '{\"marketing\":false}'");
  const rw = await user('rw', { marketing: true }), fr = await user('fr', { marketing: true }), en = await user('en', { marketing: true }), sw = await user('sw', { marketing: true });
  const out = await user('en', { marketing: false });
  await t.db.q("update system_settings set value=value where false");
  const c = (await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg() })).json;
  // test-send to self in a chosen language, clearly marked
  const ts = await t.api('POST', `/admin/campaigns/${c.id}/test-send`, { token: mgr.token, body: { lang: 'fr' } });
  assert.equal(ts.json.title, '[TEST] Remise'); assert.equal(ts.json.body, 'Remise de 20 % sur votre course.');
  assert.equal((await t.db.q<any>("select count(*)::int n from notifications where user_id=$1 and template_key='campaign_test'", [mgr.id]))[0].n, 1);
  assert.equal((await t.api('POST', `/admin/campaigns/${c.id}/test-send`, { token: mgr.token, body: { lang: 'de' } })).status, 400);
  // schedule: due now, but the first tick happens in quiet hours
  const sch = await t.api('POST', `/admin/campaigns/${c.id}/schedule`, { token: mgr.token, body: { scheduled_at: new Date(DAY.getTime() - 60e3).toISOString() } });
  assert.equal(sch.status, 200); assert.equal(sch.json.status, 'scheduled'); assert.equal(sch.json.stats.targeted, 4);
  assert.equal((await t.api('PATCH', `/admin/campaigns/${c.id}`, { token: mgr.token, body: msg() })).json.error.code, 'campaign_not_editable');
  assert.equal((await C.runCampaigns(NIGHT)).quiet, true);
  assert.equal((await C.runCampaigns(EARLY)).quiet, true);
  assert.equal((await t.db.q<any>('select count(*)::int n from notifications where template_key=$1', ['campaign']))[0].n, 0, 'nothing in quiet hours (21:00-07:00)');
  assert.equal((await t.db.q<any>('select status from campaigns where id=$1', [c.id]))[0].status, 'sending');
  // one recipient opts out after the audience was fixed
  await t.db.q("update users set notif_prefs = notif_prefs || '{\"marketing\":false}' where id=$1", [en.id]);
  await t.db.q("insert into system_settings(key,value) values ('campaign.batch_size','2') on conflict (key) do update set value=excluded.value");   // below the allowed minimum on purpose: batches of 2
  const first = await C.runCampaigns(DAY);
  assert.equal(first.sent <= 2, true); assert.equal((await t.db.q<any>('select status from campaigns where id=$1', [c.id]))[0].status === 'sending' || first.sent < 4, true);
  for (let i = 0; i < 5; i++) await C.runCampaigns(DAY);
  const done = (await t.db.q<any>('select status, stats from campaigns where id=$1', [c.id]))[0];
  assert.equal(done.status, 'done'); assert.equal(done.stats.sent, 3); assert.equal(done.stats.skipped_optout, 1);
  assert.equal((await notifs(en.id)).length, 0); assert.equal((await notifs(out.id)).length, 0);
  // each person: exactly one message, only in their language
  const expect: [any, string, RegExp][] = [[rw, 'rw', /^Igabanywa rya 20%/], [fr, 'fr', /^Remise de 20 %/], [sw, 'rw', /^Igabanywa rya 20%/]];
  for (const [u, lang, re] of expect) {
    const n = await notifs(u.id); assert.equal(n.length, 1); assert.equal(n[0].lang, lang); assert.match(n[0].body, re);
    assert.ok(!/discount|20% off|Remise/.test(lang === 'rw' ? n[0].body + n[0].title : ''), 'no other language mixed in');
  }
  await flushSms();
  const frSms = outbox.filter((m) => m.to === fr.phone && /Remise/.test(m.text)); assert.equal(frSms.length, 1); assert.equal(frSms[0].text, 'Remise de 20 % sur votre course.');
  assert.equal(outbox.filter((m) => m.to === en.phone && /20% off|Remise|Igabanywa/.test(m.text)).length, 0);
  // re-running never duplicates; a second campaign the same day is capped (1 per person per 24 h)
  await C.runCampaigns(DAY); assert.equal((await notifs(rw.id)).length, 1);
  const c2 = (await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg({ name: 'Second' }) })).json;
  await t.api('POST', `/admin/campaigns/${c2.id}/schedule`, { token: mgr.token, body: { scheduled_at: DAY.toISOString() } });
  for (let i = 0; i < 4; i++) await C.runCampaigns(new Date(DAY.getTime() + 60e3));
  const d2 = (await t.db.q<any>('select stats from campaigns where id=$1', [c2.id]))[0];
  assert.equal(d2.stats.skipped_cap, 3); assert.equal((await notifs(rw.id)).length, 1);
  // next day it can be sent again
  const c3 = (await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg({ name: 'Third', channel: 'inapp' }) })).json;
  await t.api('POST', `/admin/campaigns/${c3.id}/schedule`, { token: mgr.token, body: { scheduled_at: DAY.toISOString() } });
  for (let i = 0; i < 4; i++) await C.runCampaigns(new Date(DAY.getTime() + 25 * 3600e3));
  assert.equal((await notifs(rw.id, 'in_app')).length, 1);
  await t.db.q("delete from system_settings where key='campaign.batch_size'");
  const detail = await t.api('GET', `/admin/campaigns/${c.id}`, { token: mgr.token });
  assert.equal(detail.json.recipients.sent, 3); assert.deepEqual(detail.json.by_language, { rw: 2, fr: 1, en: 1 });
  assert.ok((await t.db.q<any>("select 1 from audit_logs where action='campaign.scheduled' and entity_id=$1", [c.id])).length);
});

test('push campaigns use the push queue; cancel stops sending; empty or oversized audiences are refused', async () => {
  const mgr = await t.staff('business_manager');
  await t.db.q("update users set notif_prefs = notif_prefs || '{\"marketing\":false}'");
  const u = await user('fr', { marketing: true });
  const c = (await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg({ channel: 'push', name: 'Push' }) })).json;
  await t.api('POST', `/admin/campaigns/${c.id}/schedule`, { token: mgr.token, body: { scheduled_at: new Date(DAY.getTime() - 1000).toISOString() } });
  await C.runCampaigns(DAY);
  assert.equal((await notifs(u.id, 'push')).length, 1); assert.equal((await notifs(u.id, 'in_app')).length, 1);
  assert.equal((await notifs(u.id, 'push'))[0].lang, 'fr');
  // cancel before sending
  const c2 = (await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg({ name: 'Cancelled', channel: 'inapp' }) })).json;
  await t.api('POST', `/admin/campaigns/${c2.id}/schedule`, { token: mgr.token, body: { scheduled_at: new Date(DAY.getTime() + 3600e3).toISOString() } });
  assert.equal((await t.api('POST', `/admin/campaigns/${c2.id}/cancel`, { token: mgr.token })).json.status, 'cancelled');
  await C.runCampaigns(new Date(DAY.getTime() + 2 * 3600e3));
  assert.equal((await t.api('POST', `/admin/campaigns/${c2.id}/cancel`, { token: mgr.token })).json.error.code, 'campaign_not_cancellable');
  // nobody eligible
  const c3 = (await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg({ name: 'Nobody', segment: { type: 'abasare_owners' } }) })).json;
  assert.equal((await t.api('POST', `/admin/campaigns/${c3.id}/schedule`, { token: mgr.token, body: {} })).json.error.code, 'campaign_empty');
  await t.db.q("insert into system_settings(key,value) values ('campaign.max_recipients','0') on conflict (key) do update set value=excluded.value");
  const c4 = (await t.api('POST', '/admin/campaigns', { token: mgr.token, body: msg({ name: 'Big' }) })).json;
  assert.equal((await t.api('POST', `/admin/campaigns/${c4.id}/schedule`, { token: mgr.token, body: {} })).json.error.code, 'campaign_too_large');
  await t.db.q("delete from system_settings where key='campaign.max_recipients'");
  void KCC;
});
