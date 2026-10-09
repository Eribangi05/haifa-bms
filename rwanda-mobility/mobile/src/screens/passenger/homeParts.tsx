import React, { useEffect, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useApp } from '../../lib/app';
import { kv } from '../../lib/storage';
import { label } from '../../lib/i18n';
import { fmtTime } from '../../lib/format';
import { statusGlyph, statusTone } from '../../lib/trip';
import type { Booking, Place, Pt, SavedPlace, Svc } from '../../lib/types';
import { Btn, Card, Chip, FadeIn, Glyph, IconBadge, Money, Pill, SectionTitle, Text } from '../../ui/components';
import { C, R, S, SHADOW, SP } from '../../ui/theme';

/** Ride / Abasare service cards (radio group) plus the QR scan shortcut. Two columns on normal phones, stacked below 340 px. */
export function ServiceCards({ svc, setSvc, abasareOn, onScan }: { svc: Svc; setSvc: (s: Svc) => void; abasareOn: boolean; onScan: () => void }) {
  const { t } = useApp(); const narrow = useWindowDimensions().width < 340;
  const card = (id: Svc, glyph: string, title: string, sub: string, accent: string) => (
    <Pressable key={id} onPress={() => setSvc(id)} accessibilityRole="radio" accessibilityState={{ selected: svc === id }} accessibilityLabel={`${title}. ${sub}`}
      style={[{ flex: narrow ? undefined : 1, minHeight: 88, borderRadius: R.md, padding: SP.md, backgroundColor: svc === id ? C.card : C.card, borderWidth: svc === id ? 2 : 1, borderColor: svc === id ? accent : C.line }, svc === id ? SHADOW.raised : SHADOW.card]}>
      <IconBadge glyph={glyph} bg={id === 'ride' ? C.skyBg : C.warnBg} size={36} />
      <Text style={[S.bold, { marginTop: SP.sm }]}>{title}</Text><Text style={S.muted} numberOfLines={2}>{sub}</Text>
    </Pressable>
  );
  return (
    <View style={{ marginBottom: SP.md }}>
      {abasareOn ? <View style={{ flexDirection: narrow ? 'column' : 'row', gap: SP.sm }}>{card('ride', '🛵', t('ab.tab.ride'), t('home.svc.ride'), C.primary)}{card('abasare', '🧑‍✈️', t('ab.tab.abasare'), t('ab.tagline'), C.gold)}</View> : null}
      <Pressable onPress={onScan} accessibilityRole="button" accessibilityLabel={`${t('scan.title')}`} style={[S.row, { marginTop: SP.sm, minHeight: 48, gap: SP.sm, paddingHorizontal: SP.md, borderRadius: R.md, backgroundColor: C.skyBg }]}>
        <Glyph g="▦" size={30} /><Text style={{ color: C.primaryDark, fontWeight: '700', flex: 1 }}>{t('scan.title')}</Text><Text accessible={false} style={{ color: C.primaryDark }}>›</Text>
      </Pressable>
    </View>
  );
}

/** Large rounded shortcuts for Home / Work / other saved places. */
export function SavedShortcuts({ saved, onPick }: { saved: SavedPlace[]; onPick: (p: Place) => void }) {
  const { t } = useApp();
  if (!saved.length) return null;
  const g = (l: string) => (l === 'home' ? '🏠' : l === 'work' ? '💼' : l === 'school' ? '🎓' : '📍');
  return (
    <View style={{ marginBottom: SP.sm }}>
      <SectionTitle text={t('home.saved')} />
      <View style={S.wrap}>{saved.map((p) => <Chip key={p.id} glyph={g(p.label)} text={`${t(('prof.places.' + p.label) as 'prof.places.home')} · ${p.name}`} onPress={() => onPick(p)} />)}</View>
    </View>
  );
}

/** Last trips with a one-tap "same destination again". Rows are plain data from the API; failures simply hide the block. */
export function RecentTrips({ trips, onAgain }: { trips: Booking[]; onAgain: (p: Pt) => void }) {
  const { t, lang } = useApp();
  if (!trips.length) return null;
  return (
    <View style={{ marginBottom: SP.sm }}>
      <SectionTitle text={t('home.recenttrips')} />
      {trips.map((b) => (
        <Pressable key={b.id} onPress={() => onAgain({ lat: b.destination.lat, lng: b.destination.lng, name: b.destination.name })} accessibilityRole="button" accessibilityLabel={`${t('trip.rebook')}: ${b.destination.name ?? ''}`} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
          <Card style={{ marginBottom: SP.sm }}>
            <View style={[S.row, { gap: SP.md }]}>
              <IconBadge glyph={statusGlyph(b.status)} bg={statusTone(b.status) === 'bad' ? C.dangerBg : C.okBg} size={38} />
              <View style={{ flex: 1 }}><Text style={S.bold} numberOfLines={1}>{b.destination.name ?? '…'}</Text><Text style={S.muted} numberOfLines={1}>{fmtTime(b.requested_at)} · {label(lang, 'bs', b.status)}</Text></View>
              <Money n={b.final_fare ?? b.estimated_fare} style={{ fontWeight: '700', color: C.ink }} />
            </View>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

/** Promotion / invite slot. Shows the invite-friends banner while the user has a referral code; tapping opens the profile where the code lives. */
export function PromoBanner({ code, onOpen }: { code?: string; onOpen: () => void }) {
  const { t } = useApp();
  if (!code) return null;
  return (
    <FadeIn>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t('promo.title')}. ${t('promo.body')}`} style={{ marginBottom: SP.md, borderRadius: R.md, overflow: 'hidden', backgroundColor: C.green }}>
        <View style={[S.row, { padding: SP.md, gap: SP.md }]}>
          <IconBadge glyph="🎁" bg={C.gold} size={44} />
          <View style={{ flex: 1 }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{t('promo.title')}</Text><Text style={{ color: '#E3F4EC', fontSize: 13 }}>{t('promo.body')}</Text></View>
          <Text accessible={false} style={{ color: '#fff', fontSize: 22 }}>›</Text>
        </View>
      </Pressable>
    </FadeIn>
  );
}

/** First-time 3-step explainer for Abasare; dismissed once, remembered in local storage. */
export function HowItWorks() {
  const { t } = useApp(); const [show, setShow] = useState(false);
  useEffect(() => { kv.get('rm_ab_how').then((v) => setShow(v !== '1')).catch(() => setShow(true)); }, []);
  if (!show) return null;
  const steps = [{ g: '🚗', k: '1' }, { g: '🧑‍✈️', k: '2' }, { g: '💵', k: '3' }] as const;
  return (
    <FadeIn><Card style={{ backgroundColor: C.goldBg, borderColor: C.gold }}>
      <Text accessibilityRole="header" style={S.h2}>{t('ab.how.title')}</Text>
      {steps.map((st, i) => { const title = t(`ab.how.${st.k}`), desc = t(`ab.how.${st.k}d`); return (
        <View key={st.k} accessible accessibilityLabel={t('ab.how.step', { n: i + 1, title, desc })} style={[S.row, { marginTop: 10, alignItems: 'flex-start' }]}>
          <IconBadge glyph={st.g} bg={C.warnBg} /><View style={{ flex: 1, marginLeft: 12 }}><Text style={[S.body, { fontWeight: '700' }]}>{i + 1}. {title}</Text><Text style={S.muted}>{desc}</Text></View>
        </View>); })}
      <View style={{ height: 12 }} /><Btn kind="ghost" title={t('ab.how.gotit')} onPress={() => { setShow(false); void kv.set('rm_ab_how', '1').catch(() => {}); }} />
    </Card></FadeIn>
  );
}

export const StatusChip = ({ status }: { status: string }) => { const { lang } = useApp(); return <Pill tone={statusTone(status)} glyph={statusGlyph(status)} text={label(lang, 'bs', status)} />; };
