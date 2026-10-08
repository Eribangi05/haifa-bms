// Browser check of the round-2 console tabs. Usage: API_ORIGIN=http://localhost:8094 DATABASE_URL=... node --import tsx scripts/growth-e2e.ts
import { chromium, type Page } from 'playwright-core';
import { createStaff } from '../src/seed.ts';
import { totpAt } from '../src/util/crypto.ts';
import { pool, q } from '../src/db.ts';
const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8094', pw = 'Console-Password-12345', stamp = Date.now();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let failed = 0;
const check = (m: string, c: any, extra = '') => { if (c) console.log('OK  ', m); else { failed++; console.log('FAIL', m, extra); } };
async function login(role: string, extra?: (id: string) => Promise<void>) {
  const email = `growth-${role}-${stamp}@test.local`, u = await createStaff(email, pw, role, 'Growth ' + role);
  if (extra) await extra(u.id);
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(); const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/tile|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto(ORIGIN + '/admin/'); await page.getByPlaceholder('Email').fill(email); await page.getByPlaceholder('Password').fill(pw);
  await page.getByPlaceholder('6-digit authenticator code').fill(totpAt(u.totpSecret)); await page.getByRole('button', { name: 'Sign in' }).click(); await page.locator('#view').waitFor({ timeout: 15000 });
  return { page, errs };
}
const tab = async (p: Page, name: string) => { await p.locator('nav button', { hasText: new RegExp('^' + name + '$') }).click(); await p.locator('#view:not(.loading)').waitFor(); await p.waitForTimeout(400); };
try {
  const { page: M, errs } = await login('business_manager');
  for (const [name, h1] of [['Fixed-price routes', 'Fixed-price routes'], ['Driver quests', 'Driver quests and bonuses'], ['Campaigns', 'Campaigns'], ['Demand map', 'Demand map'], ['Venue partners', 'Venue partners']] as const) {
    await tab(M, name); check(`${name} renders`, (await M.locator('#view h1').first().innerText({ timeout: 3000 }).catch(async () => 'ERR ' + (await M.locator('#view').innerText()).slice(0, 200))) === h1);
  }
  await tab(M, 'Fixed-price routes');
  check('placeholder routes flagged and off', (await M.locator('#view tbody tr', { hasText: 'PLACEHOLDER' }).count()) >= 4 && (await M.locator('#view tbody tr', { hasText: 'inactive' }).count()) >= 4);
  await tab(M, 'Campaigns'); await M.getByRole('button', { name: 'New campaign' }).click(); await M.locator('#view h1', { hasText: 'New campaign' }).waitFor();
  check('campaign editor shows three languages', (await M.locator('#view h3').allInnerTexts()).join('|').includes('Kinyarwanda|Français|English'));
  await M.getByRole('button', { name: 'Count recipients' }).click(); await M.waitForTimeout(600);
  check('recipient count shown', /people match/.test(await M.locator('#view').innerText()));
  await tab(M, 'Venue partners'); await M.getByRole('button', { name: 'New partner' }).click(); await M.locator('dialog input').first().fill('E2E Hotel ' + stamp); await M.getByRole('button', { name: 'Confirm' }).click(); await M.waitForTimeout(800);
  check('partner created and listed', (await M.locator('#view tbody').innerText()).includes('E2E Hotel'));
  await M.locator('#view tbody tr', { hasText: 'E2E Hotel ' + stamp }).click(); await M.locator('#view h1', { hasText: 'E2E Hotel ' + stamp }).waitFor();
  check('partner detail has statement controls', (await M.getByRole('button', { name: 'Show statement' }).count()) === 1);
  check('no console errors (manager)', errs.length === 0, errs.join(' | '));
  const pid = (await q<any>('select id from partners where name = $1', ['E2E Hotel ' + stamp]))[0].id;
  const { page: P, errs: pe } = await login('partner_manager', async (uid) => { await q('insert into partner_users(user_id, partner_id) values ($1,$2)', [uid, pid]); });
  const tabs = await P.locator('nav button[data-tab]').allInnerTexts();
  check('partner manager sees only their own tab', tabs.length === 1 && tabs[0] === 'Your venue', tabs.join(','));
  check('partner view renders statement', /statement/i.test(await P.locator('#view').innerText()));
  check('no console errors (partner)', pe.length === 0, pe.join(' | '));
  await P.screenshot({ path: '/tmp/claude-0/growth-partner.png' }); await M.screenshot({ path: '/tmp/claude-0/growth-manager.png' });
} finally { await br.close(); await pool.end(); }
console.log(failed ? `${failed} FAILED` : 'ALL OK'); process.exit(failed ? 1 : 0);
