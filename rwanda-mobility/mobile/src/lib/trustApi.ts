// Round 1 pure logic and API shapes (platform-free, unit-tested in tests/r1.test.ts).
export type Loc3 = { rw: string; fr: string; en: string };
export type RatingTag = { id: string; kind: 'positive' | 'negative'; scope: 'ride' | 'abasare'; label: Loc3 };
export type TipsCfg = { enabled: boolean; min_amount: number; max_amount: number; methods: string[]; commission?: number };
export type R1Config = { rating_tags?: { ride: RatingTag[]; abasare: RatingTag[] }; tips?: TipsCfg; safety?: { checks_enabled: boolean; response_wait_min: number } };
export type TrustedContact = { id: string; name: string; phone: string; notify_on_trip: boolean; lang: 'rw' | 'fr' | 'en' };
export type Badge = { id: string; tier?: number; label: Loc3 };
export type MyDriver = { driver_id: string; kind: 'favourite' | 'blocked'; first_name: string; rating_avg: number; trips_together: number; badges?: Badge[] };
export type ShareRow = { id: string; created_at: string; expires_at: string | null; revoked_at: string | null; auto: boolean; hide_destination: boolean; contact_name: string | null };
export type SafetyOpen = { id: string; kind: string; status: string; asked_at: string; respond_by: string };
export type NavTarget = { lat: number; lng: number; name?: string; google_maps?: string; waze?: string; geo?: string };
export type NavInfo = { target: 'pickup' | 'destination'; pickup?: NavTarget; destination?: NavTarget; eta_to_pickup_min?: number | null; eta_to_destination_min?: number | null };
export type TipResult = { id: string; amount: number; method: string; status: string; payment_id?: string | null; note?: string };

/** Tags worth showing for a score: the matching group first (positive for 4-5, negative for 1-3), the other group still available. */
export function orderTags(tags: RatingTag[], score: number): RatingTag[] {
  const first = score >= 4 ? 'positive' : 'negative';
  return [...tags].sort((a, b) => (a.kind === first ? 0 : 1) - (b.kind === first ? 0 : 1));
}
export const tagLabel = (t: { label: Loc3 }, lang: 'rw' | 'fr' | 'en') => t.label[lang] || t.label.en;

/** Preset tip amounts that fit the configured range (unique, ascending). */
export function tipPresets(min: number, max: number, base = [500, 1000, 2000, 5000]): number[] {
  return [...new Set(base.filter((a) => a >= min && a <= max))].sort((a, b) => a - b);
}
export type TipCheck = 'ok' | 'empty' | 'low' | 'high';
export function checkTip(amount: number | null, min: number, max: number): TipCheck {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return 'empty';
  return amount < min ? 'low' : amount > max ? 'high' : 'ok';
}
export const parseAmount = (s: string): number | null => { const d = s.replace(/\D/g, ''); return d ? Number(d) : null; };

/** Seconds left on a driver ETA that was `etaS` when received at `receivedAt` (ms). Never negative; null when there is no ETA. */
export function etaRemaining(etaS: number | null | undefined, receivedAt: number, now: number): number | null {
  if (etaS == null || !Number.isFinite(etaS)) return null;
  return Math.max(0, Math.round(etaS - (now - receivedAt) / 1000));
}
/** Re-sync the shown countdown to a fresh server ETA only when it disagrees with our own prediction by more than `tolS` (a moving driver keeps it smooth; a stalled one still corrects). */
export const shouldResyncEta = (predicted: number | null, server: number | null | undefined, tolS = 15) => server != null && (predicted == null || Math.abs(predicted - server) > tolS);
export function fmtCountdown(s: number): string { const m = Math.floor(s / 60); const r = s % 60; return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; }

/** Remaining time of a share link: expired / minutes / hours. */
export function expiryLeft(expiresAt: string | null, revokedAt: string | null, now: number): { kind: 'revoked' | 'expired' | 'min' | 'hours' | 'open'; n: number } {
  if (revokedAt) return { kind: 'revoked', n: 0 };
  if (!expiresAt) return { kind: 'open', n: 0 };
  const left = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(left) || left <= 0) return { kind: 'expired', n: 0 };
  const min = Math.ceil(left / 60000);
  return min < 120 ? { kind: 'min', n: min } : { kind: 'hours', n: Math.round(min / 60) };
}

/** Is a "waiting for your answer" safety check still actionable (not past its deadline by more than a grace period)? */
export const safetyPending = (o: SafetyOpen | null | undefined): o is SafetyOpen => !!o && o.status === 'asked';
export const safetySecondsLeft = (o: SafetyOpen, now: number) => Math.max(0, Math.round((new Date(o.respond_by).getTime() - now) / 1000));
/** Push/notification payload -> Track. Backend push data carries `template_key` (and `ref`), older payloads `type`. */
export function safetyRoute(data: any): { name: 'track'; params: { id?: string; safety: true } } | null {
  const k = typeof data?.template_key === 'string' ? data.template_key : typeof data?.type === 'string' ? data.type : '';
  if (!/^safety_(check|escalated)/.test(k)) return null;
  return { name: 'track', params: { ...(typeof data.booking_id === 'string' ? { id: data.booking_id } : {}), safety: true } };
}

/** Order of preference for opening turn-by-turn navigation. `geo:` opens the phone's default maps app on Android. */
export function navLinks(n: NavTarget | undefined): { app: 'google' | 'waze' | 'geo'; url: string }[] {
  if (!n) return [];
  const out: { app: 'google' | 'waze' | 'geo'; url: string }[] = [];
  out.push({ app: 'google', url: n.google_maps ?? `https://www.google.com/maps/dir/?api=1&destination=${n.lat},${n.lng}&travelmode=driving` });
  out.push({ app: 'waze', url: n.waze ?? `https://waze.com/ul?ll=${n.lat},${n.lng}&navigate=yes` });
  out.push({ app: 'geo', url: n.geo ?? `geo:${n.lat},${n.lng}?q=${n.lat},${n.lng}` });
  return out;
}
/** Fallback chain when the chosen app link cannot be opened: the chosen one, then the web Google Maps link. */
export const navFallbacks = (n: NavTarget, app: 'google' | 'waze' | 'geo') => { const all = navLinks(n); const first = all.find((l) => l.app === app)!; return [first.url, ...all.filter((l) => l.url !== first.url && l.app === 'google').map((l) => l.url)]; };

/** Badge display order and visual group. */
const ORDER = ['licence_verified', 'police_clearance_valid', 'training_completed', 'experience', 'trips_completed', 'top_rated'];
export const sortBadges = (b: Badge[]) => [...b].sort((x, y) => ORDER.indexOf(x.id) - ORDER.indexOf(y.id) || (x.tier ?? 0) - (y.tier ?? 0));
export const badgeKey = (b: Badge) => b.id + (b.tier != null ? '.' + b.tier : '');

/** Total of tag counts for the driver feedback screen, descending. */
export function rankTags(tags: Record<string, number>): { id: string; n: number }[] { return Object.entries(tags).map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)); }

/** kv flag set once the passenger's rating for a trip was saved (or queued). */
export const ratedKey = (id: string) => 'rm_rated_' + id;
