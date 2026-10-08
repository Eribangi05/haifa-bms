import { chromium } from 'playwright-core';
import pg from 'pg';
// Layout / insets / navigation audit across phone sizes. Loads the main passenger, driver and Abasare screens at several viewports, with and without
// simulated system insets (web-only `?insets=top:44,bottom:48,left:0,right:0` override of the safe-area provider), and asserts:
//  - the header sits below the top inset and non-root screens have a visible 44 px back control,
//  - the sticky footer / primary CTA is fully inside the viewport and above the bottom inset,
//  - no horizontal overflow, and on tablets the content column is capped.
// Usage: node e2e/layout-e2e.mjs <screenshot-dir>   (prereqs as app-e2e.mjs; writes <dir>/layout-*.png)
const API = (process.env.API_ORIGIN ?? 'http://localhost:8080') + '/api/v1', WEB = process.env.WEB_ORIGIN ?? 'http://localhost:8081', OUT = process.argv[2] ?? '/tmp';
const call = async (m, p, { t, body, h } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}), ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' }); await db.connect();
await db.query('delete from otp_challenges');
const rnd = () => String(10000 + Math.floor(Math.random() * 89999)).slice(0, 5);
const reg = async (phone) => { const o = await call('POST', '/auth/otp/request', { body: { phone } }); const v = await call('POST', '/auth/otp/verify', { body: { phone, code: o.j.dev_code }, h: { 'x-device-id': 'lay-' + Math.random() } }); return { tok: { access_token: v.j.access_token, refresh_token: v.j.refresh_token }, id: v.j.user.id }; };
const pax = await reg('+2507881' + rnd());
const drv = await reg('+2507882' + rnd());
await call('POST', '/drivers/enroll', { t: drv.tok.access_token, body: {} });
const rf = await call('POST', '/auth/refresh', { body: { refresh_token: drv.tok.refresh_token } }); drv.tok = { access_token: rf.j.access_token, refresh_token: rf.j.refresh_token };   // new tokens carry the driver role
await db.query("update driver_profiles set status='APPROVED', legal_name='Lay Out', zone_id='kigali' where user_id=$1", [drv.id]);

const VIEWPORTS = [[320, 568], [360, 640], [360, 800], [393, 852], [412, 915], [768, 1024]];
const INSETS = [{ top: 0, bottom: 0 }, { top: 44, bottom: 48 }];
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let bad = 0;

function audit({ inset, expectBack, expectFooter }) {
  const vw = innerWidth, vh = innerHeight, issues = [];
  const r = (sel) => { const e = document.querySelector(`[data-testid="${sel}"]`); return e ? e.getBoundingClientRect() : null; };
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`horizontal overflow ${document.documentElement.scrollWidth}>${vw}`);
  const hel = document.querySelector('[data-testid="header"]'); if (hel) { const top = hel.getBoundingClientRect().top + parseFloat(getComputedStyle(hel).paddingTop || '0'); if (top < inset.top - 0.5) issues.push(`header content top ${top} < inset ${inset.top}`); }
  if (expectBack) { const b = r('back'); if (!b) issues.push('no back control'); else { if (b.height < 43.5 || b.width < 43.5) issues.push(`back too small ${b.width}x${b.height}`); if (b.top < inset.top - 0.5 || b.left < 0) issues.push('back outside safe area'); } }
  const f = r('footer'); const c = r('cta');
  if (expectFooter && !c) issues.push('no primary CTA');
  if (f && f.bottom > vh + 0.5) issues.push(`footer bottom ${f.bottom} > viewport ${vh}`);
  if (c) { if (c.bottom > vh - inset.bottom + 0.5) issues.push(`CTA bottom ${Math.round(c.bottom)} under bottom inset (limit ${vh - inset.bottom})`); if (c.top < 0 || c.right > vw + 0.5 || c.left < -0.5) issues.push('CTA outside viewport'); }
  if (vw > 700) { const first = document.querySelector('[data-testid="footer"] > div'); if (first && first.getBoundingClientRect().width > 645) issues.push('footer content not capped on tablet'); }
  return issues;
}

for (const [w, h] of VIEWPORTS) for (const inset of INSETS) {
  const tag = `${w}x${h}${inset.top ? '-inset' : ''}`; const q = inset.top ? `?insets=top:${inset.top},bottom:${inset.bottom},left:0,right:0` : '';
  const mk = async (tok) => {
    const ctx = await br.newContext({ viewport: { width: w, height: h }, geolocation: { latitude: -1.954, longitude: 30.0927 }, permissions: ['geolocation'] });
    if (tok) await ctx.addInitScript(([t]) => { localStorage.setItem('rm_tokens', JSON.stringify(t)); localStorage.setItem('rm_lang', 'en'); localStorage.setItem('rm_loc_consent', '1'); localStorage.setItem('rm_drv_loc_consent', '1'); localStorage.setItem('rm_ab_how', '1'); }, [tok]);
    const page = await ctx.newPage(); return { ctx, page };
  };
  const check = async (page, name, opt) => {
    await page.waitForTimeout(500);
    const issues = await page.evaluate(audit, { inset, ...opt });
    await page.screenshot({ path: `${OUT}/layout-${tag}-${name}.png` });
    if (issues.length) { bad++; console.log('FAIL', tag, name, '-', issues.join(' ; ')); } else console.log('OK  ', tag, name);
  };
  // signed out
  { const { ctx, page } = await mk(null);
    await page.goto(WEB + q); await page.getByText('Komeza', { exact: true }).waitFor({ timeout: 20000 }); await check(page, 'welcome', { expectBack: false, expectFooter: true });
    await page.getByText('Komeza', { exact: true }).click(); await page.getByPlaceholder('07X XXX XXXX').waitFor(); await check(page, 'phone', { expectBack: true, expectFooter: true });
    await ctx.close(); }
  // passenger
  { const { ctx, page } = await mk(pax.tok);
    await page.goto(WEB + q); await page.getByText('Where to?').first().waitFor({ timeout: 20000 }); await check(page, 'home', { expectBack: false, expectFooter: true });
    await page.getByText('Isoko rya Kimironko', { exact: true }).or(page.getByRole('radio').nth(5)).first().click({ timeout: 3000 }).catch(() => {});
    await page.getByText('Profile', { exact: true }).first().click(); await page.getByText('Emergency contacts').first().waitFor(); await check(page, 'profile', { expectBack: true });
    await page.getByLabel('Back').first().click(); await page.getByText('Help', { exact: true }).first().click(); await page.getByText('Contact support').first().waitFor(); await check(page, 'support', { expectBack: true, expectFooter: true });
    await page.getByLabel('Back').first().click(); await page.getByText('My trips', { exact: true }).first().click(); await page.getByLabel('Back').first().waitFor(); await check(page, 'history', { expectBack: true });
    await page.getByLabel('Back').first().click(); await page.getByText('Scan a code').first().click(); await page.getByPlaceholder('Code, e.g. K7M2QX').waitFor(); await check(page, 'scan', { expectBack: true, expectFooter: true });
    await page.getByLabel('Back').first().click();
    if (await page.getByText('Abasare', { exact: true }).first().isVisible().catch(() => false)) {
      await page.getByText('Abasare', { exact: true }).first().click(); await page.waitForTimeout(500); await check(page, 'abasare-home', { expectBack: false, expectFooter: true });
      await page.getByText('Add a car', { exact: true }).first().click(); await page.getByText('My cars').first().waitFor(); await check(page, 'cars', { expectBack: true, expectFooter: true });
      await page.getByText('Add a car', { exact: true }).last().click(); await page.getByLabel('Plate number').waitFor(); await check(page, 'cars-form', { expectBack: true, expectFooter: true });
    }
    await ctx.close(); }
  // options (needs a destination)
  { const { ctx, page } = await mk(pax.tok);
    await page.goto(WEB + q); await page.getByText('Where to?').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(1200);
    await page.getByText('Isoko rya Kimironko', { exact: true }).or(page.getByText('Kimironko Market', { exact: true })).first().click({ timeout: 8000 }).catch(() => {});
    await page.getByText('See prices', { exact: true }).click({ timeout: 8000 }).catch(() => {}); await page.getByText('Fare breakdown').waitFor({ timeout: 20000 }).catch(() => {});
    await check(page, 'options', { expectBack: true, expectFooter: true }); await ctx.close(); }
  // driver application + working
  { const { ctx, page } = await mk(drv.tok);
    await page.addInitScript(() => localStorage.setItem('rm_mode', 'driver'));
    await page.goto(WEB + q); await page.getByText('Driver', { exact: true }).first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800); await check(page, 'driver-home', { expectBack: true });
    await ctx.close(); }
}
console.log(bad ? `${bad} layout problems` : 'layout: all clean'); await br.close(); await db.end(); process.exit(bad ? 1 : 0);
