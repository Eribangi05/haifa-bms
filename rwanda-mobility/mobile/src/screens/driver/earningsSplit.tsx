import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useApp } from '../../lib/app';
import { splitByService } from '../../lib/driverKind';
import { fmtRwf } from '../../lib/format';
import { useTripFeed } from '../../lib/tripFeed';
import { Card, Text } from '../../ui/components';
import { C, FS, S, SP } from '../../ui/theme';

/** Earnings by job type (rides in own vehicle vs Abasare jobs), from the driver's latest 50 jobs. Hidden until there is a finished job. */
export function EarningsSplit() {
  const { t } = useApp(); const feed = useTripFeed(); const sp = useMemo(() => splitByService(feed.trips ?? []), [feed.trips]);
  const total = sp.ride.fares + sp.abasare.fares; if (!total) return null;
  const rows = [{ k: 'ride' as const, g: '🛵', c: C.primary, v: sp.ride }, { k: 'abasare' as const, g: '🧑‍✈️', c: C.gold, v: sp.abasare }];
  return (
    <Card>
      <Text accessibilityRole="header" style={S.h2}>{t('er.split')}</Text><Text style={S.muted}>{t('er.latest')}</Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: C.line, marginVertical: SP.sm }}>
        {rows.filter((r) => r.v.fares > 0).map((r) => <View key={r.k} style={{ flex: r.v.fares / total, backgroundColor: r.c }} />)}
      </View>
      {rows.map((r) => (
        <View key={r.k} testID={`split-${r.k}`} style={[S.between, { minHeight: 48, gap: SP.sm }]}>
          <View style={[S.row, { gap: SP.sm, flex: 1 }]}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.c }} /><Text style={[S.bold, { flexShrink: 1 }]}>{r.g} {t(r.k === 'ride' ? 'er.ride' : 'er.abasare')}</Text></View>
          <View style={{ alignItems: 'flex-end' }}><Text style={{ fontSize: FS.md, fontWeight: '800', color: C.ink }}>{fmtRwf(r.v.fares)} RWF</Text><Text style={S.muted}>{t('er.jobs', { n: r.v.trips })}</Text></View>
        </View>
      ))}
    </Card>
  );
}
