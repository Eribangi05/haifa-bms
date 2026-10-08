// Small shared building blocks for the Round 1 screens.
import React from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Chip, Text } from './components';
import { C, R, S, SP } from './theme';

/** Labelled switch row with an optional explanation underneath. The whole row is 48+ px tall; the Switch carries the accessible label. */
export function SwitchRow({ label, hint, value, onChange, disabled, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID?: string }) {
  return (
    <View style={{ paddingVertical: SP.xs }}>
      <View style={[S.between, { minHeight: 48, gap: SP.md }]}>
        <Text style={[S.body, { flex: 1, fontWeight: '600' }]}>{label}</Text>
        <Switch testID={testID} accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: C.primary, false: C.line }} thumbColor={value ? C.onPrimary : C.card} />
      </View>
      {hint ? <Text style={S.muted}>{hint}</Text> : null}
    </View>
  );
}

/** A group of mutually exclusive chips. */
export function Choice<T extends string | number>({ options, value, onPick }: { options: { v: T; text: string }[]; value: T; onPick: (v: T) => void }) {
  return <View style={S.wrap} accessibilityRole="radiogroup">{options.map((o) => <Chip key={String(o.v)} text={o.text} on={o.v === value} onPress={() => onPick(o.v)} />)}</View>;
}

/** Multi-select chip (checkbox semantics) for rating tags. */
export function TagChip({ text, on, onPress, tone = 'positive' }: { text: string; on: boolean; onPress: () => void; tone?: 'positive' | 'negative' }) {
  const col = tone === 'negative' ? C.danger : C.primary; const bg = tone === 'negative' ? C.dangerBg : C.okBg;
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={text}
      style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: R.pill, borderWidth: on ? 2 : 1, borderColor: on ? col : C.line, backgroundColor: on ? bg : C.card, marginRight: SP.sm, marginBottom: SP.sm, maxWidth: '100%' }}>
      <Text accessible={false} style={{ color: col, marginRight: on ? 6 : 0, fontWeight: '800' }}>{on ? '✓' : ''}</Text>
      <Text style={{ color: on ? col : C.ink, fontWeight: on ? '700' : '500', flexShrink: 1 }}>{text}</Text>
    </Pressable>
  );
}
