// Click-through audit of the admin console for every staff role. For each role: sign in, open every nav tab at laptop (1280px) and tablet (768px) width,
// record failed API calls (4xx/5xx), JS errors, error banners and horizontal page overflow, and save screenshots to /tmp/shots/admin-audit-*.png.
// Also checks: tabs shown match the role's permissions (no tab that 403s), session expiry shows the sign-in page, dialogs close with Esc.
// Usage: API_ORIGIN=http://localhost:8092 DATABASE_URL=... node --import tsx scripts/admin-audit-e2e.ts
import { chromium, type Page } from 'playwright-core';
import { createStaff } from '../src/seed.ts';
import { totpAt } from '../src/util/crypto.ts';
import { ROLE_PERMISSIONS, STAFF_ROLES } from '../src/rbac.ts';
import { pool } from '../src/db.ts';
const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8092';
const pw = 'Audit-Password-12345', stamp = Date.now();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let failed = 0; const problems: string[] = [];
const ok = (m: string) => console.log('OK  ', m);
const bad = (m: string) => { failed++; problems.push(m); console.log('FAIL', m); };

// What each nav tab needs (permission names, mirrors the API guards). A role must see a tab iff it holds ANY of these.
const TAB_NEEDS: Record<string, string[]> = {
  Overview: ['analytics.view'], 'Live map': ['bookings.view_all'], Bookings: ['bookings.view_all'], Drivers: ['drivers.view'], Abasare: ['drivers.view'], Passengers: ['users.view'],
  Support: ['support.handle'], Safety: ['safety.respond'], 'Trust and safety': ['safety.respond', 'drivers.view'], Pricing: ['pricing.manage', 'pricing.approve'], Services: ['pricing.manage'], Promotions: ['promotions.manage'],
  'Request codes': ['codes.view'], Finance: ['finance.view'], 'Business & fleets': ['corporate.manage'], Privacy: ['privacy.handle'], Settings: ['settings.manage'], 'Audit log': ['audit.view'], Staff: ['users.manage'],
};
const hasPerm = (role: string, needs: string[]) => { const p = ROLE_PERMISSIONS[role] ?? []; return p.includes('*') || needs.some((n) => p.includes(n)); };

async function login(page: Page, email: string, secret: string) {
  await page.goto(ORIGIN + '/admin/'); await page.getByPlaceholder('Email').fill(email); await page.getByPlaceholder('Password').fill(pw);
  await page.getByPlaceholder('6-digit authenticator code').fill(totpAt(secret)); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('nav button').first().waitFor({ state: 'attached', timeout: 15000 });
}
const navNames = async (page: Page) => (await page.locator('nav button, nav a').allTextContents()).map((s) => s.trim()).filter((s) => s && s !== 'Sign out');

try {
  for (const role of (process.env.ROLES?.split(',') ?? STAFF_ROLES)) {
    const email = `audit-${role}-${stamp}@test.local`; const u = await createStaff(email, pw, role, 'Audit ' + role);
    for (const vp of [{ width: 1280, height: 800 }, { width: 768, height: 1000 }]) {
      const ctx = await br.newContext({ viewport: vp }); const page = await ctx.newPage();
      const api: string[] = [], errs: string[] = [];
      page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 400 && !r.url().endsWith('/auth/staff/login')) api.push(`${r.status()} ${r.url().replace(ORIGIN, '')}`); });
      page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
      await login(page, email, u.totpSecret); await page.waitForTimeout(500);
      if (errs.length) { bad(`${role}@${vp.width}: script errors while loading the console: ${errs.join('; ')}`); errs.length = 0; }
      const tabs = await navNames(page);
      const expected = Object.keys(TAB_NEEDS).filter((t) => hasPerm(role, TAB_NEEDS[t]));
      const missing = expected.filter((t) => !tabs.includes(t)), extra = tabs.filter((t) => !expected.includes(t));
      if (missing.length) bad(`${role}@${vp.width}: tabs missing for permitted role: ${missing.join(', ')}`);
      if (extra.length) bad(`${role}@${vp.width}: tabs shown without permission: ${extra.join(', ')}`);
      for (const t of tabs) {
        api.length = 0; errs.length = 0;
        if (vp.width < 800) { const tg = page.locator('[data-nav-toggle]'); if ((await tg.first().getAttribute('aria-expanded')) !== 'true') { await tg.first().click(); await page.waitForTimeout(300); } }
        await page.locator('nav button', { hasText: new RegExp('^' + t.replace(/[&]/g, '\\&') + '$') }).first().click();
        await page.waitForTimeout(t === 'Finance' || t === 'Overview' ? 1200 : 600);
        const banner = await page.locator('#view .alert.bad').allInnerTexts();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const h1 = (await page.locator('#view h1').first().innerText().catch(() => '')) || '';
        if (api.length) bad(`${role}@${vp.width} [${t}] failed calls: ${api.join('; ')}`);
        if (errs.length) bad(`${role}@${vp.width} [${t}] JS errors: ${errs.join('; ')}`);
        if (banner.length) bad(`${role}@${vp.width} [${t}] error shown: ${banner.join(' | ').slice(0, 150)}`);
        if (overflow > 2) bad(`${role}@${vp.width} [${t}] page scrolls horizontally by ${overflow}px`);
        if (!h1) bad(`${role}@${vp.width} [${t}] no page title`);
        if (t !== 'Overview' && h1 === 'Operations overview') bad(`${role}@${vp.width} [${t}] shows the Overview page instead of its own (script failed to load?)`);
        if (!(await page.title()).startsWith(t)) bad(`${role}@${vp.width} [${t}] browser title is '${await page.title()}'`);
        if (role === 'super_admin' || (vp.width === 1280 && ['dispatcher', 'finance_officer'].includes(role))) await page.screenshot({ path: `/tmp/shots/admin-audit-${role}-${t.replace(/\W+/g, '_')}-${vp.width}.png` });
      }
      ok(`${role} @${vp.width}: ${tabs.length} tabs clicked`);
      await ctx.close();
    }
  }

  // Session expiry: a bad access token + bad refresh token must end on the sign-in page, not a blank page.
  {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
    const email = `audit-exp-${stamp}@test.local`; const u = await createStaff(email, pw, 'super_admin', 'Audit expiry');
    await login(page, email, u.totpSecret);
    await page.evaluate(() => { sessionStorage.setItem('rm_a', 'x.y.z'); sessionStorage.setItem('rm_r', 'nope'); });
    await page.reload();
    await page.getByPlaceholder('Email').waitFor({ timeout: 10000 }).then(() => ok('expired session -> sign-in page'), () => bad('expired session did not show the sign-in page'));
    if (!(await page.getByText(/expired|sign in again/i).first().isVisible().catch(() => false))) bad('expired session: no explanatory message on sign-in page');
    await ctx.close();
  }
  // Dialog dismissal + focus: open a dialog, Esc closes it, focus returns to the opener.
  {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
    const email = `audit-dlg-${stamp}@test.local`; const u = await createStaff(email, pw, 'super_admin', 'Audit dialog');
    await login(page, email, u.totpSecret);
    await page.locator('nav button', { hasText: /^Staff$/ }).first().click();
    const inv = page.getByRole('button', { name: 'Invite staff member' }); await inv.click();
    if (!(await page.locator('dialog[open]').count())) bad('dialog did not open');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (await page.locator('dialog[open]').count()) bad('Esc does not close dialog'); else ok('Esc closes dialog');
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
    if (focused !== 'Invite staff member') bad('focus not returned to opener after closing dialog (is: ' + focused + ')'); else ok('focus returns to opener');
    await ctx.close();
  }
} catch (e: any) { bad('script error: ' + e.message.split('\n')[0]); }
await br.close(); await pool.end();
console.log(failed ? `\n${failed} problem(s)` : '\nall admin audit checks passed');
process.exit(failed ? 1 : 0);
