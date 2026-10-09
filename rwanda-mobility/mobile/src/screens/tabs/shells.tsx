import React, { useEffect, useState } from 'react';
import { useApp } from '../../lib/app';
import { TripFeedProvider, useTripFeed } from '../../lib/tripFeed';
import type { Booking, Place, Pt, Svc, Venue } from '../../lib/types';
import { Screen } from '../../ui/components';
import { TabPane, TabShell, type TabDef } from '../../ui/TabBar';
import { Home } from '../passenger/home';
import { TripsPanel, TripsTab } from '../history';
import { DriverHome } from '../driver';
import { Earnings } from '../driver/earnings';
import { VehicleTab } from '../driver/vehicleTab';
import { AccountTab } from './account';
import { Overview } from './overview';
import { WalletTab } from './wallet';

/** Rider root: five tabs. Book stays mounted once opened so a half-made booking survives a look at another tab. */
export function PassengerShell({ params }: { params?: { venue?: Venue; svc?: Svc } }) {
  const { t, tab, setTab, client } = useApp();
  const [active, setActive] = useState<Booking | null>(null); const [refCode, setRefCode] = useState<string | undefined>();
  const [intent, setIntent] = useState<{ dest?: Place | Pt; svc?: Svc; n: number } | null>(null);
  useEffect(() => { client.get('/users/me/referral').then((r) => setRefCode(r.code)).catch(() => {}); }, [client]);
  useEffect(() => { if (params?.venue) setTab('book'); }, [params?.venue]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = ['home', 'book', 'trips', 'wallet', 'account'];
  const cur = keys.includes(tab) ? tab : 'home';
  const tabs: TabDef[] = [
    { key: 'home', glyph: '🏠', label: t('tab.home') }, { key: 'book', glyph: '🗺️', label: t('tab.book'), badge: !!active && cur !== 'book' },
    { key: 'trips', glyph: '🧾', label: t('tab.trips') }, { key: 'wallet', glyph: '💳', label: t('tab.wallet') }, { key: 'account', glyph: '👤', label: t('tab.account') },
  ];
  const book = (dest?: Place | Pt, svc?: Svc) => { setIntent({ dest, svc, n: Date.now() }); setTab('book'); };
  return (
    <TripFeedProvider role="passenger">
      <TabShell tabs={tabs} active={cur} onPick={setTab}>
        <TabPane active={cur === 'home'} lazy={false}><Overview active={active} onBook={book} refCode={refCode} /></TabPane>
        <TabPane active={cur === 'book'} lazy={false}><Home key={params?.venue?.code ?? 'home'} params={params} intent={intent} onActive={setActive} /></TabPane>
        <TabPane active={cur === 'trips'}><TripsTab onBook={() => book()} /></TabPane>
        <TabPane active={cur === 'wallet'}><WalletTab /></TabPane>
        <TabPane active={cur === 'account'}><AccountTab /></TabPane>
      </TabShell>
    </TripFeedProvider>
  );
}

function DriverTrips() {
  const { t } = useApp(); const feed = useTripFeed();
  return <Screen title={t('dt.title')} onRefresh={async () => { feed.reload(); await new Promise((r) => setTimeout(r, 600)); }}><TripsPanel driver /></Screen>;
}
function DriverEarnings() {
  const { t } = useApp();
  return <Screen title={t('de.title')}><Earnings /></Screen>;
}

/** Driver root: Work (application or online/offers), Trips, Earnings, Vehicle and record, Account. */
export function DriverShell() {
  const { t, tab, setTab } = useApp();
  const keys = ['home', 'trips', 'earn', 'car', 'account']; const cur = keys.includes(tab) ? tab : 'home';
  const tabs: TabDef[] = [
    { key: 'home', glyph: '🚦', label: t('tab.drv.work') }, { key: 'trips', glyph: '🧾', label: t('tab.trips') }, { key: 'earn', glyph: '💰', label: t('tab.drv.earn') },
    { key: 'car', glyph: '🚗', label: t('tab.drv.car') }, { key: 'account', glyph: '👤', label: t('tab.account') },
  ];
  return (
    <TripFeedProvider role="driver">
      <TabShell tabs={tabs} active={cur} onPick={setTab}>
        <TabPane active={cur === 'home'} lazy={false}><DriverHome /></TabPane>
        <TabPane active={cur === 'trips'}><DriverTrips /></TabPane>
        <TabPane active={cur === 'earn'}><DriverEarnings /></TabPane>
        <TabPane active={cur === 'car'}><VehicleTab focused={cur === 'car'} /></TabPane>
        <TabPane active={cur === 'account'}><AccountTab /></TabPane>
      </TabShell>
    </TripFeedProvider>
  );
}
