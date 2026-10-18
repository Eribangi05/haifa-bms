import React, { useState } from 'react';
import { useApp, useAsync } from '../../lib/app';
import { Banner, Btn, Card, Field, Pill, Text } from '../../ui/components';
import { S } from '../../ui/theme';

/** Optional email address with proof of ownership: save the address, ask for a code, type it in. The server decides what is verified. */
export function EmailCard() {
  const { t, client, me, refreshMe, say, errMsg } = useApp(); const { busy, run } = useAsync();
  const meEx = me as (typeof me & { email_verified?: boolean }) | null;
  const [email, setEmail] = useState(me?.email ?? ''); const [code, setCode] = useState(''); const [sent, setSent] = useState(false);
  const verified = !!meEx?.email_verified && email.trim().toLowerCase() === (me?.email ?? '').toLowerCase();
  const saved = !!me?.email && email.trim().toLowerCase() === me.email.toLowerCase();
  const save = () => run(async () => { await client.patch('/users/me', { email: email.trim() }); await refreshMe(); setSent(false); say(t('prof.saved')); });
  const send = () => run(async () => { try { await client.post('/users/me/email/code', {}); setSent(true); say(t('up.email.sent')); } catch (e) { say(errMsg(e)); } });
  const verify = () => run(async () => { try { await client.post('/users/me/email/verify', { code }); await refreshMe(); setSent(false); setCode(''); say(t('up.email.ok')); } catch (e) { say(errMsg(e)); } });
  return (
    <Card>
      <Text style={S.h2}>{t('up.email.title')}</Text>
      <Text style={S.muted}>{t('up.email.hint')}</Text>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" />
      {saved ? <Pill text={verified ? t('up.email.verified') : t('up.email.unverified')} tone={verified ? 'ok' : 'warn'} /> : null}
      {!saved ? <Btn title={t('up.email.save')} onPress={save} loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} /> : null}
      {saved && !verified && !sent ? <Btn title={t('up.email.send')} onPress={send} loading={busy} /> : null}
      {saved && !verified && sent ? <>
        <Banner kind="ok" text={t('up.email.sent')} />
        <Field label={t('up.email.code')} value={code} onChangeText={(x) => setCode(x.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
        <Btn title={t('up.email.verify')} onPress={verify} loading={busy} disabled={code.length !== 6} />
      </> : null}
    </Card>
  );
}
