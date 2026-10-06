import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useApp, useAsync } from '../lib/app';
import { Banner, Btn, Chip, Field, Screen } from '../ui/components';
import { C, S } from '../ui/theme';
import { APP_NAME } from '../config';
import { ApiError } from '../lib/net';
import { tokenStore } from '../lib/storage';

export function Welcome() {
  const { t, lang, setLang, nav } = useApp();
  return (
    <Screen footer={<Btn title={t('common.continue')} onPress={() => nav.replace('phone')} big />}>
      <View style={{ alignItems: 'center', marginTop: 40, marginBottom: 28 }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.gold }} />
        </View>
        <Text style={[S.h1, { textAlign: 'center' }]}>{APP_NAME}</Text>
        <Text style={[S.muted, { textAlign: 'center', marginTop: 6, fontSize: 15 }]}>{t('app.tagline')}</Text>
      </View>
      <Text style={[S.h2, { marginBottom: 10 }]}>{t('auth.language')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip text="Kinyarwanda" on={lang === 'rw'} onPress={() => setLang('rw')} />
        <Chip text="English" on={lang === 'en'} onPress={() => setLang('en')} />
      </View>
    </Screen>
  );
}

export function Phone() {
  const { t, client, nav, lang, say } = useApp();
  const [phone, setPhone] = useState(''); const [ref, setRef] = useState(''); const { busy, run } = useAsync();
  const valid = /^(?:\+?250|0)?7[2389]\d{7}$/.test(phone.replace(/[\s-]/g, ''));
  const send = () => run(async () => {
    try {
      const r = await client.post('/auth/otp/request', { phone, language: lang }, { auth: false });
      nav.push('otp', { phone, referral: ref.trim() || undefined, dev: r.dev_code, resend: r.resend_in ?? 60 });
    } catch (e) { if (e instanceof ApiError && e.code === 'otp_cooldown') nav.push('otp', { phone, referral: ref.trim() || undefined, resend: 60 }); else throw e; }
  });
  return (
    <Screen footer={<Btn title={t('auth.sendcode')} onPress={send} disabled={!valid} loading={busy} big />}>
      <Text style={[S.h1, { marginTop: 24, marginBottom: 16 }]}>{t('auth.phone')}</Text>
      <View style={[S.row, { gap: 8 }]}>
        <View style={[S.input, { justifyContent: 'center' }]}><Text style={{ fontSize: 16 }}>+250</Text></View>
        <View style={{ flex: 1 }}><Field value={phone} onChangeText={setPhone} placeholder={t('auth.phone.hint')} keyboardType="phone-pad" autoComplete="tel" maxLength={16} accessibilityLabel={t('auth.phone')} /></View>
      </View>
      {phone.length > 4 && !valid ? <Text style={{ color: C.danger, marginBottom: 8 }}>{t('auth.invalid')}</Text> : null}
      <Field label={t('auth.referral')} value={ref} onChangeText={setRef} autoCapitalize="characters" maxLength={12} />
      <Text style={S.muted}>{t('auth.terms')}</Text>
    </Screen>
  );
}

export function Otp({ params }: { params: { phone: string; referral?: string; dev?: string; resend: number } }) {
  const { t, client, signedIn, nav, lang } = useApp();
  const [code, setCode] = useState(''); const [left, setLeft] = useState(params.resend); const { busy, run } = useAsync();
  const [err, setErr] = useState('');
  useEffect(() => { const i = setInterval(() => setLeft((x) => (x > 0 ? x - 1 : 0)), 1000); return () => clearInterval(i); }, []);
  const verify = () => run(async () => {
    setErr('');
    try {
      const r = await client.post('/auth/otp/verify', { phone: params.phone, code, language: lang, referral_code: params.referral }, { auth: false });
      await tokenStore.set({ access_token: r.access_token, refresh_token: r.refresh_token });
      await signedIn(r.roles);
    } catch (e: any) { setErr(e.message); }
  }, { silent: true });
  const resend = () => run(async () => { try { const r = await client.post('/auth/otp/request', { phone: params.phone, language: lang }, { auth: false }); setLeft(r.resend_in ?? 60); } catch (e: any) { setErr(e.message); } });
  return (
    <Screen footer={<Btn title={t('auth.verify')} onPress={verify} disabled={code.length !== 6} loading={busy} big />}>
      <Text style={[S.h1, { marginTop: 24 }]}>{t('auth.code')}</Text>
      <Text style={[S.muted, { marginVertical: 8 }]}>{t('auth.code.sent')} {params.phone}</Text>
      {params.dev ? <Banner text={`${t('auth.dev')}: ${params.dev}`} /> : null}
      <Field value={code} onChangeText={(x) => setCode(x.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" placeholder="••••••" maxLength={6} style={{ letterSpacing: 8, fontSize: 24, textAlign: 'center' }} />
      {err ? <Text style={{ color: C.danger, marginBottom: 8 }}>{err}</Text> : null}
      <Btn kind="ghost" title={left > 0 ? `${t('auth.resend.in')} ${left}s` : t('auth.resend')} onPress={resend} disabled={left > 0} />
      <View style={{ height: 8 }} /><Btn kind="ghost" title={t('common.back')} onPress={() => nav.pop()} />
    </Screen>
  );
}
