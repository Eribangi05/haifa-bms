import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { parse } from '../util/validate.js';
import { requirePerm, routeLimit, actorOf } from '../guards.js';
import { q, q1 } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';
import { type Lang } from '../services/i18n.js';
import { shareLang } from './share.js';
import * as R from '../services/requestCodes.js';

const idp = z.object({ id: z.string().uuid() });
const text = (n: number) => z.string().trim().max(n);
const lat = z.number().min(-90).max(90), lng = z.number().min(-180).max(180);
const svcEnum = z.enum(['ride', 'abasare']);

function checkBounds(la: number, ln: number) {
  if (!R.inRwanda(la, ln)) throw badRequest('outside_rwanda', 'Coordinates are outside Rwanda');
}

export async function requestCodeRoutes(app: FastifyInstance) {
  // ---- public ----
  app.get('/request-codes/:code', { config: routeLimit('PUBLIC_CODE_RATE_MAX', 60) }, async (req) => {
    const row = await R.requireUsable((req.params as any).code);
    await R.countScan(req.ip, row);
    return R.publicView(row);
  });

  // ---- admin ----
  app.get('/admin/request-codes', { preHandler: requirePerm('codes.view') }, async () => ({
    codes: (await q(`select c.*, coalesce(b.n,0)::int bookings, coalesce(b.done,0)::int completed
      from request_codes c left join lateral (select count(*) n, count(*) filter (where completed_at is not null) done from bookings where request_code_id=c.id) b on true
      order by c.created_at desc`)).map((c: any) => ({ ...c, url: R.landingUrl(c.code), expired: !!c.expires_at && new Date(c.expires_at) <= new Date() })),
  }));

  app.post('/admin/request-codes', { preHandler: requirePerm('codes.manage') }, async (req, reply) => {
    const b = parse(z.object({
      code: z.string().trim().toUpperCase().regex(R.CODE_RE).optional(), label: text(120).min(1), partner_name: text(120).optional(), lat, lng,
      address_note: text(300).optional(), default_service: svcEnum.default('ride'), pickup_note: text(300).optional(), expires_at: z.string().datetime().nullable().optional(),
    }), req.body);
    checkBounds(b.lat, b.lng);
    const code = b.code ?? await R.uniqueCode();
    let row: any;
    try {
      row = await q1(`insert into request_codes(code,label,partner_name,lat,lng,address_note,default_service,pickup_note,expires_at,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [code, b.label, b.partner_name || null, b.lat, b.lng, b.address_note || null, b.default_service, b.pickup_note || null, b.expires_at ?? null, req.auth!.id]);
    } catch (e: any) { if (e.code === '23505') throw conflict('code_exists', 'Code already exists'); throw e; }
    await audit(actorOf(req), 'request_code.create', 'request_code', row.id, undefined, { code, label: b.label, lat: b.lat, lng: b.lng, default_service: b.default_service });
    reply.code(201);
    return { ...row, url: R.landingUrl(row.code) };
  });

  app.patch('/admin/request-codes/:id', { preHandler: requirePerm('codes.manage') }, async (req) => {
    const { id } = parse(idp, req.params);
    const b = parse(z.object({
      label: text(120).min(1).optional(), partner_name: text(120).nullable().optional(), address_note: text(300).nullable().optional(), pickup_note: text(300).nullable().optional(),
      default_service: svcEnum.optional(), active: z.boolean().optional(), expires_at: z.string().datetime().nullable().optional(), lat: lat.optional(), lng: lng.optional(),
    }), req.body);
    const before = await q1<any>('select * from request_codes where id=$1', [id]);
    if (!before) throw notFound('request code');
    checkBounds(b.lat ?? before.lat, b.lng ?? before.lng);
    const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    if (!keys.length) return { ...before, url: R.landingUrl(before.code) };
    const vals = keys.map((k) => ((b as any)[k] === '' ? null : (b as any)[k]));
    const row = await q1<any>(`update request_codes set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() where id=$1 returning *`, [id, ...vals]);
    await audit(actorOf(req), 'request_code.update', 'request_code', id, Object.fromEntries(keys.map((k) => [k, before[k]])), b);
    return { ...row, url: R.landingUrl(row.code) };
  });

  app.delete('/admin/request-codes/:id', { preHandler: requirePerm('codes.manage') }, async (req) => {
    const { id } = parse(idp, req.params);
    const row = await q1<any>('update request_codes set active=false, updated_at=now() where id=$1 returning id, code', [id]);
    if (!row) throw notFound('request code');
    await audit(actorOf(req), 'request_code.deactivate', 'request_code', id, undefined, { active: false });
    return { ok: true };
  });

  const qrRow = async (req: any) => {
    const { id } = parse(idp, req.params);
    const row = await q1<any>('select id, code from request_codes where id=$1', [id]);
    if (!row) throw notFound('request code');
    await audit(actorOf(req), 'request_code.qr', 'request_code', id);
    return row;
  };
  app.get('/admin/request-codes/:id/qr.svg', { preHandler: requirePerm('codes.view') }, async (req, reply) => {
    const row = await qrRow(req);
    const svg = await QRCode.toString(R.landingUrl(row.code), { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
    return reply.header('content-type', 'image/svg+xml').header('content-disposition', `inline; filename="abasare-${row.code}.svg"`).send(svg);
  });
  app.get('/admin/request-codes/:id/qr.png', { preHandler: requirePerm('codes.view') }, async (req, reply) => {
    const row = await qrRow(req);
    const png = await QRCode.toBuffer(R.landingUrl(row.code), { type: 'png', width: 1024, margin: 2, errorCorrectionLevel: 'M' });
    return reply.header('content-type', 'image/png').header('content-disposition', `inline; filename="abasare-${row.code}.png"`).send(png);
  });
}

// ---------------- landing page (outside /api/v1) ----------------
type LS = {
  title: string; here: string; ride: string; abasare: string; abasareHint: string; appNote: string; getApp: string; getAppNone: string; tryLink: string;
  badTitle: string; badBody: string; at: string; footer: string;
};
export const LANDING_STRINGS: Record<Lang, LS> = {
  rw: {
    title: 'Saba umushoferi', here: 'Saba umushoferi hano', ride: 'Saba urugendo', abasare: 'Saba Umusare', abasareHint: 'Umushoferi utwara imodoka yawe',
    appNote: 'Ugomba kuba warashyizeho porogaramu ya Abasare kuri telefone yawe kugira ngo ukomeze.', getApp: 'Shyiraho porogaramu ya Abasare',
    getAppNone: 'Nta porogaramu ya Abasare ufite? Baza aha hantu cyangwa uyishyireho kuri telefone yawe.', tryLink: 'Nibidafunguka, kanda hano',
    badTitle: 'Iyi kode ntikora', badBody: 'Iyi kode ntiyemewe cyangwa yararangiye. Baza abakozi bo aha hantu.', at: 'Aho uri', footer: 'Abasare · Gutwara abantu mu Rwanda',
  },
  fr: {
    title: 'Demander un chauffeur', here: 'Demandez un chauffeur ici', ride: 'Demander une course', abasare: 'Demander un Abasare', abasareHint: 'Un chauffeur pour votre propre voiture',
    appNote: 'L\'application Abasare doit être installée sur votre téléphone pour continuer.', getApp: 'Installer l\'application Abasare',
    getAppNone: 'Vous n\'avez pas l\'application Abasare ? Demandez à l\'établissement ou installez-la sur votre téléphone.', tryLink: 'Si rien ne s\'ouvre, touchez ici',
    badTitle: 'Ce code n\'est pas valide', badBody: 'Ce code est invalide ou a expiré. Demandez au personnel de l\'établissement.', at: 'Vous êtes à', footer: 'Abasare · Transport au Rwanda',
  },
  en: {
    title: 'Request a driver', here: 'Request a driver here', ride: 'Request a ride', abasare: 'Request an Abasare', abasareHint: 'A driver for your own car',
    appNote: 'The Abasare app must be installed on your phone to continue.', getApp: 'Get the Abasare app',
    getAppNone: 'Don\'t have the Abasare app? Ask the venue or install Abasare on your phone.', tryLink: 'If nothing opens, tap here',
    badTitle: 'This code is not valid', badBody: 'This code is invalid or has expired. Please ask the venue staff.', at: 'You are at', footer: 'Abasare · Getting around Rwanda',
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const STYLE = `*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;background:#f4f7f4;color:#14281d}.flag{height:8px;background:linear-gradient(#00A1DE 0 50%,#FAD201 50% 75%,#20603D 75%)}main{max-width:480px;margin:0 auto;padding:20px}h1{color:#20603D;margin:.2em 0}h2{margin:.2em 0 .6em}.c{background:#fff;border-radius:14px;padding:16px;margin-top:12px;box-shadow:0 1px 4px #0001}.btn{display:block;text-align:center;text-decoration:none;font-weight:700;font-size:1.15rem;padding:18px 14px;border-radius:14px;margin-top:12px;min-height:56px}.btn small{display:block;font-weight:400;font-size:.85rem}.ride{background:#00A1DE;color:#fff}.abs{background:#FAD201;color:#14281d}.note{background:#fff8d6;border-left:4px solid #FAD201}small,.hint{color:#456}a.alt{color:#20603D}`;
const PKG = 'rw.abasare.app';

export function renderLanding(lang: Lang, row: { code: string; label: string; pickup_note: string | null; default_service: string }, appUrl = config.appDownloadUrl): string {
  const S = LANDING_STRINGS[lang];
  const link = (svc: 'ride' | 'abasare') => ({
    intent: `intent://r/${row.code}?svc=${svc}#Intent;scheme=abasare;package=${PKG};end`,
    scheme: `abasare://r/${row.code}?svc=${svc}`,
  });
  const btn = (svc: 'ride' | 'abasare', cls: string, label: string, hint?: string) => {
    const l = link(svc);
    return `<a class="btn ${cls}" href="${l.intent}" data-alt="${l.scheme}">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</a>`;
  };
  const first: ('ride' | 'abasare')[] = row.default_service === 'abasare' ? ['abasare', 'ride'] : ['ride', 'abasare'];
  const buttons = first.map((s) => (s === 'ride' ? btn('ride', 'ride', S.ride) : btn('abasare', 'abs', S.abasare, S.abasareHint))).join('');
  const get = /^https?:\/\//i.test(appUrl) ? `<p><a class="alt" href="${esc(appUrl)}" rel="noopener">${esc(S.getApp)}</a></p>` : `<p class="hint">${esc(S.getAppNone)}</p>`;
  const alt = link(first[0]).scheme;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(S.title)} · ${esc(row.label)}</title><style>${STYLE}</style></head>
<body><div class="flag"></div><main><h1>Abasare</h1><div class="c"><small>${esc(S.at)}</small><h2>${esc(row.label)}</h2>${row.pickup_note ? `<div>${esc(row.pickup_note)}</div>` : ''}</div>
<h2 style="margin-top:18px">${esc(S.here)}</h2>${buttons}
<div class="c note">${esc(S.appNote)}</div><div class="c">${get}<p><a class="alt" data-alt-link href="${alt}">${esc(S.tryLink)}</a></p></div><small>${esc(S.footer)}</small></main>
<script>if(!/Android/i.test(navigator.userAgent)){document.querySelectorAll('a[data-alt]').forEach(function(a){a.href=a.getAttribute('data-alt')})}</script></body></html>`;
}

export function renderInvalid(lang: Lang): string {
  const S = LANDING_STRINGS[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(S.badTitle)}</title><style>${STYLE}</style></head>
<body><div class="flag"></div><main><h1>Abasare</h1><div class="c"><h2>${esc(S.badTitle)}</h2><p>${esc(S.badBody)}</p></div><small>${esc(S.footer)}</small></main></body></html>`;
}

export async function requestCodeLandingRoutes(app: FastifyInstance) {
  app.get('/r/:code', { config: routeLimit('PUBLIC_CODE_RATE_MAX', 60) }, async (req, reply) => {
    const lang = shareLang(req.query, req.headers['accept-language']);
    reply.header('content-type', 'text/html; charset=utf-8').header('vary', 'accept-language').header('content-language', lang).header('cache-control', 'no-store');
    const row = await R.findUsable((req.params as any).code);
    if (!row) return reply.code(404).send(renderInvalid(lang));
    await R.countScan(req.ip, row);
    return reply.send(renderLanding(lang, row));
  });
}
