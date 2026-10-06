import { config } from '../config.js';

export interface SmsProvider { send(to: string, text: string): Promise<void>; }

/** Dev adapter: logs only. Records messages in memory for tests. NEVER logs in production. */
export const outbox: { to: string; text: string }[] = [];
const consoleSms: SmsProvider = {
  async send(to, text) {
    outbox.push({ to, text });
    if (outbox.length > 200) outbox.shift();
    if (process.env.NODE_ENV !== 'production' && process.env.QUIET !== '1') console.log(`[sms:dev] -> ${to}: ${text}`);
  },
};
/** Generic HTTPS gateway adapter (PENDING INTEGRATION: map to your SMS aggregator's real request format). */
const httpSms: SmsProvider = {
  async send(to, text) {
    const r = await fetch(config.smsHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.smsHttpToken}` },
      body: JSON.stringify({ to, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`sms gateway ${r.status}`);
  },
};
export const sms: SmsProvider = config.smsProvider === 'http' ? httpSms : consoleSms;
