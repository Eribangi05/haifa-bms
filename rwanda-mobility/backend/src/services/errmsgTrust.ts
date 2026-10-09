// rw / fr messages for the error codes of round 5 (merged into errmsg.ts's table). Placeholders: {minutes}.
type Pair = [rw: string, fr: string];
export const TRUST_ERRORS: Record<string, Pair> = {
  cancel_loop: ['Wahagaritse ingendo nyinshi mu gihe gito. Ongera ugerageze nyuma y\'iminota {minutes}.', 'Vous avez annulé trop de courses en peu de temps. Réessayez dans {minutes} minutes.'],
  service_paused: ['Gusaba ingendo nshya byahagaritswe by\'agateganyo. Ongera ugerageze nyuma gato.', 'Les nouvelles demandes de course sont suspendues pour un moment. Réessayez bientôt.'],
  promo_invalid: ['Iyi kode ntikoreshwa.', 'Ce code n\'est pas utilisable.'],
  promo_device_used: ['Iyi kode yamaze gukoreshwa kuri iyi telefone.', 'Ce code a déjà été utilisé sur ce téléphone.'],
  chat_unavailable: ['Ikiganiro nticyemewe kuri uru rugendo.', 'Le chat n\'est pas disponible pour cette course.'],
  vehicle_not_editable: ['Iki kinyabiziga ntigishobora guhindurwa kuko kiri gusuzumwa cyangwa cyemejwe.', 'Ce véhicule ne peut plus être modifié : il est en cours d\'examen ou déjà approuvé.'],
  vehicle_already_pending: ['Usanzwe ufite icyifuzo cy\'ikinyabiziga gisuzumwa.', 'Vous avez déjà une demande de véhicule en cours d\'examen.'],
  not_approved_driver: ['Banza wemezwe nk\'umushoferi mbere yo gusaba ikinyabiziga.', 'Vous devez d\'abord être approuvé comme chauffeur avant de demander un véhicule.'],
  navigation_unavailable: ['Kuyoborwa mu nzira ntibishoboka ubu.', 'Le guidage n\'est pas disponible pour le moment.'],
  location_unknown: ['Aho uri ntiharamenyekana. Fungura GPS maze ugerageze.', 'Votre position n\'est pas encore connue. Activez le GPS puis réessayez.'],
  referral_disabled: ['Ibihembo byo gutumira abandi ntibirakorwa.', 'Les récompenses de parrainage ne sont pas actives.'],
};
