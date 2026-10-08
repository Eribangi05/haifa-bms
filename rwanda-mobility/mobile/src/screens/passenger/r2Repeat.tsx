import React, { useState } from 'react';
import { Switch, View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { WEEKDAYS, WEEK_ORDER, checkRepeat, kigaliDate, stepTime, toggleDay, validTime, type SchedulePayload } from '../../lib/r2';
import { Btn, Card, Chip, Field, Text } from '../../ui/components';
import { C, S, SP } from '../../ui/theme';

/** "Repeat this ride": weekday chips, a local time stepper, start / end dates. Saves a schedule through POST /ride-schedules (does not book now). */
export function RepeatSection({ build, canRepeat, onSaved }: { build: (f: { days: number[]; time: string; start: string; end: string | null }) => SchedulePayload | null; canRepeat: boolean; onSaved: () => void }) {
  const { t, client, say } = useApp(); const { busy, run } = useAsync();
  const [on, setOn] = useState(false); const [days, setDays] = useState<number[]>(WEEKDAYS); const [time, setTime] = useState('07:30');
  const [start, setStart] = useState(kigaliDate(new Date(), 1)); const [end, setEnd] = useState(''); const [tried, setTried] = useState(false);
  const chk = checkRepeat({ days, time, start, end });
  const save = () => {
    setTried(true); if (!chk.ok) return;
    const body = build({ days, time, start, end: end.trim() || null }); if (!body) return;
    void run(async () => { await client.post('/ride-schedules', body); say(t('r2.rep.saved')); onSaved(); });
  };
  return (
    <Card>
      <View style={[S.between, { minHeight: 48 }]}>
        <Text style={[S.h2, { flex: 1, paddingRight: SP.sm }]}>{t('r2.rep.switch')}</Text>
        <Switch testID="r2-repeat-switch" accessibilityLabel={t('r2.rep.switch')} value={on} onValueChange={setOn} trackColor={{ true: C.primary }} />
      </View>
      <Text style={S.muted}>{t('r2.rep.sub')}</Text>
      {on ? <View style={{ marginTop: SP.md }}>
        {!canRepeat ? <Text style={{ color: C.danger }}>{t('r2.rep.needdest')}</Text> : null}
        <Text style={S.muted}>{t('r2.rep.days')}</Text>
        <View style={[S.wrap, { marginTop: 6 }]} accessibilityRole="radiogroup">{WEEK_ORDER.map((d) => <Chip key={d} text={t(`r2.day.${d}` as 'r2.day.0')} on={days.includes(d)} onPress={() => setDays(toggleDay(days, d))} />)}</View>
        {tried && chk.days ? <Text style={{ color: C.danger }}>{t('r2.rep.err.days')}</Text> : null}
        <Text style={[S.muted, { marginTop: SP.sm }]}>{t('r2.rep.time')}</Text>
        <View style={[S.row, { gap: SP.sm }]}>
          <Btn kind="ghost" title="−" onPress={() => setTime(stepTime(time, -15))} style={{ minWidth: 52 }} />
          <View style={{ flex: 1 }}><Field testID="r2-repeat-time" value={time} onChangeText={(x) => setTime(x.replace(/[^\d:]/g, '').slice(0, 5))} keyboardType="numbers-and-punctuation" maxLength={5} error={(tried || validTime(time) === false && time.length >= 5) && chk.time ? t('r2.rep.err.time') : undefined} accessibilityLabel={t('r2.rep.time')} /></View>
          <Btn kind="ghost" title="+" onPress={() => setTime(stepTime(time, 15))} style={{ minWidth: 52 }} />
        </View>
        <Field testID="r2-repeat-start" label={t('r2.rep.start')} value={start} onChangeText={setStart} maxLength={10} keyboardType="numbers-and-punctuation" error={(tried || start.length >= 10) && chk.start ? t('r2.rep.err.start') : undefined} />
        <View style={S.wrap}><Chip text={t('r2.rep.today')} on={start === kigaliDate()} onPress={() => setStart(kigaliDate())} /><Chip text={t('r2.rep.tomorrow')} on={start === kigaliDate(new Date(), 1)} onPress={() => setStart(kigaliDate(new Date(), 1))} /></View>
        <Field testID="r2-repeat-end" label={t('r2.rep.end')} value={end} onChangeText={setEnd} maxLength={10} keyboardType="numbers-and-punctuation" error={(tried || end.length >= 10) && chk.end ? t('r2.rep.err.end') : undefined} />
        {end ? <Chip text={t('r2.rep.noend')} onPress={() => setEnd('')} /> : null}
        <Btn testID="r2-repeat-save" title={t('r2.rep.save')} onPress={save} loading={busy} disabled={!canRepeat} />
      </View> : null}
    </Card>
  );
}
