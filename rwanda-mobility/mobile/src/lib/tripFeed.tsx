import React, { createContext, useContext, useMemo } from 'react';
import { usePoll, useApp } from './app';
import type { Booking } from './types';
import type { ApiError } from './net';

type Feed = { trips: Booking[] | null; error: ApiError | null; loaded: boolean; reload: () => void; cachedAt: number | null };
const FeedCtx = createContext<Feed>({ trips: null, error: null, loaded: false, reload: () => {}, cachedAt: null });
export const useTripFeed = () => useContext(FeedCtx);

/** One shared list of the user's latest 50 trips for every tab of a mode (Home stats, Trips list, Wallet totals), refreshed every 20 s. */
export function TripFeedProvider({ role, children }: { role: 'passenger' | 'driver'; children: React.ReactNode }) {
  const { client } = useApp();
  const q = usePoll(() => client.get<{ bookings: Booking[] }>(`/bookings?role=${role}&limit=50`), 20000, [role], true, `trips:${role}`);
  const value = useMemo<Feed>(() => ({ trips: q.data?.bookings ?? null, error: q.error, loaded: q.loaded, reload: q.reload, cachedAt: q.cachedAt }), [q.data, q.error, q.loaded, q.reload, q.cachedAt]);
  return <FeedCtx.Provider value={value}>{children}</FeedCtx.Provider>;
}
