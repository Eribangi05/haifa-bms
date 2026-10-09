import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useApp } from '../../lib/app';
import { appearance, LOCK_CHOICES, VOLUMES, useAppearance } from '../../lib/appearance';
import { NumberStepper } from '../../ui/Pickers';
import { bioAuthenticate, bioSupport, type BioSupport } from '../../lib/biometric';
import { Banner, Btn, Card, Screen, SectionTitle, Text } from '../../ui/components';
import { testOfferSound } from '../../lib/sound';
import { Choice, SwitchRow } from '../../ui/trustParts';
import { S } from '../../ui/theme';
import { OfflineMapCard } from '../../ui/OfflineMap';

/** Profile > Settings: appearance (theme, large text), data (low-data mode) and privacy (app lock). Everything is stored on this phone only. */
export function R1Settings() {
  const { t, nav, say } = useApp(); const ap = useAppearance();
  const [bio, setBio] = useState<BioSupport>('unavailable');
  useEffect(() => { void bioSupport().then(setBio); }, []);
  const web = Platform.OS === 'web';
  const toggleLock = async (on: boolean) => {
    if (!on) { await appearance.set({ lockEnabled: false }); return; }
    if (bio !== 'ready') return;
    if (await bioAuthenticate(t('r1.lock.prompt'), t('common.cancel'))) await appearance.set({ lockEnabled: true }); else say(t('r1.set.lock.fail'));   // enabling needs one successful unlock, so it can never lock out a user who cannot authenticate
  };
  return (
    <Screen title={t('r1.set.title')} onBack={() => nav.pop()}>
      <SectionTitle text={t('r1.set.appearance')} />
      <Card>
        <Text style={S.bold}>{t('r1.set.theme')}</Text>
        <Choice value={ap.theme} onPick={(v) => void appearance.set({ theme: v })} options={[{ v: 'system', text: t('r1.set.theme.system') }, { v: 'light', text: t('r1.set.theme.light') }, { v: 'dark', text: t('r1.set.theme.dark') }]} />
        <Text style={S.muted}>{t('r1.set.theme.hint')}</Text>
        <Text style={[S.bold, { marginTop: 8 }]}>{t('pk.set.size')}</Text>
        <Choice value={ap.textScale} onPick={(v) => void appearance.set({ textScale: v })} options={[{ v: 0.9, text: t('pk.size.small') }, { v: 1, text: t('pk.size.normal') }, { v: 1.25, text: t('pk.size.large') }, { v: 1.5, text: t('pk.size.xlarge') }]} />
        <Text style={S.muted}>{t('r1.set.large.hint')}</Text>
      </Card>
      <SectionTitle text={t('pk.set.display')} />
      <Card>
        <Text style={S.bold}>{t('pk.set.time')}</Text>
        <Choice value={ap.timeFormat} onPick={(v) => void appearance.set({ timeFormat: v })} options={[{ v: '24h', text: t('pk.time.24') }, { v: '12h', text: t('pk.time.12') }]} />
        <Text style={[S.bold, { marginTop: 8 }]}>{t('pk.set.week')}</Text>
        <Choice value={ap.weekStart} onPick={(v) => void appearance.set({ weekStart: v })} options={[{ v: 1, text: t('pk.week.mon') }, { v: 0, text: t('pk.week.sun') }]} />
      </Card>
      <SectionTitle text={t('r1.set.data')} />
      <Card><SwitchRow testID="set-lowdata" label={t('r1.set.lowdata')} hint={t('r1.set.lowdata.hint')} value={ap.lowData} onChange={(v) => void appearance.set({ lowData: v })} /></Card>
      <SectionTitle text={t('snd.title')} />
      <Card>
        <SwitchRow testID="set-offersound" label={t('snd.offer')} hint={t('snd.offer.hint')} value={ap.offerSound} onChange={(v) => void appearance.set({ offerSound: v })} />
        <SwitchRow testID="set-voicenav" label={t('snd.voice')} value={ap.voiceNav} onChange={(v) => void appearance.set({ voiceNav: v })} />
        <SwitchRow testID="set-chatsound" label={t('snd.chat')} hint={t('snd.chat.hint')} value={ap.chatSound} onChange={(v) => void appearance.set({ chatSound: v })} />
        <Text style={[S.bold, { marginTop: 8 }]}>{t('pk.set.volume')}</Text>
        <Choice value={ap.soundVolume} onPick={(v) => void appearance.set({ soundVolume: v })} options={VOLUMES.map((v) => ({ v, text: `${Math.round(v * 100)}%` }))} />
        <SwitchRow testID="set-vibrate" label={t('pk.set.vibrate')} hint={t('pk.set.vibrate.hint')} value={ap.vibrate} onChange={(v) => void appearance.set({ vibrate: v })} />
        <Btn testID="snd-test" kind="ghost" title={t('snd.test')} onPress={() => void testOfferSound()} />
        <Text style={S.muted}>{t('snd.test.hint')}</Text>
      </Card>
      <OfflineMapCard />
      <SectionTitle text={t('r1.set.privacy')} />
      <Card>
        {web ? <Banner text={t('r1.set.lock.web')} /> : bio === 'none_enrolled' || bio === 'unavailable' ? <Banner text={t('r1.set.lock.none')} /> : null}
        <SwitchRow testID="set-lock" label={t('r1.set.lock')} hint={t('r1.set.lock.hint')} value={ap.lockEnabled && !web} disabled={web || (bio !== 'ready' && !ap.lockEnabled)} onChange={(v) => void toggleLock(v)} />
        {ap.lockEnabled && !web ? <>
          <Text style={[S.bold, { marginTop: 8 }]}>{t('r1.set.lock.after')}</Text>
          <Choice value={ap.lockMinutes} onPick={(v) => void appearance.set({ lockMinutes: v })} options={LOCK_CHOICES.map((n) => ({ v: n, text: n === 0 ? t('r1.set.lock.0') : t('r1.set.lock.n', { n }) }))} />
          <NumberStepper testID="set-lock-minutes" label={t('pk.lock.custom')} value={ap.lockMinutes} onChange={(v) => void appearance.set({ lockMinutes: v })} min={0} max={120} unit={t('pk.min')} />
          <Text style={S.muted}>{t('r1.set.lock.escape')}</Text>
        </> : null}
      </Card>
    </Screen>
  );
}
