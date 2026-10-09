import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Switch, View } from 'react-native';
import { useApp, useAsync } from '../lib/app';
import { label } from '../lib/i18n';
import { getPushPermission } from '../lib/push';
import { openAppSettings } from '../lib/hooks';
import type { SavedPlace } from '../lib/types';
import { R1TrustedContacts } from './r1Contacts';
import { Banner, Btn, Card, Field, IconBadge, LangPicker, Pill, Screen, SectionTitle, Text, useFormFocus } from '../ui/components';
import { showAlert } from '../ui/dialog';
import { C, S, SP } from '../ui/theme';

const initials = (s: string) => (s.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '👤').toUpperCase();

export function Profile() {
  const { t, lang, setLang, me, refreshMe, client, nav, say } = useApp(); const { busy, run } = useAsync();
  const [name, setName] = useState(me?.display_name ?? ''); const [prefs, setPrefs] = useState<Record<string, boolean>>(me?.notif_prefs ?? {});
  const [ref, setRef] = useState<{ code: string; rewarded: number; total: number } | null>(null); const [biz, setBiz] = useState<{ id: string; legal_name: string; role: string; status: string }[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]); const [push, setPush] = useState<string>('granted');
  const f = useFormFocus(1);
  const loadPlaces = useCallback(() => { client.get('/users/me/places').then((r) => setPlaces(r.places)).catch(() => {}); }, [client]);
  useEffect(() => {
    loadPlaces();
    client.get('/users/me/referral').then(setRef).catch(() => {}); client.get('/businesses/mine').then((r) => setBiz(r.businesses)).catch(() => {});
    const chk = () => { void getPushPermission().then(setPush); }; chk();
    const s = AppState.addEventListener('change', (st) => { if (st === 'active') chk(); }); return () => s.remove();
  }, [client, loadPlaces]);
  const save = () => run(async () => { await client.patch('/users/me', { display_name: name.trim() || undefined, notif_prefs: prefs }); await refreshMe(); say(t('prof.saved')); });
  const priv = (kind: 'deletion' | 'access') => run(async () => { await client.post('/users/me/privacy-requests', { kind }); showAlert(t('prof.privacy'), kind === 'access' ? t('prof.export.done') : t('prof.delete.confirm')); });
  return (
    <Screen title={t('prof.title')} onBack={() => nav.pop()}>
      <Card>
        <View style={[S.row, { gap: SP.md, marginBottom: SP.md }]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.onPrimary, fontSize: 20, fontWeight: '800' }}>{initials(name || me?.display_name || '')}</Text></View>
          <View style={{ flex: 1 }}><Text style={S.bold} numberOfLines={1}>{name || me?.display_name || me?.phone}</Text><Text style={S.muted}>{me?.phone}</Text></View>
        </View>
        <Field {...f(0, save)} label={t('prof.name')} value={name} onChangeText={setName} maxLength={60} autoComplete="name" textContentType="name" />
        <Text style={S.muted}>{t('prof.language')}</Text><View style={{ marginVertical: 6 }}><LangPicker lang={lang} onPick={setLang} /></View>
        <Text style={[S.h2, { marginTop: SP.sm }]}>{t('prof.notifs')}</Text>
        {(['sms'] as const).map((k) => <View key={k} style={[S.between, { minHeight: 48 }]}><Text style={[S.body, { flex: 1 }]}>{t('prof.sms')}</Text><Switch accessibilityLabel={t('prof.sms')} value={!!prefs[k]} onValueChange={(v) => setPrefs({ ...prefs, [k]: v })} trackColor={{ true: C.primary }} /></View>)}
        <View style={{ borderTopWidth: 1, borderTopColor: C.line, marginTop: SP.sm, paddingTop: SP.sm }}>
          <View style={[S.between, { minHeight: 48 }]}><Text style={[S.bold, { flex: 1, paddingRight: SP.sm }]}>{t('r2.mkt.title')}</Text><Switch testID="r2-marketing" accessibilityLabel={t('r2.mkt.title')} value={!!prefs.marketing} disabled={busy} onValueChange={(v) => { const next = { ...prefs, marketing: v }; setPrefs(next); void run(async () => { try { await client.patch('/users/me', { notif_prefs: next }); await refreshMe(); say(t('prof.saved')); } catch (e) { setPrefs(prefs); throw e; } }); }} trackColor={{ true: C.primary }} /></View>
          <Text style={S.muted}>{t('r2.mkt.body')}</Text>
        </View>
        {push === 'denied' ? <Banner text={t('push.off')} action={<Btn kind="ghost" title={t('perm.settings')} onPress={openAppSettings} />} /> : null}
        <Btn title={t('common.save')} onPress={save} loading={busy} />
      </Card>

      <SectionTitle text={t('prof.places')} />
      <Card>
        {places.length ? places.map((p) => (
          <View key={p.id} style={[S.between, { minHeight: 48 }]}>
            <View style={[S.row, { flex: 1, gap: SP.sm }]}><IconBadge glyph={p.label === 'home' ? '🏠' : p.label === 'work' ? '💼' : p.label === 'school' ? '🎓' : '📍'} size={34} /><View style={{ flex: 1 }}><Text style={S.bold}>{t(('prof.places.' + p.label) as 'prof.places.home')}</Text><Text style={S.muted} numberOfLines={1}>{p.name}</Text></View></View>
            <Pressable onPress={() => run(async () => { await client.del(`/users/me/places/${p.id}`); loadPlaces(); })} accessibilityRole="button" accessibilityLabel={`${t('a11y.remove')}: ${p.name}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.danger }}>✕</Text></Pressable>
          </View>
        )) : <Text style={S.muted}>{t('prof.places.empty')}</Text>}
      </Card>

      <R1TrustedContacts />

      {ref ? <Card><Text style={S.h2}>{t('prof.referral')}</Text><Text style={S.muted}>{t('prof.referral.code')}</Text><Text selectable style={{ fontSize: 28, fontWeight: '800', letterSpacing: 3, color: C.primary }}>{ref.code}</Text><Text style={S.muted}>{ref.rewarded}/{ref.total}</Text><View style={{ height: SP.sm }} /><Btn testID="prof-invite" kind="ghost" title={t('acc.invite')} onPress={() => nav.push('invite')} /></Card> : null}
      {biz.length ? <Card><Text style={S.h2}>{t('prof.business')}</Text>{biz.map((b) => <View key={b.id} style={{ marginTop: 6 }}><Text style={S.body}>{b.legal_name} · {label(lang, 'role', b.role)}</Text>{b.status !== 'active' ? <Pill tone="warn" text={t('biz.pending')} /> : <Pill text={t('biz.active')} />}</View>)}</Card> : null}
      <View style={{ height: 10 }} />
      <Card><Text style={S.h2}>{t('prof.privacy')}</Text><Btn kind="ghost" title={t('prof.export')} onPress={() => priv('access')} /><View style={{ height: 8 }} /><Btn kind="ghost" title={t('prof.delete')} onPress={() => showAlert(t('prof.delete'), t('prof.delete.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: () => priv('deletion') }])} /></Card>
    </Screen>
  );
}
