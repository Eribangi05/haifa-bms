import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/app';
import { fraction, loadOfflineInfo, OfflineInfo, OfflineProgress, prefetchCommand, saveOfflineInfo } from '../lib/offlineMap';
import { Btn, Card, ProgressBar, Text } from './components';
import { MAP_HTML } from './mapHtml';
import { S } from './theme';
import { ageOf } from '../lib/cache';

/** Web build of the offline-map card: same hidden page in an iframe (blob: URL, because map workers do not start in srcdoc frames). */
export function OfflineMapCard() {
  const { t, say } = useApp();
  const src = useMemo(() => URL.createObjectURL(new Blob([MAP_HTML], { type: 'text/html' })), []);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false); const [info, setInfo] = useState<OfflineInfo>(null);
  const [p, setP] = useState<OfflineProgress>({ state: 'idle', done: 0, total: 0 });
  useEffect(() => { void loadOfflineInfo().then(setInfo); }, []);
  const onMsg = useCallback((e: MessageEvent) => {
    if (e.source !== ref.current?.contentWindow) return;
    try {
      const m = JSON.parse(e.data);
      if (m.t === 'ready') ref.current?.contentWindow?.postMessage(JSON.stringify({ init: true, headless: true, c: { lat: -1.95, lng: 30.06 } }), '*');
      else if (m.t === 'headless_ready') setReady(true);
      else if (m.t === 'offline') {
        setP({ state: m.state, done: m.done, total: m.total });
        if (m.state === 'done') { const i = { at: Date.now(), failed: m.failed ?? 0 }; setInfo(i); void saveOfflineInfo(i); say(t('offmap.done')); }
        else if (m.state === 'error') say(t('offmap.error'));
      }
    } catch { /* ignore */ }
  }, [say, t]);
  useEffect(() => { window.addEventListener('message', onMsg); return () => window.removeEventListener('message', onMsg); }, [onMsg]);
  const start = () => { if (!ready) { say(t('offmap.notready')); return; } setP({ state: 'running', done: 0, total: 0 }); ref.current?.contentWindow?.postMessage(prefetchCommand(), '*'); };
  const a = info ? ageOf(info.at) : null;
  const when = a ? t(a.unit === 'min' ? 'cache.ago.min' : a.unit === 'h' ? 'cache.ago.h' : 'cache.ago.d', { n: a.n }) : '';
  return (
    <Card>
      <Text style={S.bold}>{t('offmap.title')}</Text>
      <Text style={S.muted}>{t('offmap.hint')}</Text>
      {p.state === 'running' ? <ProgressBar value={fraction(p)} label={t('offmap.running', { pct: Math.round(fraction(p) * 100) })} /> : null}
      {info && p.state !== 'running' ? <Text style={[S.body, { marginTop: 8 }]}>{t('offmap.saved', { when })}</Text> : null}
      <Btn testID="offmap-save" kind={info ? 'ghost' : 'primary'} title={info ? t('offmap.update') : t('offmap.save')} onPress={start} disabled={p.state === 'running'} style={{ marginTop: 10 }} />
      <iframe ref={ref} title="offline-map" src={src} style={{ width: 1, height: 1, border: 0, position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
    </Card>
  );
}
