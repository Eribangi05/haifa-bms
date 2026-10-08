// Behaviour checks for the admin console (complements admin-audit-e2e.ts, which clicks every tab as every role):
// table sort/filter/CSV, dashboard numbers against SQL, map without tile access, dark mode, mobile menu, form validation, permission gating, staff disable.
// Usage: API_ORIGIN=http://localhost:8092 DATABASE_URL=... node --import tsx scripts/admin-console-e2e.ts      (creates staff users and one invite; changes nothing else)
import { chromium, type Page, type BrowserContext } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { createStaff } from '../src/seed.ts';
import { totpAt } from '../src/util/crypto.ts';
import { pool, q } from '../src/db.ts';
const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8092';
const pw = 'Console-Password-12345', stamp = Date.now();
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let failed = 0;
const ok = (m: string) => console.log('OK  ', m);
const check = (m: string, cond: any, extra = '') => { if (cond) ok(m); else { failed++; console.log('FAIL', m, extra); } };
const shot = (p: Page, n: string) => p.screenshot({ path: `/tmp/shots/admin-audit-${n}.png` });
const staff: Record<string, { email: string; secret: string; id: string }> = {};
async function mk(role: string) { const email = `console-${role}-${stamp}@test.local`; const u = await createStaff(email, pw, role, 'Console ' + role); staff[role] = { email, secret: u.totpSecret, id: u.id }; }
async function open(role: string, vp = { width: 1280, height: 800 }, setup?: (c: BrowserContext) => Promise<void>) {
  const ctx = await br.newContext({ viewport: vp, acceptDownloads: true }); if (setup) await setup(ctx);
  const page = await ctx.newPage(); const s = staff[role];
  await page.goto(ORIGIN + '/admin/'); await page.getByPlaceholder('Email').fill(s.email); await page.getByPlaceholder('Password').fill(pw);
  await page.getByPlaceholder('6-digit authenticator code').fill(totpAt(s.secret)); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#view').waitFor({ timeout: 15000 }); return { ctx, page };
}
const tab = async (p: Page, name: string) => { await p.locator('nav button', { hasText: new RegExp('^' + name + '$') }).click(); await p.locator('#view:not(.loading)').waitFor(); await p.waitForTimeout(150); };
const apiLogin = async (role: string) => { const s = staff[role]; const r = await fetch(`${ORIGIN}/api/v1/auth/staff/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: s.email, password: pw, totp: totpAt(s.secret) }) }); return { status: r.status, json: await r.json() as any }; };

try {
  for (const r of ['super_admin', 'dispatcher', 'support_agent', 'finance_officer']) await mk(r);

  // ---------------- super admin: tables, CSV, dashboard ----------------
  const { ctx, page: A } = await open('super_admin');
  await tab(A, 'Bookings');
  const rows0 = await A.locator('#view tbody tr').count();
  check('bookings table has rows', rows0 > 3, `rows=${rows0}`);
  const firstRef = await A.locator('#view tbody tr:first-child td:first-child').innerText();
  await A.locator('#view th button', { hasText: 'Fare' }).click();
  check('clicking a header sorts (aria-sort set)', (await A.locator('#view th[aria-sort="ascending"]').count()) === 1);
  const fares = (await A.locator('#view tbody tr td:nth-child(6)').allInnerTexts()).map((t) => Number(t.replace(/[^\d]/g, '')));
  check('fare column ascending', fares.every((v, i) => i === 0 || fares[i - 1] <= v), fares.slice(0, 6).join(','));
  await A.locator('#view .tsearch').fill(firstRef.trim());
  check('row filter narrows the table', (await A.locator('#view tbody tr').count()) >= 1 && (await A.locator('#view tbody tr').count()) < rows0);
  await A.locator('#view .tsearch').fill('zzzzzz-no-such');
  check('row filter shows an empty message', await A.getByText('No rows match your search.').isVisible());
  await A.locator('#view .tsearch').fill('');
  await A.locator('#view select[aria-label="Status"]').selectOption('NO_DRIVER_FOUND'); await A.getByRole('button', { name: 'Search', exact: true }).click(); await A.locator('#view:not(.loading)').waitFor(); await A.waitForTimeout(200);
  const st = await A.locator('#view tbody tr td:nth-child(2)').allInnerTexts();
  check('status filter returns only that status', st.length > 0 && st.every((t) => /no driver found/i.test(t)), st.join('|'));
  await A.getByRole('button', { name: 'Clear' }).click(); await A.locator('#view:not(.loading)').waitFor(); await A.waitForTimeout(200);
  const [dl] = await Promise.all([A.waitForEvent('download'), A.getByRole('button', { name: 'Download CSV' }).first().click()]);
  const csv = readFileSync(await dl.path()!, 'utf8');
  const csvLines = csv.trim().split(/\r?\n/);
  check('CSV has BOM, header and one line per row', csv.charCodeAt(0) === 0xfeff && csvLines[0].includes('Ref') && csvLines.length - 1 === Number(/(\d+) rows/.exec(await A.locator('#view .tbar .muted').first().innerText())![1]), `${csvLines.length}`);
  check('CSV cells never start with a formula character', !csvLines.slice(1).some((l) => /(^|,)"?[=+@]/.test(l)));
  await A.locator('#view tbody tr.click').first().click(); await A.locator('dialog[open] h2', { hasText: 'Timeline' }).waitFor({ timeout: 8000 }).catch(() => {});
  check('row click opens booking dialog with timeline', await A.locator('dialog[open] h2', { hasText: 'Timeline' }).isVisible());
  check('super admin sees booking actions', await A.getByRole('button', { name: 'Cancel booking' }).isVisible());
  await shot(A, 'booking-dialog'); await A.keyboard.press('Escape');
  check('Esc closes the booking dialog', (await A.locator('dialog[open]').count()) === 0);

  // dashboard numbers vs SQL (fixed window ending one hour ago so concurrent bookings do not matter)
  const tok = (await apiLogin('super_admin')).json.access_token;
  const to = new Date(Date.now() - 3600e3), from = new Date(+to - 30 * 864e5);
  const dash = await (await fetch(`${ORIGIN}/api/v1/admin/dashboard?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { headers: { authorization: 'Bearer ' + tok } })).json() as any;
  const sql = (await q<any>(`select count(*) filter (where status not in ('DRAFT','FARE_ESTIMATED','SCHEDULED'))::int requested,
      count(*) filter (where status in ('COMPLETED','PAYMENT_PENDING','PAYMENT_COMPLETED','PARTIALLY_REFUNDED','REFUNDED'))::int completed, count(*) filter (where status like 'CANCELLED%')::int cancelled,
      count(*) filter (where status='NO_DRIVER_FOUND')::int no_driver, coalesce(sum(final_fare) filter (where status in ('PAYMENT_COMPLETED','PARTIALLY_REFUNDED','REFUNDED')),0)::bigint gbv from bookings where created_at between $1 and $2`, [from, to]))[0];
  const comm = (await q<any>('select coalesce(sum(e.commission),0)::bigint c from driver_earnings e join bookings b on b.id=e.booking_id where b.created_at between $1 and $2', [from, to]))[0].c;
  check('dashboard requests/completed/cancelled/no-driver match SQL', dash.bookings.requested === sql.requested && dash.bookings.completed === sql.completed && dash.bookings.cancelled === sql.cancelled && dash.bookings.no_driver === sql.no_driver, JSON.stringify([dash.bookings, sql]));
  check('dashboard gross booking value and commission match SQL', String(dash.revenue.gross_booking_value) === String(sql.gbv) && String(dash.revenue.platform_commission_revenue) === String(comm));
  await tab(A, 'Overview'); await A.waitForTimeout(2500);
  check('overview shows KPI cards and sparklines', (await A.locator('.card.kpi').count()) > 10 && (await A.locator('svg.spark').count()) >= 3);
  const reqCard = await A.locator('.card.kpi').filter({ has: A.getByText('Requests', { exact: true }) }).first().locator('.v').innerText();
  const dash30 = await (await fetch(`${ORIGIN}/api/v1/admin/dashboard`, { headers: { authorization: 'Bearer ' + tok } })).json() as any;
  check('"Requests" card equals the API value', Math.abs(Number(reqCard.replace(/,/g, '')) - dash30.bookings.requested) <= 3, `${reqCard} vs ${dash30.bookings.requested}`);

  // ---------------- tabs: finance sub-pages, validation, audit ----------------
  await tab(A, 'Finance');
  await A.getByRole('tab', { name: 'Cancellation fee debts' }).click(); await A.locator('#view:not(.loading)').waitFor();
  check('fee debts sub-page loads', await A.getByText(/Passengers who cancel late/).isVisible());
  await A.getByRole('tab', { name: 'Reconciliation' }).click(); await A.locator('#view:not(.loading)').waitFor();
  await A.getByLabel('Settlement rows').fill('{not json'); await A.getByRole('button', { name: 'Run reconciliation' }).click();
  check('reconciliation rejects invalid JSON inline', await A.getByText(/not valid JSON/).isVisible());
  await A.getByLabel('Settlement rows').fill('[{"reference":"X","amount":"12","status":"SUCCESS"}]'); await A.getByRole('button', { name: 'Run reconciliation' }).click();
  check('reconciliation names the invalid row', await A.getByText(/Row 1 is invalid/).isVisible());
  await A.getByRole('tab', { name: 'Ledger and exports' }).click(); await A.locator('#view:not(.loading)').waitFor();
  const [dl2] = await Promise.all([A.waitForEvent('download'), A.getByRole('button', { name: 'Export payments.csv' }).click()]);
  check('server CSV export downloads', (await dl2.suggestedFilename()).startsWith('payments'));
  await tab(A, 'Audit log'); await A.locator('#view tbody tr.click').first().click();
  check('audit row opens before/after dialog', await A.locator('dialog[open] h2', { hasText: 'After' }).isVisible()); await A.keyboard.press('Escape');
  await tab(A, 'Passengers'); await A.getByPlaceholder(/Name, phone or email/).fill('a'); await A.getByRole('button', { name: 'Search' }).click();
  check('passenger search needs 2 characters', await A.getByText('Type at least 2 characters.').isVisible());

  // request codes: validation, create, QR download
  await tab(A, 'Request codes');
  await A.getByRole('button', { name: 'Create code' }).click();
  check('request-code form rejects an empty venue name', await A.getByText('Venue name is required.').isVisible());
  const venue = 'E2E Venue ' + stamp;
  await A.getByLabel('Venue name').fill(venue); await A.getByLabel('Latitude').fill('-1.9536'); await A.getByLabel('Longitude').fill('30.0927'); await A.getByRole('button', { name: 'Create code' }).click();
  await A.locator('#view .tsearch').first().waitFor({ timeout: 8000 }).catch(() => {}); await A.waitForTimeout(500);
  const codeRow = A.locator('tr', { hasText: venue });
  check('new request code appears in the table', (await codeRow.count()) === 1);
  const [qr] = await Promise.all([A.waitForEvent('download'), codeRow.getByRole('button', { name: 'Download QR' }).click()]);
  check('QR code downloads as a PNG', (await qr.suggestedFilename()).endsWith('.png') && readFileSync(await qr.path()!).subarray(1, 4).toString() === 'PNG');
  await codeRow.getByRole('button', { name: 'Deactivate' }).click(); await A.waitForTimeout(600);
  check('request code can be deactivated', await A.locator('tr', { hasText: venue }).getByText('Inactive').isVisible());

  // staff: invite validation, disable / enable
  await tab(A, 'Staff'); await A.getByRole('button', { name: 'Invite staff member' }).click();
  await A.getByPlaceholder('Full name').fill('X'); await A.getByPlaceholder('Email').last().fill('not-an-email'); await A.getByRole('button', { name: 'Create invitation' }).click();
  check('invite dialog validates e-mail and stays open', (await A.locator('dialog[open]').count()) === 1 && await A.getByText('Enter a valid email address').isVisible());
  await A.keyboard.press('Escape');
  const findStaff = async (email: string) => { await A.getByPlaceholder('Search name or email').fill(email); await A.getByRole('button', { name: 'Filter', exact: true }).click(); await A.waitForTimeout(600); };
  await findStaff(staff.support_agent.email);
  await A.locator('tr', { hasText: staff.support_agent.email }).first().click(); await A.locator('dialog[open]').waitFor();
  await A.locator('dialog').getByRole('button', { name: 'Disable', exact: true }).click();
  await A.getByPlaceholder(/Reason/).fill('e2e disable check'); await A.locator('dialog').last().getByRole('button', { name: 'Disable', exact: true }).click(); await A.waitForTimeout(900);
  const dis = await apiLogin('support_agent'); check('disabled staff cannot sign in', dis.status >= 400, String(dis.status));
  await findStaff(staff.support_agent.email);
  await A.locator('tr', { hasText: staff.support_agent.email }).first().click(); await A.locator('dialog[open]').waitFor();
  await A.locator('dialog').getByRole('button', { name: 'Enable', exact: true }).click();
  await A.getByPlaceholder(/Reason/).fill('e2e enable check'); await A.locator('dialog').last().getByRole('button', { name: 'Enable', exact: true }).click(); await A.waitForTimeout(900);
  check('re-enabled staff can sign in again', (await apiLogin('support_agent')).status === 200);

  // dark mode + persistence
  await A.getByRole('button', { name: /Switch between light and dark/ }).click();
  const dark = await A.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  check('dark mode toggles', dark[0] !== undefined && dark[1] !== 'rgb(242, 245, 248)', dark.join(' ')); await shot(A, 'dark-staff');
  await A.reload(); await A.locator('#view').waitFor();
  check('theme choice is remembered', (await A.evaluate(() => document.documentElement.dataset.theme)) === dark[0]);
  await ctx.close();

  // ---------------- map without tile access ----------------
  { const { ctx: c, page: P } = await open('dispatcher', { width: 1280, height: 800 }, async (cc) => { await cc.route(/tile\.openstreetmap\.org/, (r) => r.abort()); });
    await tab(P, 'Live map'); await P.waitForTimeout(2500);
    check('live map explains missing tiles and still lists positions', await P.getByText(/Map tiles could not be loaded/).isVisible() && await P.getByText(/Active bookings \(\d+\)/).isVisible()); await shot(P, 'live-no-tiles');
    // permission gating: dispatcher sees dispatch buttons, no refund / dispute
    await tab(P, 'Bookings'); await P.locator('#view tbody tr.click').first().click(); await P.locator('dialog[open]').waitFor();
    check('dispatcher: dispatch actions shown, refund and dispute hidden', await P.getByRole('button', { name: 'Restart search' }).isVisible() && (await P.getByRole('button', { name: 'Request refund' }).count()) === 0 && (await P.getByRole('button', { name: 'Mark disputed' }).count()) === 0);
    await P.getByRole('button', { name: 'Assign / reassign' }).click(); await P.getByPlaceholder(/Reason/).fill('e2e check'); await P.locator('dialog').last().getByRole('button', { name: 'Assign' }).click();
    check('assign dialog requires a driver and a reason', await P.getByText('Required').first().isVisible());
    await c.close(); }
  { const { ctx: c, page: P } = await open('support_agent');
    await tab(P, 'Bookings'); await P.locator('#view tbody tr.click').first().click(); await P.locator('dialog[open]').waitFor();
    check('support agent: can dispute, cannot cancel or refund', await P.getByRole('button', { name: 'Mark disputed' }).isVisible() && (await P.getByRole('button', { name: 'Cancel booking' }).count()) === 0 && (await P.getByRole('button', { name: 'Request refund' }).count()) === 0);
    await c.close(); }
  { const { ctx: c, page: P } = await open('finance_officer');
    check('finance officer has no Bookings or Staff tab', (await P.locator('nav button', { hasText: /^(Bookings|Staff)$/ }).count()) === 0);
    await tab(P, 'Finance'); await P.getByRole('tab', { name: 'Reconciliation' }).click(); await P.locator('#view:not(.loading)').waitFor();
    check('finance officer can reconcile', await P.getByRole('button', { name: 'Run reconciliation' }).isVisible());
    await c.close(); }

  // ---------------- phone: menu is a drawer ----------------
  { const { ctx: c, page: P } = await open('super_admin', { width: 390, height: 800 });
    check('phone: menu hidden until opened', !(await P.locator('nav#sidenav').isVisible()));
    await P.locator('[data-nav-toggle]').click(); await P.waitForTimeout(300);
    check('phone: menu opens', await P.locator('nav#sidenav').isVisible()); await P.locator('nav button', { hasText: /^Bookings$/ }).click(); await P.waitForTimeout(400);
    check('phone: menu closes after choosing a page', !(await P.locator('nav#sidenav').isVisible()));
    check('phone: no sideways page scroll', (await P.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 2); await shot(P, 'phone-bookings');
    await c.close(); }

  // the console no longer carries a copy of the role table: the server sends each caller's effective permissions at sign-in
  const src = readFileSync(new URL('../../admin-web/core.js', import.meta.url), 'utf8');
  check('core.js has no static permission mirror', !src.includes('rbac-mirror'));
  const { ROLE_PERMISSIONS, effectivePermissions } = await import('../src/rbac.ts');
  for (const r of ['dispatcher', 'support_agent', 'finance_officer', 'super_admin']) { const lg = (await apiLogin(r)).json; check(`sign-in permissions for ${r} equal the server's`, JSON.stringify(lg.permissions) === JSON.stringify(effectivePermissions([r])) && ROLE_PERMISSIONS[r] !== undefined); }
} catch (e: any) { failed++; console.log('FAIL script error:', e.message.split('\n').slice(0, 3).join(' | ')); }
await br.close(); await pool.end();
console.log(failed ? `\n${failed} problem(s)` : '\nall admin console checks passed');
process.exit(failed ? 1 : 0);
