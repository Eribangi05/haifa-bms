import React from 'react';
import { Pressable, View } from 'react-native';
import { useApp } from '../../lib/app';
import type { DriverKind } from '../../lib/driverKind';
import { Card, IconBadge, Pill, Text } from '../../ui/components';
import { Hero } from '../../ui/dash';
import { C, FS, R, S, SP } from '../../ui/theme';

export const KIND_GLYPH: Record<DriverKind, string> = { new: '🚦', own: '🛵', abasare: '🧑‍✈️', both: '🛵🧑‍✈️' };

/** Category card: who you are as a driver, which jobs that gives you, and a link to the guide. Rendered on the Jobs tab and the Profile overview. */
export function CategoryCard({ kind, jobs, onGuide, testID = 'kind-card' }: { kind: DriverKind; jobs?: ('ride' | 'abasare')[]; onGuide?: () => void; testID?: string }) {
  const { t } = useApp();
  return (
    <Hero testID={testID}>
      <View style={[S.row, { gap: SP.md }]}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ minWidth: 64, height: 64, paddingHorizontal: 8, borderRadius: 32, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 28 }}>{KIND_GLYPH[kind]}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.onPrimary, opacity: 0.85, fontSize: FS.sm }}>{t('pf.cat')}</Text>
          <Text testID={`${testID}-label`} accessibilityRole="header" style={{ color: C.onPrimary, fontSize: FS.lg + 2, fontWeight: '800' }}>{t(`dk.${kind}` as 'dk.own')}</Text>
        </View>
      </View>
      <Text style={{ color: C.onPrimary, opacity: 0.92, marginTop: SP.sm }}>{t(`dk.${kind}.sub` as 'dk.own.sub')}</Text>
      {jobs && jobs.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs + 2, marginTop: SP.sm }}>
        {jobs.map((j) => <View key={j} testID={`job-${j}`} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 5 }}><Text accessible={false} style={{ marginRight: 5 }}>{j === 'ride' ? '🛵' : '🧑‍✈️'}</Text><Text style={{ fontSize: 12, fontWeight: '700', color: C.ink }}>{t(`dk.job.${j}` as 'dk.job.ride')}</Text></View>)}
      </View> : null}
      {onGuide ? <Pressable testID="kind-guide" onPress={onGuide} accessibilityRole="button" accessibilityLabel={t('dk.guide')} style={{ marginTop: SP.md, minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' }}><Text style={{ color: C.gold, fontWeight: '800' }}>{t('dk.guide')} ›</Text></Pressable> : null}
    </Hero>
  );
}

/** Small category pill (own vehicle / Abasare) for rows and lists. */
export const KindPill = ({ job }: { job: 'ride' | 'abasare' }) => { const { t } = useApp(); return <Pill tone={job === 'abasare' ? 'warn' : 'ok'} glyph={job === 'abasare' ? '🧑‍✈️' : '🛵'} text={job === 'abasare' ? t('dk.badge.abasare') : t('dk.badge.own')} />; };

/** Option card used by the chooser: tag, title, bullet list, requirements and a call to action. */
export function OptionCard({ glyph, tint, tag, title, bullets, need, cta, onPress, testID, accent }: { glyph: string; tint: string; tag: string; title: string; bullets: string[]; need: string; cta: string; onPress: () => void; testID: string; accent: string }) {
  return (
    <Card style={{ borderColor: accent, borderWidth: 2 }}>
      <View style={[S.row, { gap: SP.md }]}>
        <IconBadge glyph={glyph} bg={tint} size={56} />
        <View style={{ flex: 1 }}><Text style={{ fontSize: FS.xs, fontWeight: '800', letterSpacing: 1, color: C.muted }}>{tag}</Text><Text accessibilityRole="header" style={S.h2}>{title}</Text></View>
      </View>
      <View style={{ marginTop: SP.md, gap: SP.sm }}>
        {bullets.map((b) => <View key={b} style={{ flexDirection: 'row', gap: SP.sm }}><Text accessible={false} style={{ color: C.green, fontWeight: '800' }}>✓</Text><Text style={[S.body, { flex: 1 }]}>{b}</Text></View>)}
      </View>
      <View style={{ backgroundColor: C.skyBg, borderRadius: R.sm + 2, padding: SP.sm + 2, marginTop: SP.md }}><Text style={S.muted}>{need}</Text></View>
      <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={cta} style={({ pressed }) => ({ marginTop: SP.md, minHeight: 52, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: accent === C.gold ? C.gold : C.primary, opacity: pressed ? 0.85 : 1, paddingHorizontal: SP.md })}>
        <Text style={{ color: accent === C.gold ? C.onGold : C.onPrimary, fontWeight: '800', fontSize: FS.md + 1, textAlign: 'center' }}>{cta}</Text>
      </Pressable>
    </Card>
  );
}
