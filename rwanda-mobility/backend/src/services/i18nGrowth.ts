// Message templates of the growth round (guest SMS, recurring rides, quest bonus). Registered into DEFAULT_TEMPLATES by i18n.ts.
// Every template exists in rw, fr and en with identical placeholders (tests/i18n.test.ts checks this). A person only ever sees ONE language.
type Lang = 'rw' | 'fr' | 'en';
type Tpl = { title: string; body: string };
export const GROWTH_TEMPLATES: Record<string, Record<Lang, Tpl>> = {
  guest_assigned: {
    en: { title: 'Your ride', body: 'Abasare: {{booker}} booked a ride for you. Driver {{driver}}, plate {{plate}}. Trip PIN: {{pin}} (give it to the driver). Follow live: {{link}}' },
    rw: { title: 'Urugendo rwawe', body: 'Abasare: {{booker}} yagutumiye urugendo. Umushoferi {{driver}}, plaque {{plate}}. PIN y\'urugendo: {{pin}} (yihe umushoferi). Rukurikirane ako kanya: {{link}}' },
    fr: { title: 'Votre course', body: 'Abasare : {{booker}} a réservé une course pour vous. Chauffeur {{driver}}, plaque {{plate}}. Code PIN : {{pin}} (donnez-le au chauffeur). Suivi en direct : {{link}}' },
  },
  guest_arrived: {
    en: { title: 'Your driver has arrived', body: 'Abasare: your driver {{driver}} has arrived. Plate {{plate}}. Trip PIN: {{pin}}. Follow live: {{link}}' },
    rw: { title: 'Umushoferi wawe yahageze', body: 'Abasare: umushoferi wawe {{driver}} yahageze. Plaque {{plate}}. PIN y\'urugendo: {{pin}}. Rukurikirane ako kanya: {{link}}' },
    fr: { title: 'Votre chauffeur est arrivé', body: 'Abasare : votre chauffeur {{driver}} est arrivé. Plaque {{plate}}. Code PIN : {{pin}}. Suivi en direct : {{link}}' },
  },
  guest_cancelled: {
    en: { title: 'Ride cancelled', body: 'Abasare: the ride {{booker}} booked for you was cancelled.' },
    rw: { title: 'Urugendo rwahagaritswe', body: 'Abasare: urugendo {{booker}} yagutumiye rwahagaritswe.' },
    fr: { title: 'Course annulée', body: 'Abasare : la course que {{booker}} avait réservée pour vous a été annulée.' },
  },
  schedule_booked: {
    en: { title: 'Recurring ride booked', body: 'Your recurring ride on {{date}} at {{time}} is booked. Price: {{amount}} RWF.' },
    rw: { title: 'Urugendo rusubiramo rwateguwe', body: 'Urugendo rwawe rusubiramo rwo ku wa {{date}} saa {{time}} rwateguwe. Igiciro: {{amount}} RWF.' },
    fr: { title: 'Course récurrente réservée', body: 'Votre course récurrente du {{date}} à {{time}} est réservée. Prix : {{amount}} RWF.' },
  },
  schedule_price_changed: {
    en: { title: 'Recurring ride not booked', body: 'Your recurring ride on {{date}} at {{time}} was NOT booked because the price changed from {{old}} to {{new}} RWF. Open the app to accept the new price.' },
    rw: { title: 'Urugendo rusubiramo ntirwateguwe', body: 'Urugendo rwawe rusubiramo rwo ku wa {{date}} saa {{time}} NTIRWATEGUWE kuko igiciro cyavuye kuri {{old}} kigera kuri {{new}} RWF. Fungura porogaramu wemere igiciro gishya.' },
    fr: { title: 'Course récurrente non réservée', body: 'Votre course récurrente du {{date}} à {{time}} n\'a PAS été réservée car le prix est passé de {{old}} à {{new}} RWF. Ouvrez l\'application pour accepter le nouveau prix.' },
  },
  schedule_no_coverage: {
    en: { title: 'Recurring ride not booked', body: 'Your recurring ride on {{date}} at {{time}} could not be booked: no driver is available for it yet. We will keep trying until shortly before the start.' },
    rw: { title: 'Urugendo rusubiramo ntirwateguwe', body: 'Urugendo rwawe rusubiramo rwo ku wa {{date}} saa {{time}} ntirwashoboye gutegurwa: nta mushoferi uraboneka. Tuzakomeza kugerageza kugeza igihe gito mbere y\'uko rutangira.' },
    fr: { title: 'Course récurrente non réservée', body: 'Votre course récurrente du {{date}} à {{time}} n\'a pas pu être réservée : aucun chauffeur n\'est disponible pour le moment. Nous réessaierons jusqu\'à peu avant le départ.' },
  },
  quest_bonus: {
    en: { title: 'Bonus earned', body: 'You completed "{{quest}}" and earned a bonus of {{amount}} RWF.' },
    rw: { title: 'Wabonye igihembo', body: 'Warangije "{{quest}}" kandi wabonye igihembo cya {{amount}} RWF.' },
    fr: { title: 'Bonus gagné', body: 'Vous avez terminé « {{quest}} » et gagné un bonus de {{amount}} RWF.' },
  },
  campaign: {
    en: { title: '{{title}}', body: '{{message}}' }, rw: { title: '{{title}}', body: '{{message}}' }, fr: { title: '{{title}}', body: '{{message}}' },
  },
};
