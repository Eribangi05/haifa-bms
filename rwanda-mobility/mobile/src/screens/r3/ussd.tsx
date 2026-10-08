import React from 'react';
import { View } from 'react-native';
import { useApp } from '../../lib/app';
import { Card, IconBadge, Text } from '../../ui/components';
import { C, S, SP } from '../../ui/theme';

/** The shortcode, only if /config exposes one in the usual USSD form (`*123#`). Anything else is ignored so we never show a made-up number. */
export const ussdCode = (cfg: unknown): string | null => {
  const c = (cfg as { ussd?: { shortcode?: unknown } } | null)?.ussd?.shortcode;
  return typeof c === 'string' && /^\*\d{1,5}(\*\d+)*#$/.test(c.trim()) ? c.trim() : null;
};

/** Info card (Help and Profile): booking without data over USSD. */
export function UssdCard() {
  const { t, cfg } = useApp(); const code = ussdCode(cfg);
  return (
    <View testID="ussd-card"><Card>
      <View style={[S.row, { gap: SP.md, alignItems: 'flex-start' }]}>
        <IconBadge glyph="📞" bg={C.goldBg} size={40} />
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={S.h2}>{t('us.title')}</Text>
          <Text style={S.body}>{t('us.body')}</Text>
          {code ? <Text selectable style={{ fontSize: 28, fontWeight: '800', letterSpacing: 2, color: C.primary, marginVertical: SP.xs }}>{code}</Text> : null}
          <Text style={S.bold}>{code ? t('us.code', { code }) : t('us.code.generic')}</Text>
          <Text accessibilityRole="header" style={[S.bold, { marginTop: SP.md }]}>{t('us.tips')}</Text>
          {(['us.tip1', 'us.tip2', 'us.tip3', 'us.tip4'] as const).map((k) => <Text key={k} style={[S.muted, { marginTop: 2 }]}>• {t(k)}</Text>)}
          <Text style={[S.muted, { marginTop: SP.sm }]}>{t('us.help')}</Text>
        </View>
      </View>
    </Card></View>
  );
}
