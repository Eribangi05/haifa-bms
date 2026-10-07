import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx, KCC, KIMIRONKO } from './helpers.ts';
import { localizeError, reqLang, GENERIC } from '../src/services/errmsg.ts';
import { DEFAULT_TEMPLATES, SUPPORTED_LANGS } from '../src/services/i18n.ts';

let t: Ctx;
before(async () => { t = await boot('rwanda_mobility_test'); });
after(async () => { await t.close(); });

const ENGLISH_HINT = /\b(the|your|you|please|wrong|code|cannot|not found|invalid|error|try again)\b/i;
const wrongCode = (c: string) => (c === '000000' ? '111111' : '000000');

test('reqLang: first tag, defaults to en', () => {
  assert.equal(reqLang('rw'), 'rw'); assert.equal(reqLang('fr-FR,fr;q=0.9,en;q=0.8'), 'fr'); assert.equal(reqLang('en-US'), 'en');
  assert.equal(reqLang('de'), 'en'); assert.equal(reqLang(undefined), 'en');
});

test('wrong OTP: message localised in rw, fr and en; code and status unchanged', async () => {
  const phone = '+250788400001';
  const o = await t.api('POST', '/auth/otp/request', { body: { phone } });
  const res: Record<string, any> = {};
  for (const lang of ['rw', 'fr', 'en']) res[lang] = await t.api('POST', '/auth/otp/verify', { body: { phone, code: wrongCode(o.json.dev_code) }, headers: { 'accept-language': lang } });
  for (const lang of ['rw', 'fr', 'en']) { assert.equal(res[lang].status, 400); assert.equal(res[lang].json.error.code, 'otp_invalid'); }
  assert.equal(res.en.json.error.message, 'Wrong code');
  assert.match(res.rw.json.error.message, /Kode/);
  assert.match(res.fr.json.error.message, /code/i);
  assert.ok(!ENGLISH_HINT.test(res.rw.json.error.message.replace(/kode/gi, '')), res.rw.json.error.message);
  assert.notEqual(res.fr.json.error.message, res.en.json.error.message);
});

test('404 and unknown route are localised', async () => {
  const u = await t.register('passenger');
  const id = '00000000-0000-4000-8000-000000000000';
  const en = await t.api('GET', `/bookings/${id}`, { token: u.token });
  const rw = await t.api('GET', `/bookings/${id}`, { token: u.token, headers: { 'accept-language': 'rw' } });
  const fr = await t.api('GET', `/bookings/${id}`, { token: u.token, headers: { 'accept-language': 'fr' } });
  for (const r of [en, rw, fr]) { assert.equal(r.status, 404); assert.equal(r.json.error.code, 'not_found'); }
  assert.equal(en.json.error.message, 'booking not found');
  assert.match(rw.json.error.message, /^Ntitwabonye urugendo/);
  assert.match(fr.json.error.message, /introuvable|trouver la course/);
  const nf = await t.api('GET', '/nope/nothing', { headers: { 'accept-language': 'fr' } });
  assert.equal(nf.status, 404); assert.equal(nf.json.error.message, 'Élément introuvable.');
  const unauth = await t.api('GET', '/users/me', { headers: { 'accept-language': 'rw' } });
  assert.equal(unauth.status, 401); assert.match(unauth.json.error.message, /Banza winjire/);
});

test('validation errors are localised and keep their code', async () => {
  const r = await t.api('POST', '/auth/otp/request', { body: { phone: 'abc' }, headers: { 'accept-language': 'fr' } });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, 'validation_error');
  assert.match(r.json.error.message, /pas valides/);
});

test('placeholders are filled from details; a code without an entry gives generic text, never English', () => {
  assert.match(localizeError('invalid_hours', 'rw', 'x', { min: 2, max: 12 }), /2.*12/);
  assert.match(localizeError('invalid_hours', 'fr', 'x', { min: 2, max: 12 }), /2.*12/);
  assert.equal(localizeError('invalid_hours', 'fr', 'Book between 2 and 12 hours'), GENERIC.fr);   // no details: no half-sentence
  for (const lang of ['rw', 'fr'] as const) {
    const m = localizeError('some_future_code', lang, 'Something English happened');
    assert.equal(m, GENERIC[lang]); assert.ok(!/English/.test(m));
  }
  assert.equal(GENERIC.rw, 'Hari ikitagenze neza. Ongera ugerageze.');
  assert.equal(localizeError('some_future_code', 'en', 'Something English happened'), 'Something English happened');
});

test('every user-facing code thrown by the API has an rw and fr message (admin-only codes excepted)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const files = ['src/routes', 'src/services'].flatMap((d) => readdirSync(d).map((f) => `${d}/${f}`)).filter((f) => f.endsWith('.ts') && !f.includes('errmsg'));
  const codes = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/(?:badRequest|conflict|AppError\(\d+,)\s*\(?\s*'([a-z_]+)'/g)) codes.add(m[1]);
  const adminOnly = new Set(['invite_invalid', 'invite_expired', 'mfa_not_started', 'bad_key', 'bad_timestamp', 'code_exists', 'email_in_use', 'fixed_required', 'invalid_clawback', 'invalid_driver_transition', 'invalid_percent', 'percent_required',
    'polygon_not_closed', 'unknown_setting', 'provider_reference_required', 'resolution_required', 'review_required', 'nothing_to_invoice', 'already_invoiced', 'credit_limit_required', 'forbidden_placeholder']);
  const FULL = { min: 1, max: 2, minutes: 3, years: 4, seconds: 5 };
  const missing = [...codes].filter((c) => !adminOnly.has(c) && localizeError(c, 'rw', 'x', FULL) === GENERIC.rw);
  assert.deepEqual(missing, [], 'add these codes to src/services/errmsg.ts');
});

test('/config lists three languages; services and places carry French', async () => {
  const c = await t.api('GET', '/config');
  assert.deepEqual(c.json.languages, ['rw', 'fr', 'en']);
  const s = await t.api('GET', '/services');
  assert.ok(s.json.services.length > 0);
  for (const x of s.json.services) { assert.ok(x.name_fr, x.id); assert.ok(x.description_fr, x.id); assert.ok(x.description_rw && x.description_en); }
  const std = s.json.services.find((x: any) => x.id === 'standard');
  assert.equal(std.name_fr, 'Voiture standard');
  const pf = await t.api('GET', '/places/popular?lang=fr');
  assert.ok(pf.json.places.some((p: any) => p.name === 'Marché de Kimironko'));
  const pr = await t.api('GET', '/places/popular?lang=rw');
  assert.ok(pr.json.places.some((p: any) => p.name === 'Isoko rya Kimironko'));
  const u = await t.register('passenger');
  const sf = await t.api('GET', '/places/search?q=Marché&lang=fr', { token: u.token });
  assert.ok(sf.json.places.some((p: any) => p.name === 'Marché de Kimironko'));
});

test('quote options and fare lines carry French labels', async () => {
  const u = await t.register('passenger');
  const e = await t.api('POST', '/fares/estimate', { token: u.token, body: { pickup: KCC, dest: KIMIRONKO, service_id: 'standard' } });
  const o = e.json.options[0];
  assert.ok(o.name_fr);
  for (const l of o.fare.lines) { assert.ok(l.label_fr, l.code); assert.ok(l.label_rw, l.code); }
  assert.equal(o.fare.lines.find((l: any) => l.code === 'base').label_fr, 'Prix de base');
});

test('every template exists in every supported language, with identical placeholders', () => {
  assert.deepEqual([...SUPPORTED_LANGS].sort(), ['en', 'fr', 'rw']);
  for (const [key, byLang] of Object.entries(DEFAULT_TEMPLATES)) {
    const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
    for (const lang of SUPPORTED_LANGS) {
      assert.ok(byLang[lang]?.title && byLang[lang]?.body, `${key}.${lang}`);
      assert.equal(ph(byLang[lang].body), ph(byLang.en.body), `${key}.${lang} placeholders`);
      assert.ok(!/\{[a-z]+\}/.test(byLang[lang].body.replace(/\{\{\w+\}\}/g, '')), `${key}.${lang} single-brace placeholder`);
    }
  }
});

test('French OTP SMS and notifications use the fr template; params are translated', async () => {
  const { outbox } = await import('../src/providers/sms.ts');
  const phone = '+250788400002';
  const o = await t.api('POST', '/auth/otp/request', { body: { phone, language: 'fr' } });
  const sms = outbox.filter((m) => m.to === phone).at(-1)!;
  assert.ok(sms.text.includes(o.json.dev_code));
  assert.match(sms.text, /Votre code Abasare/);
  // language from Accept-Language when the body has none
  const phone2 = '+250788400003';
  await t.api('POST', '/auth/otp/request', { body: { phone: phone2 }, headers: { 'accept-language': 'en' } });
  assert.match(outbox.filter((m) => m.to === phone2).at(-1)!.text, /Your Abasare code/);

  const v = await t.api('POST', '/auth/otp/verify', { body: { phone, code: o.json.dev_code, language: 'fr' } });
  assert.equal(v.json.user.preferred_language, 'fr');
  const { notify } = await import('../src/services/notify.ts');
  await notify(v.json.user.id, 'driver_decision', { status: 'APPROVED', reason: '' });
  await notify(v.json.user.id, 'doc_expiry', { doc: 'driving_licence', days: 3 });
  const rows = await t.db.q<any>('select template_key, lang, title, body from notifications where user_id=$1 and channel=$2', [v.json.user.id, 'in_app']);
  assert.ok(rows.length >= 2 && rows.every((r: any) => r.lang === 'fr'));
  const dd = rows.find((r: any) => r.template_key === 'driver_decision');
  assert.match(dd.body, /candidature.*approuvé/); assert.match(rows.find((r: any) => r.template_key === 'doc_expiry').body, /permis de conduire/);
  // same event in Kinyarwanda carries no English enum text
  await t.db.q("update users set preferred_language='rw' where id=$1", [v.json.user.id]);
  await notify(v.json.user.id, 'doc_expiry', { doc: 'driving_licence', days: 3 });
  const rw = (await t.db.q<any>("select body from notifications where user_id=$1 and template_key='doc_expiry' and lang='rw' limit 1", [v.json.user.id]))[0];
  assert.match(rw.body, /Uruhushya rwo gutwara/); assert.ok(!/licence/i.test(rw.body));
});
