import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { KV, TokenStore, Tokens } from './net';

/** Non-sensitive UI state only (language, recents, outbox of non-secret requests). */
export const kv: KV = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  del: (k) => AsyncStorage.removeItem(k),
};

/** Auth tokens live in the platform keystore, never in AsyncStorage. */
const TOKEN_KEY = 'rm_tokens';
export const tokenStore: TokenStore = {
  async get() {
    try { const s = await SecureStore.getItemAsync(TOKEN_KEY); return s ? (JSON.parse(s) as Tokens) : null; } catch { return null; }
  },
  async set(t) {
    try { if (t) await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(t)); else await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* keystore unavailable */ }
  },
};

export async function getDeviceId(): Promise<string> {
  let id = await kv.get('rm_device_id');
  if (!id) { id = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36); await kv.set('rm_device_id', id); }
  return id;
}

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try { const s = await kv.get(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}
export const saveJson = (key: string, v: unknown) => kv.set(key, JSON.stringify(v));
