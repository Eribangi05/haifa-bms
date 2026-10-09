import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useApp } from '../../lib/app';
import { fmtRwf } from '../../lib/format';
import { kv } from '../../lib/storage';
import { Btn, Card, Chip, Field, ProgressBar, Text, useReduceMotion } from '../../ui/components';
import { C, FS, R, S, SP } from '../../ui/theme';

/** Online / offline status as a clear strip: a pulsing green dot while waiting for trips. */
export function StatusStrip({ online }: { online: boolean }) {
  const { t } = useApp(); const reduce = useReduceMotion(); const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!online || reduce) { pulse.setValue(1); return; }
    const a = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }), Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true })]));
    a.start(); return () => a.stop();
  }, [online, reduce, pulse]);
  return (
    <View testID="status-strip" accessible accessibilityRole="summary" accessibilityLabel={`${t(online ? 'gw.online.title' : 'gw.offline.title')}. ${t(online ? 'gw.online.sub' : 'gw.offline.sub')}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.md, borderRadius: R.md, backgroundColor: online ? C.okBg : C.line }}>
      <Animated.View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: online ? C.green : C.muted, opacity: pulse }} />
      <View style={{ flex: 1 }}><Text style={{ fontSize: FS.lg, fontWeight: '800', color: online ? C.green : C.ink }}>{t(online ? 'gw.online.title' : 'gw.offline.title')}</Text><Text style={S.muted}>{t(online ? 'gw.online.sub' : 'gw.offline.sub')}</Text></View>
    </View>
  );
}

const GOAL_PRESETS = [5000, 10000, 20000, 30000];
const goalKey = (id?: string) => `rm_goal:${id ?? 'x'}`;

/** Daily earnings goal: a bar that fills as trips are completed. The goal is kept on the phone; the amount earned comes from today's trips. */
export function GoalCard({ earned }: { earned: number }) {
  const { t, me } = useApp(); const [goal, setGoal] = useState(0); const [editing, setEditing] = useState(false); const [custom, setCustom] = useState('');
  useEffect(() => { void kv.get(goalKey(me?.id)).then((v) => setGoal(Number(v) || 0)); }, [me?.id]);
  const save = async (n: number) => { setGoal(n); setEditing(false); setCustom(''); if (n > 0) await kv.set(goalKey(me?.id), String(n)); else await kv.del(goalKey(me?.id)); };
  const reached = goal > 0 && earned >= goal;
  if (!goal && !editing) return <Btn testID="goal-set" kind="ghost" title={`🎯 ${t('gw.goal.set')}`} onPress={() => setEditing(true)} />;
  return (
    <Card>
      <View style={S.between}><Text style={S.bold}>{t('gw.goal.title')}</Text>{goal && !editing ? <Btn kind="ghost" title={t('gw.goal.change')} onPress={() => setEditing(true)} /> : null}</View>
      {editing ? <>
        <Text style={S.muted}>{t('gw.goal.hint')}</Text>
        <View style={[S.wrap, { marginVertical: SP.sm }]}>{GOAL_PRESETS.map((n) => <Chip key={n} text={fmtRwf(n)} on={goal === n} onPress={() => void save(n)} />)}</View>
        <Field label={t('gw.goal.custom')} value={custom} onChangeText={(x) => setCustom(x.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" />
        <View style={[S.row, { gap: SP.sm }]}><View style={{ flex: 1 }}><Btn title={t('gw.goal.save')} onPress={() => void save(Number(custom))} disabled={!Number(custom)} /></View>{goal ? <Btn kind="ghost" title={t('gw.goal.clear')} onPress={() => void save(0)} /> : null}</View>
      </> : <>
        <ProgressBar value={goal ? earned / goal : 0} label={t('gw.goal.of', { done: fmtRwf(earned), goal: fmtRwf(goal) })} a11y={`${t('gw.goal.title')}: ${t('gw.goal.of', { done: fmtRwf(earned), goal: fmtRwf(goal) })}`} />
        <Text testID="goal-state" style={[S.body, { marginTop: 6, fontWeight: '700', color: reached ? C.green : C.ink }]}>{reached ? `🎉 ${t('gw.goal.reached')}` : t('gw.goal.left', { left: fmtRwf(Math.max(0, goal - earned)) })}</Text>
      </>}
    </Card>
  );
}

/** Shrinking bar for an offer: green, then gold, then red in the last seconds. */
export function CountdownBar({ left, total }: { left: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const color = left <= 5 ? C.danger : left <= 10 ? C.gold : C.green;
  return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: left }} style={{ height: 10, borderRadius: 5, backgroundColor: C.line, overflow: 'hidden', marginTop: 6 }}><View style={{ height: 10, width: `${Math.round(pct * 100)}%`, backgroundColor: color, borderRadius: 5 }} /></View>;
}
