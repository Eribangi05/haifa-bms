// Backend base URL. Android emulator reaches the host machine at 10.0.2.2. For a real device or release build,
// set EXPO_PUBLIC_API_URL (see eas.json / .env) to your HTTPS API origin.
// EXPO_PUBLIC_API_URL=self (web build served by the API itself) means "this site's own address", so one build works on any host.
const RAW_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080';
export const API_URL = (RAW_API_URL === 'self' && typeof window !== 'undefined' && window.location?.origin ? window.location.origin : RAW_API_URL).replace(/\/$/, '');
export const APP_NAME = process.env.EXPO_PUBLIC_APP_NAME ?? 'Abasare';
export const KIGALI = { lat: -1.9536, lng: 30.0927 };
export const POLL_MS = 3000;
/** Owner / support contact shown on the Help and assistance screen (call, WhatsApp, message). */
export const SUPPORT = { name: 'Jean Paul INGABIRE', phone: '+250786880880', display: '+250 786 880 880' } as const;
/** Optional public download link added to invitation messages (set EXPO_PUBLIC_APP_DOWNLOAD_URL at build time). */
export const APP_DOWNLOAD_URL = (process.env.EXPO_PUBLIC_APP_DOWNLOAD_URL ?? '').trim();
