// Interactive USSD simulator: talks to a local server's /ussd/callback exactly like an aggregator would.
//   USSD_SHARED_SECRET=... npx tsx scripts/ussd-sim.ts --phone +250788123456 [--url http://localhost:8080/ussd/callback] [--mode at|json] [--code '*123#']
// Type the digits you would press. Empty line on the first prompt starts a new dialogue; "q" quits; "new" starts again with the same phone.
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8080/ussd/callback');
const phone = arg('phone', '+250788123456');
const mode = arg('mode', 'at') as 'at' | 'json';
const code = arg('code', '*123#');
const secret = process.env.USSD_SHARED_SECRET ?? arg('secret', '');
if (!secret) { console.error('Set USSD_SHARED_SECRET (the same value the server uses) or pass --secret.'); process.exit(1); }

let sessionId = `SIM_${randomUUID().slice(0, 8)}`;
let inputs: string[] = [];

async function send(input: string | null): Promise<{ text: string; end: boolean }> {
  if (input !== null) inputs.push(input);
  const text = inputs.join('*');
  if (mode === 'json') {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ussd-secret': secret },
      body: JSON.stringify({ session_id: sessionId, phone, service_code: code, input, text, new_session: input === null }) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`);
    return { text: j.message, end: !!j.end };
  }
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-ussd-secret': secret },
    body: new URLSearchParams({ sessionId, serviceCode: code, phoneNumber: phone, text }).toString() });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${body}`);
  return { text: body.replace(/^(CON|END) /, ''), end: body.startsWith('END') };
}
const show = (s: { text: string; end: boolean }) => {
  const line = '-'.repeat(34);
  console.log(`\n${line}\n${s.text}\n${line}  [${s.text.length}/160 chars] ${s.end ? '(session ended)' : ''}`);
};

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`USSD simulator: ${mode} mode, phone ${phone}, session ${sessionId}\n${url}`);
let cur = await send(null); show(cur);
for (;;) {
  if (cur.end) { console.log('Dialogue closed by the network. Type "new" to dial again or "q" to quit.'); }
  let a: string;
  try { a = (await rl.question('> ')).trim(); } catch { break; }   // stdin closed
  if (a === 'q') break;
  if (a === 'new' || cur.end && a === '') { sessionId = `SIM_${randomUUID().slice(0, 8)}`; inputs = []; cur = await send(null); show(cur); continue; }
  try { cur = await send(a); show(cur); } catch (e: any) { console.error(e.message); }
}
rl.close();
