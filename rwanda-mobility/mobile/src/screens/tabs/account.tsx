import React from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { useApp, useAsync } from '../../lib/app';
import { Btn, Card, LangPicker, Pill, Screen, Text } from '../../ui/components';
import { MenuGroup, MenuRow } from '../../ui/dash';
import { showAlert } from '../../ui/dialog';
import { C, FS, S, SP } from '../../ui/theme';
import { UssdCard } from '../r3/ussd';
import { leaveDriverMode } from '../driver/leave';

const initials = (s: string) => (s.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '👤').toUpperCase();

/** Turn the signed-in rider into a driver applicant and open driver mode (shared by the Account and Home tabs). */
export function useBecomeDriver() {
  const { client, refreshMe, setMode } = useApp(); const { busy, run } = useAsync();
  const go = () => run(async () => { await client.post('/drivers/enroll'); await client.refresh(); await refreshMe(); setMode('driver'); });
  return { busy, go };
}

/** "Account" tab for both modes: who you are, language, and every setting grouped by purpose. Driver mode shows the driver-relevant subset. */
export function AccountTab() {
  const { t, lang, setLang, me, nav, mode, setMode, signOut, client, say } = useApp(); const become = useBecomeDriver();
  const isDriver = !!me?.roles.includes('driver'); const driverMode = mode === 'driver';
  const name = (me?.display_name ?? '').trim();
  const ver = String((Constants.expoConfig as { version?: string } | null)?.version ?? '');
  const toRider = () => { void leaveDriverMode({ client, setMode, say, t }); };
  return (
    <Screen title={t('acc.title')}>
      <Card>
        <View style={[S.row, { gap: SP.md }]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.gold }}><Text style={{ color: C.onPrimary, fontSize: 22, fontWeight: '800' }}>{initials(name)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text testID="acc-name" style={{ fontSize: FS.lg + 2, fontWeight: '800', color: C.ink }} numberOfLines={1}>{name || me?.phone}</Text>
            {name ? <Text style={S.muted}>{me?.phone}</Text> : null}
            <View style={{ marginTop: 4 }}><Pill text={driverMode ? t('acc.driver') : t('acc.rider')} /></View>
          </View>
        </View>
        <View style={{ height: SP.md }} /><Btn testID="acc-edit" kind="ghost" title={t('acc.edit')} onPress={() => nav.push('profile')} />
      </Card>

      <Card>
        <Text accessibilityRole="header" style={S.h2}>{t('acc.language')}</Text><Text style={[S.muted, { marginBottom: SP.sm }]}>{t('acc.language.sub')}</Text>
        <LangPicker lang={lang} onPick={setLang} />
      </Card>

      {isDriver
        ? <Btn testID="acc-mode" kind={driverMode ? 'ghost' : 'gold'} title={driverMode ? t('acc.mode.rider') : t('acc.mode.driver')} onPress={driverMode ? toRider : () => setMode('driver')} />
        : !driverMode ? <Btn testID="acc-become" kind="gold" title={t('drv.enroll')} onPress={become.go} loading={become.busy} /> : null}
      <View style={{ height: SP.md }} />

      {!driverMode ? <MenuGroup title={t('acc.g.rides')}>
        <MenuRow testID="open-mydrivers" glyph="⭐" title={t('r1.md.title')} sub={t('r1.md.open')} onPress={() => nav.push('r1drivers')} />
        <MenuRow testID="open-schedules" glyph="⏰" title={t('r2.sch.title')} onPress={() => nav.push('schedules')} />
        <MenuRow testID="open-cars" glyph="🚗" title={t('ab.cars.title')} sub={t('ab.home.sub')} onPress={() => nav.push('cars')} last />
      </MenuGroup> : null}

      <MenuGroup title={t('acc.g.money')}>
        {!driverMode ? <MenuRow testID="open-credit" glyph="💳" title={t('cr.title')} sub={t('wal.credit.sub')} onPress={() => nav.push('credit')} /> : null}
        <MenuRow testID="open-claims" glyph="🛟" title={t('cl.title')} sub={t('cl.entry.sub')} onPress={() => nav.push('claims')} last />
      </MenuGroup>

      <MenuGroup title={t('acc.g.app')}>
        <MenuRow testID="open-settings" glyph="⚙️" title={t('r1.set.title')} sub={t('r1.set.open')} onPress={() => nav.push('r1settings')} />
        <MenuRow testID="open-invite" glyph="🎁" title={t('acc.invite')} sub={t('acc.invite.sub')} onPress={() => nav.push('profile')} last />
      </MenuGroup>

      <MenuGroup title={t('acc.g.help')}>
        <MenuRow testID="open-help" glyph="💬" title={t('acc.help')} sub={t('acc.help.sub')} onPress={() => nav.push('support')} last />
      </MenuGroup>
      <UssdCard />

      <Btn testID="acc-signout" kind="ghost" title={t('common.signout')} onPress={() => showAlert(t('common.signout'), t('prof.signout.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.signout'), style: 'destructive', onPress: () => void signOut() }])} />
      <Text style={[S.muted, { textAlign: 'center', marginTop: SP.md }]}>{t('acc.version', { v: ver || '-' })}</Text>
    </Screen>
  );
}
