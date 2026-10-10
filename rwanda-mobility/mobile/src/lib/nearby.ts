import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useApp } from './app';
import { useAppearance } from './appearance';
import { useFlag } from './flags';

/**
 * Online drivers near the rider ("cars nearby", as ride apps show): GET /drivers/nearby gives blurred positions and a count, never names or plates.
 * Polled every 10 s while the map is on screen and the app is open (every 30 s in low-data mode); switched off remotely with the flag map.nearby_drivers.
 */
export type NearbyCar = { k: number; type: 'moto' | 'car'; lat: number; lng: number };
export type NearbyState = { cars: NearbyCar[]; count: number; etaMin: number | null; loaded: boolean };
const EMPTY: NearbyState = { cars: [], count: 0, etaMin: null, loaded: false };
export const carIcon = (t: 'moto' | 'car') => (t === 'moto' ? '🏍️' : '🚗');

export function useNearbyCars(center: { lat: number; lng: number } | null, enabled: boolean): NearbyState {
  const { client } = useApp(); const { lowData } = useAppearance(); const on = useFlag('map.nearby_drivers');
  const [s, setS] = useState<NearbyState>(EMPTY); const key = center ? `${center.lat.toFixed(3)},${center.lng.toFixed(3)}` : '';
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!enabled || !on || !center) { setS(EMPTY); return () => { alive.current = false; }; }
    const load = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const r = await client.get(`/drivers/nearby?lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}`, { timeoutMs: 8000 });
        if (alive.current && !r.disabled) setS({ cars: r.cars ?? [], count: r.count ?? 0, etaMin: r.nearest_eta_min ?? null, loaded: true });
      } catch { /* offline or asleep: keep the last picture */ }
    };
    void load(); const id = setInterval(load, lowData ? 30_000 : 10_000);
    return () => { alive.current = false; clearInterval(id); };
  }, [enabled, on, key, lowData, client]); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}
