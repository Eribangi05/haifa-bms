import { useSyncExternalStore } from 'react';
import { SUPPORT } from '../config';
import { kv } from './storage';

/**
 * Remote feature switches (GET /config/flags): the operations console can turn a feature off for everybody, or roll it out to a share of people, without a new app.
 * Unknown flags count as ON (an old server or no signal never disables features). The last answer is kept on the phone.
 */
export type Flag = { on: boolean; message?: string };
type State = { flags: Record<string, Flag>; support: { name: string; phone: string }; at: number };
let state: State = { flags: {}, support: { name: SUPPORT.name, phone: SUPPORT.phone }, at: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const KEY = 'rm_flags';

export function setFlags(r: { flags?: Record<string, Flag>; support?: { name: string; phone: string } }) {
  state = { flags: r.flags ?? state.flags, support: r.support?.phone ? r.support : state.support, at: Date.now() };
  void kv.set(KEY, JSON.stringify(state)); emit();
}
export async function restoreFlags() {
  try { const s = await kv.get(KEY); if (s) { const v = JSON.parse(s) as State; if (v && v.flags) { state = { ...state, ...v }; emit(); } } } catch { /* ignore */ }
}
export function resetFlags() { state = { flags: {}, support: { name: SUPPORT.name, phone: SUPPORT.phone }, at: 0 }; void kv.del(KEY); emit(); }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snap = () => state;
export const useFlagState = () => useSyncExternalStore(subscribe, snap, snap);
/** Is the feature on? Unknown = on. */
export const useFlag = (key: string): boolean => (useFlagState().flags[key]?.on ?? true);
/** The message the console set for when the feature is off (may be empty). */
export const useFlagMessage = (key: string): string | undefined => useFlagState().flags[key]?.message;
/** Owner / support contact (the server can change it without an app update). */
export const useSupport = () => { const s = useFlagState().support; const digits = s.phone.replace(/\D/g, ''); return { name: s.name, phone: s.phone, display: s.phone === SUPPORT.phone ? SUPPORT.display : s.phone.replace(/^\+250(\d{3})(\d{3})(\d{3})$/, '+250 $1 $2 $3'), wa: digits }; };
export const flagsNow = (key: string) => state.flags[key]?.on ?? true;
