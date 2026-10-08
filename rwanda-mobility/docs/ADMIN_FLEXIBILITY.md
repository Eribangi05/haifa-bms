# Admin flexibility: staff, roles and configuration

Owner's request: "staff roles are not editable, removing/deleting staff is not possible; the admin should have enough flexibility to manage the app and staff."
The console is English-only internal tooling; anything sent to end users stays rw/fr/en and is never mixed (the FAQ editor refuses to publish unless all three languages are written).

## Progress log

| Item | Status |
|---|---|
| 1. Staff management (list/filter, edit name/email/roles, disable/enable, remove, anonymise, resend invite, password / two-factor / full reset links, sessions, last login, activity) | DONE, API tests `tests/staff_admin.test.ts`, browser `scripts/admin-staff-e2e.ts` |
| 2. Data-driven roles and permissions (DB-backed RBAC, catalogue, custom roles, editor, server-provided permissions to the console) | DONE, `tests/roles.test.ts` |
| 3. Places (CSV import, map pick), zones (circle/polygon), document rules, FAQ, support categories/SLA, feature flags page, notification wording, admin activity | DONE, `tests/admin_config.test.ts` + browser |
| 4. Tests, e2e scripts updated (`admin-audit-e2e` tab list, `admin-console-e2e` mirror check replaced) | DONE |
| 5. Docs (runbook section 4a, support guide, this page, generated API/permission docs) | DONE |

## How roles and permissions are stored

- Tables `roles` (name, label, description, `builtin`, `is_staff`, `customized`) and `role_permissions` (migration 001 + 017). The permission catalogue (key, group, plain-English description) is `src/permissions.ts`; a test fails if a route demands a permission missing there.
- `src/services/rolesStore.ts` loads the map with a 15 s in-process cache (`RBAC_CACHE_MS`) and is refreshed immediately on every role change (other server instances follow within the TTL). Roles are re-read from the database on **every authenticated request**, so a role change or removal applies at once; role changes also revoke the person's sessions.
- Built-in roles use the defaults in `src/rbac.ts` until a super admin edits them (`customized = true`); "Reset to defaults" restores them. If the tables cannot be read, the static defaults apply. `super_admin` is always `*` and immutable, `partner_manager` is fixed.
- Sign-in, token refresh and `GET /users/me` return the caller's effective `permissions`; `admin-web/core.js` uses them (`S.perms`) and re-syncs every 20 s, so there is no static copy that can drift. The API re-checks every request regardless.

## Safeguards (all tested)

Self-protection (no own roles/status/email change, removal, reset); last active super admin locked with row locks; super-admin-only operations; no granting wider access than one holds; super-only permissions (`users.manage`, `roles.manage`, `settings.manage`, `audit.view`, `requirements.manage`, `support.configure`) cannot be handed out by non-super role editors; mandatory reason on destructive actions; admin responses for invites/resets contain only the link (never an authenticator key); wrong codes on reset links count toward the 5-try lock-out; removed accounts cannot be edited, enabled or reset; last active zone cannot be disabled; each vehicle type keeps at least one mandatory document; safety support category stays protected.

## New permissions

`roles.manage`, `places.manage` and `zones.manage` (business_manager), `faq.manage` (support_lead), `requirements.manage`, `support.configure`. Only super_admin holds the administration ones by default.

## Skipped or decided

- No hard delete of staff, places or zones (soft removal/disable only; history must stay). No "restore removed staff": re-invite instead (the email is freed).
- Support categories: the category list itself stays fixed (database check constraint on `support_cases.category`); only priority, deadline and sensitivity are editable. SOS cases keep their fixed 15-minute deadline.
- Driver document types are limited to the nine types the upload endpoint accepts; new document kinds need a code change.
- Anonymisation cannot scrub the audit log (append-only by design); audit entries therefore store masked emails only.
- Feature-flag descriptions are not editable in the console.
- Owner decisions: whether `faq.manage` should stay with support_lead; whether HR-style delegates (custom role with `users.manage`) are wanted at all (today only a super admin may grant it).
