// Default message templates. Admin-editable overrides live in notification_templates.
// Keys: {{var}} placeholders. Never put payment credentials or document content in a template.
export const DEFAULT_TEMPLATES: Record<string, Record<string, { title: string; body: string }>> = {
  otp: {
    en: { title: 'Verification code', body: 'Your Abasare code is {{code}}. It expires in {{minutes}} minutes. Never share it.' },
    rw: { title: 'Kode yo kwemeza', body: 'Kode yawe ya Abasare ni {{code}}. Irarangira mu minota {{minutes}}. Ntuyihe undi muntu.' },
  },
  booking_confirmed: {
    en: { title: 'Booking received', body: 'We are finding a driver for booking {{ref}}.' },
    rw: { title: 'Gusaba byakiriwe', body: 'Turimo gushaka umushoferi wa {{ref}}.' },
  },
  driver_assigned: {
    en: { title: 'Driver assigned', body: '{{driver}} ({{plate}}) is on the way. Your trip PIN is shown in the app.' },
    rw: { title: 'Umushoferi yabonetse', body: '{{driver}} ({{plate}}) arimo kukugana. PIN y\'urugendo iri muri porogaramu.' },
  },
  abasare_assigned: {
    en: { title: 'Abasare assigned', body: '{driver} is coming to drive your car {plate}. Check their identity in the app before handing over the keys.' },
    rw: { title: 'Abasare yabonetse', body: '{driver} araje gutwara imodoka yawe {plate}. Genzura umwirondoro we muri porogaramu mbere yo kumuha imfunguzo.' },
  },
  handover_submitted: {
    en: { title: 'Car condition recorded', body: 'Your driver recorded the {phase} condition of your car. Please review and confirm in the app.' },
    rw: { title: 'Imiterere y\'imodoka yanditswe', body: 'Umushoferi yanditse imiterere y\'imodoka yawe ({phase}). Yisuzume ukemeze muri porogaramu.' },
  },
  handover_issue: {
    en: { title: 'Car condition issue reported', body: 'The owner reported an issue with the {phase} condition of booking {ref}. Support will contact you.' },
    rw: { title: 'Ikibazo ku miterere y\'imodoka', body: 'Nyir\'imodoka yatanze ikibazo ku miterere ({phase}) ya {ref}. Ubufasha buzakuvugisha.' },
  },
  driver_arrived: {
    en: { title: 'Driver arrived', body: 'Your driver has arrived. Check the plate {{plate}} before boarding.' },
    rw: { title: 'Umushoferi yahageze', body: 'Umushoferi yahageze. Genzura plaque {{plate}} mbere yo kuzamuka.' },
  },
  trip_started: {
    en: { title: 'Trip started', body: 'Your trip {{ref}} has started.' },
    rw: { title: 'Urugendo rwatangiye', body: 'Urugendo {{ref}} rwatangiye.' },
  },
  trip_completed: {
    en: { title: 'Trip completed', body: 'Trip {{ref}} completed. Fare: {{fare}} RWF.' },
    rw: { title: 'Urugendo rurarangiye', body: 'Urugendo {{ref}} rurarangiye. Igiciro: {{fare}} RWF.' },
  },
  payment_success: {
    en: { title: 'Payment received', body: 'Payment of {{amount}} RWF for {{ref}} was received. Thank you.' },
    rw: { title: 'Kwishyura byakiriwe', body: 'Kwishyura {{amount}} RWF kuri {{ref}} byakiriwe. Murakoze.' },
  },
  payment_failed: {
    en: { title: 'Payment failed', body: 'Payment for {{ref}} did not go through. Please try again or pay cash.' },
    rw: { title: 'Kwishyura byanze', body: 'Kwishyura {{ref}} ntibyakunze. Ongera ugerageze cyangwa wishyure amafaranga.' },
  },
  booking_cancelled: {
    en: { title: 'Booking cancelled', body: 'Booking {{ref}} was cancelled. {{reason}}' },
    rw: { title: 'Gusaba byahagaritswe', body: '{{ref}} yahagaritswe. {{reason}}' },
  },
  no_driver: {
    en: { title: 'No driver available', body: 'No driver accepted {{ref}}. Try another vehicle type, move your pickup, or schedule later.' },
    rw: { title: 'Nta mushoferi uboneka', body: 'Nta mushoferi wemeye {{ref}}. Gerageza ubundi bwoko bw\'ikinyabiziga, hindura aho uzamukira, cyangwa utegure nyuma.' },
  },
  refund_processed: {
    en: { title: 'Refund approved', body: 'A refund of {{amount}} RWF for {{ref}} was approved.' },
    rw: { title: 'Kugarurirwa amafaranga', body: 'Kugarurirwa {{amount}} RWF kuri {{ref}} byemejwe.' },
  },
  doc_expiry: {
    en: { title: 'Document expiring', body: 'Your {{doc}} expires in {{days}} day(s). Upload a new one to keep receiving trips.' },
    rw: { title: 'Icyangombwa kigiye kurangira', body: '{{doc}} yawe irangira mu minsi {{days}}. Ohereza nshya kugira ngo ukomeze guhabwa ingendo.' },
  },
  driver_decision: {
    en: { title: 'Application update', body: 'Your driver application status is now: {{status}}. {{reason}}' },
    rw: { title: 'Amakuru ku busabe bwawe', body: 'Imiterere y\'ubusabe bwawe ni: {{status}}. {{reason}}' },
  },
  payout_update: {
    en: { title: 'Payout update', body: 'Your payout of {{amount}} RWF is now {{status}}.' },
    rw: { title: 'Amakuru ku kwishyurwa', body: 'Kwishyurwa {{amount}} RWF biri: {{status}}.' },
  },
  case_update: {
    en: { title: 'Support update', body: 'Your support case {{ref}} was updated: {{status}}.' },
    rw: { title: 'Amakuru y\'ubufasha', body: 'Ikibazo {{ref}} cyahinduwe: {{status}}.' },
  },
  offer: {
    en: { title: 'New trip offer', body: 'Pickup {{km}} km away. Estimated earnings {{net}} RWF.' },
    rw: { title: 'Urugendo rushya', body: 'Aho uzamukira ni {{km}} km. Inyungu ikekwa {{net}} RWF.' },
  },
  sos_ack: {
    en: { title: 'SOS recorded', body: 'Your SOS was recorded as {{ref}}. If you are in danger call 112 (police) or 912 (ambulance) now. Support has not yet confirmed contact.' },
    rw: { title: 'SOS yanditswe', body: 'SOS yawe yanditswe nka {{ref}}. Niba uri mu kaga hamagara 112 (Polisi) cyangwa 912 (ambulance) ako kanya. Ubufasha ntiburahamya ko bwakuvugishije.' },
  },
};
export const SUPPORTED_LANGS = ['rw', 'en'];
export const render = (tpl: string, p: Record<string, unknown>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(p[k] ?? ''));
