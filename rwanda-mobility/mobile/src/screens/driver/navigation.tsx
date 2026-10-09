import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useApp } from '../../lib/app';
import { arrowFor, fmtDist, progress, shouldReroute, type NavRoute, type NavStep } from '../../lib/nav';
import type { TKey } from '../../lib/i18n';
import type { Booking } from '../../lib/types';
import { AppModal } from '../../ui/AppModal';
import { Banner, Btn, Pill, Screen, Spinner, Text, useProportionalHeight } from '../../ui/components';
import { MapBox } from '../../ui/MapView';
import { C, FS, R, S, SP } from '../../ui/theme';
import { R1NavButtons } from '../trust/navHandoff';

type LL = { lat: number; lng: number };
type NavReply = { available: true; target: 'pickup' | 'destination'; distance_m: number; duration_s: number; geometry: [number, number][]; steps: NavStep[] } | { available: false; target: 'pickup' | 'destination'; reason: string };

/** Text of one manoeuvre, in the app's language (the server only sends the manoeuvre, the street name and the distance). */
export function stepText(t: (k: TKey, v?: Record<string, string | number>) => string, s: NavStep, last: 'pickup' | 'destination'): string {
  if (s.maneuver === 'arrive') return t(last === 'pickup' ? 'nav.arrive.pickup' : 'nav.arrive.dest');
  const name = s.name?.trim();
  if (s.maneuver === 'depart') return name ? t('nav.depart', { name }) : t('nav.depart.plain');
  if (s.maneuver === 'continue') return name ? t('nav.continue', { name }) : t('nav.continue.plain');
  const m = (s.modifier ?? 'straight') as string;
  const key = (name ? `nav.t.${m}.on` : `nav.t.${m}`) as TKey;
  return t(key, { name: name ?? '' });
}

/**
 * Turn-by-turn navigation inside Abasare: the route on the Rwanda map, the next manoeuvre in big letters, distance and time left.
 * The route comes from the server's own road graph (GET /bookings/:id/navigation); when the driver leaves the road a new route is requested.
 * Honest limits: no voice yet, and the road data is OpenStreetMap, so a very new road may be missing: another navigation app stays one tap away.
 */
export function NavigationModal({ trip, pos, visible, onClose }: { trip: Booking; pos: LL | null; visible: boolean; onClose: () => void }) {
  const { t, client } = useApp();
  const target: 'pickup' | 'destination' = trip.status === 'IN_PROGRESS' ? 'destination' : 'pickup';
  const [route, setRoute] = useState<(NavRoute & { target: 'pickup' | 'destination' }) | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'rerouting' | 'unavailable'>('idle');
  const lastAt = useRef(0); const inflight = useRef(false);
  const mapH = useProportionalHeight(0.5, 240, 480);

  const fetchRoute = useCallback(async (reroute: boolean) => {
    if (inflight.current) return; inflight.current = true; lastAt.current = Date.now();
    setState(reroute ? 'rerouting' : 'loading');
    try {
      const q = pos ? `?lat=${pos.lat.toFixed(5)}&lng=${pos.lng.toFixed(5)}` : '';
      const r = await client.get<NavReply>(`/bookings/${trip.id}/navigation${q}`, { timeoutMs: 12000 });
      if (r.available) { setRoute({ distance_m: r.distance_m, duration_s: r.duration_s, geometry: r.geometry, steps: r.steps, target: r.target }); setState('idle'); }
      else setState('unavailable');
    } catch { setState((s) => (s === 'rerouting' ? 'idle' : 'unavailable')); }
    finally { inflight.current = false; }
  }, [client, trip.id, pos]);

  // get the route when the screen opens, and again when the target changes (pickup -> destination)
  useEffect(() => { if (visible && (!route || route.target !== target) && state !== 'unavailable') void fetchRoute(false); }, [visible, pos?.lat, target]); // eslint-disable-line react-hooks/exhaustive-deps
  // no GPS fix on the phone yet: use the server's last known position (the start of the route it computed)
  const here: LL | null = pos ?? (route ? { lat: route.geometry[0][0], lng: route.geometry[0][1] } : null);
  const nav = route && route.target === target && here ? progress(route, here) : null;
  // left the road: ask for a new route (not more often than every 12 s)
  useEffect(() => { if (visible && nav && !nav.arrived && shouldReroute(nav.offRouteM, lastAt.current)) void fetchRoute(true); }, [nav?.offRouteM, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const eta = nav ? new Date(Date.now() + nav.remainingS * 1000) : null;
  const hhmm = eta ? `${String(eta.getHours()).padStart(2, '0')}:${String(eta.getMinutes()).padStart(2, '0')}` : '';
  return (
    <AppModal visible={visible} onClose={onClose}>
      <Screen title={t('nav.title')} onBack={onClose} scroll={false}
        footer={<View style={{ gap: SP.sm }}>{nav ? <View style={S.between}><View><Text testID="nav-remaining" style={[S.h2, { color: C.primary }]}>{t('nav.remaining', { min: Math.max(1, Math.round(nav.remainingS / 60)), km: (nav.remainingM / 1000).toFixed(1) })}</Text><Text style={S.muted}>{t('nav.eta', { time: hhmm })}</Text></View><Pill text={t(target === 'pickup' ? 'nav.target.pickup' : 'nav.target.dest')} tone="ok" /></View> : null}
          <Btn kind="ghost" title={t('nav.close')} onPress={onClose} /></View>}>
        {state === 'loading' || (!route && state === 'idle') ? <View style={{ padding: SP.xl }}><Spinner /><Text style={[S.muted, { textAlign: 'center' }]}>{t('nav.loading')}</Text></View> : null}
        {state === 'unavailable' ? <><Banner text={t('nav.unavailable')} /><R1NavButtons trip={trip as never} which={target} /></> : null}
        {nav ? <View testID="nav-banner" style={{ backgroundColor: C.primary, borderRadius: R.md, padding: SP.md, flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.sm }}>
          <Text style={{ color: C.onPrimary, fontSize: 46, fontWeight: '800', width: 62, textAlign: 'center' }}>{arrowFor(nav.arrived ? 'arrive' : nav.step.maneuver, nav.step.modifier)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.onPrimary, fontSize: FS.xl - 2, fontWeight: '800' }}>{nav.arrived ? t(target === 'pickup' ? 'nav.arrive.pickup' : 'nav.arrive.dest') : stepText(t, nav.step, target)}</Text>
            {!nav.arrived && nav.step.maneuver !== 'arrive' ? <Text style={{ color: C.onPrimary, fontSize: FS.md }}>{t('nav.in', { d: fmtDist(nav.toNextM) })}</Text> : null}
            {!nav.arrived && nav.step.maneuver === 'arrive' ? <Text style={{ color: C.onPrimary, fontSize: FS.md }}>{fmtDist(nav.toNextM)}</Text> : null}
          </View>
        </View> : null}
        {state === 'rerouting' ? <Banner text={t('nav.rerouting')} /> : null}
        {route && here ? <MapBox center={here} zoom={16} route={route.geometry} follow={{ lat: here.lat, lng: here.lng }} height={mapH}
          markers={[{ ...(target === 'pickup' ? trip.pickup : trip.destination), color: target === 'pickup' ? '#0077B0' : '#C0392B', label: target === 'pickup' ? 'P' : 'D' }, { ...here, color: '#1A5FB4', label: '' }]} /> : null}
        {route && state !== 'unavailable' ? <View style={{ marginTop: SP.md }}><R1NavButtons trip={trip as never} which={target} /></View> : null}
      </Screen>
    </AppModal>
  );
}
