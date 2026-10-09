import { Linking, Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { mailUrl, smsUrl, telUrl, whatsappUrl } from './shareLinks';

/** Open a link; resolves false when no app can handle it (the caller shows a localised message). */
export async function openLink(url: string): Promise<boolean> {
  try { await Linking.openURL(url); return true; } catch { return false; }
}
export const callNumber = (phone?: string) => openLink(telUrl(phone));
export const openWhatsApp = (text: string, phone?: string) => openLink(whatsappUrl(text, phone));
export const openSms = (text: string, phone?: string) => openLink(smsUrl(text, Platform.OS === 'ios', phone));
export const openMail = (subject: string, body: string) => openLink(mailUrl(subject, body));
/** System share sheet (any installed app). On web without Web Share it reports false. */
export async function shareSheet(message: string, title?: string): Promise<boolean> {
  try { await Share.share({ message, title }); return true; } catch { return false; }
}
export async function copyText(text: string): Promise<boolean> {
  try { await Clipboard.setStringAsync(text); return true; } catch { /* fall through */ }
  try { if (typeof navigator !== 'undefined' && navigator.clipboard) { await navigator.clipboard.writeText(text); return true; } } catch { /* ignore */ }
  return false;
}
