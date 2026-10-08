import React, { useState } from 'react';
import { View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { explainCameraDenied } from '../../lib/hooks';
import { appendFile, pickPhoto } from '../../lib/upload';
import type { Booking } from '../../lib/types';
import { Banner, Btn, Chip, Field, ProgressBar, Text } from '../../ui/components';
import { S } from '../../ui/theme';

/**
 * Check-in / check-out of the CUSTOMER's car: photos, odometer, fuel, notes. Each photo uploads on its own and the count comes from the server,
 * so after a failure or an app restart the driver sees what is already saved and only adds what is missing.
 */
export function HandoverForm({ trip, phase, reload }: { trip: Booking; phase: 'pickup' | 'dropoff'; reload: () => void }) {
  const { t, client, cfg } = useApp(); const { busy, run } = useAsync();
  const need = cfg?.abasare?.min_photos ?? 2; const have = trip.abasare?.photos_pending?.[phase] ?? 0;
  const [odo, setOdo] = useState(''); const [fuel, setFuel] = useState(50); const [notes, setNotes] = useState(''); const [damage, setDamage] = useState(false); const [photoFailed, setPhotoFailed] = useState(false);
  const add = (src: 'camera' | 'gallery') => run(async () => {
    setPhotoFailed(false);
    const r = await pickPhoto(src);
    if ('denied' in r) { explainCameraDenied(t, r.blocked); return; }
    if (!('file' in r)) return;
    try {
      const fd = new FormData(); await appendFile(fd, 'file', r.file);
      await client.post(`/bookings/${trip.id}/handover/photos?phase=${phase}`, undefined, { form: fd, timeoutMs: 40000 }); reload();
    } catch (e) { setPhotoFailed(true); throw e; }
  });
  const save = () => run(async () => { await client.post(`/bookings/${trip.id}/handover`, { phase, odometer_km: Number(odo), fuel_percent: fuel, notes: notes.trim() || undefined, damage_noted: damage }); reload(); });
  return (
    <View style={{ gap: 8 }}>
      <Text style={S.h2}>{phase === 'pickup' ? t('ab.job.checkin') : t('ab.job.checkout')}</Text>
      <ProgressBar value={Math.min(1, have / need)} label={`${t('ab.job.photos')}: ${have} / ${need} ${t('ab.job.photos.min')}`} />
      {photoFailed ? <Banner kind="bad" text={t('ab.job.photo.failed')} /> : null}
      <View style={[S.row, { gap: 8 }]}><View style={{ flex: 1 }}><Btn title={t('ab.job.take')} onPress={() => add('camera')} loading={busy} /></View><View style={{ flex: 1 }}><Btn kind="ghost" title={t('ab.job.pick')} onPress={() => add('gallery')} disabled={busy} /></View></View>
      <Field label={t('ab.job.odo')} value={odo} onChangeText={(x) => setOdo(x.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={7} />
      <Text style={S.muted}>{t('ab.job.fuel')}</Text><View style={S.wrap}>{[0, 25, 50, 75, 100].map((x) => <Chip key={x} text={`${x}%`} on={fuel === x} onPress={() => setFuel(x)} />)}</View>
      <Field label={t('ab.job.notes')} value={notes} onChangeText={setNotes} multiline maxLength={480} />
      <Chip text={(damage ? '☑ ' : '☐ ') + t('ab.job.damage')} on={damage} onPress={() => setDamage(!damage)} />
      <Btn big title={t('ab.job.submit')} onPress={save} loading={busy} disabled={have < need || odo === ''} />
    </View>
  );
}
