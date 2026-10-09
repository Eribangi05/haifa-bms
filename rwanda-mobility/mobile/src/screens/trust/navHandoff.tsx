import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useApp } from '../../lib/app';
import { navFallbacks, type NavInfo } from '../../lib/trustApi';
import { Banner, Btn, Text } from '../../ui/components';
import { S, SP } from '../../ui/theme';

/** Open turn-by-turn navigation in Google Maps / Waze / the phone's maps app (geo: intent), falling back to the Google Maps web link. */
export function R1NavButtons({ trip, which }: { trip: { navigation?: NavInfo | null; pickup: { lat: number; lng: number }; destination: { lat: number; lng: number } }; which: 'pickup' | 'destination' }) {
  const { t } = useApp(); const [fail, setFail] = useState(false);
  const nav = trip.navigation; const target = nav?.[which] ?? trip[which];   // older servers: plain coordinates
  if (!target) return null;
  const go = async (app: 'google' | 'waze' | 'geo') => {
    setFail(false);
    for (const url of navFallbacks(target, app)) { try { await Linking.openURL(url); return; } catch { /* try the next link */ } }
    setFail(true);
  };
  const min = which === 'pickup' ? nav?.eta_to_pickup_min : nav?.eta_to_destination_min;
  return (
    <View style={{ gap: SP.sm }} testID="nav-buttons">
      <Text style={S.bold}>{t('r1.nav.title')} {which === 'pickup' ? t('r1.nav.pickup') : t('r1.nav.dest')}{min != null ? ` · ${t('r1.nav.eta', { n: min })}` : ''}</Text>
      <Btn testID="nav-google" kind="ghost" title={t('r1.nav.google')} onPress={() => void go('google')} />
      <Btn testID="nav-waze" kind="ghost" title={t('r1.nav.waze')} onPress={() => void go('waze')} />
      <Btn testID="nav-geo" kind="ghost" title={t('r1.nav.other')} onPress={() => void go('geo')} />
      {fail ? <Banner text={t('r1.nav.fail')} /> : null}
    </View>
  );
}
