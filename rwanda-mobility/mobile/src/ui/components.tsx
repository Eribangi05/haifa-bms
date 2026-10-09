import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text as RNText, TextInput, useWindowDimensions, View } from 'react-native';
import type { StyleProp, TextInputProps, TextProps, TextStyle, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, FS, MAX_W, R, S, SHADOW, SP } from './theme';
import { LANGS, type Lang } from '../lib/i18n';
import { useApp } from '../lib/app';
import type { Tone } from '../lib/trip';
import { useAppearance } from '../lib/appearance';
import { LARGE_TEXT_FACTOR, fontCap } from '../lib/palette';

/** Text that respects the user's font-size setting but caps it so layouts and CTAs never clip (React 19 ignores Text.defaultProps, so this wrapper does it). */
export function Text(p: TextProps) {
  const { largeText } = useAppearance();
  if (!largeText) return <RNText maxFontSizeMultiplier={fontCap(false)} {...p} />;
  // Large-text mode: we scale the font ourselves and lower the OS cap so the total never exceeds 1.4x.
  const st = StyleSheet.flatten(p.style) ?? {};
  const scaled = { ...st, fontSize: Math.round((st.fontSize ?? 14) * LARGE_TEXT_FACTOR), ...(st.lineHeight ? { lineHeight: Math.round(st.lineHeight * LARGE_TEXT_FACTOR) } : {}) };
  return <RNText maxFontSizeMultiplier={fontCap(true)} {...p} style={scaled} />;
}

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

/** Map / hero height as a share of the window height, clamped, so it works from 320x568 phones to tablets. */
export function useProportionalHeight(frac: number, min: number, max: number) {
  const { height } = useWindowDimensions();
  return Math.round(Math.min(max, Math.max(min, height * frac)));
}

// ------------------------------------------------------------------ layout
/** Rwanda flag bands (sky blue, sun yellow, green) used as a brand accent. */
export function FlagStripe({ height = 6 }: { height?: number }) {
  return <View style={{ height, flexDirection: 'column' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={{ flex: 2, backgroundColor: C.sky }} /><View style={{ flex: 1, backgroundColor: C.gold }} /><View style={{ flex: 1, backgroundColor: C.green }} /></View>;
}

/** Top bar: applies the top inset itself, shows an obvious labelled back control (top-left, 44 px) and a title that may wrap to two lines. */
export function Header({ title, onBack, right }: { title?: string; onBack?: () => void; right?: React.ReactNode }) {
  const { t } = useApp(); const insets = useSafeAreaInsets(); const { width } = useWindowDimensions();
  const cap = width > MAX_W ? { width: MAX_W, alignSelf: 'center' as const } : null;
  return (
    <View testID="header" style={{ backgroundColor: C.card, paddingTop: insets.top, ...SHADOW.card }}>
      <View style={cap}>
        {onBack ? (
          <View style={[S.between, { paddingHorizontal: SP.sm, minHeight: 48 }]}>
            <Pressable testID="back" onPress={onBack} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={({ pressed }) => ({ minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', paddingRight: SP.md, opacity: pressed ? 0.6 : 1 })}>
              <Text accessible={false} style={{ fontSize: 30, lineHeight: 34, color: C.primary, marginTop: -3, width: 28, textAlign: 'center' }}>{'‹'}</Text>
              <Text accessible={false} numberOfLines={1} style={{ color: C.primary, fontWeight: '700', fontSize: FS.md, flexShrink: 1 }}>{t('common.back')}</Text>
            </Pressable>
            <View style={[S.row, { flexShrink: 0 }]}>{right}</View>
          </View>
        ) : null}
        <View style={[S.row, { flexWrap: 'wrap', paddingHorizontal: SP.lg, paddingTop: onBack ? 0 : SP.sm, paddingBottom: SP.md, minHeight: onBack ? 0 : 52 }]}>
          {title ? <Text accessibilityRole="header" numberOfLines={2} style={[S.h2, { flexGrow: 1, flexShrink: 1, minWidth: 120, fontSize: onBack ? FS.xl - 2 : FS.lg + 2 }]}>{title}</Text> : <View style={{ flex: 1 }} />}
          {onBack ? null : <View style={{ flexShrink: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>{right}</View>}
        </View>
      </View>
      <FlagStripe height={4} />
    </View>
  );
}

type ScreenProps = {
  children: React.ReactNode; title?: string; onBack?: () => void; right?: React.ReactNode; footer?: React.ReactNode; scroll?: boolean; stripe?: boolean;
  onRefresh?: () => Promise<unknown> | void; contentStyle?: StyleProp<ViewStyle>; scrollRef?: React.Ref<ScrollView>;
};
/**
 * The one screen shell. Handles: all four safe-area insets (notch, gesture bar, 3-button nav), a header with back, a sticky footer for the
 * primary action (bottom padding = max(inset, 12) + gap), keyboard avoidance, pull-to-refresh and a capped content width on tablets.
 */
export function Screen({ children, title, onBack, right, footer, scroll = true, stripe = true, onRefresh, contentStyle, scrollRef }: ScreenProps) {
  const insets = useSafeAreaInsets(); const { width } = useWindowDimensions();
  const [refreshing, setRefreshing] = React.useState(false);
  const wide = width > MAX_W + 40; const cap: ViewStyle | null = wide ? { width: MAX_W, alignSelf: 'center' } : null;
  const hasHeader = title !== undefined || !!onBack || !!right;
  const refresh = onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }} colors={[C.primary]} tintColor={C.primary} /> : undefined;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingLeft: insets.left, paddingRight: insets.right }}>
      {hasHeader ? <Header title={title} onBack={onBack} right={right} /> : <><View style={{ height: insets.top }} />{stripe ? <FlagStripe height={8} /> : null}</>}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" enabled={Platform.OS !== 'web'}>
        {scroll
          ? <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ padding: SP.lg, paddingBottom: footer ? SP.lg : insets.bottom + SP.xl, flexGrow: 1 }, cap, contentStyle]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={refresh} ref={scrollRef}>{children}</ScrollView>
          : <View style={[{ flex: 1 }, cap]}>{children}</View>}
        {footer ? (
          <View testID="footer" style={{ backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, paddingTop: SP.md, paddingHorizontal: SP.lg, paddingBottom: Math.max(insets.bottom, SP.md) + SP.xs, ...SHADOW.sheet }}>
            <View style={[{ gap: SP.sm }, cap]}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/** Fade + slide-up entrance. Short, native-driven, instant when the OS asks for reduced motion. */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current; const reduce = useReduceMotion();
  useEffect(() => { if (reduce) { v.setValue(1); return; } Animated.timing(v, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [v, delay, reduce]);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }, style]}>{children}</Animated.View>;
}

/** Pulsing placeholder shown while content loads (better than a lone spinner). */
export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: number | string; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0.45)).current; const reduce = useReduceMotion();
  useEffect(() => { if (reduce) { v.setValue(0.7); return; } const l = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true })])); l.start(); return () => l.stop(); }, [v, reduce]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ height, width: width as ViewStyle['width'], borderRadius: 8, backgroundColor: C.line, opacity: v }, style]} />;
}
export const SkeletonCard = () => <View style={S.card}><Skeleton height={18} width="65%" /><Skeleton height={13} width="40%" style={{ marginTop: 10 }} /></View>;

/** Round emoji badge used as a lightweight icon (no icon-font dependency). */
export const IconBadge = ({ glyph, bg = C.okBg, size = 44 }: { glyph: string; bg?: string; size?: number }) => (
  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: size * 0.5 }}>{glyph}</Text></View>
);

/** Trip progress: Request > Driver > Pickup > Trip > Done. `at` is the 0-based current step. */
export function Stepper({ at }: { at: number }) {
  const { t } = useApp();
  const steps = [t('step.request'), t('step.match'), t('step.pickup'), t('step.ride'), t('step.done')];
  return (
    <View accessible accessibilityLabel={t('a11y.step', { n: at + 1, total: steps.length, label: steps[at] })} style={{ marginBottom: SP.md }}>
      <View style={S.row}>
        {steps.map((_, i) => (
          <React.Fragment key={i}>
            <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: i <= at ? C.primary : C.line }}>
              <Text style={{ color: C.onPrimary, fontSize: 12, fontWeight: '800' }}>{i < at ? '✓' : i + 1}</Text>
            </View>
            {i < steps.length - 1 ? <View style={{ flex: 1, height: 3, backgroundColor: i < at ? C.primary : C.line }} /> : null}
          </React.Fragment>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        {steps.map((l, i) => <Text key={i} numberOfLines={1} style={{ flex: 1, fontSize: FS.xs, textAlign: i === 0 ? 'left' : i === steps.length - 1 ? 'right' : 'center', color: i === at ? C.primary : C.muted, fontWeight: i === at ? '800' : '500' }}>{l}</Text>)}
      </View>
    </View>
  );
}

/** Thin progress bar (0..1) with an optional caption: route progress, upload progress. */
export function ProgressBar({ value, label, a11y }: { value: number; label?: string; a11y?: string }) {
  const v = Math.min(1, Math.max(0, value));
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={a11y ?? label} accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' }}><View style={{ height: 8, width: `${Math.round(v * 100)}%`, backgroundColor: C.primary, borderRadius: 4 }} /></View>
      {label ? <Text style={[S.muted, { marginTop: 4 }]}>{label}</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------------ controls
export function Btn({ title, onPress, kind = 'primary', disabled, loading, style, big, testID }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'gold'; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; big?: boolean; testID?: string;
}) {
  const bg = kind === 'primary' ? C.primary : kind === 'danger' ? C.danger : kind === 'gold' ? C.gold : 'transparent';
  const fg = kind === 'ghost' ? C.primary : kind === 'gold' ? C.onGold : kind === 'danger' ? C.onDanger : C.onPrimary;
  const sc = useRef(new Animated.Value(1)).current; const reduce = useReduceMotion();
  const to = (v: number) => { if (reduce) { sc.setValue(1); return; } Animated.spring(sc, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start(); };
  return (
    <Animated.View style={{ transform: [{ scale: sc }] }}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }} onPress={onPress} disabled={disabled || loading}
        onPressIn={() => to(0.97)} onPressOut={() => to(1)} hitSlop={4}
        style={({ pressed }) => [{ backgroundColor: bg, borderRadius: R.md, minHeight: big ? 60 : 52, minWidth: 44, paddingHorizontal: 18, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
          borderWidth: kind === 'ghost' ? 1.5 : 0, borderColor: C.primary }, kind === 'primary' && !disabled ? SHADOW.card : null, style]}>
        {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: big ? 19 : 16, fontWeight: '700', textAlign: 'center', flexShrink: 1 }}>{title}</Text>}
      </Pressable>
    </Animated.View>
  );
}

type FieldProps = TextInputProps & { label?: string; inputRef?: React.Ref<TextInput>; error?: string };
export function Field({ label, inputRef, error, ...p }: FieldProps) {
  const { largeText } = useAppearance();
  return (
    <View style={{ marginBottom: SP.sm + 2 }}>
      {label ? <Text style={[S.muted, { marginBottom: 4 }]}>{label}</Text> : null}
      <TextInput ref={inputRef} maxFontSizeMultiplier={fontCap(largeText)} placeholderTextColor={C.placeholder} accessibilityLabel={label ?? p.accessibilityLabel} {...p}
        style={[S.input, error ? { borderColor: C.danger } : null, largeText ? { fontSize: 16 * LARGE_TEXT_FACTOR } : null, p.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null, p.style]} />
      {error ? <Text accessibilityLiveRegion="polite" style={{ color: C.danger, fontSize: FS.sm, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}
/** Next-field focus chain: `const f = useFormFocus(3); <Field {...f(0)} /> <Field {...f(1)} /> <Field {...f(2, submit)} />` (Enter moves on; the last field runs `submit`). */
export function useFormFocus(count: number) {
  const refs = useRef<(TextInput | null)[]>([]);
  return (i: number, onDone?: () => void): Pick<FieldProps, 'inputRef' | 'returnKeyType' | 'onSubmitEditing' | 'blurOnSubmit'> => ({
    inputRef: (r) => { refs.current[i] = r; }, returnKeyType: i >= count - 1 ? 'done' : 'next', blurOnSubmit: i >= count - 1,
    onSubmitEditing: () => { if (i < count - 1) refs.current[i + 1]?.focus(); else onDone?.(); },
  });
}

/** Text-only action (header links, "clear", "close"): role + label + a 44 px touch target. */
export const LinkBtn = ({ title, onPress, label, color = C.primary, style }: { title: string; onPress: () => void; label?: string; color?: string; style?: StyleProp<ViewStyle> }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? title} hitSlop={4} style={[{ minHeight: 44, minWidth: 44, paddingHorizontal: SP.sm, alignItems: 'center', justifyContent: 'center' }, style]}>
    <Text style={{ color, fontWeight: '700' }}>{title}</Text>
  </Pressable>
);

export const Chip = ({ text, onPress, on, glyph }: { text: string; onPress: () => void; on?: boolean; glyph?: string }) => (
  <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: !!on }} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: R.pill, borderWidth: 1, borderColor: on ? C.primary : C.line, backgroundColor: on ? C.okBg : C.card, marginRight: SP.sm, marginBottom: SP.sm, maxWidth: '100%' }}>
    {glyph ? <Text accessible={false} style={{ marginRight: 6 }}>{glyph}</Text> : null}
    <Text style={{ color: on ? C.primary : C.ink, fontWeight: on ? '700' : '500', flexShrink: 1 }}>{text}</Text>
  </Pressable>
);

/** Language switcher: one chip per language, labelled in its own language (never translated). */
export function LangPicker({ lang, onPick }: { lang: Lang; onPick: (l: Lang) => void }) {
  return <View style={S.wrap} accessibilityRole="radiogroup">{LANGS.map((l) => <Chip key={l.code} text={l.label} on={lang === l.code} onPress={() => onPick(l.code)} />)}</View>;
}

// ------------------------------------------------------------------ content
export const Card = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[S.card, SHADOW.card, style]}>{children}</View>;
export const SectionTitle = ({ text, right }: { text: string; right?: React.ReactNode }) => <View style={[S.between, { marginTop: SP.sm, marginBottom: SP.sm }]}><Text accessibilityRole="header" style={[S.h2, { flex: 1 }]}>{text}</Text>{right}</View>;

export function Banner({ text, kind = 'warn', action }: { text: string; kind?: 'warn' | 'bad' | 'ok'; action?: React.ReactNode }) {
  const bg = kind === 'bad' ? C.dangerBg : kind === 'ok' ? C.okBg : C.warnBg; const fg = kind === 'bad' ? C.danger : kind === 'ok' ? C.primary : C.warn;
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: bg, borderRadius: R.sm + 2, padding: SP.md, marginBottom: SP.md }}><Text style={{ color: fg, fontSize: 14 }}>{text}</Text>{action ? <View style={{ marginTop: SP.sm }}>{action}</View> : null}</View>;
}

export const Pill = ({ text, tone = 'ok', glyph }: { text: string; tone?: Tone; glyph?: string }) => (
  <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', backgroundColor: tone === 'bad' ? C.dangerBg : tone === 'warn' ? C.warnBg : C.okBg, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
    {glyph ? <Text accessible={false} style={{ fontSize: FS.xs, marginRight: 4, color: tone === 'bad' ? C.danger : tone === 'warn' ? C.warn : C.primary }}>{glyph}</Text> : null}
    <Text style={{ fontSize: 12, fontWeight: '600', color: tone === 'bad' ? C.danger : tone === 'warn' ? C.warn : C.primary, flexShrink: 1 }}>{text}</Text>
  </View>
);

/** List row with an icon badge, title, subtitle and trailing content: the building block for history, places, receipts. */
export function ListRow({ glyph, tint, title, subtitle, right, onPress, label }: { glyph?: string; tint?: string; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; label?: string }) {
  const body = (
    <View style={[S.row, { paddingVertical: SP.sm, gap: SP.md }]}>
      {glyph ? <IconBadge glyph={glyph} bg={tint} size={40} /> : null}
      <View style={{ flex: 1 }}><Text style={[S.body, { fontWeight: '600' }]} numberOfLines={2}>{title}</Text>{subtitle ? <Text style={S.muted} numberOfLines={2}>{subtitle}</Text> : null}</View>
      {right}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? title} style={({ pressed }) => ({ minHeight: 44, opacity: pressed ? 0.7 : 1 })}>{body}</Pressable> : body;
}

/** Illustrated empty state built from emoji and shapes (no image assets). */
export function EmptyState({ glyph, title, body, action }: { glyph: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: SP.xl, paddingHorizontal: SP.lg }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg }}>
        <View style={{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: C.skyBg }} />
        <View style={{ position: 'absolute', top: 6, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: C.gold }} />
        <View style={{ position: 'absolute', bottom: 10, left: 4, width: 12, height: 12, borderRadius: 6, backgroundColor: C.green, opacity: 0.8 }} />
        <Text style={{ fontSize: 52 }}>{glyph}</Text>
      </View>
      <Text accessibilityRole="header" style={[S.h2, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[S.muted, { textAlign: 'center', marginTop: 6, fontSize: FS.md - 1 }]}>{body}</Text> : null}
      {action ? <View style={{ marginTop: SP.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}
/** Plain one-line empty message (kept for small inline lists). */
export const Empty = ({ text }: { text: string }) => <View style={{ padding: 28, alignItems: 'center' }}><Text style={[S.muted, { textAlign: 'center' }]}>{text}</Text></View>;
export const Spinner = () => <View accessibilityRole="progressbar" style={{ padding: SP.xl }}><ActivityIndicator color={C.primary} size="large" /></View>;

/** Permission recovery card: says what is blocked, and offers either "Allow" or "Open settings" (when the OS will not ask again). */
export function PermissionCard({ title, body, actionLabel, onAction }: { title: string; body: string; actionLabel: string; onAction: () => void }) {
  return (
    <Card style={{ borderColor: C.gold, backgroundColor: C.goldBg }}>
      <View style={[S.row, { gap: SP.md, alignItems: 'flex-start' }]}><IconBadge glyph="📍" bg={C.warnBg} size={40} /><View style={{ flex: 1 }}><Text accessibilityRole="header" style={S.bold}>{title}</Text><Text style={[S.muted, { marginTop: 2 }]}>{body}</Text></View></View>
      <View style={{ marginTop: SP.md }}><Btn kind="ghost" title={actionLabel} onPress={onAction} /></View>
    </Card>
  );
}

/** Bottom-sheet look for the live trip: rounded top, overlaps the map above it. */
export const Sheet = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ backgroundColor: C.card, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, marginTop: -R.lg, padding: SP.lg, paddingTop: SP.sm, ...SHADOW.sheet }, style]}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: SP.md }} />
    {children}
  </View>
);

export const Money = ({ n, style }: { n: number | null | undefined; style?: StyleProp<TextStyle> }) => <Text style={style}>{n == null ? '-' : Math.round(n).toLocaleString('en-US')} RWF</Text>;

/** Transient message above the bottom inset (gesture bar / nav buttons never cover it). */
export function Toast({ text, lift = 0 }: { text: string | null; lift?: number }) {
  const insets = useSafeAreaInsets();
  if (!text) return null;
  return <View pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ position: 'absolute', left: SP.lg + insets.left, right: SP.lg + insets.right, bottom: insets.bottom + SP.xl + lift, alignItems: 'center' }}><View style={{ backgroundColor: C.toast, borderRadius: R.md - 2, padding: SP.md, maxWidth: MAX_W, ...SHADOW.raised }}><Text style={{ color: '#fff' }}>{text}</Text></View></View>;
}

/** Remote image whose signed URL changes on every poll: keeps one URL for ~4 minutes so it does not reload (flicker) every few seconds. */
export function RemoteImage({ url, style, label, size }: { url: string; style?: StyleProp<ViewStyle>; label?: string; size?: { width: number; height: number; radius?: number } }) {
  const cur = useRef<{ key: string; url: string; at: number } | null>(null); const [failed, setFailed] = React.useState(false); const { lowData } = useAppearance();
  const key = url.split('?')[0]; const now = Date.now();
  if (!cur.current || cur.current.key !== key || now - cur.current.at > 240000) cur.current = { key, url, at: now };
  const dim = { width: size?.width ?? 72, height: size?.height ?? 72, borderRadius: size?.radius ?? 36, backgroundColor: C.line };
  if (failed || lowData) return <View accessibilityLabel={label} style={[dim, { alignItems: 'center', justifyContent: 'center' }, style]}><Text accessible={false}>👤</Text></View>;
  return <Image source={{ uri: cur.current.url }} onError={() => setFailed(true)} accessibilityLabel={label} style={[dim, style as object]} />;
}
