import type { FastifyInstance } from 'fastify';
import { sharedView, contactOptOut } from '../services/safety.js';
import { routeLimit } from '../guards.js';
import { SUPPORTED_LANGS, type Lang } from '../services/i18n.js';

/** Language of the public share page: ?lang= wins, then the first supported Accept-Language tag, else Kinyarwanda (product default). */
export function shareLang(query: unknown, acceptLanguage: unknown): Lang {
  const ql = String((query as any)?.lang ?? '').toLowerCase().slice(0, 2);
  if ((SUPPORTED_LANGS as readonly string[]).includes(ql)) return ql as Lang;
  for (const part of String(acceptLanguage ?? '').split(',')) {
    const tag = part.trim().toLowerCase().split(/[-;_]/)[0];
    if ((SUPPORTED_LANGS as readonly string[]).includes(tag)) return tag as Lang;
  }
  return 'rw';
}

type Strings = {
  title: string; loading: string; status: string; driver: string; vehicle: string; to: string; position: string; openMap: string;
  expired: string; offline: string; footer: string; unknown: string; etaPickup: string; etaDest: string; updated: string; stale: string; stop: string; stopped: string; ended: string; statuses: Record<string, string>;
};
export const SHARE_STRINGS: Record<Lang, Strings> = {
  rw: {
    title: 'Aho urugendo rugeze', loading: 'Birimo gufunguka…', status: 'Uko urugendo rumeze', driver: 'Umushoferi', vehicle: 'Imodoka', to: 'Aho ajya', position: 'Aho aherereye ubu',
    openMap: 'Fungura ikarita', expired: 'Iyi link yararangiye cyangwa ntikiboneka.', offline: 'Nta murongo wa interineti. Turongera kugerageza…',
    footer: 'Iyi link yerekana amakuru make y\'urugendo kandi irarangira yonyine.', unknown: 'Ntibizwi',
    etaPickup: 'Umushoferi azahagera nyuma y\'iminota {n}', etaDest: 'Azagerayo nyuma y\'iminota {n}', updated: 'Byavuguruwe saa', stale: 'Aho aherereye ntiharamara kuvugururwa.', stop: 'Ntabwo nkeneye ubu butumwa', stopped: 'Ntituzongera kukohereza ubu butumwa.', ended: 'Urugendo rwarangiye. Iyi link irahita ihagarara.',
    statuses: {
      SCHEDULED: 'Urugendo rwateguwe', REQUESTED: 'Ubusabe bwoherejwe', SEARCHING_DRIVER: 'Turimo gushaka umushoferi', DRIVER_ASSIGNED: 'Umushoferi yabonetse',
      DRIVER_ARRIVING: 'Umushoferi ari mu nzira', DRIVER_ARRIVED: 'Umushoferi yahageze', AWAITING_PASSENGER_VERIFICATION: 'Hategerejwe kugenzura PIN', IN_PROGRESS: 'Urugendo rurimo gukorwa',
      COMPLETED: 'Urugendo rwarangiye', PAYMENT_PENDING: 'Urugendo rwarangiye, hategerejwe kwishyura', PAYMENT_COMPLETED: 'Urugendo rwarangiye kandi rwishyuwe',
      CANCELLATION_REQUESTED: 'Hasabwe guhagarika urugendo', CANCELLED_BY_PASSENGER: 'Urugendo rwahagaritswe n\'umugenzi', CANCELLED_BY_DRIVER: 'Urugendo rwahagaritswe n\'umushoferi',
      CANCELLED_BY_SYSTEM: 'Urugendo rwahagaritswe', NO_DRIVER_FOUND: 'Nta mushoferi wabonetse', DISPUTED: 'Urugendo rufite ikibazo kirimo gukemurwa',
      REFUNDED: 'Amafaranga yagaruwe', PARTIALLY_REFUNDED: 'Igice cy\'amafaranga cyagaruwe', PAYMENT_REVERSED: 'Kwishyura byahagaritswe', DRAFT: 'Urugendo ruritegurwa', FARE_ESTIMATED: 'Urugendo ruritegurwa',
    },
  },
  fr: {
    title: 'État de la course', loading: 'Chargement…', status: 'Statut', driver: 'Chauffeur', vehicle: 'Véhicule', to: 'Destination', position: 'Dernière position',
    openMap: 'ouvrir la carte', expired: 'Ce lien a expiré ou n\'est plus disponible.', offline: 'Hors ligne. Nouvelle tentative…',
    footer: 'Ce lien affiche des informations limitées sur la course et expire automatiquement.', unknown: 'Inconnu',
    etaPickup: 'Le chauffeur arrive dans {n} min', etaDest: 'Arrivée dans {n} min', updated: 'Mis à jour à', stale: 'La position n\'a pas été mise à jour récemment.', stop: 'Ne plus recevoir ces messages', stopped: 'Vous ne recevrez plus ces messages.', ended: 'La course est terminée. Ce lien va expirer.',
    statuses: {
      SCHEDULED: 'Course programmée', REQUESTED: 'Demande envoyée', SEARCHING_DRIVER: 'Recherche d\'un chauffeur', DRIVER_ASSIGNED: 'Chauffeur trouvé',
      DRIVER_ARRIVING: 'Le chauffeur est en route', DRIVER_ARRIVED: 'Le chauffeur est arrivé', AWAITING_PASSENGER_VERIFICATION: 'Vérification du code PIN en cours', IN_PROGRESS: 'Course en cours',
      COMPLETED: 'Course terminée', PAYMENT_PENDING: 'Course terminée, paiement en attente', PAYMENT_COMPLETED: 'Course terminée et payée',
      CANCELLATION_REQUESTED: 'Annulation demandée', CANCELLED_BY_PASSENGER: 'Course annulée par le passager', CANCELLED_BY_DRIVER: 'Course annulée par le chauffeur',
      CANCELLED_BY_SYSTEM: 'Course annulée', NO_DRIVER_FOUND: 'Aucun chauffeur trouvé', DISPUTED: 'Course en litige',
      REFUNDED: 'Remboursée', PARTIALLY_REFUNDED: 'Partiellement remboursée', PAYMENT_REVERSED: 'Paiement annulé', DRAFT: 'Course en préparation', FARE_ESTIMATED: 'Course en préparation',
    },
  },
  en: {
    title: 'Trip status', loading: 'Loading…', status: 'Status', driver: 'Driver', vehicle: 'Vehicle', to: 'To', position: 'Last position',
    openMap: 'open map', expired: 'This link has expired or is no longer available.', offline: 'Offline. Retrying…',
    footer: 'This link shows limited trip details and expires automatically.', unknown: 'Unknown',
    etaPickup: 'Driver arrives in {n} min', etaDest: 'Arriving in {n} min', updated: 'Updated at', stale: 'Position not updated recently.', stop: 'Stop these messages', stopped: 'You will not receive these messages again.', ended: 'The trip has ended. This link will expire soon.',
    statuses: {
      SCHEDULED: 'Trip scheduled', REQUESTED: 'Request sent', SEARCHING_DRIVER: 'Finding a driver', DRIVER_ASSIGNED: 'Driver assigned',
      DRIVER_ARRIVING: 'Driver is on the way', DRIVER_ARRIVED: 'Driver has arrived', AWAITING_PASSENGER_VERIFICATION: 'Verifying the trip PIN', IN_PROGRESS: 'Trip in progress',
      COMPLETED: 'Trip completed', PAYMENT_PENDING: 'Trip completed, payment pending', PAYMENT_COMPLETED: 'Trip completed and paid',
      CANCELLATION_REQUESTED: 'Cancellation requested', CANCELLED_BY_PASSENGER: 'Trip cancelled by the passenger', CANCELLED_BY_DRIVER: 'Trip cancelled by the driver',
      CANCELLED_BY_SYSTEM: 'Trip cancelled', NO_DRIVER_FOUND: 'No driver found', DISPUTED: 'Trip under review',
      REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partially refunded', PAYMENT_REVERSED: 'Payment reversed', DRAFT: 'Trip being prepared', FARE_ESTIMATED: 'Trip being prepared',
    },
  },
};

export async function shareRoutes(app: FastifyInstance) {
  // ---- public trip share (no login; limited data; expiring) ----
  app.get('/share/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const accepts = String(req.headers.accept ?? '');
    if (accepts.includes('application/json')) { reply.header('cache-control', 'no-store'); return sharedView(token); }
    const lang = shareLang(req.query, req.headers['accept-language']);
    reply.header('content-type', 'text/html; charset=utf-8').header('vary', 'accept-language').header('content-language', lang);
    return reply.send(renderSharePage(lang, token));
  });
  // a trusted contact can stop the automatic messages (and this link) for their number
  app.post('/share/:token/stop', { config: routeLimit('SHARE_STOP_RATE_MAX', 10) }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return contactOptOut((req.params as { token: string }).token);
  });
}

const safeJson = (v: unknown) => JSON.stringify(v).split('<').join('\\u003c').split('\u2028').join('').split('\u2029').join('');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderSharePage(lang: Lang, token: string): string {
  const S = SHARE_STRINGS[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(S.title)}</title>
<style>body{font-family:system-ui;margin:0;background:#f4f7f4;color:#14281d}main{max-width:480px;margin:0 auto;padding:20px}.c{background:#fff;border-radius:14px;padding:16px;margin-top:12px;box-shadow:0 1px 4px #0001}h1{color:#00704a}small{color:#567}</style></head>
<body><main><h1>Abasare</h1><div id="o" class="c">${esc(S.loading)}</div><small>${esc(S.footer)}</small><p><button id="stop" type="button" style="background:none;border:0;color:#567;text-decoration:underline;padding:0;cursor:pointer"></button></p></main>
<script>
var S=${safeJson(S)},LANG=${safeJson(lang)},TOKEN=${safeJson(encodeURIComponent(token))};
var o=document.getElementById('o');
function row(label,text,link){var d=document.createElement('div'),b=document.createElement('b');b.textContent=label+': ';d.appendChild(b);
  if(text!=null)d.appendChild(document.createTextNode(text));if(link){var a=document.createElement('a');a.href=link.href;a.textContent=link.text;d.appendChild(a);if(link.after)d.appendChild(document.createTextNode(link.after))}return d}
var timer=null,last=null,sb=document.getElementById('stop');
function fmt(t,n){return t.replace('{n}',String(n))}
function draw(j){o.textContent='';o.appendChild(row(S.status,S.statuses[j.status]||S.unknown));
if(j.driver){o.appendChild(row(S.driver,j.driver.first_name));o.appendChild(row(S.vehicle,[j.driver.vehicle,j.driver.plate].filter(Boolean).join(' · ')))}
if(j.destination)o.appendChild(row(S.to,j.destination));
if(j.eta_s!=null&&j.eta_target){var d=document.createElement('div'),b=document.createElement('b');b.textContent=fmt(j.eta_target==='pickup'?S.etaPickup:S.etaDest,Math.max(1,Math.round(j.eta_s/60)));d.appendChild(b);o.appendChild(d)}
if(j.location){var la=Number(j.location.lat),ln=Number(j.location.lng);
  o.appendChild(row(S.position,null,{href:'https://www.openstreetmap.org/?mlat='+la+'&mlon='+ln+'#map='+'16/'+la+'/'+ln,text:S.openMap,after:' ('+new Date(j.location.at).toLocaleTimeString(LANG)+')'}));
  if(j.location.stale){var w=document.createElement('div');w.textContent=S.stale;w.style.color='#a15c00';o.appendChild(w)}}
if(j.ended){var e=document.createElement('div');e.textContent=S.ended;o.appendChild(e)}
var u=document.createElement('small');u.textContent=S.updated+' '+new Date(j.updated_at).toLocaleTimeString(LANG);o.appendChild(u)}
async function r(){clearTimeout(timer);var next=10000;
try{var x=await fetch('/share/'+TOKEN,{headers:{accept:'application/json'}});var j=await x.json();if(!x.ok){o.textContent=S.expired;return}
last=j;draw(j);sb.style.display=j.can_stop?'':'none';if(!j.poll_after_s)return;next=j.poll_after_s*1000
}catch(e){if(!last)o.textContent=S.offline}
if(document.hidden)return;timer=setTimeout(r,next)}
document.addEventListener('visibilitychange',function(){if(!document.hidden)r()});
sb.textContent=S.stop;sb.onclick=async function(){try{await fetch('/share/'+TOKEN+'/stop',{method:'POST'});clearTimeout(timer);o.textContent=S.stopped;sb.remove()}catch(e){o.textContent=S.offline}};
r()
</script></body></html>`;
}
