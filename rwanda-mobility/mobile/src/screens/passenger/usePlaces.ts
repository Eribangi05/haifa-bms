import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../lib/app';
import { distM } from '../../lib/format';
import { loadJson, saveJson } from '../../lib/storage';
import type { Place, Pt, SavedPlace } from '../../lib/types';

/** Popular landmarks, the user's saved places, coverage zones and recent destinations (kept on the device). Everything degrades to empty when offline. */
export function usePlaces() {
  const { client, lang } = useApp();
  const [popular, setPopular] = useState<Place[]>([]); const [saved, setSaved] = useState<SavedPlace[]>([]); const [zones, setZones] = useState<[number, number][][]>([]); const [recents, setRecents] = useState<Pt[]>([]);
  useEffect(() => { void loadJson<Pt[]>('rm_recents', []).then(setRecents); }, []);
  useEffect(() => {
    client.get(`/places/popular?lang=${lang}`).then((r) => setPopular(r.places)).catch(() => {});
    client.get('/coverage').then((r) => setZones(r.zones.map((z: { polygon: [number, number][] }) => z.polygon))).catch(() => {});
  }, [client, lang]);
  const reloadSaved = useCallback(() => { client.get('/users/me/places').then((r) => setSaved(r.places)).catch(() => {}); }, [client]);
  useEffect(() => { reloadSaved(); }, [reloadSaved]);
  const nearest = useCallback((p: Pt) => { let best: Place | null = null; let bd = 250; for (const x of popular) { const d = distM(p, x); if (d < bd) { bd = d; best = x; } } return best?.name; }, [popular]);
  const pushRecent = useCallback((p: Pt) => { setRecents((cur) => { const r = [p, ...cur.filter((x) => x.name !== p.name)].slice(0, 6); void saveJson('rm_recents', r); return r; }); }, []);
  return { popular, saved, zones, recents, nearest, pushRecent, reloadSaved };
}
