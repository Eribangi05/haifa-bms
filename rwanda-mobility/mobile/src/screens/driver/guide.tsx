import React, { useState } from 'react';
import { View } from 'react-native';
import { useApp, useBackHandler } from '../../lib/app';
import { Btn, FadeIn, Screen, Text } from '../../ui/components';
import { Illustration } from '../../ui/dash';
import { C, FS, R, S, SP } from '../../ui/theme';

const SLIDES = {
  own: { n: 4, art: ['📲🟢', '🛵💬', '🔐🚦', '💰📊'], tint: [C.skyBg, C.okBg, C.warnBg, C.goldBg] },
  ab: { n: 6, art: ['🧑‍✈️🚗', '📸🚗', '🚦🛣️', '🏁✅', '🛵🏠', '💰🌙'], tint: [C.warnBg, C.skyBg, C.okBg, C.skyBg, C.warnBg, C.goldBg] },
} as const;

/** Multi-page guide for the two driver categories: swipe-free (Next / Back), one idea per page, illustrated, with a page counter and dots. */
export function DriverGuide({ params }: { params?: { kind?: 'own' | 'abasare' } }) {
  const { t, nav } = useApp(); const kind = params?.kind === 'abasare' ? 'ab' : 'own'; const s = SLIDES[kind]; const [i, setI] = useState(0);
  useBackHandler(() => { if (i > 0) { setI(i - 1); return true; } return false; }, i > 0);
  const last = i === s.n - 1; const key = (x: 't' | 'd') => `dg.${kind}.${i + 1}.${x}` as 'dg.own.1.t';
  return (
    <Screen title={t(kind === 'ab' ? 'dg.ab.title' : 'dg.own.title')} onBack={() => nav.pop()} contentStyle={{ justifyContent: 'center' }}
      footer={<View style={{ flexDirection: 'row', gap: SP.sm }}>
        {i > 0 ? <View style={{ flex: 1 }}><Btn testID="guide-back" kind="ghost" title={t('dg.back')} onPress={() => setI(i - 1)} /></View> : null}
        <View style={{ flex: 2 }}><Btn testID="cta" big title={last ? t('dg.done') : t('dg.next')} onPress={() => (last ? nav.pop() : setI(i + 1))} /></View>
      </View>}>
      <FadeIn key={i}>
        <Illustration glyphs={s.art[i]} tint={s.tint[i]} height={190} testID={`guide-art-${i}`} />
        <Text style={[S.muted, { textAlign: 'center' }]}>{t('dg.step', { n: i + 1, total: s.n })}</Text>
        <Text testID="guide-title" accessibilityRole="header" style={{ fontSize: FS.xl, fontWeight: '800', color: C.ink, textAlign: 'center', marginTop: SP.xs }}>{t(key('t'))}</Text>
        <Text testID="guide-body" style={[S.body, { textAlign: 'center', marginTop: SP.sm, fontSize: FS.md + 1, lineHeight: 24 }]}>{t(key('d'))}</Text>
      </FadeIn>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: SP.lg }}>
        {Array.from({ length: s.n }, (_, k) => <View key={k} style={{ width: k === i ? 22 : 8, height: 8, borderRadius: R.pill, backgroundColor: k === i ? C.primary : C.line }} />)}
      </View>
    </Screen>
  );
}
