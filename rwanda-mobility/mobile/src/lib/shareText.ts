// Share a message through the OS share sheet; on web use the Web Share API or copy to the clipboard.
import { Platform, Share } from 'react-native';
export async function shareText(message: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (Platform.OS === 'web') {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) { await nav.share({ text: message }); return 'shared'; }
      if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(message); return 'copied'; }
      return 'failed';
    }
    const r = await Share.share({ message });
    return r.action === Share.dismissedAction ? 'failed' : 'shared';
  } catch { return 'failed'; }
}
