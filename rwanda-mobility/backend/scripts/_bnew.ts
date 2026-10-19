import { chromium } from 'playwright-core';
import { createStaff } from '../src/seed.ts';
import { totpAt } from '../src/util/crypto.ts';
import { pool } from '../src/db.ts';
const O = 'http://localhost:8080', OUT = '/tmp/brochure/console';
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const email = `bnew${Date.now()}@abasare.rw`; const s = await createStaff(email, 'Audit-Password-12345', 'super_admin', 'Operations Admin');
const p = await br.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1.5 });
await p.goto(O + '/admin/'); await p.getByPlaceholder(/Email/).fill(email); await p.locator('input[type=password]').fill('Audit-Password-12345'); await p.locator('input[inputmode=numeric]').fill(totpAt(s.totpSecret)); await p.getByRole('button', { name: 'Sign in' }).click();
await p.locator('nav button').first().waitFor({ timeout: 15000 });
const tab = async (t: string, ms = 1800) => { await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(200); await p.locator(`#sidenav button[data-tab="${t}"]`).click(); await p.waitForTimeout(ms); };
const shot = async (n: string, page = p) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
const step = async (n: string, f: () => Promise<void>) => { try { await f(); } catch (e: any) { console.log('FAIL', n, e.message.split('\n')[0]); } };
p.on('dialog', (d) => d.accept());
await step('pricing km', async () => {
  await tab('pricing'); await p.getByText('Add or change a price').click(); await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'Use price per kilometre only' }).click(); await p.waitForTimeout(900); await shot('n-pricing-km');
  await p.getByText('Long pickup (optional)').scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await shot('n-pricing-pickup');
});
await step('services', async () => { await tab('services'); await shot('n-services'); });
await step('flags', async () => { await tab('flags'); await shot('n-flags'); });
await step('settings negotiation', async () => { await tab('settings'); await p.getByText('Proposed fares: largest discount').scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await shot('n-settings-neg'); });
await step('ratings', async () => { await tab('ratings'); await shot('n-ratings'); });

// ---- Abasare Business portal as the demo company administrator
const b = await br.newPage({ viewport: { width: 1200, height: 780 }, deviceScaleFactor: 1.5 });
await step('portal', async () => {
  await b.goto(O + '/business/'); await b.locator('select').selectOption('en'); await b.fill('input[type=tel]', '0788990001');
  await pool.query('delete from otp_challenges');
  const [resp] = await Promise.all([b.waitForResponse((r) => r.url().includes('/auth/otp/request')), b.getByText('Send code', { exact: true }).click()]);
  const code = (await resp.json()).dev_code; await b.fill('input[inputmode=numeric]', code); await b.getByText('Verify and sign in', { exact: true }).click();
  await b.getByText('Your accounts', { exact: true }).waitFor({ timeout: 10000 }); await b.waitForTimeout(500); await shot('biz-accounts', b);
  await b.locator('tr:has-text("Kigali Business Group") button').click(); await b.getByText('Spent this month').waitFor({ timeout: 8000 }); await b.waitForTimeout(800); await shot('biz-overview', b);
  await b.getByRole('button', { name: 'Rides', exact: true }).click(); await b.waitForTimeout(1200); await shot('biz-rides', b);
  await b.getByRole('button', { name: 'Team', exact: true }).click(); await b.waitForTimeout(1200); await shot('biz-team', b);
  await b.getByRole('button', { name: 'Monthly statement', exact: true }).click(); await b.getByText(/Total:/).waitFor({ timeout: 8000 }); await b.waitForTimeout(800); await shot('biz-statement', b);
  await b.getByRole('button', { name: 'Rules', exact: true }).click(); await b.waitForTimeout(1200); await shot('biz-rules', b);
  await b.getByRole('button', { name: 'Book a ride', exact: true }).click(); await b.waitForTimeout(800);
  await b.locator('input[placeholder*="place or landmark"]').first().fill('Kigali Convention'); await b.locator('.hit:visible').first().click();
  await b.locator('input[placeholder*="place or landmark"]').nth(1).fill('Kimironko'); await b.locator('.hit:visible').first().click();
  await b.locator('label.f:has-text("Cost centre") input').fill('Sales'); await b.locator('label.f:has-text("Purchase order") input').fill('PO-2026-0142');
  await b.getByText('See prices', { exact: true }).click(); await b.waitForTimeout(2000); await shot('biz-book', b);
  await b.getByText('Back', { exact: true }).first().click(); await b.locator('tr:has-text("Umurage") button').click(); await b.waitForTimeout(1500); await shot('biz-fleet-drivers', b);
  await b.getByRole('button', { name: 'Vehicles', exact: true }).click(); await b.waitForTimeout(1200); await shot('biz-fleet-vehicles', b);
  await b.getByRole('button', { name: 'Earnings', exact: true }).click(); await b.getByText('Gross fares').waitFor({ timeout: 8000 }); await b.waitForTimeout(800); await shot('biz-fleet-earnings', b);
  await b.locator('header select').selectOption('fr'); await b.waitForTimeout(600); await shot('biz-fleet-earnings-fr', b);
  await b.locator('header select').selectOption('rw'); await b.waitForTimeout(600); await b.getByText('Subira inyuma', { exact: true }).first().click(); await b.locator('tr:has-text("Kigali Business") button').click(); await b.waitForTimeout(1500); await shot('biz-overview-rw', b);
});
await br.close(); await pool.end();
