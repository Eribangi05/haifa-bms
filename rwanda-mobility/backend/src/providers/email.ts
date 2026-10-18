import { config } from '../config.js';

export interface EmailProvider { send(to: string, subject: string, text: string): Promise<void>; }

/** Dev adapter: keeps messages in memory (tests) and logs outside production. */
export const emailOutbox: { to: string; subject: string; text: string }[] = [];
const consoleEmail: EmailProvider = {
  async send(to, subject, text) {
    emailOutbox.push({ to, subject, text });
    if (emailOutbox.length > 200) emailOutbox.shift();
    if (process.env.NODE_ENV !== 'production' && process.env.QUIET !== '1') console.log(`[email:dev] -> ${to}: ${subject}: ${text}`);
  },
};
/** Generic HTTPS gateway adapter (PENDING INTEGRATION: map to your email service's real request format). */
const httpEmail: EmailProvider = {
  async send(to, subject, text) {
    const r = await fetch(config.emailHttpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.emailHttpToken}` },
      body: JSON.stringify({ from: config.emailFrom, to, subject, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`email gateway ${r.status}`);
  },
};
export const email: EmailProvider = config.emailProvider === 'http' ? httpEmail : consoleEmail;
