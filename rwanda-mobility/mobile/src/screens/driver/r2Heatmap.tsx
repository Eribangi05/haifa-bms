import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useApp, usePoll } from '../../lib/app';
import { useDriverTracking } from '../../lib/driverTracking';
import { fmtTime } from '../../lib/format';
import { HEAT_WINDOWS, heatCenter, heatColor, heatHintKey, heatOpacity, topCells, type HeatCell, type HeatWindowKey } from '../../lib/r2';
import { KIGALI } from '../../config';
import { Banner, Btn, Card, Chip, EmptyState, Screen, SkeletonCard, Text, useProportionalHeight } from '../../ui/components';
import { MapBox } from '../../ui/MapView';
import { usePlaces } from '../passenger/usePlaces';
import { S, SP } from '../../ui/theme';
import type { ApiError } from '../../lib/net';

type Heat = { cell_size_m: number; generated_at: string; windows: Record<HeatWindowKey, { cells: HeatCell[] }> };

/** "Where to go": demand cells for the chosen window on the shared map. Drivers see intensity and a hint only, never counts. */
export function Heatmap() {
  const { t, client, nav, errMsg, online } = useApp(); const tr = useDriverTracking(); const places = usePlaces();
  const [win, setWin] = useState<HeatWindowKey>('now'); const mapH = useProportionalHeight(0.36, 220, 380);
  const h = usePoll(() => client.get<Heat>('/drivers/me/heatmap'), 60000);
  const cells = h.data?.windows[win]?.cells ?? [];
  const r = (h.data?.cell_size_m ?? 500) / 2;
  const heat = useMemo(() => cells.map((c) => ({ lat: c.lat, lng: c.lng, r, color: heatColor(c.intensity), o: heatOpacity(c.intensity) })), [cells, r]);
  const center = heatCenter(cells, tr.pos ?? KIGALI);
  const unavailable = (h.error as ApiError | null)?.code === 'heatmap_unavailable';
  const top = topCells(cells);
  return (
    <Screen title={t('r2.heat.title')} onBack={() => nav.pop()} onRefresh={async () => { h.reload(); await new Promise((x) => setTimeout(x, 500)); }}>
      {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
      {unavailable ? <EmptyState glyph="📴" title={t('r2.heat.offline.title')} body={t('r2.heat.offline')} action={<Btn kind="ghost" title={t('common.back')} onPress={() => nav.pop()} />} /> : null}
      {h.error && !h.data && !unavailable ? <Banner kind="bad" text={errMsg(h.error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={h.reload} />} /> : null}
      {!h.data && !h.error ? <><SkeletonCard /><SkeletonCard /></> : null}
      {h.data ? <>
        <Text style={[S.muted, { marginBottom: SP.sm }]}>{t('r2.heat.sub')}</Text>
        <View style={S.wrap} accessibilityRole="radiogroup">{HEAT_WINDOWS.map((k) => <Chip key={k} text={t(`r2.heat.win.${k}` as 'r2.heat.win.now')} on={win === k} onPress={() => setWin(k)} />)}</View>
        <MapBox center={center} zoom={13} heat={heat} markers={tr.pos ? [{ ...tr.pos, label: '', color: '#1A5FB4' }] : []} height={mapH} />
        <Text style={[S.muted, { marginVertical: SP.sm }]}>{t('r2.heat.privacy')} {t('r2.heat.updated', { time: fmtTime(h.data.generated_at) })}</Text>
        {!cells.length ? <EmptyState glyph="🗺️" title={t('r2.heat.empty.title')} body={t('r2.heat.empty')} /> : <>
          <Text accessibilityRole="header" style={[S.h2, { marginBottom: SP.sm }]}>{t('r2.heat.top')}</Text>
          {top.map((c, i) => { const nm = places.nearest(c); return (
            <Card key={`${c.lat},${c.lng}`}><View style={[S.row, { gap: SP.md }]}>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: heatColor(c.intensity) }} />
              <View style={{ flex: 1 }} testID="r2-heat-cell"><Text style={S.bold}>{nm ? t('r2.heat.area', { name: nm }) : t('r2.heat.area2', { n: i + 1 })}</Text><Text style={S.muted}>{t(`r2.${heatHintKey(c.hint)}` as 'r2.heat.some')}</Text></View>
            </View></Card>); })}
        </>}
        <Text style={[S.muted, { textAlign: 'center', marginTop: SP.sm }]}>{t('r2.heat.stop')}</Text>
      </> : null}
    </Screen>
  );
}
