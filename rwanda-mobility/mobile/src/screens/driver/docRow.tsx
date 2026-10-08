import React, { useState } from 'react';
import { View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useApp, useAsync } from '../../lib/app';
import { label } from '../../lib/i18n';
import { explainCameraDenied } from '../../lib/hooks';
import { isIsoDate } from '../../lib/format';
import { appendFile, pickPhoto, type Picked } from '../../lib/upload';
import type { DriverDoc, Requirement } from '../../lib/types';
import { Banner, Btn, Field, Pill, Text } from '../../ui/components';
import { C, S } from '../../ui/theme';

/** One required document: status chip, review note, and upload (camera / gallery / PDF). Each upload is independent, so a failure never loses the others. */
export function DocRow({ req, docs, reload, editable }: { req: Requirement; docs: DriverDoc[]; reload: () => void; editable?: boolean }) {
  const { t, lang, client, say } = useApp(); const { busy, run } = useAsync(); const [open, setOpen] = useState(false); const [expiry, setExpiry] = useState(''); const [failed, setFailed] = useState(false);
  const last = docs[0];
  const expiryOk = !req.requires_expiry || isIsoDate(expiry, { future: true });
  // Called from inside run() below (run ignores nested calls, so this is a plain async function).
  const upload = async (f: Picked) => {
    setFailed(false);
    try {
      const fd = new FormData(); fd.append('doc_type', req.doc_type); if (expiry) fd.append('expiry_date', expiry); await appendFile(fd, 'file', f);
      await client.post('/drivers/documents', undefined, { form: fd, timeoutMs: 40000 }); setOpen(false); say(t('drv.uploaded')); reload();
    } catch (e) { setFailed(true); throw e; }   // keep the form open: tapping the same button again retries
  };
  const fromCamera = () => run(async () => {
    const r = await pickPhoto('camera'); if ('denied' in r) { explainCameraDenied(t, r.blocked); return; } if ('file' in r) await upload(r.file);
  });
  const fromGallery = () => run(async () => { const r = await pickPhoto('gallery'); if ('file' in r) await upload(r.file); });
  const fromPdf = () => run(async () => { const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'] }); if (!r.canceled) await upload({ uri: r.assets[0].uri, name: r.assets[0].name, type: r.assets[0].mimeType ?? 'application/pdf' }); });
  const tone = !last ? 'warn' : last.review_status === 'approved' ? 'ok' : last.review_status === 'pending' ? 'warn' : 'bad';
  return (
    <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={[S.between, { alignItems: 'flex-start', gap: 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[S.body, { fontWeight: '600' }]}>{label(lang, 'doc', req.doc_type)}{req.mandatory ? ' *' : ''}</Text>
          <Pill tone={tone} text={last ? label(lang, 'ds', last.review_status) + (last.expiry_date ? ` · ${String(last.expiry_date).slice(0, 10)}` : '') : t('drv.doc.missing')} />
          {last?.review_note ? <Text style={{ color: C.danger, marginTop: 4 }}>{last.review_note}</Text> : null}
        </View>
        {editable ? <Btn kind="ghost" title={last ? t('drv.replace') : t('drv.upload')} onPress={() => setOpen(!open)} /> : null}
      </View>
      {open ? <View style={{ marginTop: 8, gap: 8 }}>
        {failed ? <Banner kind="bad" text={t('drv.upload.failed')} /> : null}
        {req.requires_expiry ? <Field label={t('drv.expiry')} value={expiry} onChangeText={setExpiry} placeholder="2028-12-31" maxLength={10} keyboardType="numbers-and-punctuation" error={expiry.length === 10 && !expiryOk ? t('drv.expiry.bad') : undefined} /> : null}
        <Btn title={t('drv.photo.take')} onPress={fromCamera} loading={busy} disabled={!expiryOk} />
        <Btn kind="ghost" title={t('drv.photo.pick')} onPress={fromGallery} disabled={!expiryOk || busy} />
        <Btn kind="ghost" title={t('drv.file.pick')} onPress={fromPdf} disabled={!expiryOk || busy} />
      </View> : null}
    </View>
  );
}
