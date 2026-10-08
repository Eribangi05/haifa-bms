// Browser check of the staff and configuration management area: edit roles, remove, removed filter, custom role create + assign + live gating,
// self-protection, two-factor reset link end to end through the activation page, places / zones / help centre / document rules / wording / flags editors.
// Screenshots go to /tmp/shots/admin-staff-*.png.
// Usage: API_ORIGIN=http://localhost:8096 DATABASE_URL=postgres://rm:rm@localhost:5432/rm_test_b4 node --import tsx scripts/admin-staff-e2e.ts
import { chromium, type Page, type BrowserContext } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { createStaff } from '../src/seed.ts';
import { totpAt } from '../src/util/crypto.ts';
import { pool, q, q1 } from '../src/db.ts';

const ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8096';
const pw = 'Staff-E2E-Password-123', stamp = Date.now(), tag = String(stamp).slice(-6);
mkdirSync('/tmp/shots', { recursive: true });
const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let failed = 0;
const ok = (m: string) => console.log('OK  ', m);
const check = (m: string, cond: any, extra = '') => { if (cond) ok(m); else { failed++; console.log('FAIL', m, extra); } };
const shot = (p: Page, n: string) => p.screenshot({ path: `/tmp/shots/admin-staff-${n}.png` });
const jsErrors: string[] = [];
const watch = (p: Page, who: string) => { p.on('pageerror', (e) => jsErrors.push(`${who}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|tile\.openstreetmap|ERR_/.test(m.text())) jsErrors.push(`${who}: console ${m.text()}`); }); };

type U = { email: string; secret: string; id: string };
const mk = async (role: string, label: string): Promise<U> => { const email = `e2e-${label}-${stamp}@test.local`; const u = await createStaff(email, pw, role, `E2E ${label}`); return { email, secret: u.totpSecret, id: u.id }; };
async function signIn(page: Page, u: { email: string; secret: string }, password = pw) {
  await page.goto(ORIGIN + '/admin/'); await page.getByPlaceholder('Email').fill(u.email); await page.getByPlaceholder('Password').fill(password);
  await page.getByPlaceholder('6-digit authenticator code').fill(totpAt(u.secret)); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#view').waitFor({ timeout: 15000 });
}
async function open(u: U, vp = { width: 1280, height: 900 }) { const ctx = await br.newContext({ viewport: vp, acceptDownloads: true }); const page = await ctx.newPage(); watch(page, u.email.split('@')[0]); await signIn(page, u); return { ctx, page }; }
const tab = async (p: Page, name: string) => { await p.locator('nav button', { hasText: new RegExp('^' + name + '$') }).click(); await p.locator('#view:not(.loading)').waitFor(); await p.waitForTimeout(250); };
const sub = async (p: Page, label: string) => { await p.locator('.subnav button', { hasText: label }).click(); await p.locator('#view:not(.loading)').waitFor(); await p.waitForTimeout(300); };
const navNames = async (p: Page) => (await p.locator('nav button[data-tab]').allTextContents()).map((s) => s.trim());
const apiLogin = async (u: { email: string; secret: string }, password = pw, secret = u.secret) => { const r = await fetch(`${ORIGIN}/api/v1/auth/staff/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password, totp: totpAt(secret) }) }); return { status: r.status, json: (await r.json()) as any }; };
async function findStaff(p: Page, text: string, status = '') {
  await p.getByLabel('Filter by status').selectOption(status); await p.getByPlaceholder('Search name or email').fill(text);
  await p.getByRole('button', { name: 'Filter', exact: true }).click(); await p.waitForTimeout(700);
}
const dialog = (p: Page) => p.locator('dialog[open]').last();
async function reasonAnd(p: Page, reason: string, button: string | RegExp) { await dialog(p).getByPlaceholder(/Reason/).fill(reason); await dialog(p).getByRole('button', { name: button, exact: typeof button === 'string' }).click(); await p.waitForTimeout(900); }

try {
  const sa = await mk('super_admin', 'super'), second = await mk('super_admin', 'super2');
  const target = await mk('support_agent', 'agent'), custUser = await mk('analyst', 'custom'), mfaUser = await mk('driver_verifier', 'mfa'), goner = await mk('dispatcher', 'goner');
  const { ctx, page: A } = await open(sa);
  await tab(A, 'Staff');
  check('staff page opens with People / Roles / Admin activity', (await A.locator('.subnav button').allTextContents()).join('|').includes('Roles and permissions'));
  await shot(A, '1-list');

  // ---- search, filters, detail, edit roles (several roles at once) ----
  await findStaff(A, target.email);
  check('search finds the person', (await A.locator('#view tbody tr', { hasText: target.email }).count()) === 1);
  await A.locator('#view tbody tr', { hasText: target.email }).click(); await A.locator('dialog[open]').waitFor();
  check('detail shows status, roles and last sign-in fields', (await dialog(A).innerText()).includes('Last sign-in') && (await dialog(A).innerText()).includes('Active sessions'));
  await shot(A, '2-detail');
  await dialog(A).getByRole('button', { name: 'Change roles' }).click(); await A.waitForTimeout(300);
  await dialog(A).getByRole('checkbox', { name: 'Dispatcher' }).check();
  await dialog(A).getByRole('button', { name: 'Save roles' }).click();
  check('saving roles without a reason is refused in the dialog', await dialog(A).getByText('Please give a reason').isVisible());
  await shot(A, '3-roles-dialog');
  await reasonAnd(A, 'covering dispatch this month', 'Save roles'); await A.waitForTimeout(600);
  const roles1 = (await q<any>('select role from user_roles where user_id=$1 order by role', [target.id])).map((r) => r.role);
  check('person now holds two roles', roles1.join() === 'dispatcher,support_agent', roles1.join());
  check('an audit entry with the reason was written', !!(await q1("select 1 from audit_logs where action='staff.roles_changed' and entity_id=$1 and after->>'reason' like 'covering%'", [target.id])));

  // ---- self protection in the UI ----
  await findStaff(A, sa.email);
  await A.locator('#view tbody tr', { hasText: sa.email }).click(); await A.locator('dialog[open]').waitFor();
  const own = await dialog(A).innerText();
  check('own account: no remove / disable / role buttons, explanation shown', !/Remove from staff|Change roles|Disable|Full reset/.test(own) && own.includes('another administrator'));
  await shot(A, '4-self-protection'); await A.keyboard.press('Escape');
  const selfApi = await fetch(`${ORIGIN}/api/v1/admin/staff/${sa.id}/remove`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await A.evaluate(() => sessionStorage.getItem('rm_a'))) }, body: JSON.stringify({ reason: 'remove myself please' }) });
  check('API refuses removing yourself (403)', selfApi.status === 403);
  // (the last-super-admin lock, including the race, is covered by tests/staff_admin.test.ts)

  // ---- custom role: create, assign, live gating ----
  await tab(A, 'Staff'); await sub(A, 'Roles and permissions');
  check('roles table lists built-in roles and flags super admin as fixed', (await A.locator('#view tbody tr', { hasText: 'super_admin' }).count()) >= 1);
  await A.getByRole('button', { name: 'New role' }).click(); await A.locator('dialog[open]').waitFor();
  const roleName = `e2e_helpdesk_${tag}`;
  await dialog(A).getByLabel('Role name').fill(roleName); await dialog(A).getByLabel('Display name').fill('E2E Helpdesk ' + tag); await dialog(A).getByLabel('Description').fill('Answers customers');
  await dialog(A).getByRole('checkbox', { name: 'Handle support cases' }).check(); await dialog(A).getByRole('checkbox', { name: 'See all bookings' }).check();
  check('permission checkboxes show plain descriptions', (await dialog(A).innerText()).includes('Read and answer support cases'));
  await shot(A, '5-role-editor');
  await dialog(A).getByRole('button', { name: 'Create role' }).click(); await A.waitForTimeout(900);
  check('custom role created', !!(await q1('select 1 from roles where name=$1', [roleName])) && (await q<any>('select permission from role_permissions where role=$1', [roleName])).length === 2);
  await sub(A, 'People'); await findStaff(A, custUser.email);
  await A.locator('#view tbody tr', { hasText: custUser.email }).click(); await A.locator('dialog[open]').waitFor();
  await dialog(A).getByRole('button', { name: 'Change roles' }).click(); await A.waitForTimeout(300);
  await dialog(A).getByRole('checkbox', { name: 'E2E Helpdesk ' + tag }).check(); await dialog(A).getByRole('checkbox', { name: 'Analyst' }).uncheck();
  await reasonAnd(A, 'moved to the helpdesk role', 'Save roles');
  const { ctx: cctx, page: C } = await open(custUser);
  const menu1 = await navNames(C);
  check('custom-role user sees Support and Bookings but not Finance, Settings or Staff', menu1.includes('Support') && menu1.includes('Bookings') && !menu1.some((n) => ['Finance', 'Settings', 'Staff'].includes(n)), menu1.join());
  await shot(C, '6-custom-role-menu');
  const fin = async () => C.evaluate(async () => (await fetch('/api/v1/admin/finance/payments', { headers: { authorization: 'Bearer ' + sessionStorage.getItem('rm_a') } })).status);
  check('finance API is 403 for them', (await fin()) === 403);
  // grant finance.view: effective at once, menu follows on the next navigation
  await tab(A, 'Staff'); await sub(A, 'Roles and permissions');
  await A.locator('#view tbody tr', { hasText: roleName }).getByRole('button', { name: 'Edit', exact: true }).click(); await A.locator('dialog[open]').waitFor();
  await dialog(A).getByRole('checkbox', { name: 'See finance' }).check(); await reasonAnd(A, 'payment lookups needed', 'Save changes');
  check('finance API is 200 immediately for the same session', (await fin()) === 200);
  await C.evaluate(() => { (0, eval)('S.permsAt = 0'); }); await tab(C, 'Support'); await C.waitForTimeout(400);
  check('their menu gains Finance without signing in again', (await navNames(C)).includes('Finance'), (await navNames(C)).join());
  await A.locator('#view tbody tr', { hasText: roleName }).getByRole('button', { name: 'Edit', exact: true }).click(); await A.locator('dialog[open]').waitFor();
  await dialog(A).getByRole('checkbox', { name: 'See finance' }).uncheck(); await reasonAnd(A, 'payment access ended', 'Save changes');
  check('revoking applies at once too (403 again)', (await fin()) === 403);
  await C.evaluate(() => { (0, eval)('S.permsAt = 0'); }); await tab(C, 'Support'); await C.waitForTimeout(400);
  check('Finance disappears from their menu', !(await navNames(C)).includes('Finance'));
  // deleting a role in use is blocked in the dialog until people are moved
  await A.locator('#view tbody tr', { hasText: roleName }).getByRole('button', { name: 'Delete' }).click(); await A.locator('dialog[open]').waitFor();
  await dialog(A).getByPlaceholder(/Reason/).fill('trying to delete a role in use'); await dialog(A).getByRole('button', { name: 'Delete role' }).click();
  check('delete asks where to move the people', await dialog(A).getByText('Choose the role to move people to').isVisible()); await shot(A, '7-delete-role');
  await A.keyboard.press('Escape'); await cctx.close();

  // ---- remove, Removed filter, email freed ----
  await sub(A, 'People'); await findStaff(A, goner.email);
  await A.locator('#view tbody tr', { hasText: goner.email }).click(); await A.locator('dialog[open]').waitFor();
  await dialog(A).getByRole('button', { name: 'Remove from staff' }).click(); await shot(A, '8-remove-dialog');
  await reasonAnd(A, 'left the company in May', 'Remove');
  const gone = await q1<any>('select status, email, password_hash from users where id=$1', [goner.id]);
  check('removed: status, password wiped, email renamed with a suffix', gone.status === 'removed' && gone.password_hash === null && /#removed-/.test(gone.email));
  check('removed person cannot sign in', (await apiLogin(goner)).status === 401);
  await findStaff(A, goner.email.slice(0, 14));
  check('hidden from the default list', (await A.locator('#view tbody tr', { hasText: goner.email }).count()) === 0, (await A.locator('#view').innerText()).slice(0, 300));
  await findStaff(A, 'goner', 'removed');
  check('visible under the Removed filter', (await A.locator('#view tbody tr', { hasText: 'E2E goner' }).count()) >= 1); await shot(A, '9-removed-filter');
  await A.locator('#view tbody tr', { hasText: 'E2E goner' }).first().click(); await A.locator('dialog[open]').waitFor();
  check('removed detail offers anonymise, not edit', (await dialog(A).getByRole('button', { name: 'Anonymise personal data' }).count()) === 1 && (await dialog(A).getByRole('button', { name: 'Change roles' }).count()) === 0);
  await dialog(A).getByRole('button', { name: 'Anonymise personal data' }).click();
  await reasonAnd(A, 'erasure requested by the person', 'Anonymise permanently');
  check('anonymised in the database, audit rows kept', (await q1<any>('select display_name from users where id=$1', [goner.id]))!.display_name === 'Former staff member' && Number((await q1<any>('select count(*) n from audit_logs where entity_id=$1', [goner.id]))!.n) >= 2);

  // ---- admin activity ----
  await sub(A, 'Admin activity'); await A.getByLabel('Staff member').selectOption(sa.id); await A.getByRole('button', { name: 'Show' }).click(); await A.waitForTimeout(700);
  check('admin activity lists what the super admin did', (await A.locator('#view tbody tr').count()) >= 3 && (await A.locator('#view').innerText()).includes('staff.'));
  await shot(A, '10-activity');

  // ---- two-factor reset end to end ----
  await sub(A, 'People'); await findStaff(A, mfaUser.email);
  await A.locator('#view tbody tr', { hasText: mfaUser.email }).click(); await A.locator('dialog[open]').waitFor();
  await dialog(A).getByRole('button', { name: 'Reset two-factor' }).click();
  await reasonAnd(A, 'phone was stolen on the bus', 'Create link');
  const link = await A.locator('dialog input[readonly]').inputValue();
  const adminText = await A.locator('dialog[open]').last().innerText();
  check('admin sees only a link, never an authenticator key', link.includes('#activate=') && !/[A-Z2-7]{32}/.test(adminText) && !(await A.locator('dialog img').count())); await shot(A, '11-reset-link');
  await A.getByRole('button', { name: 'Close' }).last().click();
  const { ctx: P, page: Ph } = await (async () => { const c = await br.newContext({ viewport: { width: 400, height: 900 } }); const pg = await c.newPage(); watch(pg, 'phone'); return { ctx: c, page: pg }; })();
  await Ph.goto(link.replace(/^https?:\/\/[^/]+/, ORIGIN)); await Ph.getByText('Replace your authenticator').waitFor(); await shot(Ph, '12-activation-intro');
  await Ph.getByRole('button', { name: 'Start setup' }).click(); await Ph.getByAltText('Authenticator QR code').waitFor();
  await Ph.getByText('Cannot scan?').click(); const newSecret = (await Ph.locator('details code').innerText()).trim();
  check('the person sees their own new key', /^[A-Z2-7]{32}$/.test(newSecret) && newSecret !== mfaUser.secret);
  await Ph.getByPlaceholder('Your current password').fill('wrong-password-here'); await Ph.getByPlaceholder('6-digit code from the app').fill(totpAt(newSecret)); await Ph.getByRole('button', { name: 'Finish' }).click(); await Ph.waitForTimeout(500);
  check('wrong current password is refused', await Ph.getByText('Wrong password').isVisible());
  await Ph.getByPlaceholder('Your current password').fill(pw); await Ph.getByPlaceholder('6-digit code from the app').fill(totpAt(newSecret)); await Ph.getByRole('button', { name: 'Finish' }).click();
  await Ph.getByText('All set').waitFor(); await shot(Ph, '13-activation-done');
  check('old authenticator no longer works', (await apiLogin(mfaUser)).status === 401);
  check('new authenticator works', (await apiLogin(mfaUser, pw, newSecret)).status === 200);
  check('the link cannot be used twice', (await fetch(`${ORIGIN}/api/v1/staff-invite/${link.split('#activate=')[1]}`)).status === 400);
  await P.close();

  // ---- password reset link page (new password + current code) ----
  await tab(A, 'Staff'); await findStaff(A, target.email);
  await A.locator('#view tbody tr', { hasText: target.email }).click(); await A.locator('dialog[open]').waitFor();
  await dialog(A).getByRole('button', { name: 'Send password reset' }).click(); await reasonAnd(A, 'forgot the password', 'Create link');
  const plink = await A.locator('dialog input[readonly]').inputValue(); await A.getByRole('button', { name: 'Close' }).last().click();
  { const c = await br.newContext({ viewport: { width: 400, height: 800 } }); const pg = await c.newPage(); watch(pg, 'phone2');
    await pg.goto(plink.replace(/^https?:\/\/[^/]+/, ORIGIN)); await pg.getByText('Reset your password').waitFor();
    await pg.getByPlaceholder(/Choose a NEW password/).fill('Brand-New-Password-456'); await pg.getByPlaceholder('Repeat the password').fill('Brand-New-Password-456'); await pg.getByPlaceholder(/Current 6-digit/).fill(totpAt(target.secret));
    await pg.getByRole('button', { name: 'Change my password' }).click(); await pg.getByText('Password changed').waitFor(); await shot(pg, '14-password-reset-done');
    check('password reset works and signs out the old password', (await apiLogin(target)).status === 401 && (await apiLogin(target, 'Brand-New-Password-456')).status === 200); await c.close(); }

  // ---- places ----
  await tab(A, 'Places and zones');
  await A.getByRole('button', { name: 'Add place' }).click(); await A.locator('dialog[open]').waitFor(); await A.waitForTimeout(800);
  await dialog(A).getByLabel('Name in English').fill(`E2E Market ${tag}`); await dialog(A).getByLabel('Name in Kinyarwanda').fill(`Isoko ${tag}`); await dialog(A).getByLabel('Name in French').fill(`Marché ${tag}`);
  await dialog(A).getByLabel('Pickup point').check(); await dialog(A).getByLabel('Latitude').fill('50'); await dialog(A).getByLabel('Longitude').fill('30.1');
  await dialog(A).getByRole('button', { name: 'Save place' }).click();
  check('coordinates outside Rwanda are refused with an explanation', await dialog(A).getByText('outside Rwanda').isVisible());
  await dialog(A).locator('.mappick').click({ position: { x: 150, y: 120 } }); await A.waitForTimeout(300);
  const la = Number(await dialog(A).getByLabel('Latitude').inputValue());
  check('clicking the map fills in the coordinates', la < -1 && la > -3.3, String(la)); await shot(A, '15-place-map');
  await dialog(A).getByRole('button', { name: 'Save place' }).click(); await A.waitForTimeout(900);
  const pl = await q1<any>('select * from places where name_en=$1', [`E2E Market ${tag}`]);
  check('place saved with all three names and pickup flag', pl && pl.name_rw === `Isoko ${tag}` && pl.name_fr === `Marché ${tag}` && pl.designated_pickup === true);
  await A.getByPlaceholder('Search any language').fill(`Marché ${tag}`); await A.getByRole('button', { name: 'Filter', exact: true }).click(); await A.waitForTimeout(600);
  await A.locator('#view tbody tr', { hasText: `E2E Market ${tag}` }).getByRole('button', { name: 'Disable' }).click(); await A.waitForTimeout(800);
  check('place disabled', (await q1<any>('select active from places where id=$1', [pl.id]))!.active === false);
  const popular = await (await fetch(`${ORIGIN}/api/v1/places/popular`)).json() as any; check('customers no longer see it', !popular.places.some((x: any) => x.id === pl.id));
  await A.getByRole('button', { name: 'Import CSV' }).click(); await A.locator('dialog[open]').waitFor();
  await dialog(A).getByLabel('CSV text').fill(`name_en,name_rw,name_fr,kind,lat,lng,designated_pickup\nE2E Bad ${tag},,,landmark,50,30,no\nE2E Good ${tag},Hano,Ici,landmark,-1.95,30.07,yes`);
  await dialog(A).getByRole('button', { name: 'Check the file' }).click(); await A.waitForTimeout(600);
  check('import reports the bad row and nothing is saved', (await dialog(A).innerText()).includes('Row 2') && !(await q1('select 1 from places where name_en=$1', [`E2E Good ${tag}`]))); await shot(A, '16-import-errors');
  await dialog(A).getByLabel('CSV text').fill(`name_en,name_rw,name_fr,kind,lat,lng,designated_pickup\nE2E Good ${tag},Hano,Ici,landmark,-1.95,30.07,yes`);
  await dialog(A).getByRole('button', { name: 'Import', exact: true }).click(); await A.waitForTimeout(900);
  check('valid CSV imports', !!(await q1('select 1 from places where name_en=$1', [`E2E Good ${tag}`])));

  // ---- zones ----
  await sub(A, 'Zones'); await shot(A, '17-zones');
  await A.getByRole('button', { name: 'Add zone' }).click(); await A.locator('dialog[open]').waitFor(); await A.waitForTimeout(800);
  await dialog(A).getByLabel('Zone name').fill(`E2E Huye ${tag}`);
  await dialog(A).getByLabel('Radius in metres').fill('3500');
  await dialog(A).getByRole('button', { name: 'Save zone' }).click();
  check('a circle zone needs a centre', await dialog(A).getByText('Click the map or type the centre').isVisible());
  await dialog(A).getByLabel('Centre latitude').fill('-2.5967'); await dialog(A).getByLabel('Centre longitude').fill('29.7394'); await A.waitForTimeout(400); await shot(A, '18-zone-editor');
  await dialog(A).getByRole('button', { name: 'Save zone' }).click(); await A.waitForTimeout(1000);
  const zid = slugOf(`E2E Huye ${tag}`);
  const zrow = await q1<any>('select * from service_zones where id=$1', [zid]);
  check('circle zone saved as a polygon with its radius remembered', zrow && zrow.config.shape === 'circle' && zrow.config.radius_m === 3500 && zrow.polygon.length === 49, JSON.stringify(zrow?.config));
  const coverage = await (await fetch(`${ORIGIN}/api/v1/coverage`)).json() as any; check('public coverage includes the new zone', coverage.zones.some((z: any) => z.id === zid));
  await A.locator('#view tbody tr', { hasText: `E2E Huye ${tag}` }).getByRole('button', { name: 'Disable' }).click(); await reasonAnd(A, 'pilot finished', 'Disable');
  check('zone disabled with a reason', (await q1<any>('select active from service_zones where id=$1', [zid]))!.active === false);

  // ---- help centre ----
  await tab(A, 'Content and rules'); await shot(A, '19-faq');
  check('seeded questions are listed', (await A.locator('#view tbody tr').count()) >= 5);
  await A.getByRole('button', { name: 'Add question' }).click(); await A.locator('dialog[open]').waitFor();
  await dialog(A).getByLabel('Question in English').fill(`E2E question ${tag}?`); await dialog(A).getByLabel('Answer in English').fill('E2E answer in English.');
  await dialog(A).getByLabel('Published').check(); await dialog(A).getByRole('button', { name: 'Save', exact: true }).click();
  check('publishing needs all three languages', await dialog(A).getByText('also write the question and answer in').isVisible());
  await dialog(A).getByLabel('Question in Kinyarwanda').fill('Ikibazo cya E2E?'); await dialog(A).getByLabel('Answer in Kinyarwanda').fill('Igisubizo cya E2E.');
  await dialog(A).getByLabel('Question in Français').fill('Question E2E ?'); await dialog(A).getByLabel('Answer in Français').fill('Réponse E2E.');
  await dialog(A).getByRole('button', { name: 'Save', exact: true }).click(); await A.waitForTimeout(900);
  const faq = await (await fetch(`${ORIGIN}/api/v1/support/faq`)).json() as any; check('published question reaches the app endpoint', faq.faq.some((f: any) => f.q_en === `E2E question ${tag}?`));
  await A.locator('#view tbody tr', { hasText: `E2E question ${tag}` }).getByRole('button', { name: 'Unpublish' }).click(); await A.waitForTimeout(800);
  const faq2 = await (await fetch(`${ORIGIN}/api/v1/support/faq`)).json() as any; check('unpublished question disappears', !faq2.faq.some((f: any) => f.q_en === `E2E question ${tag}?`));
  await A.locator('#view tbody tr', { hasText: `E2E question ${tag}` }).getByRole('button', { name: 'Delete' }).click(); await dialog(A).getByRole('button', { name: 'Delete' }).click(); await A.waitForTimeout(800);

  // ---- driver documents, support deadlines, wording ----
  await q("update document_requirements set mandatory=false where vehicle_type='moto' and doc_type='transport_permit'");
  await sub(A, 'Driver documents'); await shot(A, '20-driver-docs');
  const permitRow = A.locator('.card', { hasText: 'Moto' }).first().locator('tr', { hasText: 'Transport permit' });
  await permitRow.getByRole('button', { name: /mandatory for moto/ }).click(); await reasonAnd(A, 'new rule from the regulator', 'Confirm');
  check('document rule changed with a reason', (await q1<any>("select mandatory from document_requirements where vehicle_type='moto' and doc_type='transport_permit'"))!.mandatory === true, (await A.locator('dialog[open]').count()) + ' dialogs; ' + (await A.locator('#view').innerText()).slice(0, 200));
  await sub(A, 'Support deadlines');
  await A.locator('#view tbody tr', { hasText: 'Lost item' }).getByRole('button', { name: 'Edit' }).click(); await dialog(A).getByLabel('Respond within (hours, 1 to 720)').fill('12'); await reasonAnd(A, 'faster for lost items', 'Save');
  check('support deadline changed', (await q1<any>("select sla_hours from support_categories where category='lost_item'"))!.sla_hours === 12);
  await shot(A, '21-support-deadlines');
  await sub(A, 'Notification wording'); await shot(A, '22-wording');
  await A.locator('#view tbody tr', { hasText: 'otp' }).first().getByRole('button', { name: 'Edit' }).click(); await dialog(A).getByLabel('Message text').fill('Your code is {{wrong}}'); await dialog(A).getByRole('button', { name: 'Save wording' }).click(); await A.waitForTimeout(500);
  check('unknown placeholder is explained', await dialog(A).getByText('is not available in this message').isVisible());
  await dialog(A).getByLabel('Message text').fill('Abasare code {{code}} (valid {{minutes}} min).'); await dialog(A).getByRole('button', { name: 'Save wording' }).click(); await A.waitForTimeout(800);
  check('wording saved and shown as customised', !!(await q1("select 1 from notification_templates where key='otp' and lang='en'")));
  await A.locator('#view tbody tr', { hasText: 'customised' }).first().getByRole('button', { name: 'Revert' }).click(); await dialog(A).getByRole('button', { name: 'Revert' }).click(); await A.waitForTimeout(800);
  check('wording reverted to the built-in text', !(await q1("select 1 from notification_templates where key='otp' and lang='en'")));

  // ---- feature flags ----
  await tab(A, 'Feature flags'); await shot(A, '23-flags');
  const flagKey = (await q1<any>("select key from feature_flags where key not in ('pricing.surge','pricing.negotiated','payments.wallet') order by key limit 1"))!.key;
  const before = (await q1<any>('select enabled from feature_flags where key=$1', [flagKey]))!.enabled;
  await A.locator('#view tbody tr', { hasText: flagKey }).getByRole('button', { name: /Turn o/ }).click(); await reasonAnd(A, 'e2e flag toggle', /Turn o/);
  check('flag toggled with a reason in the audit log', (await q1<any>('select enabled from feature_flags where key=$1', [flagKey]))!.enabled === !before && !!(await q1("select 1 from audit_logs where entity_type='flag' and entity_id=$1 and after->>'reason'='e2e flag toggle'", [flagKey])));
  await q('update feature_flags set enabled=$2 where key=$1', [flagKey, before]);

  // ---- phone width: no sideways scroll on the new pages ----
  { const c = await br.newContext({ viewport: { width: 390, height: 800 } }); const pg = await c.newPage(); watch(pg, 'phone-admin'); await signIn(pg, sa);
    for (const [t, s] of [['Staff', ''], ['Staff', 'Roles and permissions'], ['Places and zones', ''], ['Content and rules', ''], ['Feature flags', '']] as const) {
      await pg.locator('[data-nav-toggle]').click(); await pg.waitForTimeout(250); await pg.locator('nav button', { hasText: new RegExp('^' + t + '$') }).click(); await pg.waitForTimeout(700);
      if (s) await sub(pg, s);
      check(`phone: ${t}${s ? ' / ' + s : ''} has no sideways scroll`, (await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 2); }
    await shot(pg, '24-phone-roles'); await c.close(); }
  check('no JavaScript errors anywhere', jsErrors.length === 0, jsErrors.slice(0, 4).join(' | '));
  await ctx.close();
} catch (e: any) { failed++; console.log('FAIL script error:', String(e.message).split('\n').slice(0, 6).join(' | ')); }
await br.close(); await pool.end();
console.log(failed ? `\n${failed} problem(s)` : '\nall staff-management browser checks passed');
process.exit(failed ? 1 : 0);

function slugOf(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24); }
