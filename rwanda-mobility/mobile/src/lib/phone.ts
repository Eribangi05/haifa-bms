// Phone numbers from any country: pure helpers for the country picker (unit-tested in tests/phone.test.ts).
// A number is stored and sent as E.164: "+" and the country calling code, then the national number (no leading zero).
import { COUNTRIES, type Country } from './countries.ts';
import type { Lang } from './i18n';

export const DEFAULT_COUNTRY = 'RW';
/** Shown first, before the full alphabetical list: Rwanda's neighbours and the countries most visitors and relatives call from. */
export const POPULAR = ['RW', 'UG', 'KE', 'TZ', 'BI', 'CD', 'SS', 'ET', 'ZA', 'NG', 'GH', 'SN', 'BE', 'FR', 'DE', 'GB', 'US', 'CA', 'CN', 'IN', 'AE'];
export const byIso = (iso: string): Country => COUNTRIES.find((c) => c.iso === iso) ?? COUNTRIES.find((c) => c.iso === DEFAULT_COUNTRY)!;
export const countryName = (c: Country, lang: Lang) => c[lang];
export const flag = (iso: string) => String.fromCodePoint(...[...iso.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9+ ]/g, '').trim();

/** Digits of the national number as typed: spaces, dashes and the trunk "0" in front are dropped. */
export const nationalDigits = (raw: string) => raw.replace(/\D/g, '').replace(/^0+/, '');
/** E.164 for a number typed under a chosen country, or null while it is not a plausible number. Rwanda is checked strictly (072/073/078/079 mobiles). */
export function toE164(c: Country, raw: string): string | null {
  let d = nationalDigits(raw);
  if (d.startsWith(c.dial) && d.length > c.dial.length + 3 && c.iso !== 'RW') d = d.slice(c.dial.length);           // the country code typed again
  if (c.iso === 'RW') { if (d.startsWith('250')) d = d.slice(3); return /^7[2389]\d{7}$/.test(d) ? '+250' + d : null; }
  if (d.length < 4 || d.length > 12 || c.dial.length + d.length < 8 || c.dial.length + d.length > 15) return null;
  return '+' + c.dial + d;
}
const PREFER = ['US', 'GB', 'RU', 'IT', 'FI', 'FR', 'MA', 'AU', 'NO', 'NZ', 'CN', 'RW'];
/** Which country a stored "+..." number belongs to (longest calling code wins; shared codes go to the best-known country). */
export function splitE164(e164: string): { country: Country; national: string } | null {
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null; const digits = e164.slice(1);
  const hits = COUNTRIES.filter((c) => digits.startsWith(c.dial)); if (!hits.length) return null;
  const max = Math.max(...hits.map((c) => c.dial.length)); const best = hits.filter((c) => c.dial.length === max);
  const country = best.find((c) => PREFER.includes(c.iso)) ?? best[0]; return { country, national: digits.slice(country.dial.length) };
}
/** "+250788123456" -> "+250 788 123 456" for display. */
export function prettyPhone(e164: string): string { const s = splitE164(e164); return s ? `+${s.country.dial} ${s.national.replace(/(\d{3})(?=\d)/g, '$1 ')}` : e164; }
/** Any accepted way of writing a number (a Rwandan local form, or "+" / "00" with a country code) as E.164, or null. */
export function normalizeAny(raw: string): string | null {
  const s = raw.replace(/[\s\-().]/g, ''); const rw = toE164(byIso('RW'), s.replace(/^\+?250/, '')); if (/^(?:\+?250|0)?7[2389]\d{7}$/.test(s)) return rw;
  const t = s.startsWith('00') ? '+' + s.slice(2) : s; const sp = t.startsWith('+') ? splitE164(t) : null; return sp && toE164(sp.country, sp.national) ? '+' + sp.country.dial + nationalDigits(sp.national) : null;
}
/** Countries matching what the person typed (name in any of the three languages, calling code or ISO code). Empty search: popular countries first, then A to Z in the app language. */
export function searchCountries(q: string, lang: Lang): Country[] {
  const sort = (a: Country, b: Country) => a[lang].localeCompare(b[lang], lang === 'rw' ? 'en' : lang);
  const f = fold(q).replace(/^\+/, ''); if (!f) { const pop = POPULAR.map((i) => byIso(i)); return [...pop, ...COUNTRIES.filter((c) => !POPULAR.includes(c.iso)).sort(sort)]; }
  return COUNTRIES.filter((c) => fold(c.en).includes(f) || fold(c.fr).includes(f) || fold(c.rw).includes(f) || c.dial.startsWith(f) || c.iso.toLowerCase() === f).sort((a, b) => {
    const s = (c: Country) => (fold(c[lang]).startsWith(f) || c.dial === f || c.iso.toLowerCase() === f ? 0 : 1); return s(a) - s(b) || sort(a, b);
  });
}
