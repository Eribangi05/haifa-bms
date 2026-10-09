// Driver categories, application progress and per-service statistics. Pure and platform-free: unit-tested in tests/driverKind.test.ts.
//  own      = has a registered vehicle of their own (takes ride jobs; may also take Abasare jobs once approved for Abasare)
//  abasare  = no vehicle: drives customers' own cars (Abasare)
//  both     = owner-driver who is also an Abasare driver
//  new      = has not chosen a path yet

export type KindInput = { vehicle?: unknown | null; abasare?: { status?: string } | null };
export type DriverKind = 'new' | 'own' | 'abasare' | 'both';
export function driverKind(s: KindInput | null | undefined): DriverKind {
  const car = !!s?.vehicle; const ab = !!s?.abasare && s.abasare.status !== undefined && s.abasare.status !== 'none';
  return car && ab ? 'both' : car ? 'own' : ab ? 'abasare' : 'new';
}
/** Which job types this driver may receive right now (approved paths only). */
export function jobTypes(o: { ridePermitted: boolean; abasarePermitted: boolean }): ('ride' | 'abasare')[] {
  return [...(o.ridePermitted ? (['ride'] as const) : []), ...(o.abasarePermitted ? (['abasare'] as const) : [])];
}

export type StepState = 'done' | 'current' | 'todo';
export type Step = { key: 'path' | 'details' | 'documents' | 'review' | 'approved'; state: StepState };
/**
 * Five-step application progress. `profileStatus` is the driver profile status; `chosen` = a path (own vehicle / Abasare) has been picked on screen;
 * `saved` = its details are saved (a vehicle or an Abasare application exists); `docsOk` = every mandatory document has been uploaded.
 * Rejected / info-required send the driver back to Documents.
 */
export function applicationSteps(o: { profileStatus: string; chosen: boolean; saved: boolean; docsOk: boolean }): Step[] {
  const approved = o.profileStatus === 'APPROVED';
  const inReview = ['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'].includes(o.profileStatus);
  const back = ['INFO_REQUIRED', 'REJECTED'].includes(o.profileStatus);
  const at = approved ? 5 : inReview ? 3 : !o.chosen && !o.saved ? 0 : !o.saved ? 1 : !o.docsOk || back ? 2 : 3;
  const keys: Step['key'][] = ['path', 'details', 'documents', 'review', 'approved'];
  return keys.map((key, i) => ({ key, state: i < at ? 'done' : i === at ? 'current' : 'todo' }));
}

type JobLike = { status: string; final_fare: number | null; estimated_fare?: number | null; estimated_driver_net?: number | null; abasare?: unknown | null; service_id?: string };
const done = (s: string) => s === 'COMPLETED' || s === 'PAYMENT_PENDING' || s === 'PAYMENT_COMPLETED' || s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED';
export const jobKind = (b: JobLike): 'ride' | 'abasare' => (b.abasare || String(b.service_id ?? '').startsWith('abasare') ? 'abasare' : 'ride');
export type Part = { trips: number; fares: number; net: number };
/** Finished jobs split by service: ride vs Abasare. */
export function splitByService(list: JobLike[]): { ride: Part; abasare: Part } {
  const o = { ride: { trips: 0, fares: 0, net: 0 }, abasare: { trips: 0, fares: 0, net: 0 } };
  for (const b of list) if (done(b.status)) { const p = o[jobKind(b)]; p.trips++; p.fares += Math.max(0, Math.round(b.final_fare ?? 0)); p.net += Math.max(0, Math.round(b.estimated_driver_net ?? 0)); }
  return o;
}
