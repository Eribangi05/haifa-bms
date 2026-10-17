import { chromium } from 'playwright-core'; import pg from 'pg';
const API = 'http://localhost:8080/api/v1', OUT = '/tmp/brochure/app';
const db = new pg.Client({ connectionString: 'postgres://rm:rm@localhost:5432/rm_brochure' }); await db.connect();
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h ?? {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
const login = async (phone) => { await db.query('delete from otp_challenges'); const o = await call('POST', '/auth/otp/request', { body: { phone } }); const v = await call('POST', '/auth/otp/verify', { body: { phone, code: o.j.dev_code, role: 'passenger' }, h: { 'x-device-id': 'pub-' + phone } }); return v.j.access_token; };
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const lang of ['en', 'rw', 'fr']) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 }); const page = await ctx.newPage();
  const r = (await db.query("select b.id, b.ref, u.phone from bookings b join users u on u.id=b.passenger_id where u.phone='+250788990001' and b.status='PAYMENT_COMPLETED' order by b.completed_at desc limit 1")).rows[0];
  const t = await login(r.phone); const link = await call('POST', `/bookings/${r.id}/receipt/link`, { t, h: { 'accept-language': lang } });
  await page.goto(link.j.url.replace(/^https?:\/\/[^/]+/, 'http://localhost:8080') + `&lang=${lang}`); await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/p01-receipt${lang === 'en' ? '' : '-' + lang}.png` });
  const live = (await db.query("select b.id, u.phone from bookings b join users u on u.id=b.passenger_id where b.status='IN_PROGRESS' and u.device_fingerprint='demo' limit 1")).rows[0];
  if (live) { const t2 = await login(live.phone); const sh = await call('POST', `/bookings/${live.id}/share`, { t: t2, body: { ttl_minutes: 120 } }); console.log('share', sh.s); if (sh.j?.url) { await page.goto(sh.j.url.replace(/^https?:\/\/[^/]+/, 'http://localhost:8080') + `?lang=${lang}`); await page.waitForTimeout(1800); await page.screenshot({ path: `${OUT}/p02-sharepage${lang === 'en' ? '' : '-' + lang}.png` }); } }
  await ctx.close();
}
await br.close(); await db.end();
