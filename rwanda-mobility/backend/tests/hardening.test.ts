import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { boot, makeJpeg, makePng, makePdf, type Ctx } from './helpers.ts';

let t: Ctx;
let S: typeof import('../src/services/scan.ts');
let CE: typeof import('../src/services/clientErrors.ts');
before(async () => {
  t = await boot('rwanda_mobility_test');
  S = await import('../src/services/scan.ts'); CE = await import('../src/services/clientErrors.ts');
});
after(async () => { await t.close(); });

function multipart(fields: Record<string, string>, file: { name: string; data: Buffer; type: string }) {
  const b = '----rm' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
const code = async (p: Promise<any>) => { try { await p; return null; } catch (e: any) { return e.code as string; } };

// ---------------- client error reporting ----------------
test('client errors: stored with scrubbing, optional auth, validated, listed for permitted staff only', async () => {
  const u = await t.register();
  const body = {
    message: 'Network failed for +250788123456 / 0788 123 456 token=abcdef123456 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl user a.b@example.com',
    stack: 'Error at pay (PaymentScreen.tsx:10) ExponentPushToken[abc123def456] national id 1199080012345678',
    app_version: '1.2.0', platform: 'android', screen: 'PaymentScreen', lang: 'fr',
  };
  const anon = await t.api('POST', '/client-errors', { body });
  assert.equal(anon.status, 202);
  const authed = await t.api('POST', '/client-errors', { token: u.token, body: { ...body, screen: 'Home' } });
  assert.equal(authed.status, 202);
  const bad = await t.api('POST', '/client-errors', { token: 'garbage.token.value', body: { ...body, screen: 'Bad' } });
  assert.equal(bad.status, 202, 'an invalid token never blocks a crash report');
  const rows = await t.db.q<any>('select * from client_errors order by id desc limit 3');
  const all = JSON.stringify(rows);
  for (const secret of ['788123456', '0788 123 456', 'abcdef123456', 'eyJhbGci', 'example.com', 'abc123def456', '1199080012345678']) assert.ok(!all.includes(secret), `leaked ${secret}`);
  assert.match(rows[0].message, /\[phone\]/); assert.match(rows[0].stack, /\[push-token\]/);
  assert.equal(rows.find((r: any) => r.screen === 'Home').user_id, u.id);
  assert.equal(rows.find((r: any) => r.screen === 'Bad').user_id, null);
  assert.equal(CE.scrub('ordinary message: cannot read property of undefined'), 'ordinary message: cannot read property of undefined');
  // limits
  assert.equal((await t.api('POST', '/client-errors', { body: { ...body, message: 'x'.repeat(501) } })).status, 400);
  assert.equal((await t.api('POST', '/client-errors', { body: { ...body, stack: 'x'.repeat(4001) } })).status, 400);
  assert.equal((await t.api('POST', '/client-errors', { body: {} })).status, 400);
  // admin list
  const analyst = await t.staff('analyst'), driverVerifier = await t.staff('driver_verifier');
  assert.equal((await t.api('GET', '/admin/client-errors', { token: u.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/client-errors', { token: driverVerifier.token })).status, 403);
  assert.equal((await t.api('GET', '/admin/client-errors')).status, 401);
  const list = await t.api('GET', '/admin/client-errors?platform=android&screen=Home', { token: analyst.token });
  assert.equal(list.status, 200); assert.ok(list.json.errors.length >= 1); assert.ok(list.json.errors.every((e: any) => e.screen === 'Home'));
});

test('client errors: retention purge removes old reports only', async () => {
  const { purgeClientErrors } = await import('../src/jobs.ts');
  await t.db.q("insert into client_errors(message, created_at) values ('old one', now() - interval '45 days'), ('fresh one', now())");
  assert.ok(await purgeClientErrors() >= 1);
  assert.equal((await t.db.q("select 1 from client_errors where message='old one'")).length, 0);
  assert.equal((await t.db.q("select 1 from client_errors where message='fresh one'")).length, 1);
});

// ---------------- upload hardening ----------------
test('scanFile: accepts well-formed JPEG, PNG and PDF', async () => {
  await S.scanFile(makeJpeg(), 'image/jpeg'); await S.scanFile(makePng(), 'image/png'); await S.scanFile(makePdf(), 'application/pdf');
  await S.scanFile(Buffer.concat([makeJpeg(), Buffer.alloc(8)]), 'image/jpeg');    // zero padding after EOI is tolerated
});

test('scanFile: rejects mime mismatch, corruption, polyglots, script markers, active PDFs and silly dimensions', async () => {
  const jpg = makeJpeg(), png = makePng(), pdf = makePdf();
  assert.equal(await code(S.scanFile(jpg, 'image/png')), 'unsupported_file', 'declared type must match the content');
  assert.equal(await code(S.scanFile(png, 'application/pdf')), 'unsupported_file');
  assert.equal(await code(S.scanFile(Buffer.from('MZ' + 'x'.repeat(200)), 'image/jpeg')), 'unsupported_file');
  assert.equal(await code(S.scanFile(jpg.subarray(0, 60), 'image/jpeg')), 'unsupported_file', 'too small / truncated');
  assert.equal(await code(S.scanFile(jpg.subarray(0, jpg.length - 40), 'image/jpeg')), 'unsupported_file');
  assert.equal(await code(S.scanFile(png.subarray(0, png.length - 20), 'image/png')), 'unsupported_file');
  const flipped = Buffer.from(png); flipped[40] ^= 0xff;
  assert.equal(await code(S.scanFile(flipped, 'image/png')), 'unsupported_file', 'PNG checksum');
  // polyglots: data hidden after the image end
  assert.equal(await code(S.scanFile(Buffer.concat([jpg, Buffer.from('PK\x03\x04 zip payload')]), 'image/jpeg')), 'file_unsafe');
  assert.equal(await code(S.scanFile(Buffer.concat([png, Buffer.from('<?php system($_GET[0]); ?>')]), 'image/png')), 'file_unsafe');
  // script markers inside an otherwise valid file
  const withScript = Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xff, 0xfe, 0x00, 0x20]), Buffer.from('<script>alert(1)</script>..'), jpg.subarray(2)]);
  assert.equal(await code(S.scanFile(withScript, 'image/jpeg')), 'file_unsafe');
  assert.equal(await code(S.scanFile(Buffer.concat([pdf.subarray(0, pdf.length - 7), Buffer.from('<html><body onload=x()></body></html>\n%%EOF\n')]), 'application/pdf')), 'file_unsafe');
  assert.equal(await code(S.scanFile(makePdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >> '), 'application/pdf')), 'file_unsafe');
  assert.equal(await code(S.scanFile(pdf.subarray(0, 60), 'application/pdf')), 'unsupported_file');
  // dimensions
  assert.equal(await code(S.scanFile(makeJpeg(4, 4), 'image/jpeg')), 'unsupported_file');
  assert.equal(await code(S.scanFile(makeJpeg(30000, 30000), 'image/jpeg')), 'unsupported_file');
  assert.equal(await code(S.scanFile(makePng(10, 10), 'image/png')), 'unsupported_file');
  assert.equal(await code(S.scanFile(Buffer.alloc(6 * 1024 * 1024, 1), 'image/jpeg')), 'file_too_large');
});

test('uploads go through the scanner: API rejects unsafe files with a localised error and stores nothing', async () => {
  const d = await t.register('driver');
  const bad = Buffer.concat([makeJpeg(), Buffer.from('<?php evil(); ?>')]);
  const lang = (l: string, m: ReturnType<typeof multipart>) => ({ token: d.token, payload: m.payload, headers: { ...m.headers, 'accept-language': l } });
  const r = await t.api('POST', '/drivers/documents', lang('fr', multipart({ doc_type: 'national_id' }, { name: 'id.jpg', data: bad, type: 'image/jpeg' })));
  assert.equal(r.status, 400); assert.equal(r.json.error.code, 'file_unsafe'); assert.match(r.json.error.message, /risque de sécurité/);
  const rw = await t.api('POST', '/drivers/documents', lang('rw', multipart({ doc_type: 'national_id' }, { name: 'id.jpg', data: bad, type: 'image/jpeg' })));
  assert.match(rw.json.error.message, /dosiye/); assert.ok(!/fichier|file/i.test(rw.json.error.message));
  const mism = await t.api('POST', '/drivers/documents', { token: d.token, ...multipart({ doc_type: 'national_id' }, { name: 'id.png', data: makeJpeg(), type: 'image/png' }) });
  assert.equal(mism.json.error.code, 'unsupported_file');
  assert.equal((await t.db.q('select 1 from driver_documents where driver_id=$1', [d.id])).length, 0);
  const ok = await t.api('POST', '/drivers/documents', { token: d.token, ...multipart({ doc_type: 'national_id' }, { name: 'id.jpg', data: makeJpeg(), type: 'image/jpeg' }) });
  assert.equal(ok.status, 200);
});

test('the scan hook is pluggable', async () => {
  const prev = S.setScanner(async () => { throw Object.assign(new Error('x'), { code: 'file_unsafe' }); });
  try { assert.equal(await code(S.scanFile(makeJpeg(), 'image/jpeg')), 'file_unsafe'); } finally { S.setScanner(prev); }
  await S.scanFile(makeJpeg(), 'image/jpeg');
});

test('ClamAV INSTREAM client: clean, infected and unreachable scanner (fail closed)', async () => {
  let received = Buffer.alloc(0); let verdict = 'stream: OK\0';
  const srv = net.createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.subarray(0, 10).toString() === 'zINSTREAM\0' && buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) { received = buf; s.end(verdict); }
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as net.AddressInfo).port;
  try {
    const file = makeJpeg();
    await S.clamavScan(file, '127.0.0.1', port);
    // protocol: command, then <len><data> chunks, then a zero-length chunk
    assert.equal(received.readUInt32BE(10), file.length); assert.ok(received.subarray(14, 14 + file.length).equals(file));
    verdict = 'stream: Eicar-Test-Signature FOUND\0';
    assert.equal(await code(S.clamavScan(file, '127.0.0.1', port)), 'file_unsafe');
  } finally { srv.close(); }
  assert.equal(await code(S.clamavScan(makeJpeg(), '127.0.0.1', port)), 'scan_unavailable');
});

// ---------------- stricter rate limits ----------------
test('per-route rate limits: client errors, bookings, uploads and payments return a localised 429', async () => {
  const keys = ['CLIENT_ERR_RATE_MAX', 'BOOKING_RATE_MAX', 'UPLOAD_RATE_MAX', 'PAYMENT_RATE_MAX'];
  const saved = keys.map((k) => process.env[k]);
  keys.forEach((k) => { process.env[k] = '2'; });
  const { buildApp } = await import('../src/app.ts');
  const app2 = await buildApp(); await app2.ready();
  keys.forEach((k, i) => { process.env[k] = saved[i]; });
  try {
    const p = await t.register(); const p2 = await t.register(); const d = await t.register('driver');
    const hit = (method: string, url: string, token?: string, extra: any = {}) => app2.inject({ method: method as any, url: `/api/v1${url}`, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'accept-language': 'fr', ...(extra.headers ?? {}) }, payload: extra.payload ?? {} });
    const run = async (n: number, f: () => Promise<any>) => { const out = []; for (let i = 0; i < n; i++) out.push((await f()).statusCode); return out; };
    assert.deepEqual(await run(4, () => hit('POST', '/client-errors', undefined, { payload: { message: 'boom' } })), [202, 202, 429, 429]);
    assert.deepEqual(await run(3, () => hit('POST', '/bookings', p.token, { payload: {} })), [400, 400, 429]);
    assert.equal((await hit('POST', '/bookings', p2.token, { payload: {} })).statusCode, 400, 'limit is per user, not shared across users');
    assert.deepEqual(await run(3, () => hit('POST', '/payments', p.token, { payload: {} })), [400, 400, 429]);
    const mp = multipart({ doc_type: 'national_id' }, { name: 'a.jpg', data: makeJpeg(), type: 'image/jpeg' });
    assert.deepEqual(await run(3, () => hit('POST', '/drivers/documents', d.token, mp)), [200, 200, 429]);
    const r = await hit('POST', '/client-errors', undefined, { payload: { message: 'boom' } });
    assert.equal(r.json().error.code, 'rate_limited'); assert.match(r.json().error.message, /Trop de tentatives/);
  } finally { await app2.close(); }
});

// ---------------- localised public share page ----------------
test('public trip-share page is fully localised (?lang= beats Accept-Language) and escapes data', async () => {
  const p = await t.register(); const d = await t.driver({ vehicle: 'moto' });
  const { res } = await t.book(p.token); const id = res.json.booking.id;
  await t.api('POST', `/bookings/${id}/accept`, { token: d.token });
  const sh = await t.api('POST', `/bookings/${id}/share`, { token: p.token, body: {} });
  const token = sh.json.url ? String(sh.json.url).split('/share/')[1] : sh.json.token;
  const page = (q: string, al?: string) => t.api('GET', `/share/${token}${q}`, { headers: { accept: 'text/html', ...(al ? { 'accept-language': al } : {}) } });
  const fr = await page('', 'fr-FR,fr;q=0.9,en;q=0.8');
  assert.equal(fr.status, 200); assert.match(fr.raw, /<html lang="fr">/); assert.equal(fr.headers['content-language'], 'fr');
  assert.match(fr.raw, /État de la course/); assert.match(fr.raw, /Chauffeur trouvé/); assert.match(fr.raw, /expiré/);
  assert.ok(!/Trip status|Driver assigned|Ntibizwi|Umushoferi/.test(fr.raw), 'no other language in the French page');
  const rw = await page('', 'rw');
  assert.match(rw.raw, /<html lang="rw">/); assert.match(rw.raw, /Aho urugendo rugeze/); assert.match(rw.raw, /Umushoferi yabonetse/);
  assert.ok(!/Trip status|Driver assigned|Chauffeur|État de/.test(rw.raw));
  const en = await page('?lang=en', 'fr'); // explicit ?lang wins over the header
  assert.match(en.raw, /<html lang="en">/); assert.match(en.raw, /Trip status/); assert.match(en.raw, /Driver assigned/);
  assert.ok(!/Chauffeur trouvé|Aho urugendo/.test(en.raw));
  assert.match((await page('', undefined)).raw, /<html lang="rw">/, 'default is Kinyarwanda');
  assert.match((await page('?lang=xx', 'de')).raw, /<html lang="rw">/);
  // every status has a label in all three languages
  const { SHARE_STRINGS } = await import('../src/routes/share.ts');
  for (const k of Object.keys(SHARE_STRINGS.en.statuses)) for (const l of ['rw', 'fr'] as const) assert.ok(SHARE_STRINGS[l].statuses[k], `${l}.${k}`);
  assert.deepEqual(Object.keys(SHARE_STRINGS.rw).sort(), Object.keys(SHARE_STRINGS.en).sort());
  assert.deepEqual(Object.keys(SHARE_STRINGS.fr).sort(), Object.keys(SHARE_STRINGS.en).sort());
  // the token is embedded safely and the JSON view is unchanged
  const j = await t.api('GET', `/share/${token}`, { headers: { accept: 'application/json' } });
  assert.equal(j.json.status, 'DRIVER_ASSIGNED');
});
