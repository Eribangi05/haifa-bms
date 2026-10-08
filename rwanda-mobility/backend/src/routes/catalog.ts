import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, lat, lng } from '../util/validate.js';
import { anyAuth, routeLimit } from '../guards.js';
import { q } from '../db.js';
import { estimate, zoneFor } from '../services/bookings.js';
import { searchPlaces } from '../services/maps.js';
import { flag, getSetting } from '../services/settings.js';
import { checkPromo } from '../services/promos.js';
import { badRequest } from '../errors.js';
import { config } from '../config.js';
import { tagCatalogue } from '../services/tags.js';
import { isLite, liteEstimate } from '../services/lowdata.js';
import { reqLang } from '../services/errmsg.js';

export async function catalogRoutes(app: FastifyInstance) {
  app.get('/config', async () => ({
    app_name: 'Abasare', currency: 'RWF', languages: ['rw', 'fr', 'en'], country_code: '+250',
    payment_methods: [
      { id: 'cash', enabled: true },
      { id: 'mtn_momo', enabled: await flag('payments.mtn_momo'), simulated: config.momo.mode === 'simulator' },
      { id: 'airtel_money', enabled: await flag('payments.airtel_money') },
    ],
    emergency_numbers: { police: '112', ambulance: '912', traffic_police: '113' },
    abasare: { enabled: await flag('abasare.enabled'), packages: [2, 4, 8, 12], min_hours: 2, max_hours: 12, night: { start: 22, end: 5 }, min_photos: await getSetting('abasare.min_photos'), classes: ['car', 'suv', 'minivan', 'pickup', 'moto'], transmissions: ['manual', 'automatic'] },
    rating_tags: tagCatalogue(),
    tips: { enabled: await getSetting('tips.enabled'), min_amount: await getSetting('tips.min_amount'), max_amount: await getSetting('tips.max_amount'), methods: ['cash_tip', 'mtn_momo'], commission: 0 },
    safety: { checks_enabled: await getSetting('safety.checks_enabled'), response_wait_min: await getSetting('safety.response_wait_min') },
    features: { scheduled: await flag('booking.scheduled'), corporate: await flag('corporate.enabled'), promotions: await flag('promotions.enabled') },
  }));

  app.get('/services', async () => ({
    services: await q('select id,name_en,name_rw,name_fr,description_en,description_rw,description_fr,passenger_capacity,luggage,phase from service_categories where enabled order by sort'),
  }));

  app.get('/places/search', { config: routeLimit('PLACES_RATE_MAX', 60), preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({ q: z.string().min(2).max(80), lang: z.enum(['rw', 'fr', 'en']).default('en') }), req.query);
    return { places: await searchPlaces(b.q, b.lang) };
  });
  app.get('/places/popular', async (req) => {
    const { lang } = parse(z.object({ lang: z.enum(['rw', 'fr', 'en']).default('en') }), req.query);
    const r = await q<any>('select id, name_en, name_rw, name_fr, kind, lat, lng, designated_pickup from places where active order by designated_pickup desc, name_en');
    return { places: r.map((p) => ({ id: p.id, name: (lang === 'rw' ? p.name_rw : lang === 'fr' ? p.name_fr : null) || p.name_en, kind: p.kind, lat: p.lat, lng: p.lng, designated_pickup: p.designated_pickup })) };
  });
  app.get('/coverage', async () => ({ zones: await q('select id, name, polygon from service_zones where active') }));
  app.get('/coverage/check', async (req) => {
    const b = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }), req.query);
    const z_ = await zoneFor(b); return { covered: !!z_, zone: z_?.id ?? null };
  });

  app.post('/fares/estimate', { config: routeLimit('ESTIMATE_RATE_MAX', 60), preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({
      pickup: z.object({ lat, lng }), dest: z.object({ lat, lng }).optional(), service_id: z.string().optional(),
      abasare: z.object({ customer_vehicle_id: z.string().uuid(), hours: z.number().int().min(1).max(24).optional() }).optional(),
      promo_code: z.string().max(30).optional(), scheduled_for: z.string().datetime().optional(),
    }), req.body);
    if (b.promo_code && !(await flag('promotions.enabled'))) throw badRequest('promotions_disabled');
    const e = await estimate(req.auth!.id, b);
    return isLite(req) ? liteEstimate(e, reqLang(req.headers['accept-language'])) : e;
  });

  app.post('/promotions/validate', { config: routeLimit('PROMO_RATE_MAX', 30), preHandler: anyAuth }, async (req) => {
    const b = parse(z.object({ code: z.string(), service_id: z.string(), fare: z.number().int().positive() }), req.body);
    const r = await checkPromo(b.code, req.auth!.id, b.service_id, 'kigali', b.fare);
    return r.ok ? { valid: true, discount: r.discount } : { valid: false, reason: r.reason };
  });
}
