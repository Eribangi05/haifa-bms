import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { C } from './theme';
import { MAP_HTML } from './mapHtml';

import { useApp } from '../lib/app';
export type Marker = { lat: number; lng: number; label?: string; color?: string };
type Props = {
  center: { lat: number; lng: number }; zoom?: number; markers?: Marker[]; pin?: { lat: number; lng: number } | null;
  onPin?: (lat: number, lng: number) => void; onTap?: (lat: number, lng: number) => void; zones?: [number, number][][]; height?: number | string;
  onStatus?: (ok: boolean) => void;
};

// Leaflet + OpenStreetMap tiles inside a WebView: no API key needed. Tile usage policy: fine for pilots; use a commercial/self-hosted
// tile server at scale (see docs/MAP_PROVIDER_EVALUATION.md). If tiles/Leaflet can't load (offline) the parent shows landmark fallbacks.


export function MapBox({ center, zoom, markers, pin, onPin, onTap, zones, height = 280, onStatus }: Props) {
  const { t } = useApp();
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(true);
  const lastCenter = useRef('');
  const state = () => {
    const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
    const recenter = key !== lastCenter.current; lastCenter.current = key;
    const pts = [...(markers ?? []), ...(pin ? [pin] : [])];
    return { c: center, z: zoom, m: markers ?? [], p: pin ?? null, zones, recenter, fit: pts.length > 1 ? pts : undefined };
  };
  useEffect(() => { const id = setTimeout(() => { if (!ready) { setOk(false); onStatus?.(false); } }, 8000); return () => clearTimeout(id); /* eslint-disable-next-line */ }, [ready]);
  useEffect(() => { if (ready) ref.current?.postMessage(JSON.stringify(state())); /* eslint-disable-next-line */ }, [ready, center.lat, center.lng, JSON.stringify(markers), pin?.lat, pin?.lng]);
  const onMsg = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.t === 'ready') { setReady(true); ref.current?.postMessage(JSON.stringify({ init: true, ...state() })); }
      else if (m.t === 'pin') onPin?.(m.lat, m.lng);
      else if (m.t === 'tap') onTap?.(m.lat, m.lng);
      else if (m.t === 'status') { setOk(m.ok); onStatus?.(m.ok); }
    } catch { /* ignore */ }
  };
  return (
    <View style={{ height: height as number, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: '#E7EEE9' }}>
      <WebView ref={ref} source={{ html: MAP_HTML, baseUrl: 'https://localhost' }} onMessage={onMsg} originWhitelist={['*']} javaScriptEnabled domStorageEnabled
        onError={() => { setOk(false); onStatus?.(false); }} onHttpError={() => undefined} style={{ backgroundColor: 'transparent' }} />
      {!ok ? <View style={{ position: 'absolute', top: 8, left: 8, right: 8, backgroundColor: C.warnBg, padding: 8, borderRadius: 8 }}><Text style={{ color: C.warn, fontSize: 12 }}>{t('map.unavailable')}</Text></View> : null}
    </View>
  );
}
