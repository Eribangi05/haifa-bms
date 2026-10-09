'use strict';
// Shell: sign-in, navigation, routing (#/tab), theme, loading and error states. Views live in views-ops.js, views-admin.js and business.js.

// [tab key, label, permissions that unlock it (any), group]. A tab is only shown when the signed-in role holds one of them, so no tab ever answers 403.
const TABS = [
  ['dashboard', 'Overview', ['analytics.view'], 'Operations'], ['live', 'Live map', ['bookings.view_all'], 'Operations'], ['bookings', 'Bookings', ['bookings.view_all'], 'Operations'],
  ['drivers', 'Drivers', ['drivers.view'], 'Operations'], ['reviewq', 'Review queue', ['drivers.view'], 'Operations'], ['opsdash', 'Operations dashboard', ['analytics.view'], 'Operations'], ['alerts', 'Alerts', ['alerts.view'], 'Operations'], ['abasare', 'Abasare', ['drivers.view'], 'Operations'], ['safety', 'Safety', ['safety.respond'], 'Operations'], ['trust', 'Trust and safety', ['safety.respond', 'drivers.view'], 'Operations'],
  ['users', 'Passengers', ['users.view'], 'People and support'], ['support', 'Support', ['support.handle'], 'People and support'], ['privacy', 'Privacy', ['privacy.handle'], 'People and support'],
  ['finance', 'Finance', ['finance.view'], 'Money'], ['wallet', 'Credit & loyalty', ['wallet.view'], 'Money'], ['claims', 'Claims', ['claims.view'], 'People and support'], ['ussd', 'USSD channel', ['ussd.view'], 'Operations'],
  ['pricing', 'Pricing', ['pricing.manage', 'pricing.approve'], 'Business'], ['services', 'Services', ['pricing.manage'], 'Business'], ['promos', 'Promotions', ['promotions.manage'], 'Business'],
  ['codes', 'Request codes', ['codes.view'], 'Business'], ['fixedroutes', 'Fixed-price routes', ['pricing.manage', 'pricing.approve'], 'Business'], ['quests', 'Driver quests', ['growth.manage'], 'Business'], ['referrals', 'Referrals', ['growth.manage'], 'Business'], ['campaigns', 'Campaigns', ['growth.manage'], 'Business'], ['demand', 'Demand map', ['analytics.view'], 'Operations'], ['partners', 'Venue partners', ['partners.manage'], 'Business'], ['partner', 'Your venue', ['partner.portal'], 'Partner'], ['business', 'Business & fleets', ['corporate.manage', 'fleet.manage'], 'Business'],
  ['settings', 'Settings', ['settings.manage'], 'Administration'], ['audit', 'Audit log', ['audit.view'], 'Administration'], ['staff', 'Staff', ['users.manage', 'roles.manage'], 'Administration'],
  ['places', 'Places and zones', ['places.manage', 'zones.manage'], 'Administration'], ['content', 'Content and rules', ['faq.manage', 'requirements.manage', 'support.configure', 'settings.manage'], 'Administration'], ['flags', 'Feature flags', ['settings.manage'], 'Administration'],
];
const visibleTabs = () => TABS.filter(([k, , need]) => (k === 'partner' ? S.roles.includes('partner_manager') : can(...need)));   // the venue portal is for venue managers only, even a super admin has no venue

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
  if (S.access && !S.perms.length && !S.roles.includes('super_admin')) await syncAccess(true);   // a session from before permissions came from the server
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
  if (await syncAccess()) { $('#shell')?.remove(); return render(); }   // roles or permissions changed on the server: rebuild the menu
  try { await catalog(); if (!V[S.tab]) throw new Error('This page failed to load its code. Reload the page; if it persists, tell an engineer.'); after = await V[S.tab](box, S.state || {}); }
  catch (e) { if (my !== S.nav) return; view.classList.remove('loading'); view.replaceChildren(errorPanel(e, () => loadView())); return; }
  if (my !== S.nav) return;
  view.classList.remove('loading'); view.querySelector('.loader')?.remove();
  if (typeof after === 'function') { try { after(); } catch (e) { toast('Part of this page failed to load: ' + e.message, true); } }
  if (S.focusView) { S.focusView = false; const t = view.querySelector('h1'); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } }
}


// Menu icons: small line drawings (24x24, drawn here, no external font). Unknown tabs get a dot.
const IC = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  car: 'M5 16V11l2-5h10l2 5v5M3 16h18M7 19v-3M17 19v-3M7 12h10', check: 'M5 12l5 5L20 7', bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20h4', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2', phone: 'M7 3h10a1 1 0 011 1v16a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2', users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3.5 2.5-6 6-6s6 2.5 6 6M17 11a2.5 2.5 0 100-5M21 19c0-2.5-1.5-4.5-4-5',
  chat: 'M4 5h16v11H9l-5 4z', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', coin: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.8S9.5 13 9.5 14s1 1.7 2.5 1.7 2.5-.7 2.5-1.7',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8h.01', gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2 0-4-1-3.5-3 1.5-1 3.5 1 3.5 3zM12 7c2 0 4-1 3.5-3-1.5-1-3.5 1-3.5 3z',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5L17 5l-3-1-1 2h-2L10 4 7 5l.5 2L6 8.5 4 8l-1 3 2 1v1l-2 1 1 3 2-.5L7.5 18 7 20l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z',
  doc: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6', pin: 'M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11zM12 12a2 2 0 100-4 2 2 0 000 4Z', flag: 'M5 21V4M5 4h12l-2 4 2 4H5', bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
};
const TAB_ICON = { dashboard: 'home', live: 'map', bookings: 'list', drivers: 'car', reviewq: 'check', opsdash: 'chart', alerts: 'bell', abasare: 'car', safety: 'shield', trust: 'shield', ussd: 'phone', demand: 'map', users: 'users', support: 'chat', privacy: 'lock', claims: 'doc', finance: 'coin', wallet: 'coin', pricing: 'tag', services: 'list', promos: 'tag', codes: 'tag', fixedroutes: 'map', quests: 'flag', referrals: 'gift', campaigns: 'bolt', partners: 'pin', partner: 'pin', business: 'briefcase', settings: 'gear', audit: 'doc', staff: 'users', places: 'pin', content: 'doc', flags: 'flag' };
function navIcon(key) {
  const p = IC[TAB_ICON[key]]; const el = document.createElement('span'); el.className = 'ni'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = p ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + p + '"/></svg>' : '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>';
  return el;
}
const initials = (e) => { const p = String(e || '?').split('@')[0].split(/[._\-\s]+/).filter(Boolean); return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase(); };

function buildShell(root, tabs) {
  const groups = [...new Set(tabs.map((t) => t[3]))];
  const email = store.get('rm_email');
  const nav = h('nav', { id: 'sidenav', 'aria-label': 'Main navigation' },
    h('div', { class: 'brand' }, h('span', { class: 'bmark' }, h('img', { src: 'brand-mark.png', alt: '', width: 30, height: 25 })), h('span', {}, 'Abasare'), h('small', {}, 'Operations')),
    h('input', { class: 'navfind', type: 'search', placeholder: 'Go to…  (press /)', 'aria-label': 'Find a page', oninput: (e) => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('#sidenav .navgroup').forEach((g) => { let any = false; g.querySelectorAll('button').forEach((b) => { const m = !q || b.textContent.toLowerCase().includes(q); b.hidden = !m; if (m) any = true; }); g.hidden = !any; }); }, onkeydown: (e) => { if (e.key === 'Enter') { const b = [...document.querySelectorAll('#sidenav .navgroup button')].find((x) => !x.hidden); if (b) { b.click(); e.target.value = ''; e.target.dispatchEvent(new Event('input')); e.target.blur(); } } } }),
    groups.map((g) => h('div', { class: 'navgroup', role: 'group', 'aria-label': g }, h('div', { class: 'navhead' }, g), tabs.filter((t) => t[3] === g).map(([k, l]) => h('button', { 'data-tab': k, onclick: () => go(k) }, navIcon(k), h('span', { class: 'nl' }, l))))),
    h('div', { class: 'navfoot' }, h('button', { onclick: logout }, 'Sign out')));
  const themeBtn = h('button', { class: 'iconbtn', 'aria-label': 'Switch between light and dark theme', title: 'Light / dark', onclick: () => { const t = effectiveTheme() === 'dark' ? 'light' : 'dark'; applyTheme(t); pref.set('rm_theme', t); themeBtn.textContent = t === 'dark' ? '☀' : '☾'; } }, effectiveTheme() === 'dark' ? '☀' : '☾');
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'iconbtn', 'data-nav-toggle': '', 'aria-label': 'Open menu', 'aria-expanded': 'false', 'aria-controls': 'sidenav', onclick: () => { const open = nav.classList.toggle('open'); $('[data-nav-toggle]').setAttribute('aria-expanded', String(open)); } }, '☰'),
    h('ol', { id: 'crumbs', class: 'crumbs', 'aria-label': 'Breadcrumb' }), h('span', { class: 'grow' }), themeBtn,
    h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(email)), h('span', { class: 'who', title: S.roles.join(', ') }, h('b', {}, email || 'Signed in'), h('small', {}, S.roles.map(human).join(', '))));
  const scrim = h('div', { class: 'scrim', onclick: closeNav });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) { const f = document.querySelector('.navfind'); if (f) { e.preventDefault(); document.getElementById('sidenav')?.classList.add('open'); f.focus(); } } });
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
  root.append(h('main', { class: 'loginpage' },
    h('section', { class: 'loginhero', 'aria-hidden': 'true' },
      h('img', { class: 'herologo', src: 'logo.png', alt: '', width: 168, height: 168 }), h('div', { class: 'herotitle' }, 'Abasare'), h('div', { class: 'herotag' }, 'Ride \u00b7 Work \u00b7 Explore'),
      h('p', {}, 'Operations console for the Abasare team: bookings, drivers, support and safety in one place.'), h('div', { class: 'flagbands' }, h('i'), h('i'), h('i'))),
    h('div', { class: 'loginside' }, h('form', { class: 'card login', onsubmit: submit, novalidate: true },
      h('div', { class: 'brand big' }, h('span', { class: 'bmark' }, h('img', { src: 'brand-mark.png', alt: '', width: 40, height: 33 })), h('span', {}, 'Abasare Operations')), h('h1', {}, 'Staff sign-in'),
      S.notice ? h('div', { class: 'alert warn', role: 'alert' }, S.notice) : null, email, pw, totp, err, btn, h('p', { class: 'muted' }, 'Staff accounts require two-factor authentication. Lost your authenticator? Ask a super admin.')),
      h('p', { class: 'muted loginfoot' }, 'Abasare \u00b7 Kigali, Rwanda'))));
  email.focus();
}

// Sign out in other tabs of this browser is not shared (sessionStorage), but a revoked server session shows up as a 401 on the next call and ends here.
catalog();
render();
