// Backend base URL. Android emulator reaches the host machine at 10.0.2.2. For a real device or release build,
// set EXPO_PUBLIC_API_URL (see eas.json / .env) to your HTTPS API origin.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080').replace(/\/$/, '');
export const APP_NAME = process.env.EXPO_PUBLIC_APP_NAME ?? 'Abasare';
export const KIGALI = { lat: -1.9536, lng: 30.0927 };
export const POLL_MS = 3000;
