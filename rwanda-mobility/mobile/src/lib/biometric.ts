// Fingerprint / face / device PIN unlock through expo-local-authentication. Inert on web (always 'unavailable').
import { Platform } from 'react-native';
export type BioSupport = 'ready' | 'none_enrolled' | 'unavailable';
const native = Platform.OS === 'android' || Platform.OS === 'ios';
const mod = () => require('expo-local-authentication');

export async function bioSupport(): Promise<BioSupport> {
  if (!native) return 'unavailable';
  try {
    const L = mod();
    if (!(await L.hasHardwareAsync())) { return (await L.getEnrolledLevelAsync?.()) > 1 ? 'ready' : 'unavailable'; }
    return (await L.isEnrolledAsync()) || (await L.getEnrolledLevelAsync?.()) > 1 ? 'ready' : 'none_enrolled';
  } catch { return 'unavailable'; }
}
/** Shows the system prompt (biometrics, with the device PIN/pattern as the OS fallback). Never throws. */
export async function bioAuthenticate(prompt: string, cancel: string): Promise<boolean> {
  if (!native) return true;
  try { const r = await mod().authenticateAsync({ promptMessage: prompt, cancelLabel: cancel, disableDeviceFallback: false }); return !!r.success; } catch { return false; }
}
