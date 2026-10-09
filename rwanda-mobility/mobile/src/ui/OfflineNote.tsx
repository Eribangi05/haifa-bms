import React from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../lib/app';
import { ageOf } from '../lib/cache';
import { C, FS, R, SP } from './theme';

/** Shown on top of a list while it is the saved copy (no fresh answer yet): says how old it is, so nobody mistakes it for live data. */
export function OfflineNote({ at }: { at: number | null | undefined }) {
  const { t } = useApp();
  if (!at) return null;
  const a = ageOf(at);
  const when = t(a.unit === 'min' ? 'cache.ago.min' : a.unit === 'h' ? 'cache.ago.h' : 'cache.ago.d', { n: a.n });
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: C.warnBg, borderRadius: R.md, paddingVertical: SP.sm, paddingHorizontal: SP.md, marginBottom: SP.sm }}>
      <Text style={{ color: C.warn, fontSize: FS.sm }}>{t('cache.note', { when })}</Text>
    </View>
  );
}
