// USSD screens in Kinyarwanda, French and English. One language per screen, never mixed (the language picker is the only trilingual screen,
// because the language is not known yet). Every screen must stay under 160 characters (services/ussd.ts trims list lines to fit; tests check it).
export type ULang = 'rw' | 'fr' | 'en';
export const ULANGS: ULang[] = ['rw', 'fr', 'en'];
type Tx = Record<ULang, string>;
const t = (rw: string, fr: string, en: string): Tx => ({ rw, fr, en });

export const TXT = {
  lang: t('Ururimi / Langue / Language\n1 Kinyarwanda\n2 Francais\n3 English', 'Ururimi / Langue / Language\n1 Kinyarwanda\n2 Francais\n3 English', 'Ururimi / Langue / Language\n1 Kinyarwanda\n2 Francais\n3 English'),
  terms: t('Abasare: ukomeje wemeye amabwiriza n\'ibanga ry\'amakuru (reba porogaramu ya Abasare).\n1 Emera\n2 Hakana',
    'Abasare : en continuant, vous acceptez les conditions et la politique de confidentialité (voir l\'appli Abasare).\n1 Accepter\n2 Refuser',
    'Abasare: by continuing you accept our terms and privacy policy (see the Abasare app).\n1 Accept\n2 Decline'),
  terms_declined: t('Ntushobora gukoresha iyi serivisi utemeye amabwiriza. Murakoze.', 'Vous devez accepter les conditions pour utiliser ce service. Merci.', 'You must accept the terms to use this service. Thank you.'),
  main: t('Abasare\n1 Saba urugendo\n2 Urugendo rwanjye\n3 Abasare (imodoka yanjye)\n4 Ubufasha\n0 Ururimi', 'Abasare\n1 Demander une course\n2 Ma course\n3 Abasare (ma voiture)\n4 Aide\n0 Langue', 'Abasare\n1 Request a ride\n2 My trip\n3 Abasare (my car)\n4 Help\n0 Language'),
  invalid: t('Wahisemo nabi.', 'Choix invalide.', 'Invalid choice.'),
  back: t('0 Subira inyuma', '0 Retour', '0 Back'),
  pickup: t('Aho ugiye gufatirwa:', 'Départ :', 'Pickup:'),
  dest: t('Aho ujya:', 'Destination :', 'Destination:'),
  fares: t('Igiciro (ishyura mu ntoki):', 'Tarif (espèces) :', 'Fare (cash):'),
  confirm: t('{svc} {fare} RWF, mu ntoki.\n1 Emeza\n2 Hagarika', '{svc} {fare} RWF, espèces.\n1 Confirmer\n2 Annuler', '{svc} {fare} RWF, cash.\n1 Confirm\n2 Cancel'),
  booked: t('Ubusabe {ref} bwoherejwe. Turashaka umushoferi. Uzabona SMS.', 'Demande {ref} envoyée. Recherche d\'un chauffeur. Vous recevrez un SMS.', 'Request {ref} sent. We are finding a driver. You will get an SMS.'),
  cancelled_end: t('Ntiwemeje. Nta busabe bwoherejwe.', 'Non confirmé. Aucune demande envoyée.', 'Not confirmed. No request was sent.'),
  no_drivers: t('Nta bashoferi bahari ubu. Ongera ugerageze nyuma y\'iminota mike.', 'Aucun chauffeur disponible. Réessayez dans quelques minutes.', 'No drivers nearby now. Try again in a few minutes.'),
  no_places: t('Nta hantu hari. Koresha porogaramu ya Abasare.', 'Aucun lieu disponible. Utilisez l\'appli Abasare.', 'No places available. Please use the Abasare app.'),
  has_trip: t('Usanzwe ufite urugendo. Hitamo 2 urebe urugendo rwawe.', 'Vous avez déjà une course. Choisissez 2 pour la voir.', 'You already have a trip. Choose 2 to see it.'),
  no_trip: t('Nta rugendo ufite ubu.', 'Vous n\'avez aucune course en cours.', 'You have no active trip.'),
  trip_search: t('Urugendo {ref}: turashaka umushoferi.', 'Course {ref} : recherche d\'un chauffeur.', 'Trip {ref}: finding a driver.'),
  trip_driver: t('Urugendo {ref}\n{driver} {plate}\nPIN: {pin}', 'Course {ref}\n{driver} {plate}\nPIN : {pin}', 'Trip {ref}\n{driver} {plate}\nPIN: {pin}'),
  trip_going: t('Urugendo {ref} ruri mu nzira.', 'Course {ref} en cours.', 'Trip {ref} is in progress.'),
  trip_done: t('Urugendo {ref} rwarangiye. Igiciro {fare} RWF, ishyura umushoferi mu ntoki.', 'Course {ref} terminée. Tarif {fare} RWF, payez le chauffeur en espèces.', 'Trip {ref} is done. Fare {fare} RWF, pay the driver in cash.'),
  trip_cancel_opt: t('1 Hagarika urugendo\n0 Subira inyuma', '1 Annuler la course\n0 Retour', '1 Cancel trip\n0 Back'),
  cancel_ask: t('Guhagarika urugendo {ref}?\n1 Yego\n2 Oya', 'Annuler la course {ref} ?\n1 Oui\n2 Non', 'Cancel trip {ref}?\n1 Yes\n2 No'),
  cancel_done: t('Urugendo rwahagaritswe.', 'Course annulée.', 'Trip cancelled.'),
  cancel_fee: t('Urugendo rwahagaritswe. Ikiguzi: {fee} RWF.', 'Course annulée. Frais : {fee} RWF.', 'Trip cancelled. Fee: {fee} RWF.'),
  cancel_kept: t('Urugendo ntiruhagaritswe.', 'La course n\'est pas annulée.', 'Trip not cancelled.'),
  cancel_late: t('Urugendo ntirushobora guhagarikwa ubu.', 'La course ne peut plus être annulée.', 'This trip can no longer be cancelled.'),
  no_car: t('Banza wandike imodoka yawe muri porogaramu ya Abasare, hanyuma wongere ukande.', 'Ajoutez d\'abord votre voiture dans l\'appli Abasare, puis recomposez.', 'Add your car in the Abasare app first, then dial again.'),
  car: t('Hitamo imodoka:', 'Choisissez la voiture :', 'Choose car:'),
  hours: t('Amasaha:\n1 Amasaha 2\n2 Amasaha 3\n3 Amasaha 4\n4 Amasaha 6\n0 Subira inyuma', 'Durée :\n1 2 heures\n2 3 heures\n3 4 heures\n4 6 heures\n0 Retour', 'Hours:\n1 2 hours\n2 3 hours\n3 4 hours\n4 6 hours\n0 Back'),
  abasare_confirm: t('Abasare {plate} {h}h {fare} RWF mu ntoki. Imodoka ni iyanjye kandi ifite ubwishingizi.\n1 Emeza\n2 Hagarika',
    'Abasare {plate} {h}h {fare} RWF espèces. La voiture est à moi et assurée.\n1 Confirmer\n2 Annuler', 'Abasare {plate} {h}h {fare} RWF cash. This car is mine and insured.\n1 Confirm\n2 Cancel'),
  abasare_booked: t('Ubusabe {ref} bwoherejwe. Uzabona SMS.', 'Demande {ref} envoyée. Vous recevrez un SMS.', 'Request {ref} sent. You will get an SMS.'),
  abasare_deposit: t('Ubusabe {ref}. Emeza avansi ya {amount} RWF kuri telefone yawe.', 'Demande {ref}. Validez l\'acompte de {amount} RWF sur votre téléphone.', 'Request {ref}. Approve the {amount} RWF deposit on your phone.'),
  abasare_deposit_pay: t('Ubusabe {ref}. Avansi ya {amount} RWF irakenewe: yishyure muri porogaramu.', 'Demande {ref}. Acompte de {amount} RWF requis : payez-le dans l\'appli.', 'Request {ref}. A {amount} RWF deposit is needed: pay it in the app.'),
  help: t('Ibyihutirwa: Polisi 112, Ambulance 912. Ubufasha ku rugendo: porogaramu ya Abasare.', 'Urgences : Police 112, Ambulance 912. Aide sur une course : appli Abasare.', 'Emergency: Police 112, Ambulance 912. Trip help: Abasare app.'),
  blocked: t('Konti yawe ntishobora gukoresha iyi serivisi. Hamagara ubufasha.', 'Votre compte ne peut pas utiliser ce service. Contactez l\'assistance.', 'Your account cannot use this service. Please contact support.'),
  busy: t('Ibyo usabye ni byinshi. Ongera ugerageze nyuma y\'umunota.', 'Trop de demandes. Réessayez dans une minute.', 'Too many requests. Try again in a minute.'),
  error: t('Serivisi ntiraboneka ubu. Ongera ugerageze nyuma.', 'Service indisponible. Réessayez plus tard.', 'Service unavailable. Please try again later.'),
  disabled: t('Iyi serivisi ntiraboneka ubu.', 'Ce service n\'est pas disponible pour le moment.', 'This service is not available right now.'),
  bad_phone: t('Nimero ya telefone ntiyemewe.', 'Numéro de téléphone non valide.', 'Invalid phone number.'),
} as const;
export type TxtKey = keyof typeof TXT;

export const tx = (key: TxtKey, lang: ULang, vars: Record<string, string | number> = {}) =>
  TXT[key][lang].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
export const MAX_SCREEN = 160;
