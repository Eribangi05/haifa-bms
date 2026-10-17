import { chromium } from 'playwright-core';
import { createStaff } from '../src/seed.ts';
import { totpAt } from '../src/util/crypto.ts';
import { pool } from '../src/db.ts';
const O = 'http://localhost:8080', OUT = process.env.OUT ?? '/tmp/brochure/console', lang = process.env.LANG_ ?? 'en';
const only = process.argv.slice(2);
const TABS = ['dashboard', 'live', 'bookings', 'drivers', 'reviewq', 'opsdash', 'alerts', 'digest', 'ratings', 'abasare', 'safety', 'trust', 'users', 'support', 'privacy', 'revenue', 'finance', 'wallet', 'claims', 'ussd', 'pricing', 'services', 'promos', 'codes', 'fixedroutes', 'quests', 'referrals', 'campaigns', 'demand', 'partners', 'business', 'settings', 'audit', 'staff', 'places', 'content', 'flags', 'demo'];
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const email = process.env.EMAIL ?? `brochure${Date.now()}@abasare.rw`; const s = await createStaff(email, 'Audit-Password-12345', 'super_admin', 'Operations Admin');
const p = await br.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1.5 });
await p.goto(O + '/admin/'); await p.getByPlaceholder(/Email|Imeri|E-mail/).fill(email); await p.locator('input[type=password]').fill('Audit-Password-12345'); await p.locator('input[inputmode=numeric]').fill(totpAt(s.totpSecret)); await p.locator('button[type=submit]').click();
await p.locator('nav button').first().waitFor({ timeout: 15000 });
await p.locator('.langsel').selectOption(lang); await p.waitForTimeout(500);
for (const t of (only.length ? only : TABS)) {
  try { await p.locator(`#sidenav button[data-tab="${t}"]`).click({ timeout: 4000 }); } catch { console.log('no tab', t); continue; }
  await p.waitForTimeout(t === 'live' || t === 'demand' || t === 'places' ? 3500 : 1600);
  await p.screenshot({ path: `${OUT}/${t}${lang === 'en' ? '' : '-' + lang}.png` }); console.log('shot', t);
}
await br.close(); await pool.end();
