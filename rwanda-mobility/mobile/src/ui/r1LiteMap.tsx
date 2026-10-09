import React from 'react';
import { View } from 'react-native';
import { useApp } from '../lib/app';
import { Btn, Glyph, Text } from './components';
import { C, R, S, SP } from './theme';

type Mk = { lat: number; lng: number; label?: string; color?: string };
/** Low-data stand-in for the map: no tiles, no scripts. Lists the points and offers a one-tap "Show map" for this view. */
export function LiteMap({ markers, height, onShow }: { markers?: Mk[]; height: number | string; onShow: () => void }) {
  const { t } = useApp();
  return (
    <View testID="lite-map" style={{ minHeight: typeof height === 'number' ? Math.min(height, 170) : 150, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.mapBg, padding: SP.md, justifyContent: 'center', gap: SP.xs }}>
      <View style={[S.row, { gap: SP.sm }]}><Glyph g="🗺️" size={26} /><Text style={S.bold}>{t('r1.lite.map')}</Text></View>
      {(markers ?? []).filter((m) => m.label).slice(0, 4).map((m, i) => <Text key={i} style={S.muted}>• {m.label}: {m.lat.toFixed(4)}, {m.lng.toFixed(4)}</Text>)}
      <View style={{ marginTop: SP.sm, alignSelf: 'flex-start' }}><Btn kind="ghost" title={t('r1.lite.showmap')} onPress={onShow} /></View>
    </View>
  );
}
