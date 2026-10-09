// Notification templates of round 5 (referrals, chat, vehicle application). Merged into DEFAULT_TEMPLATES by i18n.ts.
// Every template exists in en, rw and fr with identical placeholders; a person only ever sees one language.
type L = 'en' | 'rw' | 'fr';
type Tpl = { title: string; body: string };
const T = (en: [string, string], rw: [string, string], fr: [string, string]): Record<L, Tpl> => ({ en: { title: en[0], body: en[1] }, rw: { title: rw[0], body: rw[1] }, fr: { title: fr[0], body: fr[1] } });

export const TRUST_TEMPLATES: Record<string, Record<L, Tpl>> = {
  referral_rewarded: T(['Your invitation paid off', 'A friend you invited finished their first trip. Your reward: {{amount}} RWF. Ambassador level: {{tier}}.'],
    ['Ubutumire bwawe bwatanze umusaruro', 'Inshuti watumiye yarangije urugendo rwayo rwa mbere. Igihembo cyawe: {{amount}} RWF. Urwego rw\'intumwa: {{tier}}.'],
    ['Votre invitation a porté ses fruits', 'Un ami que vous avez invité a terminé sa première course. Votre récompense : {{amount}} RWF. Niveau ambassadeur : {{tier}}.']),
  referral_welcome: T(['Welcome gift', 'Thanks for joining with an invitation. Your gift: {{amount}} RWF for a coming trip.'],
    ['Impano yo kukwakira', 'Urakoze kwinjira ufite ubutumire. Impano yawe: {{amount}} RWF y\'urugendo rutaha.'],
    ['Cadeau de bienvenue', 'Merci d\'avoir rejoint Abasare avec une invitation. Votre cadeau : {{amount}} RWF pour une prochaine course.']),
  chat_message: T(['New message', 'You have a new message about your trip {{ref}}.'],
    ['Ubutumwa bushya', 'Ufite ubutumwa bushya ku rugendo {{ref}}.'],
    ['Nouveau message', 'Vous avez un nouveau message pour la course {{ref}}.']),
  vehicle_approved: T(['Your vehicle is approved', 'Your {{plate}} is approved. You can now take ride jobs with it.'],
    ['Ikinyabiziga cyawe cyemejwe', '{{plate}} yemejwe. Ubu ushobora kwakira ingendo ukoresheje icyo kinyabiziga.'],
    ['Votre véhicule est approuvé', 'Votre véhicule {{plate}} est approuvé. Vous pouvez maintenant accepter des courses avec.']),
  vehicle_rejected: T(['Vehicle needs changes', 'Your {{plate}} was not approved: {{reason}}. Fix it and send it again.'],
    ['Ikinyabiziga gikeneye ibindi', '{{plate}} ntiyemejwe: {{reason}}. Kosora hanyuma wongere uyohereze.'],
    ['Véhicule à corriger', 'Votre véhicule {{plate}} n\'a pas été approuvé : {{reason}}. Corrigez puis renvoyez.']),
};
