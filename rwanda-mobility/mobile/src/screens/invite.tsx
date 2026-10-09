import React, { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { APP_DOWNLOAD_URL } from '../config';
import { useApp } from '../lib/app';
import { callNumber, copyText, openMail, openSms, openWhatsApp, shareSheet } from '../lib/contact';
import { inviteText } from '../lib/shareLinks';
import { Banner, Btn, Card, Screen, SectionTitle, SkeletonCard, Text } from '../ui/components';
import { Hero, Illustration, StatRow, StatTile } from '../ui/dash';
import { ICONS, type IconName } from '../ui/icons';
import { C, FS, R, S, SHADOW, SP } from '../ui/theme';

type Ref = { code: string; rewarded: number; total: number };

/** Invite friends: the code, one-tap sharing through WhatsApp, message, a phone call, e-mail, copy or any other app, how it works, and how many friends joined. */
export function Invite() {
  const { t, client, nav, say } = useApp(); const [ref, setRef] = useState<Ref | null>(null); const [failed, setFailed] = useState(false); const [hint, setHint] = useState(false);
  useEffect(() => { client.get<Ref>('/users/me/referral').then(setRef).catch(() => setFailed(true)); }, [client]);
  const code = ref?.code ?? '';
  const text = inviteText(t('inv.msg', { code }), APP_DOWNLOAD_URL ? t('inv.msg.link', { url: APP_DOWNLOAD_URL }) : null);
  const open = async (ok: Promise<boolean>, app: string) => { if (!(await ok)) say(t('inv.err.open', { app })); };
  const tiles: { key: string; icon: IconName; label: string; run: () => void }[] = [
    { key: 'whatsapp', icon: 'whatsapp', label: t('inv.whatsapp'), run: () => void open(openWhatsApp(text), 'WhatsApp') },
    { key: 'sms', icon: 'sms', label: t('inv.sms'), run: () => void open(openSms(text), t('inv.sms')) },
    { key: 'call', icon: 'phone', label: t('inv.call'), run: () => { setHint(true); void open(callNumber(), t('inv.call')); } },
    { key: 'email', icon: 'mail', label: t('inv.email'), run: () => void open(openMail(t('inv.subject'), text), t('inv.email')) },
    { key: 'copy', icon: 'copy', label: t('inv.copy'), run: () => void copyText(code).then((ok) => say(ok ? t('inv.copied') : t('inv.copy.failed'))) },
    { key: 'more', icon: 'share', label: t('inv.more'), run: () => void shareSheet(text, t('inv.subject')) },
  ];
  return (
    <Screen title={t('inv.title')} onBack={() => nav.pop()}>
      <Illustration glyphs="🎁👥" tint={C.goldBg} height={130} />
      <Text accessibilityRole="header" style={S.h1}>{t('inv.hero')}</Text>
      <Text style={[S.muted, { marginBottom: SP.md }]}>{t('inv.hero.sub')}</Text>

      {failed && !ref ? <Banner kind="bad" text={t('inv.nocode')} /> : null}
      {!ref && !failed ? <SkeletonCard /> : null}
      {ref ? <>
        <Hero testID="inv-code-card">
          <Text style={{ color: C.onPrimary, opacity: 0.9 }}>{t('inv.code')}</Text>
          <Pressable testID="inv-code" onPress={() => tiles[4].run()} accessibilityRole="button" accessibilityLabel={`${t('inv.code')}: ${code}. ${t('inv.copy')}`}>
            <Text selectable style={{ color: C.onPrimary, fontSize: 40, fontWeight: '800', letterSpacing: 6, marginVertical: SP.xs }}>{code}</Text>
          </Pressable>
          <Btn testID="inv-copy-btn" kind="gold" title={t('inv.copy')} onPress={tiles[4].run} />
        </Hero>

        <SectionTitle text={t('inv.share')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.sm }}>
          {tiles.map((x) => (
            <Pressable key={x.key} testID={`inv-${x.key}`} onPress={x.run} accessibilityRole="button" accessibilityLabel={x.label}
              style={({ pressed }) => ({ width: '31.8%', minHeight: 96, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', padding: SP.sm, opacity: pressed ? 0.75 : 1, ...SHADOW.card })}>
              <ShareIcon name={x.icon} />
              <Text numberOfLines={2} style={{ marginTop: SP.xs, textAlign: 'center', fontSize: FS.sm, fontWeight: '700', color: C.ink }}>{x.label}</Text>
            </Pressable>))}
        </View>
        {hint ? <Banner kind="ok" text={t('inv.call.hint')} /> : null}

        <SectionTitle text={t('inv.stats')} />
        <StatRow>
          <StatTile testID="inv-total" glyph="👥" value={String(ref.total)} label={t('inv.stat.joined')} />
          <StatTile testID="inv-rewarded" glyph="🎁" value={String(ref.rewarded)} label={t('inv.stat.rewarded')} tint={C.goldBg} />
        </StatRow>

        <SectionTitle text={t('inv.how')} />
        <Card>
          {([['mail', 'inv.how.1'], ['user', 'inv.how.2'], ['invite', 'inv.how.3']] as const).map(([ic, k], i, a) => (
            <View key={k} style={[S.row, { gap: SP.md, minHeight: 56, borderBottomWidth: i === a.length - 1 ? 0 : 1, borderBottomColor: C.line }]}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontWeight: '800', color: C.onGold }}>{i + 1}</Text></View>
              <Text style={[S.body, { flex: 1 }]}>{t(k)}</Text><ShareIcon name={ic} size={34} />
            </View>))}
        </Card>
      </> : null}
    </Screen>
  );
}

function ShareIcon({ name, size = 48 }: { name: IconName; size?: number }) {
  return <Image accessibilityElementsHidden source={ICONS[name]} resizeMode="contain" style={{ width: size, height: size }} />;
}
