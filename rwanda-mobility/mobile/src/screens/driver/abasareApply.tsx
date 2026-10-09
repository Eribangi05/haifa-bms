import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { isIsoDate } from '../../lib/format';
import type { DriverStatus } from '../../lib/types';
import { Btn, Card, Chip, Field, Screen, Text, useFormFocus } from '../../ui/components';
import { Illustration } from '../../ui/dash';
import { C, S, SP } from '../../ui/theme';

const ALL_CLASSES = ['car', 'suv', 'minivan', 'pickup', 'moto'] as const;

/** An approved owner-driver adds Abasare to the same account: skills and licence details, then review. */
export function AbasareApply() {
  const { t, client, nav, say } = useApp(); const { busy, run } = useAsync(); const f = useFormFocus(5);
  const [legal, setLegal] = useState(''); const [nid, setNid] = useState(''); const [payout, setPayout] = useState('');
  const [since, setSince] = useState(''); const [years, setYears] = useState(''); const [trans, setTrans] = useState<string[]>(['manual']); const [classes, setClasses] = useState<string[]>(['car']); const [ret, setRet] = useState('moto');
  useEffect(() => { client.get<DriverStatus>('/drivers/me/status').then((s) => { setLegal(s.profile.legal_name ?? ''); setPayout(s.profile.payout_msisdn ?? ''); }).catch(() => {}); }, [client]);
  const tog = (set: React.Dispatch<React.SetStateAction<string[]>>) => (x: string) => set((a) => (a.includes(x) ? a.filter((y) => y !== x) : [...a, x]));
  const nidOk = /^\d{8,20}$/.test(nid.replace(/\s/g, '')); const dateOk = isIsoDate(since, { notFuture: true });
  const ready = legal.trim().length >= 3 && nidOk && dateOk && trans.length > 0 && classes.length > 0;
  const send = () => run(async () => {
    await client.post('/abasare/apply', { legal_name: legal.trim(), national_id: nid.replace(/\s/g, ''), payout_msisdn: payout || undefined, licence_since: since, years_experience: Number(years) || 0, transmissions: trans, classes, return_mode: ret });
    say(t('ap.sent')); nav.pop();
  });
  return (
    <Screen title={t('ap.title')} onBack={() => nav.pop()} footer={<Btn testID="cta" big title={t('ab.apply.save')} onPress={send} loading={busy} disabled={!ready} />}>
      <Illustration glyphs="🧑‍✈️🚗" tint={C.warnBg} height={120} />
      <Text style={[S.muted, { marginBottom: SP.md }]}>{t('ap.sub')}</Text>
      <Card>
        <Field {...f(0)} label={t('drv.legalname')} value={legal} onChangeText={setLegal} autoComplete="name" />
        <Field {...f(1)} label={t('drv.nid')} value={nid} onChangeText={(x) => setNid(x.replace(/[^\d\s]/g, ''))} keyboardType="number-pad" maxLength={24} error={nid.length > 0 && !nidOk ? t('drv.nid.bad') : undefined} />
        <Field {...f(2)} label={t('drv.payout')} value={payout} onChangeText={setPayout} keyboardType="phone-pad" maxLength={16} />
        <Field {...f(3)} label={t('ab.apply.licence')} value={since} onChangeText={setSince} placeholder="2018-03-15" maxLength={10} keyboardType="numbers-and-punctuation" error={since.length === 10 && !dateOk ? t('drv.date.bad') : undefined} />
        <Field {...f(4)} label={t('ab.apply.exp')} value={years} onChangeText={(x) => setYears(x.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
        <Text style={S.muted}>{t('ab.apply.trans')}</Text><View style={[S.wrap, { marginVertical: 6 }]}>{(['manual', 'automatic'] as const).map((x) => <Chip key={x} text={x === 'manual' ? t('ab.car.manual') : t('ab.car.auto')} on={trans.includes(x)} onPress={() => tog(setTrans)(x)} />)}</View>
        <Text style={S.muted}>{t('ab.apply.classes')}</Text><View style={[S.wrap, { marginVertical: 6 }]}>{ALL_CLASSES.map((x) => <Chip key={x} text={t(`ab.cls.${x}` as 'ab.cls.car')} on={classes.includes(x)} onPress={() => tog(setClasses)(x)} />)}</View>
        <Text style={S.muted}>{t('ab.apply.return')}</Text><View style={[S.wrap, { marginVertical: 6 }]}>{(['moto', 'taxi', 'own', 'walk'] as const).map((x) => <Chip key={x} text={t(`ab.apply.ret.${x}` as 'ab.apply.ret.moto')} on={ret === x} onPress={() => setRet(x)} />)}</View>
      </Card>
    </Screen>
  );
}
