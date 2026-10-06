// Kinyarwanda (rw), English (en) and French (fr). One language per session: the UI must never mix them.
// Add a language: create locales/<code>.ts typed Record<K, string>, register it in DICTS and LANGS.
import { en, type K } from './locales/en';
import { rw } from './locales/rw';
import { fr } from './locales/fr';
export type Lang = 'rw' | 'en' | 'fr';
export const LANGS: { code: Lang; label: string }[] = [{ code: 'rw', label: 'Kinyarwanda' }, { code: 'fr', label: 'Français' }, { code: 'en', label: 'English' }];
export const isLang = (x: unknown): x is Lang => x === 'rw' || x === 'en' || x === 'fr';
export const DICTS: Record<Lang, Record<string, string>> = { en, rw, fr };
export type TKey = K;
export const translate = (lang: Lang, key: TKey, vars?: Record<string, string | number>) => {
  // Fallback to English only for a missing key; the typed dictionaries make that a compile error.
  let s = DICTS[lang]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
};
/** Pick a server-provided localised field (`name_rw`, `name_fr`, `name_en`...). Falls back to English only when the server sent no translation. */
export const pick = (lang: Lang, o: any, base: string): string => (o?.[`${base}_${lang}`] ?? o?.[`${base}_en`] ?? '') as string;
/** Translate a server code (status, document type, payment method...) with a key prefix; unknown codes fall back to a neutral word, never raw English. */
export const label = (lang: Lang, prefix: string, code: string | null | undefined): string => {
  if (!code) return '';
  const k = `${prefix}.${code}`;
  return DICTS[lang]?.[k] ?? translate(lang, 'common.unknown');
};
