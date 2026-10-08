// Rating tag catalogue (served by GET /config). Labels exist in all three languages; the API stores only the stable ids.
import type { Lang } from './i18n.js';
export type Tag = { id: string; kind: 'positive' | 'negative'; scope: 'ride' | 'abasare'; label: Record<Lang, string> };
const T = (id: string, kind: Tag['kind'], scope: Tag['scope'], en: string, rw: string, fr: string): Tag => ({ id, kind, scope, label: { en, rw, fr } });

export const RIDE_TAGS: Tag[] = [
  T('clean_car', 'positive', 'ride', 'Clean car', 'Imodoka isukuye', 'Voiture propre'),
  T('polite', 'positive', 'ride', 'Polite', 'Yubaha abagenzi', 'Courtois'),
  T('safe_driving', 'positive', 'ride', 'Safe driving', 'Atwara atekanye', 'Conduite sûre'),
  T('knows_route', 'positive', 'ride', 'Knows the route', 'Azi inzira', 'Connaît le chemin'),
  T('on_time', 'positive', 'ride', 'On time', 'Yageze ku gihe', 'Ponctuel'),
  T('helpful', 'positive', 'ride', 'Helpful', 'Afasha', 'Serviable'),
  T('unsafe', 'negative', 'ride', 'Unsafe driving', 'Atwara ateza ibyago', 'Conduite dangereuse'),
  T('rude', 'negative', 'ride', 'Rude', 'Afite imvugo mbi', 'Impoli'),
  T('dirty_car', 'negative', 'ride', 'Dirty car', 'Imodoka yanduye', 'Voiture sale'),
  T('late', 'negative', 'ride', 'Late', 'Yatinze', 'En retard'),
  T('bad_route', 'negative', 'ride', 'Poor route choice', 'Yahisemo inzira mbi', 'Mauvais itinéraire'),
];
export const ABASARE_TAGS: Tag[] = [
  T('careful_driving', 'positive', 'abasare', 'Careful driving', 'Atwara yitonze', 'Conduite prudente'),
  T('punctual', 'positive', 'abasare', 'Punctual', 'Yubahiriza igihe', 'Ponctuel'),
  T('car_care', 'positive', 'abasare', 'Looked after my car', 'Yitaye ku modoka yanjye', 'A pris soin de ma voiture'),
  T('respectful', 'positive', 'abasare', 'Respectful', 'Yubaha', 'Respectueux'),
  ...RIDE_TAGS.filter((t) => ['unsafe', 'rude', 'late'].includes(t.id)).map((t) => ({ ...t, scope: 'abasare' as const })),
];
export const tagsFor = (abasare: boolean) => (abasare ? ABASARE_TAGS : RIDE_TAGS);
export const tagCatalogue = () => ({ ride: RIDE_TAGS, abasare: ABASARE_TAGS });
export const invalidTags = (ids: string[], abasare: boolean) => ids.filter((i) => !tagsFor(abasare).some((t) => t.id === i));
