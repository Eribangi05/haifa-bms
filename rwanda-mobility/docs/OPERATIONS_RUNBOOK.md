# Operations runbook

For the engineer on call. Business-side routines (reconciliation, payouts, support cases) are in [`SUPPORT_OPERATIONS_GUIDE.md`](SUPPORT_OPERATIONS_GUIDE.md); the SOS procedure for responders is in [`EMERGENCY_RESPONSE_PLAYBOOK.md`](EMERGENCY_RESPONSE_PLAYBOOK.md); every variable is in [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

> **How this was checked.** The SQL below was run against the development schema (migrations 001 to 008). The `docker compose` commands, the Render dashboard steps and the provider-portal steps (MTN, SMS aggregator, Expo) were written from the configuration files and the providers' documented behaviour and **have not been run against a real deployment**. Provider and Render screens change: treat their steps as a guide and check the provider's current documentation. Run every restore at least once in a scratch environment before you need it.

Commands assume `psql "$DATABASE_URL"` reaches the production database (on the compose stack: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db psql -U rm -d rwanda_mobility`; on Render use the database's *External connection string*, or the dashboard shell). `DC` below means `docker compose -f deploy/docker-compose.yml --env-file deploy/.env`.

## 1. Daily checks (10 minutes)

1. **Is it up?** `curl -fsS https://<api>/health` returns `{"ok":true,...}`; `curl -fsS https://<api>/ready` returns `{"ready":true}` (this one also proves the database answers). Both are public.
2. **Console overview** (Operations console -> Overview, last 7 days): look at *Needs attention*; payment success rate under about 85% and a rising *no driver found* count are the early warnings.
3. **Stuck money** (should all return zero rows):
   ```sql
   -- online payments still waiting after 15 minutes (the sweeper re-checks the provider every 30 s)
   select reference, method, status, amount, created_at from payments where status in ('INITIATED','PENDING') and method <> 'cash' and created_at < now() - interval '15 minutes';
   -- unresolved reconciliation differences
   select count(*) from reconciliation_items where not resolved;
   -- ledger must balance: this returns 0
   select coalesce(sum(debit) - sum(credit), 0) as imbalance from ledger_entries;
   ```
4. **Messages leaving?**
   ```sql
   select channel, status, count(*) from notifications where created_at > now() - interval '24 hours' group by 1, 2 order by 1, 2;   -- 'failed' or a growing 'queued' = gateway problem
   select count(*) as unchecked_push_receipts from push_tickets where checked_at is null and created_at < now() - interval '15 minutes';
   ```
5. **Safety and support**: open the *Safety* page (no incident left `open` longer than minutes) and *Support* (overdue cases). Overview shows both as counts.
6. **Client crashes**: `GET /admin/client-errors` (needs a token with `diagnostics.view`; there is no console page for it yet). A sudden spike after an app release means a bad build.
7. **Backups and disk**: confirm last night's backup exists and is recent (section 2); check free disk on the database and on the documents volume (`df -h`, or the Render disk graph); check the TLS certificate is not close to expiry (Caddy renews automatically; Render manages it).
8. **Logs**: search for `"level":50` (errors). A 500 shown to a user ends with `Reference: <id>`: that id is the log `reqId`.

Weekly: restore the latest backup into a scratch database and run the ledger query above; review staff accounts (Staff page) and disable leavers; review Audit log for `staff.*`, `user.status`, `settings.*`, `pricing.*` entries you do not recognise.

## 1b. Last drills (9 Oct 2026, local PostgreSQL 16, compiled server)

* **Load**: `backend/scripts/loadtest.ts --duration 15 --concurrency 20`: health 362 req/s (p95 9 ms), config 362 req/s (p95 49 ms), estimate p95 59 ms; the per-user and per-IP limits answered 429 as designed once exceeded (OTP and estimate). A free Render instance has far less CPU than this machine: repeat the drill on the real service before launch and note the first thing that slows down (usually the database connection pool).
* **Restore**: `scripts/restore-test.sh`: dump, restore into a scratch database, compare every table: 101 tables, identical row counts. Run it weekly on the real database.

## 2. Backup and restore (PostgreSQL and uploaded documents)

What must be backed up: **the database**, **the documents volume** (`STORAGE_DIR`: driver documents, evidence, Abasare car-check photos; files, not database rows) and **`DATA_ENC_KEY`** (stored separately in your password manager: without it encrypted national IDs, emergency contacts and staff authenticator secrets in a restored database are unreadable).

### Docker Compose stack

```bash
deploy/backup.sh /srv/backups          # db-<time>.dump (pg_dump custom format) + storage-<time>.tgz; keeps 14 days locally
# cron (01:30 daily):  30 1 * * * cd /srv/rwanda-mobility && deploy/backup.sh /srv/backups
# then copy /srv/backups OFF the host (object storage / another server); a backup on the same disk is not a backup.
```

### Render or any managed PostgreSQL

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner -f db-$(date -u +%Y%m%dT%H%M%SZ).dump
```
Paid Render databases also keep their own daily backups and point-in-time recovery; restoring one creates a new database: point `DATABASE_URL` at it and redeploy. The free database has no usable backup: dump it yourself and remember it expires after 30 days.

### Restore (always into a scratch database first)

```bash
createdb rwanda_mobility_restore
pg_restore --no-owner --dbname=rwanda_mobility_restore db-<time>.dump
psql rwanda_mobility_restore -c "select coalesce(sum(debit)-sum(credit),0) as imbalance from ledger_entries" \
                             -c "select count(*) as bookings from bookings" -c "select max(created_at) as newest from bookings"
```
Production restore on the compose stack (downtime: minutes):
```bash
$DC stop api
$DC exec -T db psql -U rm -d postgres -c "drop database rwanda_mobility" -c "create database rwanda_mobility owner rm"
$DC exec -T db pg_restore -U rm -d rwanda_mobility --no-owner < /srv/backups/db-<time>.dump
$DC up -d api          # migrations re-run on start and do nothing if the schema is current
# only if the documents volume was lost too (the archive holds a top-level storage/ folder):
$DC exec -T api tar -C /data -xzf - < /srv/backups/storage-<time>.tgz
```
After any restore: run the stuck-money queries from section 1, sign in to the console, open a recent booking and a driver's documents (links must open), and tell finance that payments after the backup time must be re-checked against the MTN report (Finance -> Reconciliation).

## 3. Rotating secrets

General rule: change the value in the secret manager (Render dashboard -> Environment; `deploy/.env` on compose), redeploy (`$DC up -d api`), check `/ready`, then verify the thing the secret protects. Never put a secret in git, a chat or a ticket. Keep the four app secrets different from each other (the server warns otherwise).

| Secret | Effect of changing it | Procedure |
|---|---|---|
| `JWT_SECRET` | Access tokens signed with the old value are rejected (HTTP 401) and OTP codes issued in the last 5 minutes stop working. Refresh tokens are random values stored hashed in `sessions`, not JWTs, so **nobody is signed out**: the app and the console refresh silently and carry on. | Generate `openssl rand -base64 48`, set, redeploy. To also **force everyone to sign in again** (the secret leaked): `update sessions set revoked_at = now() where revoked_at is null;` |
| `FILE_SIGNING_SECRET` | Only open document links (5-minute lifetime) stop working. Safe at any time. | Set, redeploy. |
| `PIN_SECRET` | Trip PINs are derived from the booking id and this secret, never stored: trips already in progress show a **different PIN** to passenger and driver after the change (both read the same new value, but a PIN already read out loud no longer matches). | Rotate when no trip is in progress, or accept that open trips use the dispatcher *PIN override* (audited). |
| `DATA_ENC_KEY` | **There is no key versioning and no re-encryption tool.** Changing the value makes every existing encrypted value unreadable: staff authenticator secrets (every staff member needs an MFA reset), driver national ID and emergency contacts. | Rotate only if the key leaked, and plan it: (1) take a backup; (2) write a one-off script that reads the columns `users.mfa_secret_enc`, `staff_invites.pending_mfa_enc`, `driver_profiles.national_id_enc`, `driver_profiles.emergency_contact_enc` with the old key (`decrypt()` in `src/util/crypto.ts`) and rewrites them with the new key (`encrypt()`), inside one transaction; (3) run it, then deploy the new key. If you only need to recover from a leaked key, also revoke all staff sessions. This script does not exist yet: it is a gap listed in `AUDIT_ADMIN_DOCS.md`. |
| `MOMO_CALLBACK_TOKEN` | The callback URL carries `?token=`; callbacks sent with the old token are rejected. Nothing is lost: a payment that never gets its callback is picked up by the 30-second payment sweeper, which asks MTN for the status. | Set a new value (16+ characters), redeploy, and check one test payment settles. |
| `MOMO_API_KEY`, `MOMO_SUBSCRIPTION_KEY` | Collections calls fail until the new values are in. | Generate the new key in the MTN MoMo developer portal (subscription key: regenerate the *secondary* key, deploy it, then regenerate the primary; API key: create a new key for the API user), set, redeploy, watch the next payment. Keep the old value until the new one works. |
| `SMS_HTTP_TOKEN` | OTP and critical SMS fail until updated: users cannot sign in. | Create the new token at the aggregator, set, redeploy, request an OTP for your own number. Do it during a quiet hour. |
| `EXPO_ACCESS_TOKEN` | Push delivery fails until updated (in-app notifications and SMS for critical events still work). | Create a new token in your Expo account, set, redeploy, send yourself a push (e.g. a driver offer on a test device). |
| Database password | The API cannot connect until `DATABASE_URL` matches. | Compose: `$DC exec db psql -U rm -d rwanda_mobility -c "alter user rm password 'NEW'"`, edit `DB_PASSWORD` in `deploy/.env`, `$DC up -d api` (the volume remembers the old password, so changing only the env file does not work). Render: rotate in the database settings and redeploy. |
| A staff member's password | No self-service reset exists on purpose. | See section 4 ("Reset a password"). |

## 4. Staff accounts

**Create** (normal path, no engineer needed): console -> Staff -> *Invite staff member*. The invitee gets a one-time link, chooses a 12+ character password and enrols their own authenticator. The link expires and can be revoked under *Pending invitations*.

**Disable a leaver**: Staff -> *Disable* (reason is audited), then *Revoke sessions* to end any open session. *Enable* reverses it. Both are in the audit log (`staff.sessions_revoked`, `user.status`).

**Reset a staff member's authenticator** (lost phone; also the way back in if the only super admin lost theirs). Uses the recovery variables:
1. Set both `ADMIN_MFA_RESET_EMAIL=<their email>` and `ADMIN_MFA_RESET_TOKEN=<any text of 8+ characters>` on the service and redeploy.
2. On start the server generates a new authenticator secret for that account (only accounts with a staff role; passengers and drivers are refused) and logs it **once**: search the logs for `STAFF MFA RESET`. Copy the secret and the `otpauth://` line, give them to the person over a private channel, and have them add it to their authenticator app.
3. It runs only once per distinct token value. **Remove both variables afterwards** and redeploy. Old authenticator codes stop working immediately; their password is unchanged.
4. Check the audit log for `staff.mfa_reset`, and use *Revoke sessions* if you suspect the old phone was in someone else's hands.

**Reset a password** (forgotten or compromised). Run on the server or in a one-off container, from `backend/`; it sets the new password and a new authenticator secret together and prints the secret, so deliver both over private channels and have the person change nothing else:
```bash
NEW_PASSWORD='a-long-random-passphrase' STAFF_EMAIL='person@company.rw' STAFF_ROLE='support_agent' \
node --import tsx --input-type=module -e "
import { createStaff } from './src/seed.ts'; import { pool } from './src/db.ts';
const a = await createStaff(process.env.STAFF_EMAIL, process.env.NEW_PASSWORD, process.env.STAFF_ROLE, process.env.STAFF_EMAIL);
console.log('New authenticator secret (give it to the person once):', a.totpSecret); await pool.end();"
# compose:  $DC exec -e NEW_PASSWORD=... -e STAFF_EMAIL=... -e STAFF_ROLE=... api node --import tsx --input-type=module -e "..."
```
The role you pass is **added** (existing roles stay). Then Staff -> *Revoke sessions* for that person.

**First super admin**: set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (12+ characters) before the first start; the secret is logged once (`FIRST SUPER ADMIN CREATED`). It never overwrites an existing admin. Remove the password afterwards.

## 4a. Staff lifecycle (console: Staff tab)

All of this is in the console under **Staff** (needs `users.manage`, which only a super admin holds by default). Every action asks for a reason where it is destructive and is written to the audit log.

- **Add**: Staff > Invite staff member. Pick a role (built-in or custom). Send the one-time link (valid 48 h) to the person only. They choose their password and scan their own authenticator QR; you never see either. Lost link: Pending invitations > New link (the old link dies).
- **Change role**: open the person > Change roles. A person may hold several roles. They are signed out and sign in with exactly the new access. Changes to a role's permissions (Roles and permissions tab) apply on the holder's next click.
- **Edit name or email**: open the person > Edit. Changing the email signs them out everywhere. You cannot change your own roles, status or email, or remove yourself: ask another administrator.
- **Disable / enable**: temporary. Disabling ends all sessions at once.
- **Remove**: open the person > Remove from staff (reason required). Sessions, password and two-factor are deleted, the person disappears from the default list (Status filter > Removed shows them), audit history stays, and the stored email is renamed `...#removed-xxxx` so the same address can be invited again. **Anonymise personal data** (removed people only) replaces name and email permanently; audit rows are append-only and stay.
- **Recover access**: open the person > **Send password reset** (they still have their authenticator), **Reset two-factor** (lost phone, they still know the password; open sessions end immediately) or **Full reset** (lost both). You get a single-use link; the person completes it on their own device and the new authenticator key is shown only to them. Never paste a link into a shared channel.
- **Break-glass**: if no super admin can sign in, use `ADMIN_MFA_RESET_EMAIL` / `ADMIN_MFA_RESET_TOKEN` (section 4) on the server.
- **Safeguards** (enforced by the API): the last active super admin cannot be removed, disabled or demoted (also under concurrent requests); only a super admin can create, change, disable, remove or reset a super admin or edit built-in roles; nobody can give a role (or permission) wider than their own access or manage someone with wider access.

## 5. Deploying and rolling back

Every start applies pending SQL migrations (`schema_migrations`) and re-runs the idempotent catalogue seed, so a deploy is one step. Migrations so far are additive (new tables, columns and indexes): the previous version of the code keeps working on the new schema, which is what makes a code-only rollback safe. **Before any deploy that contains a new migration, take a backup.** A migration that drops or rewrites data cannot be undone by rolling back the code: restore from the backup instead.

**Render** (staging blueprint `render.yaml`):
1. *Roll back*: Dashboard -> `abasare-api` -> Events/Deploys -> pick the last good deploy -> *Rollback* (Render re-deploys that exact image). Render may switch auto-deploy off after a rollback: check Settings -> Build & Deploy and leave it off until the fix is merged. Check `/ready` and one booking in the console.
2. *Roll forward without Git*: Manual Deploy -> *Deploy a specific commit*.
3. For production set `autoDeploy: false` in the blueprint, deploy by hand after CI is green.

**Docker Compose**:
```bash
git fetch && git checkout <good-tag-or-commit>
$DC up -d --build api
$DC logs --tail=100 api && curl -fsS https://<api>/ready
```
Tag every release (`git tag v0.5.1`) and keep the previous image: `docker tag <compose-image> abasare-api:previous` before building. If a new migration is the problem, `$DC stop api`, restore the pre-deploy database dump (section 2), check out the old code, start.

**App releases** cannot be rolled back on devices: the API must stay compatible with the previous app version for at least one release (additive changes only), and a bad build is fixed by shipping a new one (Play Console staged rollout lets you halt it).

## 6. Incident: payments

| Symptom | What to do |
|---|---|
| Passengers report "paid but unpaid" / payments stuck `PENDING` | Console -> Finance -> Transactions: search the reference. The sweeper re-queries MTN every 30 s; wait two sweeps. If MTN says success and we say failed, it is a *late success*: it appears under Finance -> Reconciliation -> *Payment exceptions*. Confirm in the MTN portal, never from a screenshot, then settle through a documented refund or adjustment (maker-checker). |
| MTN is down or slow (many `FAILED(timeout)`) | Keep trips running on cash: Settings -> feature flags -> switch **`payments.mtn_momo` off** (customers then see cash only; trips in progress are unaffected). Announce in the app channel, switch the flag back on when a test payment succeeds. |
| Callbacks not arriving | Check `MOMO_CALLBACK_URL` equals `PUBLIC_BASE_URL` + `/api/v1/webhooks/payments/mtn_momo`, that the token matches `MOMO_CALLBACK_TOKEN`, and the logs for `bad callback credentials` (401). The sweeper still settles payments, only later. |
| Wrong amount taken / duplicate charge | Do **not** edit rows. Request a refund from the booking (support lead or finance officer), a different person approves (finance approver). The ledger keeps both entries. Note the payment reference for the MTN dispute. |
| **Ledger imbalance** (Finance -> Ledger and exports shows a red banner, or the SQL in section 1 is not 0) | Stop approving payouts. The database refuses unbalanced transactions at commit, so this means a bug or manual SQL: take a backup, export `ledger` CSV (Finance -> Ledger and exports) and escalate to the developers with the time it first appeared. |
| Payout paid twice / wrong MoMo number | Payout status is final once *Paid*: contact MTN to recall, record a driver adjustment (`POST /admin/finance/adjustments`, above 100,000 RWF needs a super admin). |
| `MOMO_MODE=simulator` in production | The server logs a warning at start. Real customers would be "paying" with fake money: fix `MOMO_MODE` immediately and reconcile every payment since. |

## 7. Incident: SOS

The app records and alerts; it never claims police or an ambulance were called. A person must do that and write it down.
1. **Receiving**: an SOS creates an urgent safety incident, an urgent support case and an SMS to every number in Settings -> *Safety escalation contacts*. The responder follows [`EMERGENCY_RESPONSE_PLAYBOOK.md`](EMERGENCY_RESPONSE_PLAYBOOK.md): console -> Safety -> *Acknowledge*, call the user, call 112 / the right agency themselves, then *Resolve* with what was actually done.
2. **Nobody acknowledged within minutes?** Check that the escalation contacts are set and that SMS is flowing: `select status, count(*) from notifications where channel = 'sms' and created_at > now() - interval '1 hour' group by 1;`. If the SMS gateway is down, phone the duty responder directly and use the on-call phone tree.
3. **Locate**: the incident row has `lat`/`lng`; the Safety page links to the position on a map. The live trip is on the Live map page.
4. **Afterwards**: keep the incident open until the resolution text is complete; add a safety block (driver and passenger) via `POST /admin/safety-blocks` if needed; suspend the driver pending review (Drivers -> Suspend, reason required).
5. **Drill** the whole path monthly with a test SOS on a staging account and record the time to acknowledge.

## 8. Monitoring suggestions

The service exposes only `/health` and `/ready` and writes JSON logs (pino) to stdout: there is no metrics endpoint. A pilot-level setup:
* **Uptime**: an external check on `/ready` every minute (UptimeRobot, Better Stack, a cron on another host) alerting by SMS or WhatsApp.
* **Logs**: ship stdout to a log service; alert on `level >= 50`, on repeated `unhandled rejection`, `bad callback credentials` and `config:` warnings after a deploy.
* **Business alarms** (a cron that runs these queries and messages you on any non-zero result): stuck online payments (section 1), `notifications` with `status = 'failed'`, `select count(*) from safety_incidents where status = 'open' and created_at < now() - interval '10 minutes'`, `select count(*) from support_cases where sla_due_at < now() and status in ('open','in_progress','awaiting_user')`, drivers waiting for verification over 48 h, the ledger imbalance query.
* **Capacity**: database connections (`DB_POOL_MAX` per instance), database disk, documents volume, and p95 latency from the load balancer. One instance is supported today because jobs run in-process (`SETUP_AND_DEPLOYMENT.md`, section 5).
* **Release health**: `/admin/client-errors` count per day by app version.
* **Costs and abuse**: provider-side spend caps on SMS (OTP pumping is only rate limited in the app), alerts on OTP request spikes.
