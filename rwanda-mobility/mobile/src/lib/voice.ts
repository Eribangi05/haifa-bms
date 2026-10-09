import * as Speech from 'expo-speech';
import type { Lang } from './i18n';

/**
 * Spoken navigation: the phone's own text-to-speech reads the next turn aloud, in the app language only (never mixed).
 * Kinyarwanda needs a Kinyarwanda voice on the phone (Android: Settings > Text-to-speech > Google > install "Kinyarwanda"); when the phone has none,
 * `voiceAvailable` is false and the app stays silent instead of reading Kinyarwanda with a foreign voice.
 * Every call is recorded in globalThis.__abasareSpeech for browser tests.
 */
const LOCALE: Record<Lang, string> = { rw: 'rw-RW', fr: 'fr-FR', en: 'en-GB' };
const log = (text: string, lang: string) => { try { const g = globalThis as { __abasareSpeech?: { text: string; lang: string; at: number }[] }; (g.__abasareSpeech ??= []).push({ text, lang, at: Date.now() }); } catch { /* ignore */ } };
const cache: Partial<Record<Lang, boolean>> = {};

export async function voiceAvailable(lang: Lang): Promise<boolean> {
  if (cache[lang] !== undefined) return cache[lang]!;
  let ok = lang !== 'rw';                       // French and English voices ship with every phone; Kinyarwanda must be checked
  try { const v = await Speech.getAvailableVoicesAsync(); if (Array.isArray(v) && v.length) ok = v.some((x) => String(x.language).toLowerCase().startsWith(lang)); } catch { /* keep the default */ }
  cache[lang] = ok; return ok;
}
export async function speak(text: string, lang: Lang): Promise<void> {
  if (!text || !(await voiceAvailable(lang))) return;
  log(text, LOCALE[lang]);
  try { Speech.stop(); Speech.speak(text, { language: LOCALE[lang], rate: 0.95, pitch: 1 }); } catch { /* no speech engine */ }
}
export const stopSpeaking = () => { try { Speech.stop(); } catch { /* ignore */ } };
