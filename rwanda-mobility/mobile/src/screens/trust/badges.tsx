import React, { useState } from 'react';
import { View } from 'react-native';
import { useApp, useBackHandler } from '../../lib/app';
import { badgeKey, sortBadges, type Badge } from '../../lib/trustApi';
import type { TKey } from '../../lib/i18n';
import { AppModal } from '../../ui/AppModal';
import { Btn, Card, LinkBtn, Screen, Text } from '../../ui/components';
import { C, FS, R, S, SP } from '../../ui/theme';

const IDS = ['licence_verified', 'police_clearance_valid', 'experience', 'trips_completed', 'top_rated', 'training_completed'] as const;
const GLYPH: Record<string, string> = { licence_verified: '🪪', police_clearance_valid: '🛡️', experience: '🧭', trips_completed: '🚗', top_rated: '⭐', training_completed: '🎓' };
const TONE: Record<string, { bg: () => string; fg: () => string }> = {
  licence_verified: { bg: () => C.okBg, fg: () => C.primaryDark }, police_clearance_valid: { bg: () => C.okBg, fg: () => C.primaryDark },
  experience: { bg: () => C.skyBg, fg: () => C.primary }, trips_completed: { bg: () => C.skyBg, fg: () => C.primary }, training_completed: { bg: () => C.skyBg, fg: () => C.primary },
  top_rated: { bg: () => C.goldBg, fg: () => C.warn },
};

/** Computed trust badges as chips, with a legend sheet that explains every badge. */
export function R1Badges({ badges, compact }: { badges?: Badge[]; compact?: boolean }) {
  const { t, lang } = useApp(); const [open, setOpen] = useState(false);
  useBackHandler(() => { setOpen(false); return true; }, open);
  if (!badges?.length) return null;
  const nameOf = (b: Badge) => b.label?.[lang] || t(`r1.badge.name.${b.id}` as TKey);
  return (
    <View style={{ marginTop: SP.sm }} testID="badges">
      <View style={S.wrap}>
        {sortBadges(badges).map((b) => { const tone = TONE[b.id] ?? TONE.experience; return (
          <View key={badgeKey(b)} accessible accessibilityLabel={nameOf(b)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: tone.bg(), borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 5, marginRight: SP.xs + 2, marginBottom: SP.xs + 2, maxWidth: '100%' }}>
            <Text accessible={false} style={{ marginRight: 5, fontSize: FS.sm }}>{GLYPH[b.id] ?? '✓'}</Text>
            <Text style={{ color: tone.fg(), fontSize: 12, fontWeight: '700', flexShrink: 1 }}>{nameOf(b)}</Text>
          </View>); })}
      </View>
      {compact ? null : <LinkBtn style={{ alignSelf: 'flex-start' }} title={t('r1.badge.legend')} onPress={() => setOpen(true)} />}
      <AppModal visible={open} onClose={() => setOpen(false)}>
        <Screen title={t('r1.badge.title')} onBack={() => setOpen(false)} footer={<Btn testID="cta" title={t('common.close')} onPress={() => setOpen(false)} />}>
          <Text style={S.muted}>{t('r1.badge.intro')}</Text>
          <View style={{ height: SP.md }} />
          {IDS.map((id) => { const tone = TONE[id]; return (
            <Card key={id}>
              <View style={[S.row, { gap: SP.sm, marginBottom: SP.xs }]}>
                <View style={{ backgroundColor: tone.bg(), borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center' }}><Text accessible={false} style={{ marginRight: 5 }}>{GLYPH[id]}</Text><Text style={{ color: tone.fg(), fontWeight: '800', fontSize: 13 }}>{t(`r1.badge.name.${id}` as TKey)}</Text></View>
              </View>
              <Text style={S.body}>{t(`r1.badge.desc.${id}` as TKey)}</Text>
            </Card>); })}
          <Text style={S.muted}>{t('r1.badge.note')}</Text>
        </Screen>
      </AppModal>
    </View>
  );
}
