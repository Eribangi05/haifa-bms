import React, { useState } from 'react';
import { FlatList, Modal, Pressable, TextInput, View } from 'react-native';
import { useApp } from '../lib/app';
import { useAppearance } from '../lib/appearance';
import { MONTHS, WEEKDAYS_SHORT, addDays, addMonths, clampIso, dayAllowed, joinHM, joinInstant, longDate, minuteChoices, monthGrid, parseIso, showHM, splitHM, splitInstant, todayKigali, toIso, validHM } from '../lib/calendar';
import { kv } from '../lib/storage';
import { byIso, countryName, DEFAULT_COUNTRY, flag, searchCountries, splitE164, toE164 } from '../lib/phone';
import { Btn, Chip, Field, Text } from './components';
import { C, R, S, SP } from './theme';

/**
 * Pickers: nobody has to type a date or a time. A calendar to choose a day (months and years can be stepped, impossible days are greyed out),
 * a clock to choose hours and minutes (the minute step is adjustable), a date-and-time field that combines both, and a number stepper for
 * lengths (minutes, hours, days) that can be typed or stepped. All texts follow the app language; the clock follows the 24-hour / 12-hour choice.
 */

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }} onPress={onClose} accessibilityLabel={title}>
        <Pressable onPress={() => undefined} style={{ backgroundColor: C.card, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, padding: SP.lg, maxHeight: '92%', gap: SP.sm }}>
          <Text style={S.h2}>{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const box = (error?: boolean) => ({ minHeight: 48, borderWidth: 1, borderColor: error ? C.danger : C.line, borderRadius: R.sm, paddingHorizontal: SP.md, justifyContent: 'center' as const, backgroundColor: C.card });

export function DateField({ label, value, onChange, min, max, optional, error, testID, startAt }: { label?: string; value: string; onChange: (iso: string) => void; min?: string; max?: string; optional?: boolean; error?: string; testID?: string; startAt?: string }) {
  const { t, lang } = useApp(); const ap = useAppearance(); const [open, setOpen] = useState(false);
  const seed = parseIso(value) ? value : clampIso(startAt ?? todayKigali(), min, max); const sp = parseIso(seed)!;
  const [view, setView] = useState({ y: sp.y, m: sp.m });
  const show = () => { const s = parseIso(value) ? value : clampIso(startAt ?? todayKigali(), min, max); const p = parseIso(s)!; setView({ y: p.y, m: p.m }); setOpen(true); };
  const days = monthGrid(view.y, view.m, ap.weekStart); const names = ap.weekStart === 1 ? WEEKDAYS_SHORT[lang] : [WEEKDAYS_SHORT[lang][6], ...WEEKDAYS_SHORT[lang].slice(0, 6)];
  const today = todayKigali(); const tomorrow = addDays(today, 1);
  const pick = (iso: string) => { onChange(iso); setOpen(false); };
  const yearStep = (n: number) => setView((v) => addMonths(v.y, v.m, n * 12));
  return (
    <View>
      {label ? <Text style={S.muted}>{label}</Text> : null}
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label ?? t('pk.date.pick')}: ${value ? longDate(value, lang) : t('pk.date.none')}`} onPress={show} style={box(!!error)}>
        <Text style={{ color: value ? C.ink : C.placeholder, fontSize: 16 }}>{value ? longDate(value, lang) : t('pk.date.none')}</Text>
      </Pressable>
      {error ? <Text style={{ color: C.danger, fontSize: 13 }}>{error}</Text> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? t('pk.date.pick')}>
        <View style={[S.between, { gap: SP.xs }]}>
          <Btn kind="ghost" title="«" onPress={() => yearStep(-1)} style={{ minWidth: 48 }} testID="cal-prev-year" />
          <Btn kind="ghost" title="‹" onPress={() => setView((v) => addMonths(v.y, v.m, -1))} style={{ minWidth: 48 }} testID="cal-prev" />
          <Text testID="cal-title" style={[S.bold, { flex: 1, textAlign: 'center' }]}>{MONTHS[lang][view.m - 1]} {view.y}</Text>
          <Btn kind="ghost" title="›" onPress={() => setView((v) => addMonths(v.y, v.m, 1))} style={{ minWidth: 48 }} testID="cal-next" />
          <Btn kind="ghost" title="»" onPress={() => yearStep(1)} style={{ minWidth: 48 }} testID="cal-next-year" />
        </View>
        <View style={{ flexDirection: 'row' }}>{names.map((n, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: C.muted, fontSize: 12 }}>{n}</Text>)}</View>
        {days.map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row' }}>
            {row.map((d, ci) => {
              if (!d) return <View key={ci} style={{ flex: 1, height: 44 }} />;
              const iso = toIso(view.y, view.m, d); const ok = dayAllowed(iso, min, max); const sel = iso === value;
              return (
                <Pressable key={ci} testID={`cal-day-${iso}`} disabled={!ok} onPress={() => pick(iso)} accessibilityRole="button" accessibilityState={{ selected: sel, disabled: !ok }} accessibilityLabel={longDate(iso, lang)}
                  style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', margin: 1, borderRadius: R.sm, backgroundColor: sel ? C.primary : iso === today ? C.okBg : 'transparent', opacity: ok ? 1 : 0.3 }}>
                  <Text style={{ color: sel ? C.onPrimary : C.ink, fontWeight: sel || iso === today ? '700' : '400' }}>{d}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={S.wrap}>
          {dayAllowed(today, min, max) ? <Chip text={t('pk.today')} action onPress={() => pick(today)} /> : null}
          {dayAllowed(tomorrow, min, max) ? <Chip text={t('pk.tomorrow')} action onPress={() => pick(tomorrow)} /> : null}
          {optional && value ? <Chip text={t('pk.clear')} action onPress={() => pick('')} /> : null}
        </View>
        <Btn kind="ghost" title={t('common.cancel')} onPress={() => setOpen(false)} />
      </Sheet>
    </View>
  );
}

export function TimeField({ label, value, onChange, testID, error }: { label?: string; value: string; onChange: (hm: string) => void; testID?: string; error?: string }) {
  const { t } = useApp(); const ap = useAppearance(); const [open, setOpen] = useState(false); const [step, setStep] = useState(5);
  const cur = splitHM(value); const mins = minuteChoices(step);
  const set = (h: number, m: number) => onChange(joinHM(h, m));
  const hourText = (h: number) => (ap.timeFormat === '12h' ? `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}` : String(h).padStart(2, '0'));
  return (
    <View>
      {label ? <Text style={S.muted}>{label}</Text> : null}
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label ?? t('pk.time.pick')}: ${validHM(value) ? showHM(value, ap.timeFormat) : ''}`} onPress={() => setOpen(true)} style={box(!!error)}>
        <Text style={{ color: validHM(value) ? C.ink : C.placeholder, fontSize: 16 }}>{validHM(value) ? showHM(value, ap.timeFormat) : '--:--'}</Text>
      </Pressable>
      {error ? <Text style={{ color: C.danger, fontSize: 13 }}>{error}</Text> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? t('pk.time.pick')}>
        <Text testID="time-shown" style={[S.h1, { textAlign: 'center' }]}>{validHM(value) ? showHM(value, ap.timeFormat) : '--:--'}</Text>
        <Text style={S.muted}>{t('pk.hour')}</Text>
        <View style={S.wrap}>{Array.from({ length: 24 }, (_, h) => <Chip key={h} testID={`time-h-${h}`} text={hourText(h)} on={validHM(value) && cur.h === h} onPress={() => set(h, cur.m)} />)}</View>
        <Text style={S.muted}>{t('pk.minute')}</Text>
        <View style={S.wrap}>{mins.map((m) => <Chip key={m} testID={`time-m-${m}`} text={String(m).padStart(2, '0')} on={validHM(value) && cur.m === m} onPress={() => set(cur.h, m)} />)}</View>
        <Text style={S.muted}>{t('pk.step')}</Text>
        <View style={S.wrap}>{[1, 5, 10, 15, 30].map((n) => <Chip key={n} text={String(n)} on={step === n} onPress={() => setStep(n)} />)}</View>
        <Btn testID="time-done" title={t('pk.ok')} onPress={() => { if (!validHM(value)) set(cur.h, cur.m); setOpen(false); }} />
      </Sheet>
    </View>
  );
}

/** A date and a time as one instant (ISO string), limited to a window. `value` is an ISO instant or null. */
export function DateTimeField({ label, value, onChange, min, max, testID, error }: { label?: string; value: string | null; onChange: (iso: string | null) => void; min?: Date; max?: Date; testID?: string; error?: string }) {
  const sp = splitInstant(value); const defaultStart = splitInstant((min ?? new Date()).toISOString())!;
  const date = sp?.date ?? ''; const time = sp?.time ?? '';
  const minD = min ? splitInstant(min.toISOString())!.date : undefined; const maxD = max ? splitInstant(max.toISOString())!.date : undefined;
  return (
    <View style={{ gap: SP.sm }}>
      {label ? <Text style={S.muted}>{label}</Text> : null}
      <DateField testID={testID ? `${testID}-date` : undefined} value={date} min={minD} max={maxD} onChange={(d) => onChange(d ? joinInstant(d, time || defaultStart.time) : null)} startAt={defaultStart.date} />
      <TimeField testID={testID ? `${testID}-time` : undefined} value={time} onChange={(h) => onChange(joinInstant(date || defaultStart.date, h))} />
      {error ? <Text style={{ color: C.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

/** A number the person can step with − and + or type: lengths of time, counts. */
export function NumberStepper({ value, onChange, min, max, step = 1, unit, testID, label }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number; unit?: string; testID?: string; label?: string }) {
  const { t } = useApp(); const [text, setText] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const commit = (s: string) => { const n = Number(s.replace(/[^\d]/g, '')); setText(null); if (s.trim() && Number.isFinite(n)) onChange(clamp(n)); };
  return (
    <View>
      {label ? <Text style={S.muted}>{label}</Text> : null}
      <View style={[S.row, { gap: SP.sm }]}>
        <Btn kind="ghost" title="−" testID={testID ? `${testID}-dec` : undefined} onPress={() => onChange(clamp(value - step))} style={{ minWidth: 52 }} disabled={value <= min} />
        <TextInput testID={testID} value={text ?? String(value)} onChangeText={(s) => setText(s.replace(/[^\d]/g, '').slice(0, 5))} onBlur={() => text !== null && commit(text)} onSubmitEditing={() => text !== null && commit(text)} keyboardType="number-pad" accessibilityLabel={label ?? unit}
          style={[S.input, { flex: 1, textAlign: 'center', fontWeight: '700' }]} />
        <Btn kind="ghost" title="+" testID={testID ? `${testID}-inc` : undefined} onPress={() => onChange(clamp(value + step))} style={{ minWidth: 52 }} disabled={value >= max} />
        {unit ? <Text style={S.muted}>{unit}</Text> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- phone number with a country picker

/**
 * A phone number with a country picker: the person chooses the country from a searchable list (name in the app language, calling code, flag) and types the
 * national number. `value` and `onChange` use E.164 ("+250788123456"); onChange gives '' while the number is not complete or plausible.
 */
export function PhoneField({ value, onChange, testID, label, invalidText, onSubmit, autoFocus }: { value: string; onChange: (e164: string) => void; testID?: string; label?: string; invalidText?: string; onSubmit?: () => void; autoFocus?: boolean }) {
  const { t, lang } = useApp(); const first = splitE164(value);
  const [iso, setIso] = useState(first?.country.iso ?? DEFAULT_COUNTRY); const [text, setText] = useState(first?.national ?? ''); const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const c = byIso(iso);
  React.useEffect(() => { if (!first) void kv.get('rm_country').then((v) => { if (v) setIso(byIso(v).iso); }).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (nextIso: string, nextText: string) => { setIso(nextIso); setText(nextText); onChange(toE164(byIso(nextIso), nextText) ?? ''); };
  const pickCountry = (code: string) => { setOpen(false); setQ(''); void kv.set('rm_country', code).catch(() => {}); set(code, text); };
  const results = searchCountries(q, lang); const bad = text.replace(/\D/g, '').length >= 4 && !toE164(c, text);
  return (
    <View>
      {label ? <Text style={S.muted}>{label}</Text> : null}
      <View style={[S.row, { gap: SP.sm, alignItems: 'flex-start' }]}>
        <Pressable testID={testID ? `${testID}-country` : undefined} accessibilityRole="button" accessibilityLabel={`${t('ph.country')}: ${countryName(c, lang)} +${c.dial}`} onPress={() => setOpen(true)} style={[S.input, { justifyContent: 'center', marginTop: 0, minWidth: 104, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
          <Text style={{ fontSize: 20 }}>{flag(c.iso)}</Text><Text style={{ fontSize: 16, fontWeight: '600' }}>+{c.dial}</Text><Text style={{ color: C.muted }}>▾</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Field testID={testID} value={text} onChangeText={(x) => set(iso, x.replace(/[^\d\s\-()]/g, ''))} placeholder={c.iso === 'RW' ? t('auth.phone.hint') : t('ph.number')} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={18}
            accessibilityLabel={label ?? t('ph.number')} autoFocus={autoFocus} onSubmitEditing={onSubmit} error={bad ? invalidText ?? t('ph.invalid') : undefined} />
        </View>
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t('ph.country')}>
        <TextInput testID="country-search" value={q} onChangeText={setQ} placeholder={t('ph.search')} placeholderTextColor={C.placeholder} autoCorrect={false} accessibilityLabel={t('ph.search')} style={S.input} />
        <FlatList style={{ maxHeight: 420 }} data={results} keyExtractor={(x) => x.iso} keyboardShouldPersistTaps="handled" initialNumToRender={20} ListEmptyComponent={<Text style={S.muted}>{t('ph.none')}</Text>}
          renderItem={({ item, index }) => (
            <View>
              {!q && index === 0 ? <Text style={[S.muted, { paddingVertical: 4 }]}>{t('ph.common')}</Text> : null}
              <Pressable testID={`country-${item.iso}`} onPress={() => pickCountry(item.iso)} accessibilityRole="button" accessibilityState={{ selected: item.iso === iso }} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
                <Text style={{ fontSize: 22, width: 32 }}>{flag(item.iso)}</Text><Text style={{ flex: 1, fontWeight: item.iso === iso ? '700' : '400' }}>{countryName(item, lang)}</Text><Text style={{ color: C.muted }}>+{item.dial}</Text>
              </Pressable>
            </View>
          )} />
        <Btn kind="ghost" title={t('common.cancel')} onPress={() => setOpen(false)} />
      </Sheet>
    </View>
  );
}
