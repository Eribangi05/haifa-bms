// Localised user-facing error messages. The API keeps stable machine `code`s; only `message` is localised.
// Rule: the UI must never mix languages, so for rw/fr we NEVER fall back to the English text.
// Placeholders: {min} {max} {minutes} {years} {seconds} are filled from `details` when present.
import { GROWTH_ERRORS, GROWTH_NOUNS } from './errmsgGrowth.js';
import { TRUST_ERRORS } from './errmsgTrust.js';
export type Lang = 'rw' | 'fr' | 'en';

export function reqLang(header?: string): Lang {
  const first = String(header ?? '').split(',')[0]?.trim().toLowerCase().split(/[-;_]/)[0];
  return first === 'rw' || first === 'fr' || first === 'en' ? first : 'en';
}

/** Picks the text for the caller's language (Accept-Language), for static sentences in successful responses. Never mixes languages. */
export const pickLang = (req: { headers: Record<string, any> }, text: Record<Lang, string>): string => text[reqLang(req.headers['accept-language'])];

type Pair = [rw: string, fr: string];
import { MONEY_ERRORS } from './moneyErrors.js';

export const GENERIC: Record<Exclude<Lang, 'en'>, string> = {
  rw: 'Hari ikitagenze neza. Ongera ugerageze.',
  fr: 'Une erreur s\'est produite. Veuillez réessayer.',
};

// Message variants of the same code are keyed `code|English message`; the plain `code` entry is the default.
const T: Record<string, Pair> = {
  ...MONEY_ERRORS,   // round 3: credit, loyalty, deposit, claims (services/moneyErrors.ts)
  // --- generic / transport
  validation_error: ['Amakuru winjije ntabwo ari yo. Suzuma hanyuma ongera ugerageze.', 'Les informations saisies ne sont pas valides. Vérifiez-les et réessayez.'],
  bad_request: ['Ubusabe ntibwumvikanye. Ongera ugerageze.', 'La requête est incorrecte. Veuillez réessayer.'],
  bad_json: ['Ubusabe ntibwumvikanye. Ongera ugerageze.', 'La requête est incorrecte. Veuillez réessayer.'],
  internal_error: ['Hari ikitagenze neza. Ongera ugerageze nyuma y\'akanya. Nibikomeza, hamagara ubufasha.', 'Un problème est survenu. Réessayez dans un instant. Si cela continue, contactez l\'assistance.'],
  not_found: ['Ntitwabonye icyo ushaka.', 'Élément introuvable.'],
  unauthorized: ['Banza winjire muri konti yawe.', 'Veuillez vous connecter à votre compte.'],
  'unauthorized|session ended': ['Igihe cyawe cyo gukoresha porogaramu cyarangiye. Ongera winjire.', 'Votre session est terminée. Veuillez vous reconnecter.'],
  'unauthorized|session expired': ['Igihe cyawe cyo gukoresha porogaramu cyarangiye. Ongera winjire.', 'Votre session a expiré. Veuillez vous reconnecter.'],
  'unauthorized|session revoked': ['Wasohotse kuri iki gikoresho. Ongera winjire.', 'Vous avez été déconnecté de cet appareil. Veuillez vous reconnecter.'],
  'unauthorized|invalid refresh token': ['Igihe cyawe cyo gukoresha porogaramu cyarangiye. Ongera winjire.', 'Votre session a expiré. Veuillez vous reconnecter.'],
  'unauthorized|invalid credentials': ['Amakuru winjije ntabwo ari yo.', 'Identifiants incorrects.'],
  locked: ['Konti yawe yafunzwe by\'agateganyo. Gerageza nyuma.', 'Votre compte est temporairement verrouillé. Réessayez plus tard.'],
  forbidden: ['Ntabwo wemerewe gukora ibi.', 'Vous n\'êtes pas autorisé à effectuer cette action.'],
  'forbidden|Account is not active': ['Konti yawe ntikora kuri ubu. Hamagara ubufasha.', 'Votre compte n\'est pas actif. Contactez l\'assistance.'],
  'forbidden|Corporate account is not active': ['Konti y\'ikigo cyawe ntikora kuri ubu.', 'Le compte de votre entreprise n\'est pas actif.'],
  'forbidden|You are not an authorised member of this business account': ['Ntabwo uri umunyamuryango wemerewe kuri konti y\'iki kigo.', 'Vous n\'êtes pas membre autorisé de ce compte entreprise.'],
  'forbidden|Your account cannot apply right now': ['Konti yawe ntishobora gutanga ubusabe ubu.', 'Votre compte ne peut pas déposer de candidature pour le moment.'],
  'forbidden|Only the fleet owner can request payouts': ['Nyir\'ikigo cy\'imodoka ni we wenyine ushobora gusaba kwishyurwa.', 'Seul le propriétaire de la flotte peut demander un paiement.'],
  'forbidden|Fleet must be verified before inviting drivers': ['Ikigo cyawe kigomba kubanza kugenzurwa mbere yo gutumira abashoferi.', 'Votre flotte doit d\'abord être vérifiée avant d\'inviter des chauffeurs.'],
  'forbidden|link expired or invalid': ['Iyi link yararangiye cyangwa ntiyemewe.', 'Ce lien a expiré ou n\'est pas valide.'],
  rate_limited: ['Wagerageje inshuro nyinshi. Tegereza gato hanyuma ugerageze.', 'Trop de tentatives. Patientez un instant puis réessayez.'],
  'rate_limited|Too many wrong attempts. Request a new code.': ['Wagerageje kode itari yo inshuro nyinshi. Saba indi kode.', 'Trop de codes erronés. Demandez un nouveau code.'],
  'rate_limited|Too many codes requested for this number. Try later.': ['Wasabye kode inshuro nyinshi kuri iyi nimero. Ongera ugerageze nyuma.', 'Trop de codes demandés pour ce numéro. Réessayez plus tard.'],
  'rate_limited|Too many codes requested from this network. Try later.': ['Hasabwe kode nyinshi kuri uyu murongo. Ongera ugerageze nyuma.', 'Trop de codes demandés depuis ce réseau. Réessayez plus tard.'],
  too_many_requests: ['Wagerageje inshuro nyinshi. Tegereza gato hanyuma ugerageze.', 'Trop de tentatives. Patientez un instant puis réessayez.'],
  idempotency_key_required: ['Ubusabe ntibwuzuye. Ongera ugerageze.', 'Requête incomplète. Veuillez réessayer.'],
  provider_error: ['Ntitwashoboye kugera kuri MTN Mobile Money. Ongera ugerageze cyangwa wishyure mu ntoki.', 'Impossible de joindre le service de paiement mobile. Réessayez ou payez en espèces.'],
  FST_ERR_CTP_INVALID_MEDIA_TYPE: ['Ubusabe ntibwumvikanye. Ongera ugerageze.', 'La requête est incorrecte. Veuillez réessayer.'],
  FST_ERR_CTP_BODY_TOO_LARGE: ['Ibyoherejwe ni binini cyane.', 'Les données envoyées sont trop volumineuses.'],
  FST_REQ_FILE_TOO_LARGE: ['Idosiye ni nini cyane. Ntishobora kurenza 5 MB.', 'Le fichier est trop volumineux. Taille maximale : 5 Mo.'],

  // --- sign-in / OTP
  otp_invalid: ['Kode winjije ntabwo ari yo. Ongera ugerageze.', 'Le code saisi est incorrect. Veuillez réessayer.'],
  'otp_invalid|Code expired or not requested': ['Kode yararangiye cyangwa ntiwayisabye. Saba indi kode.', 'Le code a expiré ou n\'a pas été demandé. Demandez un nouveau code.'],
  'otp_invalid|Wrong code': ['Kode winjije ntabwo ari yo. Ongera ugerageze.', 'Le code saisi est incorrect. Veuillez réessayer.'],
  'otp_invalid|Code already used': ['Iyi kode yarakoreshejwe. Saba indi kode.', 'Ce code a déjà été utilisé. Demandez un nouveau code.'],
  otp_cooldown: ['Tegereza amasegonda {seconds} mbere yo gusaba indi kode.', 'Patientez {seconds} secondes avant de demander un nouveau code.'],
  invalid_phone: ['Andika nimero ya telefone yemewe, hamwe n\'inyuguti z\'igihugu (urugero +250 7XX XXX XXX).', 'Saisissez un numéro de téléphone valide avec son indicatif de pays (+250 7XX XXX XXX).'],
  suspicious_registration: ['Hafunguwe konti nyinshi kuri iki gikoresho. Hamagara ubufasha.', 'Trop de comptes ont été créés depuis cet appareil. Contactez l\'assistance.'],
  not_a_driver: ['Iyi konti ntabwo ari iy\'umushoferi.', 'Ce compte n\'est pas un compte chauffeur.'],

  // --- request codes
  code_invalid: ['Iyi kode ntiyemewe cyangwa yararangiye.', 'Ce code n\'est pas valide ou a expiré.'],

  // --- booking / quote
  active_booking_exists: ['Usanzwe ufite urugendo rurimo gukorwa.', 'Vous avez déjà une course en cours.'],
  active_trip: ['Banza urangize urugendo urimo mbere yo guhagarika akazi.', 'Terminez d\'abord votre course en cours avant de vous mettre hors ligne.'],
  active_trips: ['Uyu mukoresha afite ingendo zitararangira cyangwa zitaishyuwe.', 'Cet utilisateur a des courses en cours ou impayées.'],
  destination_required: ['Hitamo aho ujya.', 'Choisissez une destination.'],
  'destination_required|Choose where to be driven': ['Hitamo aho ushaka kujyanwa.', 'Choisissez où vous souhaitez être conduit.'],
  quote_expired: ['Igiciro cyararangiye. Ongera ukibaze.', 'Le prix a expiré. Veuillez demander un nouveau tarif.'],
  quote_used: ['Iki giciro cyarakoreshejwe. Ongera ukibaze.', 'Ce tarif a déjà été utilisé. Veuillez en demander un nouveau.'],
  invalid_quote: ['Igiciro ntikiboneka. Ongera ukibaze.', 'Ce tarif n\'est pas valide. Veuillez en demander un nouveau.'],
  invalid_route: ['Aho ujya cyangwa aho uvuye ntibyemewe. Ongera ugerageze.', 'Itinéraire invalide. Veuillez réessayer.'],
  pickup_outside_coverage: ['Aho uzamukira ntabwo turahakorera.', 'Le lieu de prise en charge est en dehors de notre zone de service.'],
  service_unavailable: ['Iyi serivisi ntiboneka aho uri.', 'Ce service n\'est pas disponible ici.'],
  scheduled_disabled: ['Gutegura urugendo mbere ntibirashoboka ubu.', 'La réservation à l\'avance n\'est pas disponible pour le moment.'],
  no_pricing_rule: ['Nta giciro rihari kuri iyi serivisi aha hantu.', 'Aucun tarif n\'est disponible pour ce service dans cette zone.'],
  vehicle_mismatch: ['Iki giciro cyatanzwe ku yindi modoka.', 'Ce tarif a été établi pour un autre véhicule.'],
  promo_invalid: ['Kode y\'igabanywa ntiyemewe.', 'Ce code promo n\'est pas valide.'],
  promotions_disabled: ['Igabanywa ntiriboneka ubu.', 'Les promotions ne sont pas disponibles pour le moment.'],
  invalid_extra: ['Amafaranga y\'inyongera ntabwo ari yo.', 'Le montant supplémentaire n\'est pas valide.'],
  corporate_disabled: ['Konti z\'ibigo ntizirashoboka ubu.', 'Les comptes entreprise ne sont pas disponibles pour le moment.'],
  corporate_payment_mismatch: ['Kwishyura n\'ikigo bisaba konti y\'ikigo.', 'Le paiement entreprise nécessite un compte entreprise.'],
  corporate_booking: ['Ingendo z\'ikigo zishyurwa n\'ikigo.', 'Les courses entreprise sont facturées à l\'entreprise.'],
  corporate_budget_exceeded: ['Ingengo y\'imari y\'ikigo ku kwezi yarenga.', 'Le budget transport mensuel de l\'entreprise serait dépassé.'],
  corporate_max_fare: ['Igiciro kirenze igihe cyemewe n\'ikigo.', 'Le tarif dépasse le plafond fixé par l\'entreprise.'],
  corporate_member_limit: ['Amafaranga yemewe ku kwezi kuri uyu mukozi yarenga.', 'Le plafond mensuel de cet employé serait dépassé.'],
  corporate_service_not_allowed: ['Iyi serivisi ntiyemewe n\'amategeko y\'ikigo.', 'Ce service n\'est pas autorisé par la politique de l\'entreprise.'],
  corporate_time_not_allowed: ['Iki gihe ntikemewe n\'amategeko y\'ikigo.', 'Cet horaire n\'est pas autorisé par la politique de l\'entreprise.'],
  idempotency_conflict: ['Ubu busabe bwarakozwe. Ongera urebe.', 'Cette requête a déjà été traitée. Vérifiez à nouveau.'],
  cannot_cancel: ['Ntushobora guhagarika uru rugendo ubu.', 'Vous ne pouvez plus annuler cette course.'],
  stale_version: ['Urugendo rwahindutse. Ongera ufungure urugendo hanyuma ugerageze.', 'La course a changé. Actualisez puis réessayez.'],
  invalid_state: ['Ibi ntibishoboka kuko imiterere y\'urugendo yahindutse. Ongera ufungure urugendo.', 'Action impossible : l\'état de la course a changé. Actualisez la course.'],
  invalid_transition: ['Ibi ntibishoboka kuko imiterere y\'urugendo yahindutse.', 'Action impossible : l\'état de la course a changé.'],
  not_ratable: ['Ushobora gutanga amanota ku ngendo zarangiye gusa.', 'Seules les courses terminées peuvent être notées.'],
  already_rated: ['Wamaze gutanga amanota kuri uru rugendo.', 'Vous avez déjà noté cette course.'],
  no_receipt: ['Inyemezabwishyu iboneka urugendo rumaze kurangira.', 'Le reçu est disponible une fois la course terminée.'],
  already_open: ['Usanzwe ufite ubusabe bumeze nk\'ubu butararangira.', 'Vous avez déjà une demande ouverte de ce type.'],
  not_resolved: ['Ushobora gutanga igitekerezo ikibazo kimaze gukemurwa.', 'Vous pourrez donner votre avis une fois la demande résolue.'],
  chat_closed: ['Ikiganiro cyarafunzwe kuko urugendo rwarangiye.', 'La discussion est fermée car la course est terminée.'],
  already_done: ['Ibi byamaze gukorwa.', 'C\'est déjà fait.'],
  fee_changed: ['Amafaranga y\'inyongera yo guhagarika yarahindutse. Ongera ukibaze igiciro.', 'Vos frais d\'annulation en attente ont changé. Veuillez redemander le tarif.'],
  debt_in_use: ['Aya mafaranga ari ku rugendo rukirimo gukorwa. Ntushobora kuyakuraho ubu.', 'Ces frais sont rattachés à une course en cours et ne peuvent pas être annulés pour le moment.'],
  already_finalised: ['Igiciro cy\'urugendo cyamaze kwemezwa.', 'Le tarif de la course est déjà finalisé.'],

  // --- payments
  no_cash_due: ['Nta mafaranga yo kwishyura mu ntoki asabwa kuri uru rugendo.', 'Aucun paiement en espèces n\'est dû pour cette course.'],
  cash_partly_collected: ['Igice cy\'amafaranga cyamaze kwakirwa mu ntoki.', 'Une partie des espèces a déjà été encaissée.'],
  payment_in_flight: ['Tegereza ko ubusabe bwa Mobile Money burangira mbere yo guhindura uburyo bwo kwishyura.', 'Attendez la fin de la demande Mobile Money avant de changer de mode de paiement.'],
  payment_method_unavailable: ['Ubu buryo bwo kwishyura ntibuboneka. Hitamo ubundi.', 'Ce mode de paiement n\'est pas disponible. Choisissez-en un autre.'],
  no_successful_payment: ['Nta kwishyura kwuzuye kwo kugarurira amafaranga.', 'Aucun paiement abouti à rembourser.'],
  invalid_amount: ['Amafaranga yanditse ntabwo ari yo.', 'Le montant saisi n\'est pas valide.'],
  refund_exceeds_payment: ['Amafaranga yo kugarura arenze ayishyuwe.', 'Le remboursement dépasse le montant payé.'],
  outstanding_balance: ['Banza wishyure amafaranga asigaye mbere yo gusiba konti.', 'Réglez d\'abord le solde en cours avant de supprimer le compte.'],

  // --- driver: offers, trip steps
  driver_busy: ['Usanzwe ufite urugendo rurimo gukorwa.', 'Vous avez déjà une course en cours.'],
  driver_not_dispatchable: ['Umushoferi ntari ku murongo cyangwa ntiyemerewe gukora.', 'Le chauffeur n\'est pas en ligne ou n\'est pas autorisé à travailler.'],
  driver_skills_mismatch: ['Umushoferi ntiyemerewe gutwara ubu bwoko bw\'imodoka.', 'Le chauffeur n\'est pas approuvé pour ce type de véhicule ou de boîte de vitesses.'],
  vehicle_not_suitable: ['Imodoka y\'umushoferi ntikwiranye n\'iyi serivisi.', 'Le véhicule du chauffeur ne convient pas à ce service.'],
  not_permitted_to_work: ['Ntabwo uremererwa gutangira akazi. Reba ibyangombwa byawe n\'imiterere ya konti.', 'Vous ne pouvez pas encore vous mettre en ligne. Vérifiez vos documents et le statut de votre compte.'],
  'not_permitted_to_work|Not eligible for this trip': ['Ntiwemerewe gukora uru rugendo.', 'Vous n\'êtes pas éligible pour cette course.'],
  offer_expired: ['Ubusabe bw\'urugendo bwararangiye.', 'L\'offre de course a expiré.'],
  offer_no_longer_available: ['Uru rugendo ntirukiboneka.', 'Cette course n\'est plus disponible.'],
  offer_not_found: ['Ntitwabonye ubu busabe bw\'urugendo.', 'Offre de course introuvable.'],
  location_stale: ['Fungura aho uri (GPS) kugira ngo wemeze ko wahageze.', 'Activez la localisation pour confirmer votre arrivée.'],
  too_far_from_pickup: ['Ntabwo uragera aho umugenzi azamukira.', 'Vous n\'êtes pas encore au lieu de prise en charge.'],
  wait_longer: ['Tegereza nibura iminota {minutes} mbere yo kuvuga ko umugenzi atabonetse.', 'Attendez au moins {minutes} minutes avant de signaler une absence du passager.'],
  pin_invalid: ['PIN winjije ntabwo ari yo.', 'Le code PIN saisi est incorrect.'],
  pin_locked: ['Wagerageje PIN itari yo inshuro nyinshi. Hamagara ubufasha.', 'Trop de codes PIN erronés. Contactez l\'assistance.'],
  reason_required: ['Andika impamvu.', 'Veuillez indiquer un motif.'],
  note_required: ['Sobanura ikibazo.', 'Veuillez décrire le problème.'],
  'note_required|Explain what is wrong so the driver can fix it': ['Sobanura ikitagenda neza kugira ngo umushoferi akikosore.', 'Expliquez le problème afin que le chauffeur puisse le corriger.'],
  'note_required|Describe the issue': ['Sobanura ikibazo.', 'Décrivez le problème.'],
  self_remove: ['Ntushobora kwikuraho.', 'Vous ne pouvez pas vous retirer vous-même.'],

  // --- driver onboarding / documents
  application_incomplete: ['Banza wuzuze umwirondoro wawe n\'amakuru y\'imodoka cyangwa ya Abasare.', 'Complétez d\'abord votre profil et les informations de votre véhicule ou d\'Abasare.'],
  documents_missing: ['Ohereza ibyangombwa byose bisabwa.', 'Envoyez tous les documents requis.'],
  documents_not_approved: ['Ibyangombwa byose bisabwa bigomba kubanza kwemezwa.', 'Tous les documents obligatoires doivent d\'abord être approuvés.'],
  expiry_required: ['Iki cyangombwa gisaba itariki kirangiriraho.', 'Ce document nécessite une date d\'expiration.'],
  already_expired: ['Iki cyangombwa cyararangiye.', 'Ce document a déjà expiré.'],
  expiry_too_far: ['Reba itariki irangiriraho: irenze imyaka 20.', 'Vérifiez la date d\'expiration : elle est à plus de 20 ans.'],
  file_required: ['Hitamo idosiye yo kohereza.', 'Sélectionnez un fichier à envoyer.'],
  file_too_large: ['Idosiye ni nini cyane. Ntishobora kurenza 5 MB.', 'Le fichier est trop volumineux. Taille maximale : 5 Mo.'],
  unsupported_file: ['Ubu bwoko bw\'idosiye ntibwemewe. Koresha ifoto (JPG, PNG) cyangwa PDF.', 'Ce type de fichier n\'est pas accepté. Utilisez une photo (JPG, PNG) ou un PDF.'],
  file_unsafe: ['Iyi dosiye ntishobora kwemerwa kuko ishobora guteza ibibazo by\'umutekano. Koresha ifoto cyangwa PDF isanzwe.', 'Ce fichier ne peut pas être accepté car il peut présenter un risque de sécurité. Utilisez une photo ou un PDF standard.'],
  scan_unavailable: ['Ntitwashoboye gusuzuma iyi dosiye ubu. Ongera ugerageze nyuma y\'akanya.', 'Impossible de vérifier ce fichier pour le moment. Réessayez dans un instant.'],
  too_many_photos: ['Amafoto ni menshi cyane.', 'Trop de photos.'],
  not_editable: ['Ubusabe bwawe ntibushobora guhindurwa ubu.', 'Votre candidature ne peut plus être modifiée.'],
  already_applied: ['Wamaze gutanga ubusabe bwo kuba Umusare.', 'Vous avez déjà déposé une candidature pour devenir Umusare.'],
  not_applied: ['Uyu mushoferi ntabwo yasabye kuba Umusare.', 'Ce chauffeur n\'a pas candidaté pour devenir Umusare.'],
  no_vehicle: ['Nta modoka cyangwa ubusabe bwa Abasare buhari bwo kwemeza.', 'Aucun véhicule ou candidature Abasare à approuver.'],
  account_not_approvable: ['Konti y\'umushoferi ntishobora kwemezwa muri iki gihe.', 'Le compte du chauffeur ne peut pas être approuvé dans son état actuel.'],
  plate_in_use: ['Iyi plaque yamaze kwandikwa ku yindi konti.', 'Cette plaque d\'immatriculation est déjà enregistrée.'],
  licence_too_new: ['Ugomba kuba umaze nibura imyaka {years} ufite uruhushya rwo gutwara.', 'Vous devez détenir votre permis de conduire depuis au moins {years} ans.'],
  invalid_licence_date: ['Itariki y\'uruhushya rwo gutwara ntabwo ari yo.', 'La date d\'obtention du permis n\'est pas valide.'],
  skills_required: ['Hitamo ubwoko bw\'imodoka n\'uburyo bwazo (manuel cyangwa automatique) ushobora gutwara.', 'Choisissez les types de véhicules et de boîtes de vitesses que vous savez conduire.'],

  // --- Abasare (drive my own car)
  abasare_disabled: ['Abasare ntiraboneka ubu.', 'Abasare n\'est pas disponible pour le moment.'],
  attestation_required: ['Emeza ko iyi modoka ari iyawe cyangwa ko wemerewe kuyikoresha, kandi ko ubwishingizi bwayo bwemera undi mushoferi.', 'Confirmez que vous êtes propriétaire de ce véhicule ou autorisé à l\'utiliser, et que son assurance couvre un autre conducteur.'],
  insurance_confirmation_required: ['Emeza ko iyi modoka ifite ubwishingizi bugifite agaciro muri "Imodoka zanjye".', 'Confirmez que ce véhicule a une assurance valide dans « Mes véhicules ».'],
  car_in_use: ['Iyi modoka iri mu rugendo. Ntushobora kuyikuraho cyangwa kuyihindura ubu.', 'Ce véhicule est utilisé pour une course. Vous ne pouvez pas le retirer ou le modifier maintenant.'],
  limit: ['Wageze ku mubare ntarengwa.', 'Vous avez atteint la limite autorisée.'],
  'limit|Maximum 5 cars': ['Ushobora kwandikisha imodoka 5 gusa.', 'Vous pouvez enregistrer 5 véhicules au maximum.'],
  'limit|Too many saved places': ['Wageze ku mubare ntarengwa w\'ahantu wabitse.', 'Vous avez atteint le nombre maximum de lieux enregistrés.'],
  'limit|Maximum 5 emergency contacts': ['Ushobora kwandika abantu 5 gusa bo guhamagara mu byihutirwa.', 'Vous pouvez enregistrer 5 contacts d\'urgence au maximum.'],
  invalid_hours: ['Hitamo amasaha hagati ya {min} na {max}.', 'Choisissez entre {min} et {max} heures.'],
  invalid_schedule: ['Itariki cyangwa isaha yo gutegura ntabwo byemewe.', 'La date ou l\'heure de la réservation n\'est pas valide.'],
  not_an_abasare_booking: ['Uru rugendo si urwa Abasare.', 'Cette course n\'est pas une course Abasare.'],
  handover_required: ['Banza wandike imiterere y\'imodoka (amafoto, kilometrage, lisansi).', 'Enregistrez d\'abord l\'état du véhicule (photos, kilométrage, carburant).'],
  not_recorded_yet: ['Umushoferi ntaraandika imiterere y\'imodoka.', 'Le chauffeur n\'a pas encore enregistré l\'état du véhicule.'],
  already_submitted: ['Iri genzura ryamaze gutangwa.', 'Cette vérification a déjà été envoyée.'],
  already_confirmed: ['Wamaze kwemeza iyi miterere y\'imodoka.', 'Vous avez déjà confirmé cet état du véhicule.'],
  handover_disputed: ['Imiterere y\'imodoka iracyajyanye n\'ikibazo cyatanzwe. Ubufasha buzakuvugisha.', 'L\'état du véhicule fait l\'objet d\'un litige. L\'assistance vous contactera.'],
  photos_required: ['Fata nibura amafoto {min} y\'imodoka.', 'Prenez au moins {min} photos du véhicule.'],
  odometer_decreased: ['Kilometrage yo ku iherezo ntishobora kuba iri munsi y\'iyo ku ntangiriro.', 'Le kilométrage à l\'arrivée ne peut pas être inférieur à celui du départ.'],
  window_closed: ['Ikibazo gitangwa mu minota {minutes} nyuma yo kugezwa aho wajyaga. Hamagara ubufasha.', 'Un problème peut être signalé dans les {minutes} minutes suivant l\'arrivée. Contactez l\'assistance.'],
  'invalid_state|Record the car at pickup after you arrive and before starting': ['Andika imiterere y\'imodoka umaze kugera aho uzamukira, mbere yo gutangira.', 'Enregistrez l\'état du véhicule après votre arrivée et avant le départ.'],

  // --- payouts / balances (owners, drivers)
  no_payout_account: ['Banza wandike nimero ya Mobile Money yo kwishyurwaho.', 'Enregistrez d\'abord un numéro Mobile Money pour recevoir vos paiements.'],
  below_minimum: ['Amafaranga make yo kubikuza ni {min} RWF.', 'Le montant minimum de retrait est de {min} RWF.'],
  below_fee: ['Amafaranga asabwe ni make kurusha ibyo gukata.', 'Le montant est inférieur aux frais de retrait.'],
  insufficient_balance: ['Amafaranga ufite ntahagije.', 'Votre solde disponible est insuffisant.'],
  exceeds_cash_held: ['Amafaranga arenze ayo umushoferi afite.', 'Le montant dépasse les espèces détenues par le chauffeur.'],
  fleet_disabled: ['Serivisi y\'ibigo by\'imodoka ntiraboneka ubu.', 'Le portail des flottes n\'est pas disponible pour le moment.'],
  already_decided: ['Ubu busabe bwamaze gufatwaho icyemezo.', 'Cette demande a déjà été traitée.'],

  // --- tips, tags, favourites, safety checks
  invalid_tag: ['Imvugo wahisemo ntiyemewe. Hitamo muri ziri ku rutonde.', 'Ce libellé n\'est pas valide. Choisissez parmi la liste proposée.'],
  tips_disabled: ['Guhemba umushoferi ntibirashoboka ubu.', 'Les pourboires ne sont pas disponibles pour le moment.'],
  tip_too_low: ['Agashimwe gake cyane. Nibura ni {min} RWF.', 'Pourboire trop faible. Le minimum est de {min} RWF.'],
  tip_too_high: ['Agashimwe karenze ibyemewe. Ntikarenze {max} RWF.', 'Pourboire trop élevé. Le maximum est de {max} RWF.'],
  tip_not_allowed: ['Guhemba umushoferi bishoboka nyuma y\'urugendo rwarangiye, mu minsi 7.', 'Le pourboire est possible après une course terminée, pendant 7 jours.'],
  tip_exists: ['Wamaze guhemba umushoferi kuri uru rugendo.', 'Vous avez déjà laissé un pourboire pour cette course.'],
  no_open_safety_check: ['Nta kibazo cyo kukugenzura gitegereje igisubizo cyawe.', 'Aucune vérification de sécurité n\'attend votre réponse.'],
  not_ridden: ['Ushobora gushyira ku rutonde gusa umushoferi mwakoranye urugendo.', 'Vous ne pouvez ajouter qu\'un chauffeur avec qui vous avez fait une course.'],
};

Object.assign(T, TRUST_ERRORS);   // round 5: fraud checks, chat, vehicle application (services/errmsgTrust.ts)
Object.assign(T, GROWTH_ERRORS);   // round 2: guest rides, schedules, partners, campaigns (services/errmsgGrowth.ts)

const NOUNS: Record<string, Pair> = {
  booking: ['urugendo', 'la course'], 'business account': ['konti y\'ikigo', 'le compte entreprise'], case: ['ikibazo', 'la demande'],
  document: ['icyangombwa', 'le document'], 'driver profile': ['umwirondoro w\'umushoferi', 'le profil du chauffeur'], driver: ['umushoferi', 'le chauffeur'],
  fleet: ['ikigo cy\'imodoka', 'la flotte'], invite: ['ubutumire', 'l\'invitation'], payment: ['kwishyura', 'le paiement'], payout: ['kwishyurwa', 'le paiement'],
  quote: ['igiciro', 'le tarif'], refund: ['kugarurirwa amafaranga', 'le remboursement'], request: ['ubusabe', 'la demande'], service: ['serivisi', 'le service'],
  'share link': ['link yo gusangiza', 'le lien de partage'], user: ['umukoresha', 'l\'utilisateur'], vehicle: ['imodoka', 'le véhicule'],
};

Object.assign(NOUNS, GROWTH_NOUNS);

const fill = (s: string, d: any): string | null => {
  let missing = false;
  const out = s.replace(/\{(\w+)\}/g, (_, k) => { const v = d && typeof d === 'object' ? d[k] : undefined; if (v == null) missing = true; return String(v ?? ''); });
  return missing ? null : out;
};

export function localizeError(code: string, lang: Lang, fallback: string, details?: any): string {
  if (lang === 'en') return fallback;
  const i = lang === 'rw' ? 0 : 1;
  if (code === 'not_found') {
    const m = /^(.*) not found$/.exec(fallback);
    const noun = m ? NOUNS[m[1]]?.[i] : undefined;
    if (noun) return lang === 'rw' ? `Ntitwabonye ${noun}.` : `Impossible de trouver ${noun}.`;
    return T.not_found[i];
  }
  const hit = T[`${code}|${fallback}`] ?? T[code];
  if (!hit) return GENERIC[lang];
  return fill(hit[i], details) ?? GENERIC[lang];   // missing placeholder values: generic text, never half a sentence
}

/** Codes thrown by the API that have no table entry (used by the test-suite to keep this table complete). */
export const KNOWN_CODES = new Set(Object.keys(T).map((k) => k.split('|')[0]));
