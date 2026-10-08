import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp, useAsync } from '../../lib/app';
import { ApiError, uuid } from '../../lib/net';
import { fmtDate, fmtTime, groupByDay } from '../../lib/format';
import { creditForPoints, entryAmount, entryInfo, entryIsMove, redeemChoices, signedRwf, tierProgress, TIER_GLYPH, validRedeem, type LoyaltyView, type WalletEntry, type WalletView } from '../../lib/money3';
import type { TKey } from '../../lib/i18n';
import { Banner, Btn, Card, Chip, EmptyState, IconBadge, Money, Screen, SectionTitle, SkeletonCard, Text } from '../../ui/components';
import { showAlert } from '../../ui/dialog';
import { C, FS, R, S, SP } from '../../ui/theme';

/** Wallet balance (shared by the Home chip, the credit screen and the pay pickers). Enabled only for signed-in passengers. */
export function useWallet(enabled = true) {
  const { client } = useApp(); const [w, setW] = useState<WalletView | null>(null); const [err, setErr] = useState<ApiError | null>(null);
  const load = useCallback(async () => { try { setW(await client.get<WalletView>('/wallet')); setErr(null); } catch (e) { setErr(e as ApiError); } }, [client]);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  return { wallet: w, error: err, reload: load };
}

/** Compact balance chip for Home. Hidden until the balance is known, so it never flashes a wrong number. */
export function CreditChip() {
  const { t, nav } = useApp(); const { wallet } = useWallet();
  if (!wallet) return null;
  return (
    <Pressable testID="credit-chip" onPress={() => nav.push('credit')} accessibilityRole="button" accessibilityLabel={t('cr.chip.a11y', { n: Math.round(wallet.available).toLocaleString('en-US') })}
      style={{ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: C.goldBg, borderColor: C.gold, borderWidth: 1, borderRadius: R.pill, paddingHorizontal: 14, marginBottom: SP.md }}>
      <Text accessible={false}>💳</Text><Text style={{ color: C.ink, fontWeight: '700' }}>{t('cr.chip')}</Text><Money n={wallet.available} style={{ color: C.primaryDark, fontWeight: '800' }} />
    </Pressable>
  );
}

/** Ring made of 60 small bars (no SVG dependency): works on Android, iOS and web. */
export function Ring({ ratio, size = 96, children, a11y }: { ratio: number; size?: number; children?: React.ReactNode; a11y: string }) {
  const N = 60; const on = Math.round(Math.min(1, Math.max(0, ratio)) * N);
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={a11y} accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: N }, (_, i) => (
        <View key={i} style={{ position: 'absolute', width: size, height: size, alignItems: 'center', transform: [{ rotate: `${i * (360 / N)}deg` }] }}>
          <View style={{ width: 4, height: size / 9, borderRadius: 2, backgroundColor: i < on ? C.gold : C.line }} />
        </View>))}
      {children}
    </View>
  );
}

export function LoyaltyCard({ loyalty, onChanged }: { loyalty: LoyaltyView; onChanged: () => void }) {
  const { t, client, say, errMsg } = useApp(); const { busy, run } = useAsync(); const [pickP, setPickP] = useState<number | null>(null); const keyRef = useRef<{ p: number; k: string } | null>(null);
  const tn = (x: string) => t(`cr.tier.${x}` as TKey);
  const prog = useMemo(() => tierProgress(loyalty.lifetime_points, loyalty.tiers, loyalty.tier), [loyalty]);
  const choices = redeemChoices(loyalty.points, loyalty.redeem.min_points, loyalty.redeem.step);
  const cur = loyalty.tiers.find((x) => x.tier === loyalty.tier);
  const redeem = (p: number) => run(async () => {
    if (keyRef.current?.p !== p) keyRef.current = { p, k: uuid() };   // same key on a retry of this exact choice: never a double redemption
    try { const r = await client.post<{ credit_added: number }>('/loyalty/redeem', { points: p }, { idempotencyKey: keyRef.current.k }); say(t('cr.redeem.done', { n: r.credit_added })); keyRef.current = null; setPickP(null); onChanged(); }
    catch (e) {
      const code = (e as ApiError)?.code;
      if (code === 'insufficient_points' || code === 'below_min_redeem' || code === 'invalid_points' || code === 'credit_cap_exceeded') { say(t(`cr.err.${code}` as TKey)); onChanged(); }
      else if (e instanceof ApiError && (e.isNetwork || e.isTimeout)) { say(t('cr.redeem.pending')); onChanged(); }
      else say(errMsg(e));
    }
  });
  const ask = () => { if (pickP == null || !validRedeem(pickP, loyalty.redeem.min_points, loyalty.redeem.step, loyalty.points)) return; const p = pickP;
    showAlert(t('cr.redeem'), t('cr.redeem.confirm', { p, n: creditForPoints(p, loyalty.redeem.rwf_per_100_points) }), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), onPress: () => void redeem(p) }]); };
  return (
    <Card style={{ borderColor: C.gold, borderWidth: 2 } as never}>
      <View style={[S.row, { gap: SP.lg }]}>
        <Ring ratio={prog.ratio} a11y={t('cr.ring.a11y', { tier: tn(loyalty.tier), n: loyalty.points, pct: Math.round(prog.ratio * 100) })}>
          <Text accessible={false} style={{ fontSize: 34 }}>{TIER_GLYPH[loyalty.tier] ?? '⭐'}</Text>
        </Ring>
        <View style={{ flex: 1 }}>
          <Text style={S.h2}>{t('cr.tier', { tier: tn(loyalty.tier) })}</Text>
          <Text testID="loyalty-points" style={[S.bold, { color: C.primaryDark }]}>{t('cr.points', { n: loyalty.points })}</Text>
          <Text style={S.muted}>{prog.next ? t('cr.next', { n: prog.needed, tier: tn(prog.next.tier) }) : t('cr.top')}</Text>
        </View>
      </View>
      <Text accessibilityRole="header" style={[S.bold, { marginTop: SP.lg }]}>{t('cr.perks')}</Text>
      <Text style={S.body}>• {t('cr.perk.earn', { n: loyalty.earn.rwf_per_point })}</Text>
      {cur && cur.bonus_pct > 0 ? <Text style={S.body}>• {t('cr.perk.bonus', { n: cur.bonus_pct })}</Text> : null}
      {cur && cur.extra_free_cancel_s > 0 ? <Text style={S.body}>• {t('cr.perk.cancel', { n: cur.extra_free_cancel_s })}</Text> : <Text style={S.muted}>{t('cr.perk.none')}</Text>}
      <Text accessibilityRole="header" style={[S.bold, { marginTop: SP.lg }]}>{t('cr.redeem')}</Text>
      <Text style={S.muted}>{t('cr.redeem.rate', { p: 100, n: loyalty.redeem.rwf_per_100_points })}</Text>
      {choices.length ? <>
        <Text style={[S.muted, { marginVertical: SP.xs }]}>{t('cr.redeem.pick')}</Text>
        <View style={S.wrap}>{choices.map((p) => <Chip key={p} text={`${p}`} on={pickP === p} onPress={() => setPickP(p)} />)}</View>
        <Btn testID="redeem-btn" title={pickP ? t('cr.redeem.btn', { p: pickP }) : t('cr.redeem')} onPress={ask} disabled={pickP == null} loading={busy} />
      </> : <Text style={S.muted}>{t('cr.redeem.min', { n: Math.max(loyalty.redeem.min_points, loyalty.redeem.step), s: loyalty.redeem.step })}</Text>}
    </Card>
  );
}

export function CreditScreen() {
  const { t, client, nav, errMsg, online } = useApp(); const { wallet, error, reload } = useWallet();
  const [loy, setLoy] = useState<LoyaltyView | null | false>(null); const [entries, setEntries] = useState<WalletEntry[] | null>(null); const [next, setNext] = useState<number | null>(null); const [more, setMore] = useState(false);
  const loadAll = useCallback(async () => {
    void reload();
    client.get<LoyaltyView>('/loyalty').then((l) => setLoy(l.enabled ? l : false)).catch(() => setLoy(false));
    client.get<{ entries: WalletEntry[]; next_before: number | null }>('/wallet/statement?limit=30').then((r) => { setEntries(r.entries); setNext(r.next_before); }).catch(() => setEntries((x) => x ?? []));
  }, [client, reload]);
  useEffect(() => { void loadAll(); }, [loadAll]);
  const loadMore = async () => { if (next == null || more) return; setMore(true); try { const r = await client.get<{ entries: WalletEntry[]; next_before: number | null }>(`/wallet/statement?limit=30&before=${next}`); setEntries((e) => [...(e ?? []), ...r.entries]); setNext(r.next_before); } catch { /* keep what we have */ } finally { setMore(false); } };
  const groups = useMemo(() => groupByDay(entries ?? [], (e) => e.created_at), [entries]);
  return (
    <Screen title={t('cr.title')} onBack={() => nav.pop()} onRefresh={async () => { await loadAll(); }}>
      {!online ? <Banner kind="bad" text={t('net.offline')} /> : null}
      {error && !wallet ? <Banner kind="bad" text={errMsg(error)} action={<Btn kind="ghost" title={t('common.retry')} onPress={reload} />} /> : null}
      {!wallet && !error ? <SkeletonCard /> : null}
      {wallet ? <Card style={{ backgroundColor: C.primary, borderColor: C.primary }}>
        <Text style={{ color: '#D7ECF7' }}>{t('cr.balance')}</Text>
        <Text testID="credit-balance" style={{ color: '#fff', fontSize: 36, fontWeight: '800' }}>{Math.round(wallet.available).toLocaleString('en-US')} RWF</Text>
        {wallet.reserved > 0 ? <Text style={{ color: '#D7ECF7' }}>{t('cr.reserved', { n: Math.round(wallet.reserved).toLocaleString('en-US') })}</Text> : null}
      </Card> : null}
      {wallet && wallet.expiring_within_30_days > 0 && wallet.next_expiry ? <Banner text={t('cr.expiring', { n: Math.round(wallet.expiring_within_30_days).toLocaleString('en-US'), date: fmtDate(wallet.next_expiry) })} /> : null}
      <Text style={[S.muted, { marginBottom: SP.md }]}>{t('cr.note')}</Text>

      <SectionTitle text={t('cr.loyalty')} />
      {loy === null ? <SkeletonCard /> : loy === false ? <Card><Text style={S.muted}>{t('cr.loyalty.off')}</Text></Card> : <LoyaltyCard loyalty={loy} onChanged={loadAll} />}

      <SectionTitle text={t('cr.statement')} />
      {entries === null ? <><SkeletonCard /><SkeletonCard /></> : null}
      {entries && !entries.length ? <EmptyState glyph="💳" title={t('cr.empty.title')} body={t('cr.empty')} /> : null}
      {groups.map((g) => (
        <View key={g.key} style={{ marginBottom: SP.sm }}>
          <Text accessibilityRole="header" style={[S.muted, { fontWeight: '700', marginBottom: SP.xs }]}>{g.kind === 'today' ? t('common.today') : g.kind === 'yesterday' ? t('common.yesterday') : g.date}</Text>
          <Card style={{ paddingVertical: SP.xs }}>
            {g.items.map((e) => { const amt = entryAmount(e); const info = entryInfo(e); const move = entryIsMove(e);
              return (
                <View key={e.id} testID="stmt-row" style={[S.row, { gap: SP.md, minHeight: 56, paddingVertical: SP.xs }]}>
                  <IconBadge glyph={info.glyph} bg={C.skyBg} size={36} />
                  <View style={{ flex: 1 }}><Text style={S.body}>{t(`cr.src.${info.key}` as TKey)}</Text><Text style={S.muted}>{fmtTime(e.created_at)}</Text></View>
                  <Text style={{ fontSize: FS.md, fontWeight: '800', color: move ? C.muted : amt > 0 ? C.green : C.ink }}>{move ? '' : signedRwf(amt)}{move ? Math.abs(amt).toLocaleString('en-US') : ''} RWF</Text>
                </View>); })}
          </Card>
        </View>))}
      {next != null ? <Btn kind="ghost" title={t('cr.more')} onPress={loadMore} loading={more} /> : null}
    </Screen>
  );
}
