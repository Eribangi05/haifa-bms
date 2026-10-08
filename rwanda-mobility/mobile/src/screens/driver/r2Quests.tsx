import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useApp, usePoll } from '../../lib/app';
import { kv } from '../../lib/storage';
import { fmtDate } from '../../lib/format';
import { clampPct, newlyCompleted, questSeenKey, ringQuarters, sortQuests, timeLeft, type Quest } from '../../lib/r2';
import { pick } from '../../lib/i18n';
import { Banner, Btn, Card, EmptyState, Money, Pill, ProgressBar, Screen, SkeletonCard, Text, useReduceMotion } from '../../ui/components';
import { C, FS, S, SP } from '../../ui/theme';

type Award = { quest_id: string; period_key: string; amount: number; progress: number; created_at: string; title?: string };
const SEEN_KEY = 'r2_quests_seen';
const qTitle = (lang: 'rw' | 'fr' | 'en', q: Quest) => pick(lang, q, 'title') || q.title || '';

/** Progress ring built from four border quarters (no SVG dependency) with the percentage inside; the bar below gives the exact value. */
export function Ring({ pct, done, size = 64 }: { pct: number; done?: boolean; size?: number }) {
  const q = ringQuarters(pct); const col = done ? C.green : C.primary; const on = (i: number) => (q > i ? col : C.line);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 6, borderTopColor: on(0), borderRightColor: on(1), borderBottomColor: on(2), borderLeftColor: on(3), alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '0deg' }] }}>
      <Text style={{ fontWeight: '800', color: C.ink, fontSize: FS.sm }}>{done ? '✓' : `${clampPct(pct)}%`}</Text>
    </View>
  );
}

/** Small celebration: emoji pops and fades; with reduce-motion only the static message remains. */
export function Celebrate({ text }: { text: string }) {
  const reduce = useReduceMotion(); const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => { if (reduce) { v.setValue(1); return; } Animated.sequence([Animated.timing(v, { toValue: 1, duration: 450, easing: Easing.out(Easing.back(2)), useNativeDriver: true }), Animated.delay(900), Animated.timing(v, { toValue: 0.85, duration: 400, useNativeDriver: true })]).start(); }, [v, reduce]);
  return (
    <Animated.View testID="r2-celebrate" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }], backgroundColor: C.goldBg, borderColor: C.gold, borderWidth: 2, borderRadius: 14, padding: SP.md, marginBottom: SP.md, flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
      <Text accessible={false} style={{ fontSize: 34 }}>🎉</Text><Text style={[S.bold, { flex: 1 }]}>{text}</Text>
    </Animated.View>
  );
}

/** Loads quests and tells which just completed (once per quest and period, remembered in kv). */
export function useQuests(ms = 30000) {
  const { client } = useApp();
  const q = usePoll(() => client.get<{ quests: Quest[] }>('/drivers/me/quests'), ms);
  const [fresh, setFresh] = useState<Quest[]>([]); const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const list = q.data?.quests; if (!list) return;
    (async () => {
      if (!seen.current) { let a: string[] = []; try { a = JSON.parse((await kv.get(SEEN_KEY)) ?? '[]'); } catch { /* ignore */ } seen.current = new Set(a); }
      const nc = newlyCompleted(list, seen.current); if (!nc.length) return;
      nc.forEach((x) => seen.current!.add(questSeenKey(x))); setFresh(nc);
      try { await kv.set(SEEN_KEY, JSON.stringify([...seen.current].slice(-100))); } catch { /* ignore */ }
    })();
  }, [q.data]);
  return { ...q, quests: q.data?.quests ?? null, fresh };
}

function Left({ q }: { q: Quest }) {
  const { t } = useApp(); const l = timeLeft(q.period.ends_at);
  return <Text style={S.muted}>{l ? (l.days > 0 ? t('r2.q.left.days', { d: l.days, h: l.hours }) : t('r2.q.left.hours', { h: l.hours })) : t('r2.q.ended')}</Text>;
}

export function QuestRow({ q }: { q: Quest }) {
  const { t, lang } = useApp();
  return (
    <Card style={q.completed ? { borderColor: C.green } : undefined}>
      <View style={[S.row, { gap: SP.md }]}>
        <Ring pct={q.percent} done={q.completed} />
        <View style={{ flex: 1 }}>
          <Text style={S.bold} numberOfLines={3}>{qTitle(lang, q)}</Text>
          <Text style={S.muted}>{t(q.window === 'daily' ? 'r2.q.daily' : 'r2.q.weekly')} · {t('r2.q.reward', { n: Math.round(q.reward).toLocaleString('en-US') })}</Text>
          <Left q={q} />
        </View>
      </View>
      <View style={{ marginTop: SP.sm }}><ProgressBar value={q.percent / 100} a11y={`${qTitle(lang, q)}: ${t('r2.q.pct', { n: clampPct(q.percent) })}`} label={t('r2.q.progress', { p: Math.round(q.progress).toLocaleString('en-US'), t: Math.round(q.target).toLocaleString('en-US') })} /></View>
      <View style={[S.row, { gap: SP.sm, marginTop: SP.sm, flexWrap: 'wrap' }]}>
        {q.completed ? <Pill glyph="✓" text={t('r2.q.done')} /> : null}
        {q.budget_exhausted && !q.completed ? <Pill tone="warn" text={t('r2.q.nobudget')} /> : null}
        {q.placeholder ? <Pill tone="warn" text={t('r2.q.test')} /> : null}
      </View>
    </Card>
  );
}

/** Compact card for the driver Working screen: the closest-to-done quest and a link to the full screen. */
export function QuestsCard({ onOpen }: { onOpen: () => void }) {
  const { t, lang } = useApp(); const qs = useQuests(60000); const top = qs.quests ? sortQuests(qs.quests.filter((x) => !x.placeholder))[0] : null;
  return (
    <Card>
      {qs.fresh.length ? <Celebrate text={t('r2.q.celebrate', { n: qs.fresh.reduce((a, x) => a + x.reward, 0).toLocaleString('en-US') })} /> : null}
      <View style={S.between}><Text accessibilityRole="header" style={S.h2}>{t('r2.q.card')}</Text><Btn testID="r2-quests-open" kind="ghost" title={t('r2.q.all')} onPress={onOpen} /></View>
      {top ? <View style={{ marginTop: SP.sm }}><Text style={S.body} numberOfLines={2}>{qTitle(lang, top)}</Text><ProgressBar value={top.percent / 100} a11y={t('r2.q.pct', { n: clampPct(top.percent) })} label={`${t('r2.q.progress', { p: Math.round(top.progress), t: Math.round(top.target) })} · ${t('r2.q.reward', { n: top.reward })}`} /></View>
        : qs.quests ? <Text style={S.muted}>{t('r2.q.empty')}</Text> : null}
    </Card>
  );
}

export function Quests() {
  const { t, nav, client, errMsg, online } = useApp();
  const qs = useQuests(15000); const hist = usePoll(() => client.get<{ awards: Award[] }>('/drivers/me/quests/history'), 60000);
  const list = qs.quests ? sortQuests(qs.quests) : null;
  return (
    <Screen title={t('r2.q.title')} onBack={() => nav.pop()} onRefresh={async () => { qs.reload(); hist.reload(); await new Promise((r) => setTimeout(r, 500)); }}>
      {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
      {qs.fresh.length ? <Celebrate text={t('r2.q.celebrate', { n: qs.fresh.reduce((a, x) => a + x.reward, 0).toLocaleString('en-US') })} /> : null}
      {qs.error && !list ? <Banner kind="bad" text={errMsg(qs.error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={qs.reload} />} /> : null}
      {!list && !qs.error ? <><SkeletonCard /><SkeletonCard /></> : null}
      <Text accessibilityRole="header" style={[S.h2, { marginBottom: SP.sm }]}>{t('r2.q.active')}</Text>
      {list && !list.length ? <EmptyState glyph="🎯" title={t('r2.q.empty.title')} body={t('r2.q.empty')} /> : null}
      {list?.map((q) => <QuestRow key={q.id + q.period.key} q={q} />)}
      <Text accessibilityRole="header" style={[S.h2, { marginVertical: SP.sm }]}>{t('r2.q.history')}</Text>
      {hist.data && !hist.data.awards.length ? <Text style={S.muted}>{t('r2.q.hist.empty')}</Text> : null}
      {hist.data?.awards.map((a) => (
        <Card key={a.quest_id + a.period_key}><View style={S.between}><View style={{ flex: 1, paddingRight: SP.sm }}><Text style={S.bold} numberOfLines={2}>{a.title}</Text><Text style={S.muted}>{fmtDate(a.created_at)}</Text></View><Money n={a.amount} style={{ fontWeight: '800', color: C.green }} /></View></Card>))}
    </Screen>
  );
}
