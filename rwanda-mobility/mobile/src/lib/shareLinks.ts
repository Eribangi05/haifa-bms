// Deep links for sharing / contacting. Platform-free (the caller passes the platform) so they are unit-tested in tests/shareLinks.test.ts.
const enc = encodeURIComponent;
const digits = (p: string) => p.replace(/[^\d]/g, '');
/** WhatsApp chat link; with a phone it opens that chat, without one it opens WhatsApp's contact picker with the text. wa.me works on Android, iOS and web. */
export const whatsappUrl = (text: string, phone?: string) => `https://wa.me/${phone ? digits(phone) : ''}?text=${enc(text)}`;
/** SMS compose link. iOS separates the body with "&", Android with "?". */
export const smsUrl = (text: string, ios: boolean, phone?: string) => `sms:${phone ? phone.replace(/\s/g, '') : ''}${ios ? '&' : '?'}body=${enc(text)}`;
export const telUrl = (phone?: string) => `tel:${phone ? phone.replace(/\s/g, '') : ''}`;
export const mailUrl = (subject: string, body: string) => `mailto:?subject=${enc(subject)}&body=${enc(body)}`;
/** The invitation text: the localised message plus an optional download line. */
export const inviteText = (msg: string, link: string | null | undefined) => (link ? `${msg}\n${link}` : msg);
