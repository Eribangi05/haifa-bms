import { q1 } from '../db.js';
import { config } from '../config.js';
import { notFound, badRequest, forbidden } from '../errors.js';
import { signFileToken, verifyFileToken } from '../util/crypto.js';

/**
 * Shareable trip receipt: a signed link (valid 30 days) to a plain, printable page (the browser's "Save as PDF" makes the PDF).
 * Shows route, fare lines, total and payment; the driver appears by first name and plate only. No phone numbers.
 */
type Lang = 'rw' | 'fr' | 'en';
const OK = ['COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const key = (id: string) => `receipt:${id}`;
const TTL_S = 30 * 86400;

export async function receiptLink(userId: string, bookingId: string, lang: Lang) {
  const b = await q1<any>('select id, passenger_id, status from bookings where id=$1', [bookingId]);
  if (!b) throw notFound('booking');
  if (b.passenger_id !== userId) throw forbidden('Only the person who booked can share the receipt');
  if (!OK.includes(b.status)) throw badRequest('no_receipt', 'Receipt is available once the trip is completed');
  return { url: `${config.publicBaseUrl}/receipt/${b.id}?token=${encodeURIComponent(signFileToken(key(b.id), TTL_S))}&lang=${lang}`, expires_in_days: 30 };
}

const S: Record<string, [string, string, string]> = {   // en, fr, rw
  title: ['Trip receipt', 'Reçu de course', 'Inyemezabwishyu y\'urugendo'], no: ['Receipt no.', 'Reçu n°', 'Inomero y\'inyemezabwishyu'], date: ['Date', 'Date', 'Itariki'],
  from: ['From', 'Départ', 'Aho yaturutse'], to: ['To', 'Arrivée', 'Aho yagiye'], dist: ['Distance and time', 'Distance et durée', 'Intera n\'igihe'], driver: ['Driver', 'Chauffeur', 'Umushoferi'],
  fare: ['Fare', 'Tarif', 'Igiciro'], discount: ['Discount', 'Réduction', 'Igabanyirizwa'], tax: ['Tax', 'Taxe', 'Imisoro'], total: ['Total', 'Total', 'Yose hamwe'], pay: ['Payment', 'Paiement', 'Kwishyura'],
  paid: ['Paid', 'Payé', 'Cyishyuwe'], due: ['Payment pending', 'Paiement en attente', 'Hategerejwe kwishyura'], refunded: ['Refunded', 'Remboursé', 'Cyasubijwe'],
  cash: ['Cash', 'Espèces', 'Amafaranga mu ntoki'], mtn_momo: ['MTN MoMo', 'MTN MoMo', 'MTN MoMo'], airtel_money: ['Airtel Money', 'Airtel Money', 'Airtel Money'], wallet: ['Abasare credit', 'Crédit Abasare', 'Amafaranga yo mu ikofi'],
  corporate: ['Company account', 'Compte entreprise', 'Konti y\'ikigo'], card: ['Card', 'Carte', 'Ikarita'], print: ['Print or save as PDF', 'Imprimer ou enregistrer en PDF', 'Capa cyangwa ubike nka PDF'],
  bad: ['This link has expired or is not valid.', 'Ce lien a expiré ou n\'est pas valide.', 'Iyi link yararangiye cyangwa ntikwiye.'],
  thanks: ['Thank you for riding with Abasare.', 'Merci d\'avoir voyagé avec Abasare.', 'Murakoze gutwarwa na Abasare.'],
};
const li = (l: Lang) => ({ en: 0, fr: 1, rw: 2 })[l];
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const CSS = 'body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f4f7f4;color:#14281d}main{max-width:460px;margin:0 auto;padding:18px}.c{background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 4px #0001}h1{margin:0;font-size:20px}.r{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #eef2ef}.r span:first-child{color:#567}.t{font-weight:800;font-size:18px;border:0}button{margin-top:12px;padding:9px 14px;border:0;border-radius:8px;background:#0077B0;color:#fff;font:inherit;cursor:pointer}@media print{button{display:none}body{background:#fff}.c{box-shadow:none}}';

export function badReceiptPage(lang: Lang) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Abasare</title><style>${CSS}</style></head><body><main><div class="c">${esc(S.bad[li(lang)])}</div></main></body></html>`;
}

export async function renderReceipt(id: string, token: string, lang: Lang): Promise<string | null> {
  if (!verifyFileToken(key(id), token)) return null;
  const b = await q1<any>(`select b.ref, b.status, b.pickup_name, b.dest_name, b.distance_m, b.duration_s, b.final_fare, b.fare_breakdown, b.completed_at, b.driver_id, b.vehicle_id, b.payment_method,
      (select split_part(u.display_name,' ',1) from users u where u.id=b.driver_id) driver, (select v.plate from vehicles v where v.id=b.vehicle_id) plate,
      (select p.status from payments p where p.booking_id=b.id and p.kind='fare' order by p.created_at desc limit 1) pay_status
    from bookings b where b.id=$1`, [id]);
  if (!b || !OK.includes(b.status)) return null;
  const i = li(lang), t = (k: string) => S[k][i], nf = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US'), rwf = (n: number) => `${nf.format(n)} RWF`;
  const bd = b.fare_breakdown ?? { lines: [] }, lab = (l: any) => (lang === 'rw' ? l.label_rw : lang === 'fr' ? l.label_fr : l.label_en) || l.label_en;
  const row = (a: string, v: string, cls = '') => `<div class="r ${cls}"><span>${esc(a)}</span><span>${esc(v)}</span></div>`;
  const status = b.status === 'REFUNDED' || b.status === 'PARTIALLY_REFUNDED' ? t('refunded') : b.status === 'PAYMENT_COMPLETED' ? t('paid') : t('due');
  const when = b.completed_at ? new Date(b.completed_at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: 'Africa/Kigali', dateStyle: 'medium', timeStyle: 'short' }) : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(t('title'))} ${esc(b.ref)}</title><style>${CSS}</style></head>
<body><main><div class="c"><h1>Abasare</h1><div style="color:#567">${esc(t('title'))}</div>${row(t('no'), b.ref)}${row(t('date'), when)}${row(t('from'), b.pickup_name ?? '')}${row(t('to'), b.dest_name ?? '')}
${b.distance_m ? row(t('dist'), `${(b.distance_m / 1000).toFixed(1)} km · ${Math.max(1, Math.round((b.duration_s ?? 0) / 60))} min`) : ''}${b.driver ? row(t('driver'), [b.driver, b.plate].filter(Boolean).join(' · ')) : ''}
${(bd.lines ?? []).map((l: any) => row(lab(l), rwf(l.amount))).join('')}${bd.discount ? row(t('discount'), `- ${rwf(bd.discount)}`) : ''}${bd.tax ? row(t('tax'), rwf(bd.tax)) : ''}
${row(t('total'), rwf(b.final_fare ?? 0), 't')}${row(t('pay'), `${t(b.payment_method in S ? b.payment_method : 'cash')} · ${status}`)}<p style="color:#567;margin:12px 0 0">${esc(t('thanks'))}</p>
<button onclick="print()">${esc(t('print'))}</button></div></main></body></html>`;
}
