'use strict';
// Staff management: people (edit, roles, disable, remove, recover access), roles and permissions editor, admin activity.
// The API enforces every rule (self-protection, last super admin, who may touch whom); this file only shows the right buttons and explains the rules.

const STAFF_STATUS_FILTERS = [['', 'Active and disabled'], ['active', 'Active'], ['disabled', 'Disabled'], ['removed', 'Removed'], ['all', 'Everyone (including removed)']];

V.staff = async (el, state = {}) => {
  const sub = state.sub || 'people';
  const tabs = [['people', 'People'], can('roles.manage') && ['roles', 'Roles and permissions'], ['activity', 'Admin activity']].filter(Boolean);
  el.append(h('h1', {}, 'Staff and roles'), subnav('staff', tabs, sub));
  if (sub === 'roles') return staffRolesView(el, state);
  if (sub === 'activity') return staffActivityView(el, state);
  return staffPeopleView(el, state);
};

// ------------------------------------------------------------------ people
async function staffPeopleView(el, state) {
  const status = state.status ?? '', role = state.role || '', search = state.q || '';
  const qs = new URLSearchParams(); if (status) qs.set('status', status); if (role) qs.set('role', role); if (search) qs.set('q', search);
  const [d, inv] = await Promise.all([api('GET', '/admin/staff?' + qs), api('GET', '/admin/staff/invites')]);
  const rows = d.staff;
  const me = myId(), isSuper = S.roles.includes('super_admin');
  const roleLabel = (n) => d.roles.find((r) => r.name === n)?.label || human(n);
  const q = h('input', { type: 'search', placeholder: 'Search name or email', 'aria-label': 'Search staff', value: search, style: 'min-width:min(100%,240px)' });
  const rs = h('select', { 'aria-label': 'Filter by role' }, h('option', { value: '' }, 'Any role'), d.roles.map((r) => h('option', { value: r.name, selected: r.name === role }, r.label || human(r.name))));
  const ss = h('select', { 'aria-label': 'Filter by status' }, STAFF_STATUS_FILTERS.map(([v, l]) => h('option', { value: v, selected: v === status }, l)));
  const apply = () => go('staff', { sub: 'people', q: q.value.trim(), role: rs.value, status: ss.value });
  el.append(note('Two-factor authentication is mandatory. New staff are invited by a one-time link: they choose their own password and scan their own authenticator QR code. You never see their credentials. Open a person to change roles, reset access or remove them.'),
    filterBar(q, rs, ss, h('button', { type: 'submit', class: 'b', onclick: apply }, 'Filter'), (search || role || status) ? h('button', { type: 'button', class: 'b sec', onclick: () => go('staff', { sub: 'people' }) }, 'Clear') : null,
      h('span', { class: 'grow' }), can('users.manage') && h('button', { class: 'b', onclick: () => inviteStaffDialog(d.roles) }, 'Invite staff member')),
    table([{ h: 'Name', f: (s) => h('div', {}, h('b', {}, s.display_name || '(no name)'), s.id === me ? h('span', { class: 'muted' }, ' (you)') : null), s: (s) => s.display_name || '', csv: (s) => s.display_name || '' },
      { h: 'Email', f: (s) => (s.status === 'removed' ? h('span', { class: 'muted' }, s.anonymised_at ? 'anonymised' : 'removed address') : s.email), s: (s) => s.email || '', csv: (s) => (s.status === 'removed' ? '' : s.email) },
      { h: 'Roles', f: (s) => h('span', { class: 'chips' }, s.roles.map((r) => h('span', { class: 'chip' }, roleLabel(r)))), s: (s) => s.roles.join(), csv: (s) => s.roles.join(' ') },
      { h: 'Status', f: (s) => pill(s.status, s.status === 'active' ? 'ok' : s.status === 'disabled' ? 'warn' : 'bad'), s: (s) => s.status, csv: (s) => s.status },
      dateCol('Last sign-in', 'last_login_at'), { h: 'Sessions', k: 'active_sessions', cls: 'num' }],
      rows, (s) => staffDetailDialog(s.id, d.roles), status === 'removed' ? 'Nobody has been removed.' : 'No staff match.', { csv: 'staff', search: false }),
    h('h2', {}, 'Pending invitations and reset links'),
    inv.invites.length ? table([{ h: 'Name', k: 'display_name' }, { h: 'Email', k: 'email' }, { h: 'Kind', f: (x) => ({ invite: 'New account', password_reset: 'Password reset', mfa_reset: 'Two-factor reset', full_reset: 'Full reset' })[x.purpose] || x.purpose, s: (x) => x.purpose },
      { h: 'Role', f: (x) => roleLabel(x.role), s: (x) => x.role }, dateCol('Expires', 'expires_at'),
      { h: '', f: (x) => h('span', { class: 'row' },
        can('users.manage') && h('button', { class: 'b sec', title: 'Create a fresh link. The old link stops working.', onclick: async () => { const a = await ask('Make a new link for ' + x.email + '?', { confirmText: 'Make new link', message: 'The old link stops working at once. You get a new one to send.' }); if (a) { try { const r = await api('POST', `/admin/staff/invites/${x.id}/regenerate`); showInvite(r, x.email, () => go('staff')); } catch (e) { toast(e.message, true); } } } }, 'New link'),
        can('users.manage') && h('button', { class: 'b sec', onclick: async () => { const a = await ask('Revoke this link for ' + x.email + '?', { danger: true, confirmText: 'Revoke' }); if (a) act(() => api('DELETE', '/admin/staff/invites/' + x.id), () => go('staff')); } }, 'Revoke')) }], inv.invites, null, '', { sort: false })
      : h('div', { class: 'empty' }, 'No pending invitations.'));
}

/** Invitation dialog. Roles come from the server (built-in and custom). */
async function inviteStaffDialog(roles) {
  const isSuper = S.roles.includes('super_admin');
  const opts = roles.filter((r) => r.name !== 'partner_manager' && (isSuper || r.name !== 'super_admin')).map((r) => ({ value: r.name, label: (r.label || human(r.name)) + (r.description ? ' - ' + r.description : '') }));
  const a = await ask('Invite a staff member', { confirmText: 'Create invitation', fields: [{ name: 'name', label: 'Full name', required: true, maxlength: 80 }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'role', label: 'Role', type: 'select', options: opts, help: 'You can add more roles after they join. Venue partner managers are invited from the Venue partners page.' }] });
  if (a) { delete a.reason; try { const r = await api('POST', '/admin/staff/invites', a); showInvite(r, a.email, () => go('staff')); } catch (e) { toast(e.message, true); } }
}

/** Shows a one-time link (invitation or reset). The link is the only thing the administrator ever sees. */
function showLink(url, expires, email, what, onClose) {
  const link = h('input', { readonly: true, value: url, 'aria-label': 'One-time link', style: 'width:100%;margin:6px 0' }); let dlg;
  dlg = openDialog(what, h('div', {}, h('p', {}, 'Send this link ONLY to ' + email + '. It works once and expires ' + when(expires) + '. They set up their own credentials on their own device. You will not see them.'), link,
    h('div', { class: 'row end' }, h('button', { class: 'b', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { link.select(); toast('Select and copy the link'); } } }, 'Copy link'), h('button', { class: 'b sec', onclick: () => { dlg.close(); if (onClose) onClose(); } }, 'Close'))), { width: 560, key: 'link' });
  link.select();
}

// ------------------------------------------------------------------ one person
async function staffDetailDialog(id, roles) {
  const d = await api('GET', '/admin/staff/' + id);
  const s = d.staff, me = myId(), self = id === me, isSuper = S.roles.includes('super_admin');
  const roleLabel = (n) => roles.find((r) => r.name === n)?.label || human(n);
  const holdsSuper = s.roles.includes('super_admin');
  const lockedBySuper = holdsSuper && !isSuper;
  let dlg;
  const done = (msg) => () => { dlg.close(); go('staff'); };
  const btn = (label, fn, cls = 'sec', title) => h('button', { class: 'b ' + cls, title: title || null, onclick: fn }, label);
  const act2 = (title, opts, call, after) => async () => { const a = await ask(title, opts); if (a) act(() => call(a), after || done()); };
  const removed = s.status === 'removed';
  const acts = [];
  if (!removed) {
    acts.push(
      btn('Edit name and email', async () => {
        const a = await ask('Edit ' + (s.display_name || s.email), { reason: true, confirmText: 'Save', message: self ? 'You can change your own name only.' : 'Changing the email signs this person out everywhere. They sign in with the new address.', fields: [{ name: 'name', label: 'Display name', value: s.display_name || '', required: true, maxlength: 80 }, !self && { name: 'email', label: 'Email', type: 'email', value: s.email || '', required: true }].filter(Boolean) });
        if (!a) return; const body = { reason: a.reason }; if (a.name !== s.display_name) body.display_name = a.name; if (a.email && a.email.toLowerCase() !== (s.email || '').toLowerCase()) body.email = a.email;
        if (Object.keys(body).length === 1) { toast('Nothing changed'); return; }
        act(() => api('PATCH', '/admin/staff/' + id, body), done());
      }),
      !self && btn('Change roles', () => rolesDialog(s, roles, done())),
      !self && btn(s.status === 'active' ? 'Disable' : 'Enable', act2(s.status === 'active' ? 'Disable ' + (s.display_name || s.email) + '?' : 'Enable ' + (s.display_name || s.email) + '?', { reason: true, danger: s.status === 'active', confirmText: s.status === 'active' ? 'Disable' : 'Enable', message: s.status === 'active' ? 'They can no longer sign in and every open session ends at once. You can enable them again later.' : 'They can sign in again with their existing credentials.' },
        (a) => api('POST', `/admin/staff/${id}/status`, { status: s.status === 'active' ? 'disabled' : 'active', reason: a.reason })), s.status === 'active' ? 'red' : ''),
      btn('Sign out everywhere', act2('Sign ' + (s.display_name || s.email) + ' out everywhere?', { danger: true, confirmText: 'Sign out everywhere', reason: true }, (a) => api('POST', `/admin/staff/${id}/sessions/revoke`, { reason: a.reason }))));
    if (!self && s.status === 'active') acts.push(
      btn('Send password reset', act2('Password reset link for ' + (s.display_name || s.email), { reason: true, confirmText: 'Create link', message: 'They choose a new password with the link and confirm it with their current authenticator code.' },
        async (a) => { const r = await api('POST', `/admin/staff/${id}/reset`, { kind: 'password', reason: a.reason }); showLink(r.reset_url, r.expires_at, s.email, 'Password reset link', () => go('staff')); }, () => dlg.close())),
      btn('Reset two-factor', act2('Two-factor reset for ' + (s.display_name || s.email), { reason: true, danger: true, confirmText: 'Create link', message: 'Use this when the phone was lost or stolen. Their open sessions end now. They scan a NEW authenticator QR code on their own device with the link and confirm with their current password. You will not see the new key.' },
        async (a) => { const r = await api('POST', `/admin/staff/${id}/reset`, { kind: 'two_factor', reason: a.reason }); showLink(r.reset_url, r.expires_at, s.email, 'Two-factor reset link', () => go('staff')); }, () => dlg.close())),
      btn('Full reset', act2('Full reset for ' + (s.display_name || s.email), { reason: true, danger: true, confirmText: 'Create link', message: 'For someone who lost BOTH password and phone. They choose a new password and a new authenticator with the link. Open sessions end now.' },
        async (a) => { const r = await api('POST', `/admin/staff/${id}/reset`, { kind: 'full', reason: a.reason }); showLink(r.reset_url, r.expires_at, s.email, 'Full reset link', () => go('staff')); }, () => dlg.close())));
    if (!self) acts.push(btn('Remove from staff', act2('Remove ' + (s.display_name || s.email) + ' from staff?', { reason: true, danger: true, confirmText: 'Remove', message: 'They are signed out everywhere, their password and two-factor are deleted, and they disappear from the staff list (see the Removed filter). Their audit history stays. Their email becomes free so they can be invited again.' },
      (a) => api('POST', `/admin/staff/${id}/remove`, { reason: a.reason })), 'red'));
  } else if (!s.anonymised_at && !self) {
    acts.push(btn('Anonymise personal data', act2('Anonymise ' + (s.display_name || 'this person') + '?', { reason: true, danger: true, confirmText: 'Anonymise permanently', message: 'Replaces the name and email with placeholders. This cannot be undone. Audit rows stay, so past actions remain traceable to an anonymous "Former staff member".' },
      (a) => api('POST', `/admin/staff/${id}/anonymise`, { reason: a.reason })), 'red'));
  }
  const activity = (await api('GET', `/admin/staff/${id}/activity?view=by&limit=8`)).logs;
  const about = (await api('GET', `/admin/staff/${id}/activity?view=about&limit=8`)).logs;
  const logTable = (rows) => rows.length ? table([dateCol('When', 'created_at'), { h: 'Action', f: (l) => h('code', {}, l.action), s: (l) => l.action }, { h: 'Change', f: (l) => h('span', { class: 'trunc' }, summarize(l.after)) }], rows, null, '', { sort: false, search: false }) : h('div', { class: 'empty' }, 'Nothing yet.');
  dlg = openDialog(s.display_name || s.email || 'Staff member', h('div', {},
    h('div', { class: 'kvgrid' },
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Email'), h('span', {}, removed ? (s.anonymised_at ? 'anonymised' : 'removed') : s.email)),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Status'), pill(s.status, s.status === 'active' ? 'ok' : s.status === 'disabled' ? 'warn' : 'bad')),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Roles'), h('span', { class: 'chips' }, s.roles.map((r) => h('span', { class: 'chip' }, roleLabel(r))))),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Two-factor'), h('span', {}, s.mfa_enabled ? 'On' : 'Off')),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Last sign-in'), h('span', {}, when(s.last_login_at))),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Added'), h('span', {}, dateOnly(s.created_at)))),
    self ? note('This is your own account. You can change your name here. Roles, status, removal and resets must be done by another administrator.') : null,
    lockedBySuper ? note('Only a super admin can change a super admin.') : null,
    d.links.length ? note('Open link: ' + d.links.map((l) => ({ invite: 'invitation', password_reset: 'password reset', mfa_reset: 'two-factor reset', full_reset: 'full reset' })[l.purpose] + ' (expires ' + when(l.expires_at) + ')').join(', ') + '. Creating a new one revokes it.') : null,
    lockedBySuper ? null : h('div', { class: 'row' }, acts),
    h('h2', {}, 'Active sessions'),
    d.sessions.length ? table([{ h: 'Signed in', f: (x) => when(x.created_at), s: (x) => Date.parse(x.created_at) }, { h: 'Last used', f: (x) => ago(x.last_used_at), s: (x) => Date.parse(x.last_used_at) }, { h: 'Address', k: 'ip' }, { h: 'Device', f: (x) => x.device_name || '-' },
      { h: '', f: (x) => lockedBySuper ? null : h('button', { class: 'b sec', onclick: () => act(() => api('DELETE', `/admin/staff/${id}/sessions/${x.id}`), done()) }, 'End') }], d.sessions, null, '', { sort: false, search: false }) : h('div', { class: 'empty' }, 'Not signed in anywhere.'),
    h('h2', {}, 'What they did recently'), logTable(activity),
    h('h2', {}, 'What was done to this account'), logTable(about),
    h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => { dlg.close(); go('staff', { sub: 'activity', staff: id }); } }, 'See all activity'), h('button', { class: 'b sec', onclick: () => dlg.close() }, 'Close'))), { width: 900, key: 'staff' });
}

/** Role checkboxes with the description of each role. */
function rolesDialog(s, roles, after) {
  const isSuper = S.roles.includes('super_admin');
  const boxes = {}, errBox = h('div', { class: 'ferr', role: 'alert' });
  const reasonEl = h('textarea', { rows: 2, placeholder: 'Reason (required, kept in the audit log)', 'aria-label': 'Reason', style: 'width:100%' });
  const offer = roles.filter((r) => r.name !== 'partner_manager' && (isSuper || r.name !== 'super_admin' || s.roles.includes('super_admin')));
  const list = offer.map((r) => {
    const cb = h('input', { type: 'checkbox', checked: s.roles.includes(r.name), 'aria-label': r.label || r.name }); boxes[r.name] = cb;
    return h('label', { class: 'rolepick' }, cb, h('span', {}, h('b', {}, r.label || human(r.name)), h('span', { class: 'hint' }, ' ' + (r.description || (r.permissions.includes('*') ? 'Everything' : r.permissions.length + ' permissions')))));
  });
  let dlg;
  dlg = openDialog('Roles for ' + (s.display_name || s.email), h('div', {}, h('p', { class: 'effect' }, 'A person can hold several roles; they get everything any of them allows. The change takes effect at once and they are signed out so they sign in with exactly the new access.'),
    h('div', { class: 'rolelist' }, list), reasonEl, errBox,
    h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'b', onclick: async () => {
      errBox.textContent = ''; const chosen = Object.entries(boxes).filter(([, cb]) => cb.checked).map(([n]) => n);
      const keep = s.roles.filter((r) => !offer.some((o) => o.name === r));   // roles not shown here stay as they are
      if (!chosen.length) { errBox.textContent = 'Choose at least one role.'; return; }
      if (reasonEl.value.trim().length < 5) { errBox.textContent = 'Please give a reason (at least 5 characters).'; reasonEl.focus(); return; }
      try { await api('PATCH', '/admin/staff/' + s.id, { roles: [...chosen, ...keep], reason: reasonEl.value.trim() }); toast('Roles saved'); dlg.close(); after(); } catch (e) { errBox.textContent = e.message; }
    } }, 'Save roles'))), { width: 620, key: 'roles-edit' });
}

// ------------------------------------------------------------------ roles and permissions
async function staffRolesView(el, state) {
  const [r, p] = await Promise.all([api('GET', '/admin/roles'), api('GET', '/admin/permissions')]);
  const isSuper = S.roles.includes('super_admin');
  el.append(note('A role is a named set of permissions. Built-in roles ship with sensible defaults; only a super admin can change them (and can reset them to the defaults). Create your own roles for jobs that do not fit. Changes apply to everyone holding the role on their very next click. The super admin role is fixed and always allows everything.'),
    h('div', { class: 'row' }, h('button', { class: 'b', onclick: () => roleEditor(null, r, p) }, 'New role')),
    table([{ h: 'Role', f: (x) => h('div', {}, h('b', {}, x.label || human(x.name)), ' ', h('code', { class: 'muted' }, x.name), ' ', x.builtin ? pill(x.customized ? 'edited' : 'built-in', x.customized ? 'warn' : 'info') : pill('custom', 'ok')), s: (x) => x.label || x.name, csv: (x) => x.name },
      { h: 'What it is for', f: (x) => x.description || '', s: (x) => x.description || '' },
      { h: 'People', k: 'member_count', cls: 'num' }, { h: 'Permissions', f: (x) => (x.permissions.includes('*') ? 'Everything' : x.permissions.length), s: (x) => (x.permissions.includes('*') ? 999 : x.permissions.length), cls: 'num' },
      { h: '', f: (x) => h('span', { class: 'row' },
        h('button', { class: 'b sec', onclick: () => roleEditor(x, r, p) }, x.editable ? 'Edit' : 'View'),
        h('button', { class: 'b sec', onclick: () => roleEditor(null, r, p, x) }, 'Copy'),
        x.builtin && x.customized && x.editable && h('button', { class: 'b sec', onclick: async () => { const a = await ask('Reset ' + (x.label || x.name) + ' to its defaults?', { reason: true, confirmText: 'Reset', message: 'Permissions go back to what the software ships with. Everyone holding the role is affected on their next click.' }); if (a) act(() => api('POST', `/admin/roles/${x.name}/reset`, { reason: a.reason }), () => go('staff', { sub: 'roles' })); } }, 'Reset to defaults'),
        !x.builtin && x.editable && h('button', { class: 'b red', onclick: () => deleteRoleDialog(x, r.roles) }, 'Delete')) }], r.roles, null, 'No roles.', { csv: 'roles', sort: false }));
}

/** Grouped permission checkboxes. `role` null = create (optionally prefilled from `copyOf`). */
function roleEditor(role, r, p, copyOf = null) {
  const creating = !role, src = role || copyOf, isSuperRole = role?.permissions.includes('*');
  const editable = creating || role.editable, mine = new Set(r.my_permissions), iAmSuper = mine.has('*');
  const SUPER_ONLY = ['users.manage', 'roles.manage', 'settings.manage', 'audit.view', 'requirements.manage', 'support.configure'];
  const grantable = (k) => k !== 'partner.portal' && (iAmSuper || (mine.has(k) && !SUPER_ONLY.includes(k)));
  const have = new Set(src ? (src.permissions.includes('*') ? p.catalogue.map((x) => x.key) : src.permissions) : []);
  const name = h('input', { value: '', placeholder: 'role_name (lowercase letters, digits, _)', 'aria-label': 'Role name', maxlength: 30, disabled: !creating, style: 'width:100%' });
  const label = h('input', { value: creating ? (copyOf ? (copyOf.label || human(copyOf.name)) + ' (copy)' : '') : role.label || human(role.name), placeholder: 'Display name, e.g. Station supervisor', 'aria-label': 'Display name', maxlength: 60, disabled: !editable, style: 'width:100%' });
  const desc = h('input', { value: src?.description || '', placeholder: 'What is this role for?', 'aria-label': 'Description', maxlength: 200, disabled: !editable, style: 'width:100%' });
  const reasonEl = h('textarea', { rows: 2, placeholder: 'Reason for the change (required, kept in the audit log)', 'aria-label': 'Reason', style: 'width:100%' });
  const errBox = h('div', { class: 'ferr', role: 'alert' }), boxes = {};
  const groups = p.groups.map((g) => {
    const items = g.permissions.map((x) => {
      const cb = h('input', { type: 'checkbox', checked: have.has(x.key) || (isSuperRole && true), disabled: !editable || isSuperRole || (!grantable(x.key) && !(role && role.permissions.includes(x.key))), 'aria-label': x.label, title: x.key }); boxes[x.key] = cb;
      return h('label', { class: 'permpick' }, cb, h('span', {}, h('b', {}, x.label), h('span', { class: 'hint' }, ' ' + x.description), h('code', { class: 'muted' }, ' ' + x.key)));
    });
    const all = h('button', { type: 'button', class: 'b sec sm', disabled: !editable || isSuperRole, onclick: () => { const on = g.permissions.some((x) => !boxes[x.key].checked && !boxes[x.key].disabled); g.permissions.forEach((x) => { if (!boxes[x.key].disabled) boxes[x.key].checked = on; }); } }, 'Toggle all');
    return h('details', { open: true, class: 'permgroup' }, h('summary', {}, h('b', {}, g.group), ' ', all), items);
  });
  let dlg;
  const save = async () => {
    errBox.textContent = '';
    const perms = Object.entries(boxes).filter(([, cb]) => cb.checked).map(([k]) => k);
    try {
      if (creating) { if (!name.value.trim()) { errBox.textContent = 'Give the role a short name.'; name.focus(); return; } await api('POST', '/admin/roles', { name: name.value.trim(), label: label.value.trim(), description: desc.value.trim() || undefined, permissions: perms }); toast('Role created'); }
      else {
        if (reasonEl.value.trim().length < 5) { errBox.textContent = 'Please give a reason (at least 5 characters).'; reasonEl.focus(); return; }
        await api('PATCH', '/admin/roles/' + role.name, { label: label.value.trim(), description: desc.value.trim(), permissions: perms, reason: reasonEl.value.trim() }); toast('Role saved; it applies to everyone holding it on their next click');
      }
      dlg.close(); go('staff', { sub: 'roles' });
    } catch (e) { errBox.textContent = e.message; }
  };
  dlg = openDialog(creating ? (copyOf ? 'Copy of ' + (copyOf.label || copyOf.name) : 'New role') : (editable ? 'Edit ' : '') + (role.label || role.name), h('div', {},
    isSuperRole ? note('The super admin role always allows everything and cannot be changed.') : null,
    !editable && !isSuperRole ? note(role.name === 'partner_manager' ? 'This role is fixed by the system.' : role.builtin ? 'Only a super admin can edit built-in roles.' : 'You cannot edit a role you hold, or one that allows more than you do.') : null,
    creating ? h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Role name'), name, h('span', { class: 'hint' }, 'Shown in code and audit entries. Cannot be changed later.')) : null,
    h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Display name'), label), h('label', { class: 'dfield' }, h('span', { class: 'flabel' }, 'Description'), desc),
    !iAmSuper && editable ? note('You can only grant permissions you hold yourself, and not the administration ones.') : null,
    h('div', { class: 'permgroups' }, groups),
    editable && !creating ? reasonEl : null, errBox,
    h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => dlg.close() }, editable ? 'Cancel' : 'Close'), editable && h('button', { class: 'b', onclick: save }, creating ? 'Create role' : 'Save changes'))), { width: 820, key: 'role-edit' });
}

function deleteRoleDialog(x, roles) {
  const others = roles.filter((o) => o.name !== x.name && o.name !== 'partner_manager');
  const pick = h('select', { 'aria-label': 'Move people to' }, h('option', { value: '' }, x.member_count ? 'Choose a role to move them to' : 'Nobody to move'), others.map((o) => h('option', { value: o.name }, o.label || human(o.name))));
  const reasonEl = h('textarea', { rows: 2, placeholder: 'Reason (required, kept in the audit log)', 'aria-label': 'Reason', style: 'width:100%' });
  const errBox = h('div', { class: 'ferr', role: 'alert' }); let dlg;
  dlg = openDialog('Delete ' + (x.label || x.name) + '?', h('div', {}, x.member_count ? h('p', { class: 'effect' }, `${x.member_count} ${x.member_count === 1 ? 'person holds' : 'people hold'} this role. A role cannot be deleted while it is assigned. Choose a role to move them to; they are signed out and sign in with the new role.`) : h('p', {}, 'Nobody holds this role. Pending invitations for it are revoked.'),
    x.member_count ? pick : null, reasonEl, errBox,
    h('div', { class: 'row end' }, h('button', { class: 'b sec', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'b red', onclick: async () => {
      errBox.textContent = ''; if (reasonEl.value.trim().length < 5) { errBox.textContent = 'Please give a reason (at least 5 characters).'; return; }
      if (x.member_count && !pick.value) { errBox.textContent = 'Choose the role to move people to.'; return; }
      try { await api('DELETE', '/admin/roles/' + x.name, { reason: reasonEl.value.trim(), reassign_to: pick.value || undefined }); toast('Role deleted'); dlg.close(); go('staff', { sub: 'roles' }); } catch (e) { errBox.textContent = e.message; }
    } }, 'Delete role'))), { width: 560, key: 'role-del' });
}

// ------------------------------------------------------------------ admin activity
async function staffActivityView(el, state) {
  const d = await api('GET', '/admin/staff?status=all');
  const who = state.staff || '', view = state.view || 'by', action = state.action || '';
  const sel = h('select', { 'aria-label': 'Staff member' }, h('option', { value: '' }, 'Choose a person'), d.staff.map((s) => h('option', { value: s.id, selected: s.id === who }, (s.display_name || s.email || s.id) + (s.status === 'removed' ? ' (removed)' : ''))));
  const vs = h('select', { 'aria-label': 'Direction' }, [['by', 'What they did'], ['about', 'What was done to them']].map(([v, l]) => h('option', { value: v, selected: v === view }, l)));
  const ac = h('input', { type: 'search', placeholder: 'Action starts with, e.g. staff, refund', 'aria-label': 'Action prefix', value: action });
  const apply = () => go('staff', { sub: 'activity', staff: sel.value, view: vs.value, action: ac.value.trim() });
  el.append(note('Every change an administrator makes is recorded in the append-only audit log. Pick a person to see what they did, or what was done to their account.'), filterBar(sel, vs, ac, h('button', { type: 'submit', class: 'b', onclick: apply }, 'Show')));
  if (!who) { el.append(h('div', { class: 'empty' }, 'Choose a person above.')); return; }
  const a = await api('GET', `/admin/staff/${who}/activity?view=${view}&limit=300` + (action ? '&action=' + encodeURIComponent(action) : ''));
  el.append(table([dateCol('When', 'created_at'), { h: 'Actor', f: (l) => l.actor_name || 'System', s: (l) => l.actor_name || '' }, { h: 'Action', f: (l) => h('code', {}, l.action), s: (l) => l.action, csv: (l) => l.action },
    { h: 'Entity', f: (l) => [human(l.entity_type || ''), l.entity_id ? h('span', { class: 'muted mono' }, ' ' + short(l.entity_id)) : null], s: (l) => l.entity_type || '' },
    { h: 'Change', f: (l) => h('span', { class: 'trunc', title: JSON.stringify(l.after ?? '') }, summarize(l.after)), csv: (l) => JSON.stringify(l.after ?? '') }], a.logs,
    (l) => openDialog(l.action, h('div', {}, h('div', { class: 'kv' }, h('span', { class: 'k' }, 'When'), h('span', {}, when(l.created_at))), h('h2', {}, 'Before'), h('pre', {}, l.before == null ? '(none)' : JSON.stringify(l.before, null, 2)), h('h2', {}, 'After'), h('pre', {}, l.after == null ? '(none)' : JSON.stringify(l.after, null, 2))), { width: 640, key: 'audit' }),
    'No activity matches.', { csv: 'admin-activity', search: true }));
}
