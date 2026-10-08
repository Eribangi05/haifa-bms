import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Switch, View } from 'react-native';
import { useApp, useAsync } from '../lib/app';
import { label } from '../lib/i18n';
import { getPushPermission } from '../lib/push';
import { openAppSettings } from '../lib/hooks';
import type { Contact, SavedPlace } from '../lib/types';
import { Banner, Btn, Card, Field, IconBadge, LangPicker, Pill, Screen, SectionTitle, Text, useFormFocus } from '../ui/components';
import { showAlert } from '../ui/dialog';
import { C, R, S, SP } from '../ui/theme';

const RW_PHONE = /^(?:\+?250|0)?7[2389]\d{7}$/;
const initials = (s: string) => (s.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '👤').toUpperCase();

export function Profile() {
  const { t, lang, setLang, me, refreshMe, client, nav, signOut, setMode, say } = useApp(); const { busy, run } = useAsync();
  const [name, setName] = useState(me?.display_name ?? ''); const [prefs, setPrefs] = useState<Record<string, boolean>>(me?.notif_prefs ?? {});
  const [contacts, setContacts] = useState<Contact[]>([]); const [cn, setCn] = useState(''); const [cp, setCp] = useState('');
  const [ref, setRef] = useState<{ code: string; rewarded: number; total: number } | null>(null); const [biz, setBiz] = useState<{ id: string; legal_name: string; role: string; status: string }[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]); const [push, setPush] = useState<string>('granted');
  const f = useFormFocus(1); const fc = useFormFocus(2);
  const loadContacts = useCallback(() => { client.get('/users/me/emergency-contacts').then((r) => setContacts(r.contacts)).catch(() => {}); }, [client]);
  const loadPlaces = useCallback(() => { client.get('/users/me/places').then((r) => setPlaces(r.places)).catch(() => {}); }, [client]);
  useEffect(() => {
    loadContacts(); loadPlaces();
    client.get('/users/me/referral').then(setRef).catch(() => {}); client.get('/businesses/mine').then((r) => setBiz(r.businesses)).catch(() => {});
    const chk = () => { void getPushPermission().then(setPush); }; chk();
    const s = AppState.addEventListener('change', (st) => { if (st === 'active') chk(); }); return () => s.remove();
  }, [client, loadContacts, loadPlaces]);
  const save = () => run(async () => { await client.patch('/users/me', { display_name: name.trim() || undefined, notif_prefs: prefs }); await refreshMe(); say(t('prof.saved')); });
  const priv = (kind: 'deletion' | 'access') => run(async () => { await client.post('/users/me/privacy-requests', { kind }); showAlert(t('prof.privacy'), kind === 'access' ? t('prof.export.done') : t('prof.delete.confirm')); });
  const becomeDriver = () => run(async () => { await client.post('/drivers/enroll'); await client.refresh(); await refreshMe(); setMode('driver'); });
  const phoneOk = RW_PHONE.test(cp.replace(/[\s-]/g, ''));
  const addContact = () => { if (!cn.trim() || !phoneOk) return; void run(async () => { await client.post('/users/me/emergency-contacts', { name: cn.trim(), phone: cp }); setCn(''); setCp(''); loadContacts(); }); };
  return (
    <Screen title={t('prof.title')} onBack={() => nav.pop()}>
      <Card>
        <View style={[S.row, { gap: SP.md, marginBottom: SP.md }]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{initials(name || me?.display_name || '')}</Text></View>
          <View style={{ flex: 1 }}><Text style={S.bold} numberOfLines={1}>{name || me?.display_name || me?.phone}</Text><Text style={S.muted}>{me?.phone}</Text></View>
        </View>
        <Field {...f(0, save)} label={t('prof.name')} value={name} onChangeText={setName} maxLength={60} autoComplete="name" textContentType="name" />
        <Text style={S.muted}>{t('prof.language')}</Text><View style={{ marginVertical: 6 }}><LangPicker lang={lang} onPick={setLang} /></View>
        <Text style={[S.h2, { marginTop: SP.sm }]}>{t('prof.notifs')}</Text>
        {(['sms', 'marketing'] as const).map((k) => <View key={k} style={[S.between, { minHeight: 48 }]}><Text style={[S.body, { flex: 1 }]}>{k === 'sms' ? t('prof.sms') : t('prof.promos')}</Text><Switch accessibilityLabel={k === 'sms' ? t('prof.sms') : t('prof.promos')} value={!!prefs[k]} onValueChange={(v) => setPrefs({ ...prefs, [k]: v })} trackColor={{ true: C.primary }} /></View>)}
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

      <SectionTitle text={t('prof.contacts')} />
      <Card>
        {contacts.map((c) => <View key={c.id} style={[S.between, { minHeight: 48 }]}><Text style={[S.body, { flex: 1 }]}>{c.name} · {c.phone}</Text><Pressable onPress={() => run(async () => { await client.del(`/users/me/emergency-contacts/${c.id}`); loadContacts(); })} accessibilityRole="button" accessibilityLabel={`${t('a11y.remove')}: ${c.name}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.danger }}>✕</Text></Pressable></View>)}
        {!contacts.length ? <Banner text={t('prof.contacts.hint')} /> : null}
        <Field {...fc(0)} label={t('prof.contact.name')} value={cn} onChangeText={setCn} maxLength={60} />
        <Field {...fc(1, addContact)} label={t('prof.contact.phone')} value={cp} onChangeText={setCp} keyboardType="phone-pad" maxLength={16} error={cp.length > 4 && !phoneOk ? t('auth.invalid') : undefined} />
        <Btn kind="ghost" title={t('prof.contacts.add')} disabled={!cn.trim() || !phoneOk} onPress={addContact} />
      </Card>

      <Card><Text style={S.h2}>{t('ab.cars.title')}</Text><Text style={S.muted}>{t('ab.home.sub')}</Text><View style={{ height: 8 }} /><Btn kind="ghost" title={t('ab.cars.title')} onPress={() => nav.push('cars')} /></Card>
      {ref ? <Card><Text style={S.h2}>{t('prof.referral')}</Text><Text style={S.muted}>{t('prof.referral.code')}</Text><Text selectable style={{ fontSize: 28, fontWeight: '800', letterSpacing: 3, color: C.primary }}>{ref.code}</Text><Text style={S.muted}>{ref.rewarded}/{ref.total}</Text></Card> : null}
      {biz.length ? <Card><Text style={S.h2}>{t('prof.business')}</Text>{biz.map((b) => <View key={b.id} style={{ marginTop: 6 }}><Text style={S.body}>{b.legal_name} · {label(lang, 'role', b.role)}</Text>{b.status !== 'active' ? <Pill tone="warn" text={t('biz.pending')} /> : <Pill text={t('biz.active')} />}</View>)}</Card> : null}
      {!me?.roles.includes('driver') ? <Card><Text style={S.h2}>{t('prof.driver')}</Text><Text style={S.muted}>{t('drv.become.sub')}</Text><View style={{ height: 8 }} /><Btn kind="gold" title={t('drv.enroll')} onPress={becomeDriver} loading={busy} /></Card> : <Btn kind="ghost" title={t('drv.mode')} onPress={() => setMode('driver')} />}
      <View style={{ height: 10 }} />
      <Card><Text style={S.h2}>{t('prof.privacy')}</Text><Btn kind="ghost" title={t('prof.export')} onPress={() => priv('access')} /><View style={{ height: 8 }} /><Btn kind="ghost" title={t('prof.delete')} onPress={() => showAlert(t('prof.delete'), t('prof.delete.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: () => priv('deletion') }])} /></Card>
      <Btn kind="ghost" title={t('common.signout')} onPress={() => showAlert(t('common.signout'), t('prof.signout.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.signout'), style: 'destructive', onPress: () => void signOut() }])} />
    </Screen>
  );
}
