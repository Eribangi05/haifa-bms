import React, { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { useApp, useAsync, useBackHandler, usePoll } from '../lib/app';
import { etaRemaining, fmtCountdown, safetyPending, safetySecondsLeft, shouldResyncEta, type SafetyOpen } from '../lib/r1';
import { AppModal } from '../ui/AppModal';
import { Banner, Btn, Card, Glyph, LinkBtn, Screen, Text, useReduceMotion } from '../ui/components';
import { C, FS, S, SP } from '../ui/theme';

type Phase = 'none' | 'prompt' | 'ok' | 'help' | 'missed';
const call = (n: string) => { void Linking.openURL(`tel:${n}`).catch(() => {}); };

/**
 * "Are you OK?" for the live trip. Polls the safety check; while one waits it shows a persistent banner and a full-screen prompt with two big answers.
 * Wording never claims that any agency was contacted: only that the support team was asked to follow up.
 */
export function R1SafetyLayer({ id, active, openHint }: { id: string; active: boolean; openHint?: boolean }) {
  const { t, client, cfg, say } = useApp(); const { busy, run } = useAsync();
  const poll = usePoll(() => client.get<{ open: SafetyOpen | null }>(`/bookings/${id}/safety-check`), 8000, [id], active);
  const open = safetyPending(poll.data?.open) ? poll.data!.open : null;
  const [phase, setPhase] = useState<Phase>('none'); const seen = useRef<string | null>(null); const was = useRef<SafetyOpen | null>(null);
  const [now, setNow] = useState(Date.now()); const num = cfg?.emergency_numbers ?? { police: '112', ambulance: '912' };
  useBackHandler(() => { if (phase === 'prompt') { setPhase('none'); return true; } if (phase !== 'none') { setPhase('none'); return true; } return false; }, phase !== 'none');
  useEffect(() => {
    if (open) { was.current = open; if (seen.current !== open.id) { seen.current = open.id; setPhase('prompt'); } return; }
    // a check we were showing is gone and we did not answer it: the time ran out (or staff resolved it)
    if (was.current && phase !== 'ok' && phase !== 'help') { if (safetySecondsLeft(was.current, Date.now()) <= 5) setPhase('missed'); }
    was.current = null;
  }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [open]);
  const answer = (a: 'ok' | 'help') => run(async () => {
    await client.post(`/bookings/${id}/safety-check/respond`, { answer: a }, { retry: true });
    setPhase(a === 'ok' ? 'ok' : 'help'); poll.reload(); if (a === 'ok') say(t('r1.sc.thanks'));
  });
  const left = open ? safetySecondsLeft(open, now) : 0;
  const bodyKey = open?.kind === 'long_stop' || open?.kind === 'stop' ? 'r1.sc.body.stop' : 'r1.sc.body.dev';
  const dangerLine = t('r1.sc.danger', { police: num.police, ambulance: num.ambulance });

  return (
    <>
      {open && phase !== 'prompt' ? <Banner kind="bad" text={t('r1.sc.banner')} action={<Btn testID="sc-banner-btn" kind="danger" title={t('r1.sc.banner.btn')} onPress={() => setPhase('prompt')} />} /> : null}
      {!open && phase === 'missed' ? <Banner text={t('r1.sc.missed', { police: num.police })} action={<Btn kind="ghost" title={t('r1.sc.call', { n: num.police })} onPress={() => call(num.police)} />} /> : null}
      {!open && phase === 'help' ? <Banner kind="bad" text={t('r1.sc.help.body', { police: num.police })} action={<Btn kind="ghost" title={t('r1.sc.call', { n: num.police })} onPress={() => call(num.police)} />} /> : null}
      <AppModal visible={phase === 'prompt' && !!open} onClose={() => setPhase('none')}>
        <Screen title={t('r1.sc.title')} onBack={() => setPhase('none')} stripe={false}
          footer={<>
            <Btn testID="sc-ok" big title={t('r1.sc.ok')} onPress={() => answer('ok')} loading={busy} />
            <Btn testID="sc-help" big kind="danger" title={t('r1.sc.help')} onPress={() => answer('help')} loading={busy} />
          </>}>
          <View style={{ alignItems: 'center', paddingVertical: SP.lg }}>
            <Glyph g="🛟" size={72} />
            <Text accessibilityRole="header" style={[S.h1, { textAlign: 'center', marginTop: SP.sm }]}>{t('r1.sc.title')}</Text>
            <Text style={[S.body, { textAlign: 'center', marginTop: SP.sm }]}>{t(bodyKey)}</Text>
            <Text style={[S.muted, { textAlign: 'center', marginTop: SP.sm, fontSize: FS.md - 1 }]}>{t('r1.sc.ask')}</Text>
            <Text accessibilityLiveRegion="polite" style={[S.h2, { color: C.danger, marginTop: SP.lg }]}>{t('r1.sc.left', { time: fmtCountdown(left) })}</Text>
          </View>
          <LinkBtn title={t('r1.sc.later')} onPress={() => setPhase('none')} style={{ alignSelf: 'center', marginBottom: SP.sm }} />
          <Card style={{ borderColor: C.danger }}>
            <Text style={S.body}>{dangerLine}</Text>
            <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.sm, flexWrap: 'wrap' }}>
              <Btn kind="ghost" title={t('r1.sc.call', { n: num.police })} onPress={() => call(num.police)} />
              <Btn kind="ghost" title={t('r1.sc.call', { n: num.ambulance })} onPress={() => call(num.ambulance)} />
            </View>
          </Card>
        </Screen>
      </AppModal>
    </>
  );
}

/** Live driver ETA from the booking (`driver_eta_s`): counts down every second between polls and re-syncs on each new value. */
export function R1DriverEta({ etaS, target, stamp }: { etaS: number | null | undefined; target: string | null | undefined; stamp: unknown }) {
  const { t } = useApp(); const reduce = useReduceMotion();
  const [now, setNow] = useState(Date.now()); const recv = useRef(Date.now()); const base = useRef<number | null | undefined>(etaS);
  // A poll only restarts the countdown when the server's value disagrees with our own prediction (keeps a moving driver smooth, still corrects a stalled one).
  const predicted = etaRemaining(base.current, recv.current, Date.now());
  if (etaS == null) base.current = null; else if (shouldResyncEta(predicted, etaS)) { base.current = etaS; recv.current = Date.now(); }
  useEffect(() => { if (etaS == null) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [etaS]);
  void stamp; void now;
  const left = etaRemaining(base.current, recv.current, Date.now());
  if (left == null) return null;
  return (
    <View style={{ marginBottom: SP.md }} testID="driver-eta">
      <Text style={S.muted}>{target === 'destination' ? t('r1.eta.dest') : t('r1.eta.pickup')}</Text>
      <Text accessibilityLiveRegion={reduce ? 'none' : 'polite'} accessibilityLabel={`${target === 'destination' ? t('r1.eta.dest') : t('r1.eta.pickup')} ${Math.max(1, Math.round(left / 60))} ${t('common.min')}`} style={{ fontSize: 34, fontWeight: '800', color: C.primary }}>{fmtCountdown(left)}</Text>
      <Text style={S.muted}>{t('r1.eta.live')}</Text>
    </View>
  );
}
