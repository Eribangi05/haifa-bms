import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleProp, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, S } from './theme';

export function Screen({ children, scroll = true, footer }: { children: React.ReactNode; scroll?: boolean; footer?: React.ReactNode }) {
  return (
    <SafeAreaView style={S.screen} edges={['top', 'bottom']}>
      {scroll ? <ScrollView contentContainerStyle={S.pad} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={S.fill}>{children}</View>}
      {footer ? <View style={{ padding: 12, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line }}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Btn({ title, onPress, kind = 'primary', disabled, loading, style, big }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'gold'; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; big?: boolean;
}) {
  const bg = kind === 'primary' ? C.primary : kind === 'danger' ? C.danger : kind === 'gold' ? C.gold : 'transparent';
  const fg = kind === 'ghost' ? C.primary : kind === 'gold' ? C.ink : '#fff';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [{ backgroundColor: bg, borderRadius: 14, minHeight: big ? 60 : 50, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        borderWidth: kind === 'ghost' ? 1.5 : 0, borderColor: C.primary }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: big ? 19 : 16, fontWeight: '700' }}>{title}</Text>}
    </Pressable>
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

export const Card = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[S.card, style]}>{children}</View>;

export function Banner({ text, kind = 'warn' }: { text: string; kind?: 'warn' | 'bad' | 'ok' }) {
  const bg = kind === 'bad' ? C.dangerBg : kind === 'ok' ? C.okBg : C.warnBg; const fg = kind === 'bad' ? C.danger : kind === 'ok' ? C.primary : C.warn;
  return <View style={{ backgroundColor: bg, borderRadius: 12, padding: 12, marginBottom: 12 }}><Text style={{ color: fg, fontSize: 14 }}>{text}</Text></View>;
}

export const Pill = ({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'warn' | 'bad' }) => (
  <View style={{ alignSelf: 'flex-start', backgroundColor: tone === 'bad' ? C.dangerBg : tone === 'warn' ? C.warnBg : C.okBg, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}>
    <Text style={{ fontSize: 12, fontWeight: '600', color: tone === 'bad' ? C.danger : tone === 'warn' ? C.warn : C.primary }}>{text}</Text>
  </View>
);

export const Chip = ({ text, onPress, on }: { text: string; onPress: () => void; on?: boolean }) => (
  <Pressable onPress={onPress} accessibilityRole="button" style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, borderWidth: 1, borderColor: on ? C.primary : C.line, backgroundColor: on ? C.okBg : '#fff', marginRight: 8, marginBottom: 8 }}>
    <Text style={{ color: on ? C.primary : C.ink, fontWeight: on ? '700' : '500' }}>{text}</Text>
  </Pressable>
);

export const Header = ({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line }}>
    {onBack ? <Pressable onPress={onBack} accessibilityLabel="Back" style={{ padding: 8, marginRight: 4 }}><Text style={{ fontSize: 22, color: C.primary }}>{'‹'}</Text></Pressable> : null}
    <Text style={[S.h2, { flex: 1 }]} numberOfLines={1}>{title}</Text>{right}
  </View>
);

export const Money = ({ n, style }: { n: number | null | undefined; style?: object }) => <Text style={style}>{n == null ? '-' : Math.round(n).toLocaleString('en-US')} RWF</Text>;
export const Empty = ({ text }: { text: string }) => <View style={{ padding: 28, alignItems: 'center' }}><Text style={[S.muted, { textAlign: 'center' }]}>{text}</Text></View>;
export const Spinner = () => <View style={{ padding: 24 }}><ActivityIndicator color={C.primary} size="large" /></View>;
