import { DIAL_CODES } from './countries.js';

/** Normalise Rwandan mobile numbers to +250XXXXXXXXX. Accepts 07XXXXXXXX, 2507XXXXXXXX, +2507XXXXXXXX, 7XXXXXXXX. Used where only a Rwandan number makes sense (mobile-money payout numbers, USSD). */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[\s\-().]/g, '');
  let m = d.match(/^(?:\+?250|0)?(7[2389]\d{7})$/);   // 072/073 Airtel, 078/079 MTN (prefix list configurable here)
  return m ? `+250${m[1]}` : null;
}

const DIALS = [...new Set(DIAL_CODES.map(([, d]) => d))].sort((a, b) => b.length - a.length);
/** Is this "+<country code><number>" a plausible international number? The calling code must exist and the whole number is 8 to 15 digits (E.164). */
export function isInternationalPhone(e164: string): boolean {
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return false;
  const digits = e164.slice(1); const dial = DIALS.find((d) => digits.startsWith(d)); if (!dial) return false;
  const national = digits.length - dial.length; return national >= 4 && national <= 12;
}
/**
 * Any phone number people may sign in with or give as a contact: a Rwandan number in any local form (as normalizePhone), or an international number written
 * with "+" or "00" and its country code. Returns "+<digits>" or null.
 */
export function normalizeAnyPhone(input: string): string | null {
  const rw = normalizePhone(input); if (rw) return rw;
  let d = input.replace(/[\s\-().]/g, ''); if (d.startsWith('00')) d = '+' + d.slice(2);
  return d.startsWith('+') && isInternationalPhone(d) ? d : null;
}
