import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { FlagStripe, IconBadge, Text } from './components';
import { C, FS, R, S, SHADOW, SP } from './theme';

/** Brand hero: sky-blue field with sun-yellow and green accents and the flag bands along the bottom edge. Text inside should use `onPrimary`. */
export function Hero({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={{ borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.primary, marginBottom: SP.md, ...SHADOW.raised }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', right: -34, top: -34, width: 130, height: 130, borderRadius: 65, backgroundColor: C.gold, opacity: 0.2 }} />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', right: 40, bottom: -48, width: 100, height: 100, borderRadius: 50, backgroundColor: C.green, opacity: 0.28 }} />
      <View style={{ padding: SP.lg }}>{children}</View>
      <FlagStripe height={6} />
    </View>
  );
}

/** One number with a caption: the building block of every statistics strip. */
export function StatTile({ glyph, value, unit, label, tint = C.skyBg, testID }: { glyph: string; value: string; unit?: string; label: string; tint?: string; testID?: string }) {
  return (
    <View testID={testID} accessible accessibilityLabel={`${label}: ${value}${unit ? ' ' + unit : ''}`} style={{ flex: 1, minWidth: 96, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: SP.md, ...SHADOW.card }}>
      <IconBadge glyph={glyph} bg={tint} size={32} />
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: value.length <= 5 ? FS.xl - 2 : value.length <= 7 ? FS.lg + 2 : FS.md + 1, fontWeight: '800', color: C.ink, marginTop: SP.sm }}>{value}</Text>
      <Text numberOfLines={3} style={S.muted}>{unit ? `${label} · ${unit}` : label}</Text>
    </View>
  );
}
export const StatRow = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.md }}>{children}</View>;

/** Square shortcut tile (3 per row on phones, 2 on very narrow screens). */
export function QuickAction({ glyph, label, onPress, tint = C.skyBg, testID, badge }: { glyph: string; label: string; onPress: () => void; tint?: string; testID?: string; badge?: boolean }) {
  const narrow = useWindowDimensions().width < 340;
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ width: narrow ? '48.5%' : '31.8%', minHeight: 92, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', padding: SP.sm, opacity: pressed ? 0.75 : 1, ...SHADOW.card })}>
      <View><IconBadge glyph={glyph} bg={tint} size={44} />{badge ? <View style={{ position: 'absolute', top: 0, right: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: C.danger, borderWidth: 2, borderColor: C.card }} /> : null}</View>
      <Text numberOfLines={2} style={{ marginTop: SP.sm, textAlign: 'center', fontSize: FS.sm, fontWeight: '700', color: C.ink }}>{label}</Text>
    </Pressable>
  );
}
export const QuickGrid = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.md }}>{children}</View>;

/** Settings-style list row inside a Card: icon, title, optional subtitle/value, chevron. */
export function MenuRow({ glyph, title, sub, value, onPress, testID, tint = C.skyBg, danger, last }: { glyph: string; title: string; sub?: string; value?: string; onPress: () => void; testID?: string; tint?: string; danger?: boolean; last?: boolean }) {
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${title}. ${sub}` : title} style={({ pressed }) => ({ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line, opacity: pressed ? 0.7 : 1 })}>
      <IconBadge glyph={glyph} bg={danger ? C.dangerBg : tint} size={38} />
      <View style={{ flex: 1 }}><Text style={[S.body, { fontWeight: '700' }, danger ? { color: C.danger } : null]}>{title}</Text>{sub ? <Text style={S.muted} numberOfLines={2}>{sub}</Text> : null}</View>
      {value ? <Text style={[S.muted, { maxWidth: '38%' }]} numberOfLines={1}>{value}</Text> : null}
      <Text accessible={false} style={{ color: C.muted, fontSize: 22 }}>›</Text>
    </Pressable>
  );
}
export const MenuGroup = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <View style={{ marginBottom: SP.md }}>
    {title ? <Text accessibilityRole="header" style={{ fontSize: FS.sm, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: SP.sm, marginLeft: SP.xs }}>{title}</Text> : null}
    <View style={{ backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: SP.md, ...SHADOW.card }}>{children}</View>
  </View>
);
