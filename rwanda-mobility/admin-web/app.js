'use strict';
// Shell: sign-in, navigation, routing (#/tab), theme, loading and error states. Views live in views-ops.js, views-admin.js and business.js.

// [tab key, label, permissions that unlock it (any), group]. A tab is only shown when the signed-in role holds one of them, so no tab ever answers 403.
const TABS = [
  ['dashboard', 'Overview', ['analytics.view'], 'Operations'], ['live', 'Live map', ['bookings.view_all'], 'Operations'], ['bookings', 'Bookings', ['bookings.view_all'], 'Operations'],
  ['drivers', 'Drivers', ['drivers.view'], 'Operations'], ['abasare', 'Abasare', ['drivers.view'], 'Operations'], ['safety', 'Safety', ['safety.respond'], 'Operations'], ['trust', 'Trust and safety', ['safety.respond', 'drivers.view'], 'Operations'],
  ['users', 'Passengers', ['users.view'], 'People and support'], ['support', 'Support', ['support.handle'], 'People and support'], ['privacy', 'Privacy', ['privacy.handle'], 'People and support'],
  ['finance', 'Finance', ['finance.view'], 'Money'], ['wallet', 'Credit & loyalty', ['wallet.view'], 'Money'], ['claims', 'Claims', ['claims.view'], 'People and support'], ['ussd', 'USSD channel', ['ussd.view'], 'Operations'],
  ['pricing', 'Pricing', ['pricing.manage', 'pricing.approve'], 'Business'], ['services', 'Services', ['pricing.manage'], 'Business'], ['promos', 'Promotions', ['promotions.manage'], 'Business'],
  ['codes', 'Request codes', ['codes.view'], 'Business'], ['fixedroutes', 'Fixed-price routes', ['pricing.manage', 'pricing.approve'], 'Business'], ['quests', 'Driver quests', ['growth.manage'], 'Business'], ['campaigns', 'Campaigns', ['growth.manage'], 'Business'], ['demand', 'Demand map', ['analytics.view'], 'Operations'], ['partners', 'Venue partners', ['partners.manage'], 'Business'], ['partner', 'Your venue', ['partner.portal'], 'Partner'], ['business', 'Business & fleets', ['corporate.manage', 'fleet.manage'], 'Business'],
  ['settings', 'Settings', ['settings.manage'], 'Administration'], ['audit', 'Audit log', ['audit.view'], 'Administration'], ['staff', 'Staff', ['users.manage'], 'Administration'],
];
const visibleTabs = () => TABS.filter(([, , need]) => can(...need));

// ---------------- theme (auto follows the OS; the toggle overrides and is remembered) ----------------
const effectiveTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function applyTheme(t) { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
applyTheme(pref.get('rm_theme'));

// ---------------- navigation ----------------
const unsaved = () => S.dirty.size > 0;
window.addEventListener('beforeunload', (e) => { if (unsaved()) { e.preventDefault(); e.returnValue = ''; } });
const setDirty = (id, on) => { if (on) S.dirty.add(id); else S.dirty.delete(id); };   // forms register here; leaving the page then asks first

/** go('bookings', {q: 'x'}): open a tab. Same tab without state = reload keeping filters. */
function go(tab, state) {
  if (unsaved() && !window.confirm('You have unsaved changes on this page. Leave without saving?')) return;
  S.dirty.clear();
  if (tab !== S.tab) { S.tab = tab; S.state = state || {}; history.pushState(null, '', '#/' + tab); S.focusView = true; }
  else if (state) S.state = state;
  render();
}
window.addEventListener('popstate', () => { const t = tabFromHash(); if (t && t !== S.tab) { S.tab = t; S.state = {}; S.dirty.clear(); render(); } });
function tabFromHash() { const m = /^#\/([a-z]+)$/.exec(location.hash); return m && TABS.some((t) => t[0] === m[1]) ? m[1] : null; }

function closeNav() { const n = $('#sidenav'); if (n) n.classList.remove('open'); const t = $('[data-nav-toggle]'); if (t) t.setAttribute('aria-expanded', 'false'); }

async function render() {
  const root = $('#app');
  const m = /^#activate=(.+)$/.exec(location.hash); if (m && !S.access) { root.replaceChildren(); return activationView(root, m[1]); }
  if (!S.access) { root.replaceChildren(); return loginView(root); }
  const tabs = visibleTabs();
  if (!tabs.length) { root.replaceChildren(h('main', { class: 'loginpage' }, h('div', { class: 'card login' }, h('h1', {}, 'No access'), h('p', {}, 'Your account has no operations role. Ask a super admin to assign one.'), h('button', { class: 'b wide', onclick: logout }, 'Sign out')))); return; }
  const wanted = tabFromHash();
  if (!S.tabSet) { S.tabSet = true; if (wanted) S.tab = wanted; }
  if (!tabs.some((t) => t[0] === S.tab)) { S.tab = tabs[0][0]; history.replaceState(null, '', '#/' + S.tab); }
  if (!$('#shell')) buildShell(root, tabs);
  const cur = TABS.find((t) => t[0] === S.tab);
  document.querySelectorAll('#sidenav button[data-tab]').forEach((b) => { const on = b.dataset.tab === S.tab; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#crumbs').replaceChildren(h('li', {}, cur[3]), h('li', { 'aria-current': 'page' }, cur[1]));
  document.title = cur[1] + ' · Abasare Operations';
  closeNav();
  await loadView();
}

async function loadView() {
  const my = ++S.nav, view = $('#view');
  const box = h('div', { class: 'page' });
  view.classList.add('loading'); view.replaceChildren(loading(), box);
  let after;
  try { await catalog(); if (!V[S.tab]) throw new Error('This page failed to load its code. Reload the page; if it persists, tell an engineer.'); after = await V[S.tab](box, S.state || {}); }
  catch (e) { if (my !== S.nav) return; view.classList.remove('loading'); view.replaceChildren(errorPanel(e, () => loadView())); return; }
  if (my !== S.nav) return;
  view.classList.remove('loading'); view.querySelector('.loader')?.remove();
  if (typeof after === 'function') { try { after(); } catch (e) { toast('Part of this page failed to load: ' + e.message, true); } }
  if (S.focusView) { S.focusView = false; const t = view.querySelector('h1'); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } }
}

function buildShell(root, tabs) {
  const groups = [...new Set(tabs.map((t) => t[3]))];
  const email = store.get('rm_email');
  const nav = h('nav', { id: 'sidenav', 'aria-label': 'Main navigation' },
    h('div', { class: 'brand' }, h('img', { src: 'logo.png', alt: '', width: 28, height: 28 }), h('span', {}, 'Abasare'), h('small', {}, 'Operations')),
    groups.map((g) => h('div', { class: 'navgroup', role: 'group', 'aria-label': g }, h('div', { class: 'navhead' }, g), tabs.filter((t) => t[3] === g).map(([k, l]) => h('button', { 'data-tab': k, onclick: () => go(k) }, l)))),
    h('div', { class: 'navfoot' }, h('button', { onclick: logout }, 'Sign out')));
  const themeBtn = h('button', { class: 'iconbtn', 'aria-label': 'Switch between light and dark theme', title: 'Light / dark', onclick: () => { const t = effectiveTheme() === 'dark' ? 'light' : 'dark'; applyTheme(t); pref.set('rm_theme', t); themeBtn.textContent = t === 'dark' ? '☀' : '☾'; } }, effectiveTheme() === 'dark' ? '☀' : '☾');
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'iconbtn', 'data-nav-toggle': '', 'aria-label': 'Open menu', 'aria-expanded': 'false', 'aria-controls': 'sidenav', onclick: () => { const open = nav.classList.toggle('open'); $('[data-nav-toggle]').setAttribute('aria-expanded', String(open)); } }, '☰'),
    h('ol', { id: 'crumbs', class: 'crumbs', 'aria-label': 'Breadcrumb' }), h('span', { class: 'grow' }), themeBtn,
    h('span', { class: 'who', title: S.roles.join(', ') }, h('b', {}, email || 'Signed in'), h('small', {}, S.roles.map(human).join(', '))));
  const scrim = h('div', { class: 'scrim', onclick: closeNav });
  root.replaceChildren(h('a', { class: 'skip', href: '#view', onclick: (e) => { e.preventDefault(); $('#view').focus(); } }, 'Skip to content'),
    h('div', { class: 'shell', id: 'shell' }, nav, scrim, h('div', { class: 'content' }, top, h('main', { id: 'view', tabindex: '-1' }))));
}

// ---------------- sign-in ----------------
function loginView(root) {
  const email = h('input', { type: 'email', placeholder: 'Email', 'aria-label': 'Email', autocomplete: 'username', required: true }), pw = h('input', { type: 'password', placeholder: 'Password', 'aria-label': 'Password', autocomplete: 'current-password', required: true }),
    totp = h('input', { placeholder: '6-digit authenticator code', 'aria-label': 'Authenticator code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', required: true });
  const err = h('div', { class: 'err', role: 'alert' }), btn = h('button', { class: 'b wide', type: 'submit' }, 'Sign in');
  const submit = async (ev) => {
    ev.preventDefault(); err.textContent = '';
    if (!email.value.trim() || !pw.value) { err.textContent = 'Enter your email and password.'; return; }
    if (!/^\d{6}$/.test(totp.value.trim())) { err.textContent = 'Enter the 6-digit code from your authenticator app.'; totp.focus(); return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      let r; try { r = await fetch(API + '/auth/staff/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value.trim(), password: pw.value, totp: totp.value.trim() }) }); } catch { throw new Error('Cannot reach the server. Check your connection.'); }
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error?.message || 'Sign-in failed');
      save(j); store.set('rm_email', email.value.trim()); S.notice = ''; S.tabSet = false; S.tab = 'dashboard'; S.state = {}; if (!tabFromHash()) history.replaceState(null, '', location.pathname); render();
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Sign in'; }
  };
  root.append(h('main', { class: 'loginpage' }, h('form', { class: 'card login', onsubmit: submit, novalidate: true },
    h('div', { class: 'brand big' }, h('img', { src: 'logo.png', alt: '', width: 40, height: 40 }), h('span', {}, 'Abasare Operations')), h('h1', {}, 'Staff sign-in'),
    S.notice ? h('div', { class: 'alert warn', role: 'alert' }, S.notice) : null, email, pw, totp, err, btn, h('p', { class: 'muted' }, 'Staff accounts require two-factor authentication. Lost your authenticator? Ask a super admin.'))));
  email.focus();
}

// Sign out in other tabs of this browser is not shared (sessionStorage), but a revoked server session shows up as a 401 on the next call and ends here.
catalog();
render();
