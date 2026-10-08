import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp, useAsync } from '../lib/app';
import type { Lang } from '../lib/i18n';
import type { TrustedContact } from '../lib/r1';
import { Banner, Btn, Card, Field, SectionTitle, Skeleton, Text, useFormFocus } from '../ui/components';
import { showAlert } from '../ui/dialog';
import { Choice, SwitchRow } from '../ui/r1Parts';
import { C, S, SP } from '../ui/theme';

const RW_PHONE = /^(?:\+?250|0)?7[2389]\d{7}$/;
const LANG_KEYS = { rw: 'r1.tc.lang.rw', fr: 'r1.tc.lang.fr', en: 'r1.tc.lang.en' } as const;

/** Profile: trusted contacts with per-contact "notify when my trip starts" and SMS language, the auto-share master switch, and a plain explanation of what is sent. */
export function R1TrustedContacts() {
  const { t, lang, client, say, errMsg } = useApp(); const { run } = useAsync();
  const [list, setList] = useState<TrustedContact[] | null>(null); const [auto, setAuto] = useState<boolean | null>(null); const [fail, setFail] = useState(false);
  const [cn, setCn] = useState(''); const [cp, setCp] = useState(''); const [cl, setCl] = useState<Lang>(lang); const [cnotify, setCnotify] = useState(true);
  const fc = useFormFocus(2);
  const load = useCallback(() => {
    setFail(false);
    client.get<{ contacts: TrustedContact[] }>('/users/me/emergency-contacts').then((r) => setList(r.contacts)).catch(() => setFail(true));
    client.get<{ auto_share: boolean }>('/users/me/safety-prefs').then((r) => setAuto(r.auto_share)).catch(() => {});
  }, [client]);
  useEffect(load, [load]);
  const patch = (c: TrustedContact, p: Partial<Pick<TrustedContact, 'notify_on_trip' | 'lang'>>) => {
    setList((l) => (l ?? []).map((x) => (x.id === c.id ? { ...x, ...p } : x)));   // optimistic; reverted on failure
    void run(async () => { try { await client.patch(`/users/me/emergency-contacts/${c.id}`, p); } catch (e) { setList((l) => (l ?? []).map((x) => (x.id === c.id ? c : x))); throw e; } });
  };
  const flipAuto = (v: boolean) => { const old = auto; setAuto(v); void run(async () => { try { await client.patch('/users/me/safety-prefs', { auto_share: v }); } catch (e) { setAuto(old); throw e; } }); };
  const phoneOk = RW_PHONE.test(cp.replace(/[\s-]/g, ''));
  const add = () => { if (!cn.trim() || !phoneOk) return; void run(async () => { await client.post('/users/me/emergency-contacts', { name: cn.trim(), phone: cp, notify_on_trip: cnotify, lang: cl }); setCn(''); setCp(''); load(); say(t('r1.tc.saved')); }); };
  const remove = (c: TrustedContact) => showAlert(t('r1.tc.remove.confirm'), `${c.name} · ${c.phone}`, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), style: 'destructive', onPress: () => void run(async () => { await client.del(`/users/me/emergency-contacts/${c.id}`); load(); }) }]);
  const langOpts = (['rw', 'fr', 'en'] as Lang[]).map((v) => ({ v, text: t(LANG_KEYS[v]) }));
  return (
    <View testID="trusted-contacts">
      <SectionTitle text={t('r1.tc.title')} />
      <Card>
        <Text style={S.bold}>{t('r1.tc.what.title')}</Text>
        <Text style={[S.muted, { marginTop: 2 }]}>{t('r1.tc.what')}</Text>
        {auto != null ? <SwitchRow testID="tc-auto" label={t('r1.tc.auto')} hint={t('r1.tc.auto.hint')} value={auto} onChange={flipAuto} /> : null}
      </Card>
      {fail ? <Banner kind="bad" text={errMsg(new Error('x'))} action={<Btn kind="ghost" title={t('common.retry')} onPress={load} />} /> : null}
      {!list && !fail ? <Card><Skeleton height={18} width="50%" /><Skeleton height={14} width="70%" style={{ marginTop: 10 }} /></Card> : null}
      {list && !list.length ? <Banner text={t('r1.tc.empty')} /> : null}
      {(list ?? []).map((c) => (
        <Card key={c.id} style={{ marginBottom: SP.sm }}>
          <View style={S.between}>
            <View style={{ flex: 1 }}><Text style={S.bold}>{c.name}</Text><Text style={S.muted}>{c.phone}</Text></View>
            <Pressable onPress={() => remove(c)} accessibilityRole="button" accessibilityLabel={`${t('a11y.remove')}: ${c.name}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.danger }}>✕</Text></Pressable>
          </View>
          <SwitchRow testID={`tc-notify-${c.id}`} label={t('r1.tc.notify')} value={c.notify_on_trip} onChange={(v) => patch(c, { notify_on_trip: v })} />
          {c.notify_on_trip ? <><Text style={S.muted}>{t('r1.tc.lang')}</Text><Choice value={c.lang} options={langOpts} onPick={(v) => patch(c, { lang: v })} /></> : <Text style={S.muted}>{t('r1.tc.off.note')}</Text>}
        </Card>))}
      <Card>
        <Text style={S.bold}>{t('r1.tc.add')}</Text>
        <Field {...fc(0)} label={t('prof.contact.name')} value={cn} onChangeText={setCn} maxLength={60} />
        <Field {...fc(1, add)} label={t('prof.contact.phone')} value={cp} onChangeText={setCp} keyboardType="phone-pad" maxLength={16} error={cp.length > 4 && !phoneOk ? t('auth.invalid') : undefined} />
        <Text style={S.muted}>{t('r1.tc.lang')}</Text><Choice value={cl} options={langOpts} onPick={setCl} />
        <SwitchRow label={t('r1.tc.new.notify')} value={cnotify} onChange={setCnotify} />
        <Btn testID="tc-add" kind="ghost" title={t('r1.tc.add.btn')} disabled={!cn.trim() || !phoneOk} onPress={add} />
      </Card>
    </View>
  );
}
