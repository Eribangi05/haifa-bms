// Regenerates docs/ERD.md from a migrated PostgreSQL database (the schema is the source of truth, so the diagram cannot go stale).
// Usage (from rwanda-mobility/): DATABASE_URL=postgres://rm:rm@localhost:5432/rwanda_mobility node docs/tools/gen-erd.mjs
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { Pool } = createRequire(join(root, 'backend', 'package.json'))('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://rm:rm@localhost:5432/rwanda_mobility' });

const MODULES = {
  'Identity and privacy': ['users', 'user_roles', 'roles', 'role_permissions', 'otp_challenges', 'sessions', 'consents', 'privacy_requests', 'staff_invites', 'push_tokens', 'push_tickets', 'sms_opt_outs', 'ussd_phones', 'ussd_sessions'],
  'Rider': ['saved_places', 'emergency_contacts', 'passenger_driver_prefs', 'tips', 'trip_contact_notices', 'guest_messages', 'ride_schedules', 'ride_schedule_runs', 'loyalty_accounts', 'loyalty_events', 'wallet_lots', 'wallet_holds', 'wallet_txns', 'wallet_adjustments'],
  'Catalogue and pricing': ['service_categories', 'service_zones', 'zone_services', 'places', 'pricing_rules', 'commission_rules', 'fare_quotes', 'promotions', 'promotion_redemptions', 'referrals'],
  'Drivers and vehicles': ['driver_profiles', 'driver_documents', 'document_requirements', 'driver_status_history', 'vehicles', 'driver_locations', 'driver_badge_grants', 'driver_quests', 'driver_quest_awards'],
  'Abasare (own-car hire)': ['customer_vehicles', 'abasare_handovers', 'handover_photos', 'booking_deposits', 'deposit_attempts', 'claims', 'claim_events', 'claim_evidence'],
  'Fleets and business accounts': ['fleets', 'fleet_members', 'fleet_invites', 'corporate_accounts', 'corporate_members', 'corporate_invoices', 'partners', 'partner_users', 'campaigns', 'campaign_recipients'],
  'Bookings and dispatch': ['bookings', 'booking_events', 'dispatch_offers', 'trip_shares', 'trip_messages', 'ratings', 'safety_blocks', 'request_codes', 'fixed_routes'],
  'Money': ['payments', 'payment_provider_events', 'ledger_accounts', 'ledger_entries', 'driver_earnings', 'payouts', 'refunds', 'passenger_debts', 'reconciliation_runs', 'reconciliation_items'],
  'Support and safety': ['support_cases', 'case_events', 'safety_incidents', 'safety_alerts', 'support_categories', 'faq_entries'],
  'Platform': ['notifications', 'notification_templates', 'feature_flags', 'system_settings', 'audit_logs', 'client_errors', 'schema_migrations'],
};
const moduleOf = {}; for (const [m, ts] of Object.entries(MODULES)) for (const t of ts) moduleOf[t] = m;

// which migration first creates each table, and which later migrations alter it
const mig = {}, altered = {};
for (const f of readdirSync(join(root, 'backend', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  const n = f.slice(0, 3), sql = readFileSync(join(root, 'backend', 'migrations', f), 'utf8');
  for (const m of sql.matchAll(/create table (?:if not exists )?(\w+)/gi)) mig[m[1]] ??= n;
  for (const m of sql.matchAll(/alter table (?:if exists )?(\w+)/gi)) (altered[m[1]] ??= new Set()).add(n);
}
const migFiles = readdirSync(join(root, 'backend', 'migrations')).filter((x) => x.endsWith('.sql')).sort();

const cols = (await pool.query(`select table_name t, column_name c, data_type dt, udt_name u, is_nullable n, ordinal_position o from information_schema.columns where table_schema='public' order by table_name, ordinal_position`)).rows;
const pks = (await pool.query(`select tc.table_name t, kcu.column_name c from information_schema.table_constraints tc join information_schema.key_column_usage kcu using (constraint_name, table_schema) where tc.constraint_type='PRIMARY KEY' and tc.table_schema='public'`)).rows;
const fks = (await pool.query(`select cl.relname child, a.attname col, pl.relname parent, c.conname, a.attnotnull nn
  from pg_constraint c join pg_class cl on cl.oid=c.conrelid join pg_class pl on pl.oid=c.confrelid join pg_namespace ns on ns.oid=cl.relnamespace
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum = any(c.conkey) where c.contype='f' and ns.nspname='public' order by 1,2`)).rows;
const uniq = (await pool.query(`select tablename t, indexname i, indexdef d from pg_indexes where schemaname='public' and indexdef ilike 'create unique index%' and indexname not like '%\\_pkey' order by 1,2`)).rows;
const trig = (await pool.query(`select c.relname t, g.tgname n from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace s on s.oid=c.relnamespace where not g.tgisinternal and s.nspname='public' order by 1,2`)).rows;
const tables = [...new Set(cols.map((c) => c.t))].sort();
const pkSet = new Set(pks.map((p) => p.t + '.' + p.c)), fkSet = new Set(fks.map((f) => f.child + '.' + f.col));
const unknown = tables.filter((t) => !moduleOf[t]);
if (unknown.length) { console.error('Tables missing from MODULES in gen-erd.mjs:', unknown.join(', ')); process.exit(1); }

const typeOf = (c) => (c.dt === 'ARRAY' ? c.u.replace(/^_/, '') + '[]' : c.dt === 'USER-DEFINED' ? c.u : c.dt).replace('timestamp with time zone', 'timestamptz').replace('character varying', 'varchar').replace('double precision', 'float8').replace('without time zone', '').replace(/\s+/g, '_');
let out = `# Entity-relationship overview

> **Generated** from the migrated PostgreSQL schema by \`docs/tools/gen-erd.mjs\` (${tables.length} tables, ${fks.length} foreign keys, migrations 001 to ${migFiles.at(-1).slice(0, 3)}). Do not edit by hand: change a migration, run it, then regenerate:
> \`DATABASE_URL=postgres://rm:rm@localhost:5432/rwanda_mobility node docs/tools/gen-erd.mjs\`

Full DDL with checks, partial unique indexes and triggers lives in [\`backend/migrations/\`](../backend/migrations). One diagram per module showing each table's columns and its outgoing foreign keys; a table from another module appears as a bare box where a key crosses modules. Columns are marked \`PK\` / \`FK\`. The table index lists how many columns are nullable.

## Migrations

| # | File | What it adds |
|---|---|---|
`;
const WHAT = { '001': 'Core schema: identity, catalogue, pricing, drivers, bookings, payments, ledger, support, safety, audit', '002': 'Abasare: customer cars, handovers and photos, hourly/night pricing columns, driver Abasare application fields', '003': 'French names and descriptions for services and places', '004': 'Push tokens and tickets, client error reports, passenger cancellation-fee debts', '005': 'Staff invitations (single-use link, own password and authenticator)', '006': 'Request codes (venue QR codes) and `bookings.request_code_id`', '007': 'Pricing time windows (`pricing_rules.time_multipliers`), promotion audiences (`segment`, `segment_phones`)', '008': 'Audit follow-ups: indexes on hot paths, case-insensitive unique e-mail' };
for (const f of migFiles) out += `| ${f.slice(0, 3)} | \`${f}\` | ${WHAT[f.slice(0, 3)] ?? ''} |\n`;

const mid = (s) => s.replace(/\W+/g, '_');
for (const [m, ts] of Object.entries(MODULES)) {
  const list = ts.filter((t) => tables.includes(t)); if (!list.length) continue;
  out += `\n## ${m}\n\n\`\`\`mermaid\nerDiagram\n`;
  const rels = fks.filter((f) => list.includes(f.child));   // outgoing keys of this module's tables; other modules show as bare boxes
  const seen = new Set();
  for (const f of rels) { const k = `${f.parent}|${f.child}|${f.col}`; if (seen.has(k)) continue; seen.add(k); out += `  ${f.parent} ${f.nn ? '||' : '|o'}--o{ ${f.child} : "${f.col}"\n`; }
  for (const t of list) {
    out += `  ${t} {\n`;
    for (const c of cols.filter((x) => x.t === t)) out += `    ${typeOf(c)} ${mid(c.c)}${pkSet.has(t + '.' + c.c) ? ' PK' : fkSet.has(t + '.' + c.c) ? ' FK' : ''}\n`;
    out += '  }\n';
  }
  out += '```\n';
}
out += `\n## Table index\n\n| Table | Module | Since | Columns | Notes |\n|---|---|---|---|---|\n`;
for (const t of tables) {
  const cs = cols.filter((c) => c.t === t), alt = [...(altered[t] ?? [])].filter((n) => n !== (mig[t] ?? '001'));
  out += `| \`${t}\` | ${moduleOf[t]} | ${mig[t] ?? '001'} | ${cs.length} | ${alt.length ? 'altered in ' + alt.join(', ') : ''}${cs.some((c) => c.n === 'YES') ? (alt.length ? '; ' : '') + cs.filter((c) => c.n === 'YES').length + ' nullable' : ''} |\n`;
}
out += `\n## Unique and partial unique indexes (business rules the database enforces)\n\n| Table | Index | Definition |\n|---|---|---|\n`;
for (const u of uniq) out += `| \`${u.t}\` | \`${u.i}\` | \`${u.d.replace(/^CREATE UNIQUE INDEX \w+ ON public\./i, '').replace(/\|/g, '\\|')}\` |\n`;
out += `\n## Triggers\n\n| Table | Trigger |\n|---|---|\n`;
for (const g of trig) out += `| \`${g.t}\` | \`${g.n}\` |\n`;
out += `
## Notable guarantees

* \`ledger_balanced\` (deferred constraint trigger): sum(debit) = sum(credit) per \`txn_id\`; \`ledger_immutable\` and \`audit_immutable\` reject UPDATE and DELETE.
* One active trip per driver and per vehicle, one open request per passenger, one live payment per booking, one active vehicle per driver (partial unique indexes above).
* \`bookings (passenger_id, idempotency_key)\`, \`payments.reference\`, \`driver_earnings.booking_id\` and \`passenger_debts.booking_id\` (one cancellation-fee debt per cancelled trip) are unique; staff e-mail is unique case-insensitively (\`users_email_lower_uniq\`).
* Phone check \`^\\+250[0-9]{9}$\`; money columns are integers (RWF) with \`>= 0\` checks; request codes match \`^[A-HJ-NP-Z2-9]{6,8}$\`.
`;
writeFileSync(join(root, 'docs', 'ERD.md'), out);
console.log(`docs/ERD.md written: ${tables.length} tables, ${fks.length} foreign keys, ${uniq.length} unique indexes`);
await pool.end();
