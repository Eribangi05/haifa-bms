import React from 'react';
import { Image, Pressable, View, useWindowDimensions } from 'react-native';
import { FlagStripe, Glyph, IconBadge, Text } from './components';
import { emojiList } from './icons';
import { C, FS, R, S, SHADOW, SP } from './theme';

/** Brand hero: sky-blue field with sun-yellow and green accents and the flag bands along the bottom edge. Text inside should use `onPrimary`. */
export function Hero({ children, testID, art }: { children: React.ReactNode; testID?: string; art?: import('react-native').ImageSourcePropType }) {
  return (
    <View testID={testID} style={{ borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.primary, marginBottom: SP.md, ...SHADOW.raised }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', right: -34, top: -34, width: 130, height: 130, borderRadius: 65, backgroundColor: C.gold, opacity: 0.2 }} />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', right: 40, bottom: -48, width: 100, height: 100, borderRadius: 50, backgroundColor: C.green, opacity: 0.28 }} />
      {art ? <Image accessibilityElementsHidden source={art} resizeMode="cover" style={{ position: 'absolute', right: 0, top: 0, width: '52%', height: '58%', opacity: 0.95 }} /> : null}
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
    {title ? <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SP.sm }}><View style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: C.gold, marginRight: SP.sm }} /><Text accessibilityRole="header" style={{ fontSize: FS.sm, fontWeight: '800', color: C.ink, textTransform: 'uppercase', letterSpacing: 0.6 }}>{title}</Text></View> : null}
    <View style={{ backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: SP.md, ...SHADOW.card }}>{children}</View>
  </View>
);

/** Illustrated panel built from emoji and flag-coloured shapes (no image assets): used on guide pages, choosers and empty pages. */
export function Illustration({ glyphs, tint = C.skyBg, height = 150, testID }: { glyphs: string; tint?: string; height?: number; testID?: string }) {
  return (
    <View testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height, borderRadius: R.lg, backgroundColor: tint, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: SP.md }}>
      <View style={{ position: 'absolute', left: -24, bottom: -30, width: 110, height: 110, borderRadius: 55, backgroundColor: C.sky, opacity: 0.22 }} />
      <View style={{ position: 'absolute', right: 26, top: -28, width: 84, height: 84, borderRadius: 42, backgroundColor: C.gold, opacity: 0.5 }} />
      <View style={{ position: 'absolute', right: -18, bottom: -22, width: 100, height: 100, borderRadius: 50, backgroundColor: C.green, opacity: 0.35 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>{emojiList(glyphs).map((g, i) => <View key={i} style={{ marginHorizontal: -4 }}><Glyph g={g} size={Math.round(height * (emojiList(glyphs).length > 2 ? 0.46 : 0.56))} /></View>)}</View>
    </View>
  );
}

/** Segmented control for sub-pages inside one tab (equal-width pills). */
export function Segmented({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: C.line, borderRadius: R.pill, padding: 3, marginBottom: SP.md }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable key={it.key} testID={`seg-${it.key}`} onPress={() => onChange(it.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={it.label}
            style={{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: R.pill, backgroundColor: on ? C.card : 'transparent', paddingHorizontal: 4, ...(on ? SHADOW.card : {}) }}>
            <Text numberOfLines={1} style={{ fontSize: FS.sm, fontWeight: on ? '800' : '600', color: on ? C.primaryDark : C.muted }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Horizontal progress steps (done = ✓, current = highlighted number). */
export function StepBar({ steps, labels }: { steps: { key: string; state: 'done' | 'current' | 'todo' }[]; labels: Record<string, string> }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: SP.sm }}>
      {steps.map((st, i) => (
        <View key={st.key} testID={`step-${st.key}-${st.state}`} accessible accessibilityLabel={`${labels[st.key]}: ${st.state}`} style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
            <View style={{ flex: 1, height: 3, backgroundColor: i === 0 ? 'transparent' : st.state === 'todo' ? C.line : C.green }} />
            <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: st.state === 'done' ? C.green : st.state === 'current' ? C.gold : C.line, borderWidth: st.state === 'current' ? 2 : 0, borderColor: C.ink }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: st.state === 'done' ? '#fff' : C.ink }}>{st.state === 'done' ? '✓' : i + 1}</Text>
            </View>
            <View style={{ flex: 1, height: 3, backgroundColor: i === steps.length - 1 ? 'transparent' : st.state === 'done' ? C.green : C.line }} />
          </View>
          <Text numberOfLines={2} style={{ fontSize: FS.xs, textAlign: 'center', marginTop: 4, fontWeight: st.state === 'current' ? '800' : '500', color: st.state === 'todo' ? C.muted : C.ink }}>{labels[st.key]}</Text>
        </View>
      ))}
    </View>
  );
}
