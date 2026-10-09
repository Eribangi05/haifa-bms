// Default message templates (en, rw, fr). Admin-editable overrides live in notification_templates.
// Keys: {{var}} placeholders. Never put payment credentials or document content in a template.
// Rule: a user only ever sees ONE language. Every template must exist in every language in SUPPORTED_LANGS.
import { MONEY_TEMPLATES, MONEY_LABELS } from './moneyTemplates.js';
import { GROWTH_TEMPLATES } from './i18nGrowth.js';
import { TRUST_TEMPLATES } from './trustTemplates.js';
export const SUPPORTED_LANGS = ['rw', 'fr', 'en'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
type Tpl = { title: string; body: string };

export const DEFAULT_TEMPLATES: Record<string, Record<Lang, Tpl>> = {
  otp: {
    en: { title: 'Verification code', body: 'Your Abasare code is {{code}}. It expires in {{minutes}} minutes. Never share it.' },
    rw: { title: 'Kode yo kwemeza', body: 'Kode yawe ya Abasare ni {{code}}. Irangira nyuma y\'iminota {{minutes}}. Ntuyihe undi muntu.' },
    fr: { title: 'Code de vérification', body: 'Votre code Abasare est {{code}}. Il expire dans {{minutes}} minutes. Ne le partagez jamais.' },
  },
  booking_confirmed: {
    en: { title: 'Booking received', body: 'We are finding a driver for booking {{ref}}.' },
    rw: { title: 'Ubusabe bwawe bwakiriwe', body: 'Turimo gushakira umushoferi urugendo {{ref}}.' },
    fr: { title: 'Réservation reçue', body: 'Nous recherchons un chauffeur pour la réservation {{ref}}.' },
  },
  driver_assigned: {
    en: { title: 'Driver assigned', body: '{{driver}} ({{plate}}) is on the way. Your trip PIN is shown in the app.' },
    rw: { title: 'Umushoferi yabonetse', body: '{{driver}} ({{plate}}) ari mu nzira aza aho uri. PIN y\'urugendo iragaragara muri porogaramu.' },
    fr: { title: 'Chauffeur trouvé', body: '{{driver}} ({{plate}}) est en route. Le code PIN de votre course est affiché dans l\'application.' },
  },
  abasare_assigned: {
    en: { title: 'Abasare assigned', body: '{{driver}} is coming to drive your car {{plate}}. Check their identity in the app before handing over the keys.' },
    rw: { title: 'Abasare yabonetse', body: '{{driver}} araje gutwara imodoka yawe {{plate}}. Banza ugenzure umwirondoro we muri porogaramu mbere yo kumuha imfunguzo.' },
    fr: { title: 'Abasare trouvé', body: '{{driver}} vient conduire votre voiture {{plate}}. Vérifiez son identité dans l\'application avant de lui remettre les clés.' },
  },
  handover_submitted: {
    en: { title: 'Car condition recorded', body: 'Your driver recorded the {{phase}} condition of your car. Please review and confirm in the app.' },
    rw: { title: 'Imiterere y\'imodoka yanditswe', body: 'Umushoferi yanditse imiterere y\'imodoka yawe {{phase}}. Yisuzume, hanyuma uyemeze muri porogaramu.' },
    fr: { title: 'État du véhicule enregistré', body: 'Votre chauffeur a enregistré l\'état de votre voiture {{phase}}. Vérifiez-le et confirmez dans l\'application.' },
  },
  handover_issue: {
    en: { title: 'Car condition issue reported', body: 'The owner reported an issue with the {{phase}} condition of booking {{ref}}. Support will contact you.' },
    rw: { title: 'Ikibazo ku miterere y\'imodoka', body: 'Nyir\'imodoka yagaragaje ikibazo ku miterere y\'imodoka {{phase}} ku rugendo {{ref}}. Itsinda ry\'ubufasha rizakuvugisha.' },
    fr: { title: 'Problème signalé sur l\'état du véhicule', body: 'Le propriétaire a signalé un problème sur l\'état du véhicule {{phase}} pour la réservation {{ref}}. L\'assistance vous contactera.' },
  },
  driver_arrived: {
    en: { title: 'Driver arrived', body: 'Your driver has arrived. Check the plate {{plate}} before boarding.' },
    rw: { title: 'Umushoferi yahageze', body: 'Umushoferi yahageze. Genzura plaque {{plate}} mbere yo kwinjira mu modoka.' },
    fr: { title: 'Chauffeur arrivé', body: 'Votre chauffeur est arrivé. Vérifiez la plaque {{plate}} avant de monter.' },
  },
  trip_started: {
    en: { title: 'Trip started', body: 'Your trip {{ref}} has started.' },
    rw: { title: 'Urugendo rwatangiye', body: 'Urugendo {{ref}} rwatangiye.' },
    fr: { title: 'Course commencée', body: 'Votre course {{ref}} a commencé.' },
  },
  trip_completed: {
    en: { title: 'Trip completed', body: 'Trip {{ref}} completed. Fare: {{fare}} RWF.' },
    rw: { title: 'Urugendo rwarangiye', body: 'Urugendo {{ref}} rwarangiye. Igiciro: {{fare}} RWF.' },
    fr: { title: 'Course terminée', body: 'Course {{ref}} terminée. Tarif : {{fare}} RWF.' },
  },
  payment_success: {
    en: { title: 'Payment received', body: 'Payment of {{amount}} RWF for {{ref}} was received. Thank you.' },
    rw: { title: 'Kwishyura byakiriwe', body: 'Twakiriye {{amount}} RWF wishyuye ku rugendo {{ref}}. Murakoze.' },
    fr: { title: 'Paiement reçu', body: 'Le paiement de {{amount}} RWF pour {{ref}} a bien été reçu. Merci.' },
  },
  payment_failed: {
    en: { title: 'Payment failed', body: 'Payment for {{ref}} did not go through. Please try again or pay cash.' },
    rw: { title: 'Kwishyura ntibyakunze', body: 'Kwishyura urugendo {{ref}} ntibyakunze. Ongera ugerageze cyangwa wishyure mu ntoki.' },
    fr: { title: 'Échec du paiement', body: 'Le paiement de {{ref}} n\'a pas abouti. Réessayez ou payez en espèces.' },
  },
  booking_cancelled: {
    en: { title: 'Booking cancelled', body: 'Booking {{ref}} was cancelled. {{reason}}' },
    rw: { title: 'Urugendo rwahagaritswe', body: 'Urugendo {{ref}} rwahagaritswe. {{reason}}' },
    fr: { title: 'Réservation annulée', body: 'La réservation {{ref}} a été annulée. {{reason}}' },
  },
  booking_cancelled_fee: {
    en: { title: 'Booking cancelled', body: 'Booking {{ref}} was cancelled. A cancellation fee of {{fee}} RWF applies.' },
    rw: { title: 'Urugendo rwahagaritswe', body: 'Urugendo {{ref}} rwahagaritswe. Hakwa amafaranga yo guhagarika angana na {{fee}} RWF.' },
    fr: { title: 'Réservation annulée', body: 'La réservation {{ref}} a été annulée. Des frais d\'annulation de {{fee}} RWF s\'appliquent.' },
  },
  no_driver: {
    en: { title: 'No driver available', body: 'No driver accepted {{ref}}. Try another vehicle type, move your pickup, or schedule later.' },
    rw: { title: 'Nta mushoferi uboneka', body: 'Nta mushoferi wemeye urugendo {{ref}}. Gerageza ubundi bwoko bw\'ikinyabiziga, hindura aho uzamukira, cyangwa utegure urugendo nyuma.' },
    fr: { title: 'Aucun chauffeur disponible', body: 'Aucun chauffeur n\'a accepté {{ref}}. Essayez un autre type de véhicule, changez le lieu de prise en charge ou planifiez plus tard.' },
  },
  refund_processed: {
    en: { title: 'Refund approved', body: 'A refund of {{amount}} RWF for {{ref}} was approved.' },
    rw: { title: 'Kugarurirwa amafaranga byemejwe', body: 'Kugarurirwa {{amount}} RWF ku rugendo {{ref}} byemejwe.' },
    fr: { title: 'Remboursement approuvé', body: 'Un remboursement de {{amount}} RWF pour {{ref}} a été approuvé.' },
  },
  doc_expiry: {
    en: { title: 'Document expiring', body: 'Your {{doc}} expires in {{days}} day(s). Upload a new one to keep receiving trips.' },
    rw: { title: 'Icyangombwa kigiye kurangira', body: 'Icyangombwa cyawe ({{doc}}) kirangira mu minsi {{days}}. Ohereza gishya kugira ngo ukomeze guhabwa ingendo.' },
    fr: { title: 'Document bientôt expiré', body: 'Votre document ({{doc}}) expire dans {{days}} jour(s). Envoyez-en un nouveau pour continuer à recevoir des courses.' },
  },
  driver_decision: {
    en: { title: 'Application update', body: 'Your driver application status is now: {{status}}. {{reason}}' },
    rw: { title: 'Amakuru ku busabe bwawe', body: 'Uko ubusabe bwawe bwo kuba umushoferi bwifashe ubu: {{status}}. {{reason}}' },
    fr: { title: 'Mise à jour de votre candidature', body: 'Le statut de votre candidature de chauffeur est désormais : {{status}}. {{reason}}' },
  },
  payout_update: {
    en: { title: 'Payout update', body: 'Your payout of {{amount}} RWF is now {{status}}.' },
    rw: { title: 'Amakuru ku kwishyurwa', body: 'Kwishyurwa {{amount}} RWF: {{status}}.' },
    fr: { title: 'Mise à jour du paiement', body: 'Votre paiement de {{amount}} RWF est désormais : {{status}}.' },
  },
  case_update: {
    en: { title: 'Support update', body: 'Your support case {{ref}} was updated: {{status}}.' },
    rw: { title: 'Amakuru ku kibazo cyawe', body: 'Ikibazo cyawe {{ref}} cyahindutse: {{status}}.' },
    fr: { title: 'Mise à jour de l\'assistance', body: 'Votre demande {{ref}} a été mise à jour : {{status}}.' },
  },
  offer: {
    en: { title: 'New trip offer', body: 'Pickup {{km}} km away. Estimated earnings {{net}} RWF.' },
    rw: { title: 'Urugendo rushya', body: 'Aho umugenzi azamukira ni kuri km {{km}}. Inyungu ikekwa ni {{net}} RWF.' },
    fr: { title: 'Nouvelle course', body: 'Prise en charge à {{km}} km. Gains estimés : {{net}} RWF.' },
  },
  sos_ack: {
    en: { title: 'SOS recorded', body: 'Your SOS was recorded as {{ref}}. If you are in danger call 112 (police) or 912 (ambulance) now. Support has not yet confirmed contact.' },
    rw: { title: 'SOS yanditswe', body: 'SOS yawe yanditswe nka {{ref}}. Niba uri mu kaga, hamagara 112 (Polisi) cyangwa 912 (ambulance) ako kanya. Ubufasha ntiburemeza ko bwaguhamagaye.' },
    fr: { title: 'SOS enregistré', body: 'Votre SOS a été enregistré sous la référence {{ref}}. Si vous êtes en danger, appelez immédiatement le 112 (police) ou le 912 (ambulance). L\'assistance n\'a pas encore confirmé qu\'elle vous a contacté.' },
  },
  // --- trusted contacts (sent to someone who is not a user, in the contact's own language) and safety checks
  trusted_trip_started: {
    en: { title: '{{who}} is on a trip', body: '{{who}} started a trip with driver {{driver}}, plate {{plate}}. Follow live: {{link}}' },
    rw: { title: '{{who}} ari mu rugendo', body: '{{who}} yatangiye urugendo n\'umushoferi {{driver}}, plaque {{plate}}. Kurikirana aho ageze: {{link}}' },
    fr: { title: '{{who}} est en route', body: '{{who}} a commencé une course avec le chauffeur {{driver}}, plaque {{plate}}. Suivez en direct : {{link}}' },
  },
  trusted_trip_arrived: {
    en: { title: 'Arrived safely', body: '{{who}} has arrived safely at the destination.' },
    rw: { title: 'Yageze amahoro', body: '{{who}} yageze amahoro iyo yajyaga.' },
    fr: { title: 'Bien arrivé(e)', body: '{{who}} est bien arrivé(e) à destination, en toute sécurité.' },
  },
  safety_check_deviation: {
    en: { title: 'Are you OK?', body: 'Your trip seems to be leaving its route. Open the app and tell us whether you are OK or need help within {{minutes}} minutes, or our support team will be alerted. In danger call 112.' },
    rw: { title: 'Ese uri amahoro?', body: 'Urugendo rwawe rusa nk\'urwavuye mu nzira yaruteganyirijwe. Fungura porogaramu utubwire niba uri amahoro cyangwa ukeneye ubufasha mu minota {{minutes}}, bitabaye ibyo itsinda ry\'ubufasha rizamenyeshwa. Niba uri mu kaga hamagara 112.' },
    fr: { title: 'Tout va bien ?', body: 'Votre course semble s\'écarter de son itinéraire. Ouvrez l\'application et indiquez si tout va bien ou si vous avez besoin d\'aide dans les {{minutes}} minutes, sinon notre équipe d\'assistance sera alertée. En cas de danger, appelez le 112.' },
  },
  safety_check_stop: {
    en: { title: 'Are you OK?', body: 'Your trip has been stopped for about {{stop}} minutes. Open the app and tell us whether you are OK or need help within {{minutes}} minutes, or our support team will be alerted. In danger call 112.' },
    rw: { title: 'Ese uri amahoro?', body: 'Imodoka yawe imaze iminota nka {{stop}} ihagaze. Fungura porogaramu utubwire niba uri amahoro cyangwa ukeneye ubufasha mu minota {{minutes}}, bitabaye ibyo itsinda ry\'ubufasha rizamenyeshwa. Niba uri mu kaga hamagara 112.' },
    fr: { title: 'Tout va bien ?', body: 'Votre course est à l\'arrêt depuis environ {{stop}} minutes. Ouvrez l\'application et indiquez si tout va bien ou si vous avez besoin d\'aide dans les {{minutes}} minutes, sinon notre équipe d\'assistance sera alertée. En cas de danger, appelez le 112.' },
  },
  safety_escalated: {
    en: { title: 'Support alerted', body: 'Following your safety check we opened safety case {{ref}} for our support team. No one has confirmed contact with you yet. If you are in danger call 112 (police) or 912 (ambulance) now.' },
    rw: { title: 'Ubufasha bwamenyeshejwe', body: 'Nyuma yo kukugenzura twafunguye ikibazo cy\'umutekano {{ref}} ku itsinda ry\'ubufasha. Nta muntu uremeza ko yakuvugishije. Niba uri mu kaga, hamagara 112 (Polisi) cyangwa 912 (ambulance) ako kanya.' },
    fr: { title: 'Assistance alertée', body: 'Suite à votre vérification de sécurité, nous avons ouvert le dossier {{ref}} pour notre équipe d\'assistance. Personne n\'a encore confirmé vous avoir contacté. Si vous êtes en danger, appelez immédiatement le 112 (police) ou le 912 (ambulance).' },
  },
  tip_received: {
    en: { title: 'You received a tip', body: 'A passenger tipped you {{amount}} RWF. It is all yours: no commission is taken.' },
    rw: { title: 'Wahawe agashimwe', body: 'Umugenzi yaguhaye agashimwe ka {{amount}} RWF. Kose ni akawe, nta komisiyo gakatwaho.' },
    fr: { title: 'Vous avez reçu un pourboire', body: 'Un passager vous a laissé un pourboire de {{amount}} RWF. Il est entièrement à vous : aucune commission n\'est prélevée.' },
  },
  tip_failed: {
    en: { title: 'Tip not sent', body: 'Your tip of {{amount}} RWF did not go through. You can try again.' },
    rw: { title: 'Agashimwe ntikagezeyo', body: 'Agashimwe kawe ka {{amount}} RWF ntikagezeyo. Ushobora kongera kugerageza.' },
    fr: { title: 'Pourboire non envoyé', body: 'Votre pourboire de {{amount}} RWF n\'a pas abouti. Vous pouvez réessayer.' },
  },
};

Object.assign(DEFAULT_TEMPLATES, TRUST_TEMPLATES);   // round 5: referrals, chat, vehicle application (services/trustTemplates.ts)
Object.assign(DEFAULT_TEMPLATES, MONEY_TEMPLATES);   // round 3: credit, deposit, claims, USSD (services/moneyTemplates.ts)

// Enumerated values that appear inside templates ({{status}}, {{doc}}, {{phase}}) are translated per language,
// so a Kinyarwanda or French message never contains an English word.
type Triple = Record<Lang, string>;
const V = (en: string, rw: string, fr: string): Triple => ({ en, rw, fr });
export const VALUE_LABELS: Record<string, Triple> = {
  // driver application / account
  approved: V('approved', 'bwemejwe', 'approuvée'), rejected: V('rejected', 'bwanzwe', 'refusée'), suspended: V('suspended', 'bwahagaritswe by\'agateganyo', 'suspendue'),
  pending: V('pending', 'burategerejwe', 'en attente'), resubmit: V('resubmit', 'ongera wohereze', 'à renvoyer'), reinstated: V('reinstated', 'bwongeye gukora', 'rétablie'),
  info_required: V('more information required', 'dukeneye andi makuru', 'informations complémentaires requises'),
  abasare_approved: V('Abasare approved', 'Abasare byemejwe', 'Abasare approuvé'), abasare_rejected: V('Abasare rejected', 'Abasare byanzwe', 'Abasare refusé'),
  abasare_suspended: V('Abasare suspended', 'Abasare byahagaritswe by\'agateganyo', 'Abasare suspendu'), abasare_pending: V('Abasare pending', 'Abasare biri gusuzumwa', 'Abasare en attente'),
  APPLICATION_STARTED: V('application started', 'ubusabe bwatangiye', 'candidature commencée'), DOCUMENTS_SUBMITTED: V('documents submitted', 'ibyangombwa byoherejwe', 'documents envoyés'),
  UNDER_REVIEW: V('under review', 'burimo gusuzumwa', 'en cours d\'examen'), INFO_REQUIRED: V('more information required', 'dukeneye andi makuru', 'informations complémentaires requises'),
  APPROVED: V('approved', 'bwemejwe', 'approuvé'), REJECTED: V('rejected', 'bwanzwe', 'refusé'), SUSPENDED: V('suspended', 'bwahagaritswe by\'agateganyo', 'suspendu'),
  EXPIRED_INELIGIBLE: V('documents expired', 'ibyangombwa byararangiye', 'documents expirés'), DEACTIVATED: V('deactivated', 'konti yafunzwe', 'compte désactivé'),
  // payouts
  REQUESTED: V('requested', 'bwasabwe', 'demandé'), REVIEWED: V('reviewed', 'bwasuzumwe', 'examiné'), PAID: V('paid', 'byishyuwe', 'payé'), FAILED: V('failed', 'ntibyakunze', 'échoué'),
  // support cases
  open: V('open', 'gifunguye', 'ouverte'), in_progress: V('in progress', 'kirimo gukemurwa', 'en cours'), awaiting_user: V('waiting for your reply', 'dutegereje igisubizo cyawe', 'en attente de votre réponse'),
  resolved: V('resolved', 'cyakemutse', 'résolue'), closed: V('closed', 'cyarafunzwe', 'clôturée'),
  // handover phases
  pickup: V('pickup', 'mbere y\'urugendo', 'au départ'), dropoff: V('drop-off', 'nyuma y\'urugendo', 'à l\'arrivée'), 'drop-off': V('drop-off', 'nyuma y\'urugendo', 'à l\'arrivée'),
  // documents
  national_id: V('national ID', 'Indangamuntu', 'carte d\'identité'), driving_licence: V('driving licence', 'Uruhushya rwo gutwara', 'permis de conduire'),
  profile_photo: V('profile photo', 'Ifoto y\'umwirondoro', 'photo de profil'), vehicle_registration: V('vehicle registration', 'Icyangombwa cy\'ikinyabiziga', 'carte grise'),
  insurance: V('insurance', 'Ubwishingizi', 'assurance'), transport_permit: V('transport permit', 'Uruhushya rwo gutwara abantu', 'licence de transport'),
  inspection: V('inspection', 'Isuzuma ry\'ikinyabiziga', 'contrôle technique'), police_clearance: V('police clearance', 'Icyemezo cy\'imyitwarire myiza', 'casier judiciaire'),
};
Object.assign(VALUE_LABELS, MONEY_LABELS);
const LABELLED_PARAMS = ['status', 'doc', 'phase'];

/** Translate enumerated template params into the target language (unknown values pass through unchanged). */
export function localizeParams(params: Record<string, unknown>, lang: Lang): Record<string, unknown> {
  const out = { ...params };
  for (const k of LABELLED_PARAMS) {
    const v = out[k];
    if (typeof v === 'string' && VALUE_LABELS[v]) out[k] = VALUE_LABELS[v][lang];
  }
  return out;
}

Object.assign(DEFAULT_TEMPLATES, GROWTH_TEMPLATES);   // round 2 templates (services/i18nGrowth.ts)

export const render = (tpl: string, p: Record<string, unknown>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(p[k] ?? ''));
