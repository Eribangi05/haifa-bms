import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MAP_HTML } from './mapHtml';
import type { Marker } from './MapView';
import { useApp } from '../lib/app';
import { useAppearance } from '../lib/appearance';
import { LiteMap } from './liteMap';
export type { Marker, HeatCircle } from './MapView';
import type { HeatCircle } from './MapView';

type Props = {
  center: { lat: number; lng: number }; zoom?: number; markers?: Marker[]; pin?: { lat: number; lng: number } | null;
  onPin?: (lat: number, lng: number) => void; onTap?: (lat: number, lng: number) => void; zones?: [number, number][][]; height?: number | string; onStatus?: (ok: boolean) => void; heat?: HeatCircle[];
  /** Driving route to draw (lat,lng points) and, for turn-by-turn, a camera that follows the driver (with heading). */
  route?: [number, number][]; follow?: { lat: number; lng: number; bearing?: number } | null;
};

/** Web build (responsive booking option): same Leaflet page inside an iframe, same message protocol as the native WebView. */
function MapBoxFull({ center, zoom, markers, pin, onPin, onTap, zones, height = 280, onStatus, heat, route, follow }: Props) {
  const { t } = useApp();
  // A blob: URL, not srcDoc: MapLibre's web workers do not start inside an about:srcdoc frame (the map would stay blank).
  const src = useMemo(() => URL.createObjectURL(new Blob([MAP_HTML], { type: 'text/html' })), []);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);
  const ref = useRef<HTMLIFrameElement>(null); const [ready, setReady] = useState(false); const [ok, setOk] = useState(true); const last = useRef('');
  const state = () => { const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`; const recenter = key !== last.current; last.current = key; const pts = [...(markers ?? []).filter((m) => !m.icon && !m.bubble), ...(pin ? [pin] : [])]; return { c: center, z: zoom, h: heat ?? [], m: markers ?? [], p: pin ?? null, zones, recenter, route: route ?? [], follow: follow ?? null, fit: !follow && pts.length > 1 ? pts : undefined }; };
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      try {
        const m = JSON.parse(e.data);
        if (m.t === 'ready') { setReady(true); ref.current?.contentWindow?.postMessage(JSON.stringify({ init: true, ...state() }), '*'); }
        else if (m.t === 'pin') onPin?.(m.lat, m.lng); else if (m.t === 'tap') onTap?.(m.lat, m.lng); else if (m.t === 'status') { setOk(m.ok); onStatus?.(m.ok); }
      } catch { /* ignore */ }
    };
    window.addEventListener('message', h); return () => window.removeEventListener('message', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });
  useEffect(() => { const id = setTimeout(() => { if (!ready) { setOk(false); onStatus?.(false); } }, 8000); return () => clearTimeout(id); /* eslint-disable-next-line */ }, [ready]);
  useEffect(() => { if (ready) ref.current?.contentWindow?.postMessage(JSON.stringify(state()), '*'); /* eslint-disable-next-line */ }, [ready, center.lat, center.lng, JSON.stringify(markers), JSON.stringify(heat), pin?.lat, pin?.lng, route?.length, route?.[0]?.[0], follow?.lat, follow?.lng, follow?.bearing]);
  return (
    <div style={{ position: 'relative' }}>
      <iframe ref={ref} title={t('home.pickup')} src={src} style={{ border: '1px solid #DBE4DE', borderRadius: 14, width: '100%', height: height as number, background: '#E7EEE9' }} />
      {!ok ? <div style={{ position: 'absolute', top: 8, left: 8, right: 8, background: '#FFF4CC', color: '#8A6500', padding: 8, borderRadius: 8, fontSize: 12 }}>{t('map.unavailable')}</div> : null}
    </div>
  );
}

/** Low-data mode swaps the tiled map for a text card (Round 1); "Show map" loads it for this view only. */
export function MapBox(p: React.ComponentProps<typeof MapBoxFull>) {
  const { lowData } = useAppearance(); const [force, setForce] = useState(false);
  if (lowData && !force) return <LiteMap markers={p.markers} height={p.height ?? 280} onShow={() => setForce(true)} />;
  return <MapBoxFull {...p} />;
}
