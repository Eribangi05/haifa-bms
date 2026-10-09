// Documentation and delivery checks (no dependencies). Run from anywhere: node docs/tools/check-docs.mjs
//  1. every relative markdown link resolves to a file (and a #heading that exists)
//  2. every file in docs/ and store/ is linked from README.md
//  3. environment variables: code <-> docs/ENVIRONMENT_VARIABLES.md <-> backend/.env.example <-> render.yaml <-> deploy/.env.example
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p) => relative(root, p);
const problems = [];
const bad = (m) => problems.push(m);

const walk = (d, out = []) => { for (const f of readdirSync(d)) { if (['node_modules', '.git', 'android', 'dist', 'build'].includes(f)) continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const mds = [join(root, 'README.md'), ...walk(join(root, 'docs')).filter((f) => f.endsWith('.md')), ...walk(join(root, 'store')).filter((f) => f.endsWith('.md'))];

// ---- 1. links ----
const slug = (h) => h.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const anchors = (file) => { const set = new Set(); let fence = false; for (const l of readFileSync(file, 'utf8').split('\n')) { if (/^```/.test(l)) fence = !fence; const m = !fence && /^#{1,6}\s+(.*)$/.exec(l); if (m) set.add(slug(m[1])); } return set; };
let links = 0;
for (const f of mds) {
  let fence = false;
  for (const [i, line] of readFileSync(f, 'utf8').split('\n').entries()) {
    if (/^```/.test(line)) fence = !fence; if (fence) continue;
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = m[1]; if (/^(https?:|mailto:|tel:)/.test(href)) continue; links++;
      const [path, hash] = href.split('#'); const target = path ? resolve(dirname(f), decodeURIComponent(path)) : f;
      if (!existsSync(target)) { bad(`${rel(f)}:${i + 1} broken link: ${href}`); continue; }
      if (hash && target.endsWith('.md') && !anchors(target).has(hash.toLowerCase())) bad(`${rel(f)}:${i + 1} missing heading anchor: ${href}`);
    }
  }
}
// ---- 2. README coverage ----
const readme = readFileSync(join(root, 'README.md'), 'utf8');
for (const f of mds.filter((x) => x !== join(root, 'README.md'))) if (!readme.includes(rel(f).replace(/\\/g, '/'))) bad(`README.md does not link ${rel(f)}`);

// ---- 3. environment variables ----
const codeVars = new Set();
for (const f of walk(join(root, 'backend', 'src')).filter((x) => x.endsWith('.ts'))) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|\benv\.([A-Z][A-Z0-9_]+)|env\[['"]([A-Z][A-Z0-9_]+)['"]\]|secret\('([A-Z][A-Z0-9_]+)'|routeLimit\('([A-Z][A-Z0-9_]+)'/g)) codeVars.add(m[1] || m[2] || m[3] || m[4] || m[5]);
}
codeVars.delete('NODE_ENV'); codeVars.add('NODE_ENV');
const docText = readFileSync(join(root, 'docs', 'ENVIRONMENT_VARIABLES.md'), 'utf8');
const docVars = new Set([...docText.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((m) => m[1]).filter((v) => !/^(EXPO_PUBLIC_|RM_)/.test(v)));
const INFRA = new Set(['DB_PASSWORD', 'API_DOMAIN', 'EAS_PROJECT_ID', 'EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_ALLOW_CLEARTEXT', 'NODE_VERSION']);   // used by compose / the mobile and web builds, not by backend/src
for (const v of codeVars) if (!docVars.has(v)) bad(`env var ${v} is used in backend/src but not documented in docs/ENVIRONMENT_VARIABLES.md`);
const settingKeys = /^[a-z]+\.[a-z_*]+$/;
const keysOf = (file, re) => (existsSync(file) ? [...readFileSync(file, 'utf8').matchAll(re)].map((m) => m[1]) : []);
const check = (label, vars) => { for (const v of vars) if (!codeVars.has(v) && !INFRA.has(v)) bad(`${label} sets ${v}, which backend/src never reads`); };
check('backend/.env.example', keysOf(join(root, 'backend', '.env.example'), /^([A-Z][A-Z0-9_]+)=/gm));
check('deploy/.env.example', keysOf(join(root, 'deploy', '.env.example'), /^([A-Z][A-Z0-9_]+)=/gm));
check('render.yaml', keysOf(resolve(root, '..', 'render.yaml'), /key:\s*([A-Z][A-Z0-9_]+)/g));
check('deploy/docker-compose.yml', keysOf(join(root, 'deploy', 'docker-compose.yml'), /^\s{6}([A-Z][A-Z0-9_]+):/gm));
// production must-haves present in the blueprint and the compose example
for (const v of ['JWT_SECRET', 'DATA_ENC_KEY', 'PIN_SECRET', 'FILE_SIGNING_SECRET', 'PUBLIC_BASE_URL', 'DATABASE_URL']) {
  if (!keysOf(resolve(root, '..', 'render.yaml'), /key:\s*([A-Z][A-Z0-9_]+)/g).includes(v)) bad(`render.yaml does not set required ${v}`);
  if (v !== 'DATABASE_URL' && !keysOf(join(root, 'deploy', '.env.example'), /^([A-Z][A-Z0-9_]+)=/gm).includes(v)) bad(`deploy/.env.example does not list required ${v}`);
}
// settings keys documented
const cfg = readFileSync(join(root, 'backend', 'src', 'config.ts'), 'utf8');
const settings = [...cfg.matchAll(/^\s*'([a-z]+\.[a-z_]+)':/gm)].map((m) => m[1]);
for (const k of settings) if (!docText.includes('`' + k + '`') && !docText.includes('`' + k.split('.')[0] + '.*`')) bad(`runtime setting ${k} is not listed in docs/ENVIRONMENT_VARIABLES.md`);

if (problems.length) { console.error(problems.map((p) => 'FAIL ' + p).join('\n')); console.error(`\n${problems.length} problem(s) in ${mds.length} markdown files`); process.exit(1); }
console.log(`docs OK: ${mds.length} markdown files, ${links} relative links, ${codeVars.size} backend env vars, ${settings.length} runtime settings checked`);
