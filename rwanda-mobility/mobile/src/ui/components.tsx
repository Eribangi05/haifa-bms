import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, useWindowDimensions, ScrollView, StyleProp, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, S } from './theme';
import { LANGS, type Lang } from '../lib/i18n';
import { useApp } from '../lib/app';

const MAX_W = 640;

/** True when the OS asks for reduced motion (animations become instant). */
export function useReduceMotion() {
  const [r, setR] = React.useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => live && setR(!!v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setR(!!v));
    return () => { live = false; sub?.remove?.(); };
  }, []);
  return r;
}
export function Screen({ children, scroll = true, footer, embedded }: { children: React.ReactNode; scroll?: boolean; footer?: React.ReactNode; embedded?: boolean }) {
  const { width } = useWindowDimensions();
  const wide = width > MAX_W + 40;
  return (
    <SafeAreaView style={S.screen} edges={embedded ? ['bottom'] : ['top', 'bottom']}>
      {embedded ? null : <FlagStripe height={8} />}
      {scroll ? <ScrollView contentContainerStyle={[S.pad, wide ? { width: MAX_W, alignSelf: 'center' } : null]} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={S.fill}>{children}</View>}
      {footer ? <View style={{ padding: 12, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line }}><View style={wide ? { width: MAX_W, alignSelf: 'center' } : null}>{footer}</View></View> : null}
    </SafeAreaView>
  );
}

/** Fade + slide-up entrance. Respects nothing fancy: short, native-driven, harmless when motion is reduced by the OS. */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current; const reduce = useReduceMotion();
  useEffect(() => { if (reduce) { v.setValue(1); return; } Animated.timing(v, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [v, delay, reduce]);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }, style]}>{children}</Animated.View>;
}

/** Pulsing placeholder shown while content loads (better than a lone spinner). */
export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: number | string; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0.45)).current; const reduce = useReduceMotion();
  useEffect(() => { if (reduce) { v.setValue(0.7); return; } const l = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true })])); l.start(); return () => l.stop(); }, [v, reduce]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ height, width: width as any, borderRadius: 8, backgroundColor: C.line, opacity: v }, style]} />;
}

/** Round emoji badge used as a lightweight icon (no icon-font dependency). */
export const IconBadge = ({ glyph, bg = C.okBg, size = 44 }: { glyph: string; bg?: string; size?: number }) => (
  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: size * 0.5 }}>{glyph}</Text></View>
);

/** Trip progress: Request > Driver > Pickup > Trip > Done. `at` is the 0-based current step. */
export function Stepper({ at }: { at: number }) {
  const { t } = useApp();
  const steps = [t('step.request'), t('step.match'), t('step.pickup'), t('step.ride'), t('step.done')];
  return (
    <View accessible accessibilityLabel={t('a11y.step', { n: at + 1, total: steps.length, label: steps[at] })} style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {steps.map((_, i) => (
          <React.Fragment key={i}>
            <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: i <= at ? C.primary : C.line }}>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{i < at ? '✓' : i + 1}</Text>
            </View>
            {i < steps.length - 1 ? <View style={{ flex: 1, height: 3, backgroundColor: i < at ? C.primary : C.line }} /> : null}
          </React.Fragment>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        {steps.map((l, i) => <Text key={i} numberOfLines={1} style={{ flex: 1, fontSize: 11, textAlign: i === 0 ? 'left' : i === steps.length - 1 ? 'right' : 'center', color: i === at ? C.primary : C.muted, fontWeight: i === at ? '800' : '500' }}>{l}</Text>)}
      </View>
    </View>
  );
}

export function Btn({ title, onPress, kind = 'primary', disabled, loading, style, big }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'gold'; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; big?: boolean;
}) {
  const bg = kind === 'primary' ? C.primary : kind === 'danger' ? C.danger : kind === 'gold' ? C.gold : 'transparent';
  const fg = kind === 'ghost' ? C.primary : kind === 'gold' ? C.ink : '#fff';
  const sc = useRef(new Animated.Value(1)).current; const reduce = useReduceMotion();
  const to = (v: number) => { if (reduce) { sc.setValue(1); return; } Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start(); };
  return (
    <Animated.View style={{ transform: [{ scale: sc }] }}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }} onPress={onPress} disabled={disabled || loading}
        onPressIn={() => to(0.97)} onPressOut={() => to(1)} hitSlop={4}
        style={({ pressed }) => [{ backgroundColor: bg, borderRadius: 14, minHeight: big ? 60 : 52, minWidth: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
          borderWidth: kind === 'ghost' ? 1.5 : 0, borderColor: C.primary }, style]}>
        {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: big ? 19 : 16, fontWeight: '700', textAlign: 'center', flexShrink: 1 }}>{title}</Text>}
      </Pressable>
    </Animated.View>
  );
}

export function Field({ label, ...p }: TextInputProps & { label?: string }) {
  return (
    <View style={{ marginBottom: 10 }}>
      {label ? <Text style={[S.muted, { marginBottom: 4 }]}>{label}</Text> : null}
      <TextInput placeholderTextColor="#8A9A91" accessibilityLabel={label} style={[S.input, p.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null]} {...p} />
    </View>
  );
}

/** Text-only action (header links, "clear", "close"): role + label + a 44 px touch target. */
export const LinkBtn = ({ title, onPress, label, color = C.primary, style }: { title: string; onPress: () => void; label?: string; color?: string; style?: StyleProp<ViewStyle> }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? title} hitSlop={4} style={[{ minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }, style]}>
    <Text style={{ color, fontWeight: '700' }}>{title}</Text>
  </Pressable>
);

export const Card = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[S.card, style]}>{children}</View>;

export function Banner({ text, kind = 'warn' }: { text: string; kind?: 'warn' | 'bad' | 'ok' }) {
  const bg = kind === 'bad' ? C.dangerBg : kind === 'ok' ? C.okBg : C.warnBg; const fg = kind === 'bad' ? C.danger : kind === 'ok' ? C.primary : C.warn;
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: bg, borderRadius: 12, padding: 12, marginBottom: 12 }}><Text style={{ color: fg, fontSize: 14 }}>{text}</Text></View>;
}

export const Pill = ({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'warn' | 'bad' }) => (
  <View style={{ alignSelf: 'flex-start', backgroundColor: tone === 'bad' ? C.dangerBg : tone === 'warn' ? C.warnBg : C.okBg, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}>
    <Text style={{ fontSize: 12, fontWeight: '600', color: tone === 'bad' ? C.danger : tone === 'warn' ? C.warn : C.primary }}>{text}</Text>
  </View>
);

export const Chip = ({ text, onPress, on }: { text: string; onPress: () => void; on?: boolean }) => (
  <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: !!on }} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, borderWidth: 1, borderColor: on ? C.primary : C.line, backgroundColor: on ? C.okBg : '#fff', marginRight: 8, marginBottom: 8, maxWidth: '100%' }}>
    <Text style={{ color: on ? C.primary : C.ink, fontWeight: on ? '700' : '500', flexShrink: 1 }}>{text}</Text>
  </Pressable>
);

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  const { t } = useApp();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.card, minHeight: 56 }}>
        {onBack ? <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 4 }}><Text style={{ fontSize: 28, color: C.primary }}>{'‹'}</Text></Pressable> : null}
        <Text accessibilityRole="header" style={[S.h2, { flex: 1 }]} numberOfLines={1}>{title}</Text>{right}
      </View>
      <FlagStripe height={5} />
    </View>
  );
}

export const Money = ({ n, style }: { n: number | null | undefined; style?: object }) => <Text style={style}>{n == null ? '-' : Math.round(n).toLocaleString('en-US')} RWF</Text>;
export const Empty = ({ text }: { text: string }) => <View style={{ padding: 28, alignItems: 'center' }}><Text style={[S.muted, { textAlign: 'center' }]}>{text}</Text></View>;
export const Spinner = () => <View accessibilityRole="progressbar" style={{ padding: 24 }}><ActivityIndicator color={C.primary} size="large" /></View>;

/** Rwanda flag bands (sky blue, sun yellow, green) used as a brand accent. */
export function FlagStripe({ height = 6 }: { height?: number }) {
  return <View style={{ height, flexDirection: 'column' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={{ flex: 2, backgroundColor: C.sky }} /><View style={{ flex: 1, backgroundColor: C.gold }} /><View style={{ flex: 1, backgroundColor: C.green }} /></View>;
}

/** Language switcher: one chip per language, labelled in its own language (never translated). */
export function LangPicker({ lang, onPick }: { lang: Lang; onPick: (l: Lang) => void }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap' }} accessibilityRole="radiogroup">{LANGS.map((l) => <Chip key={l.code} text={l.label} on={lang === l.code} onPress={() => onPick(l.code)} />)}</View>;
}
