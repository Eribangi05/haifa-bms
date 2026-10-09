// Round 3 pure logic (credit, loyalty, deposit, claims). Platform-free and unit-tested in tests/money3.test.ts.
import type { Tone } from './trip';

export type WalletView = { currency?: string; available: number; reserved: number; next_expiry: string | null; expiring_within_30_days: number; note?: string };
export type WalletEntry = { id: number; kind: string; source: string | null; available_delta: number; held_delta: number; available_after: number; held_after: number; booking_id?: string | null; memo?: string | null; created_at: string };
export type LoyaltyTier = { tier: string; min_points: number; bonus_pct: number; extra_free_cancel_s: number };
export type LoyaltyView = {
  enabled: boolean; points: number; lifetime_points: number; tier: string; credit_value_rwf: number; next_tier: { tier: string; points_needed: number } | null;
  earn: { rwf_per_point: number; bonus_pct: number }; redeem: { rwf_per_100_points: number; min_points: number; step: number }; tiers: LoyaltyTier[];
  events: { kind: string; points: number; booking_id?: string | null; memo?: string | null; created_at: string }[];
};
export type DepositView = {
  required: boolean; status: string; percent: number; amount: number; held: number; applied: number; refunded: number; retained: number;
  pay_by: string | null; paid_at: string | null; paid_with: string | null; last_attempt: { method: string; status: string; failure_reason?: string | null } | null;
};
export type BookingWallet = { mode: 'full' | 'partial'; reserved: number; applied: number };

// ------------------------------------------------------------------ paying with credit
export type CreditSplit = { mode: 'none' | 'full' | 'partial'; credit: number; remainder: number };
/** How a fare divides between customer credit and the other method. `custom` = a chosen credit amount (clamped to what is free and to the fare). */
export function splitCredit(fare: number | null | undefined, available: number, use: boolean, custom?: number | null): CreditSplit {
  const f = Math.max(0, Math.round(fare ?? 0)); const av = Math.max(0, Math.floor(available));
  if (!use || f <= 0 || av <= 0) return { mode: 'none', credit: 0, remainder: f };
  const cap = Math.min(av, f);
  const credit = custom == null || !Number.isFinite(custom) ? cap : Math.max(0, Math.min(cap, Math.floor(custom)));
  if (credit <= 0) return { mode: 'none', credit: 0, remainder: f };
  return credit >= f ? { mode: 'full', credit: f, remainder: 0 } : { mode: 'partial', credit, remainder: f - credit };
}
/** Booking fields for the chosen split. The server decides; the client never marks anything paid. */
export function creditBookingFields(s: CreditSplit, method: string): Record<string, unknown> {
  if (s.mode === 'full') return { payment_method: 'wallet' };
  if (s.mode === 'partial') return { payment_method: 'wallet_partial', wallet_amount: s.credit, remainder_method: method === 'mtn_momo' ? 'mtn_momo' : 'cash' };
  return { payment_method: method };
}
/** Receipt breakdown from the booking view only: fare, credit applied, deposit applied, and what was collected by the other method. */
export function receiptParts(b: { final_fare: number | null; wallet?: BookingWallet | null; deposit?: Pick<DepositView, 'applied' | 'refunded'> | null; payment?: { amount?: number; method?: string } | null }) {
  const total = Math.max(0, Math.round(b.final_fare ?? 0));
  const credit = Math.max(0, Math.round(b.wallet?.applied ?? 0)); const deposit = Math.max(0, Math.round(b.deposit?.applied ?? 0));
  const other = Math.max(0, total - credit - deposit);
  return { total, credit, deposit, other, refundedCredit: Math.max(0, Math.round(b.deposit?.refunded ?? 0)), method: b.payment?.method ?? null, hasExtra: credit > 0 || deposit > 0 };
}

// ------------------------------------------------------------------ loyalty
/** Points the customer may redeem now: from `min` up to `points` in `step`s (capped list for the chooser). */
export function redeemChoices(points: number, min: number, step: number, max = 6): number[] {
  const st = Math.max(1, step); const lo = Math.max(min, st); const top = Math.floor(points / st) * st;
  if (top < lo) return [];
  const all: number[] = []; for (let p = Math.ceil(lo / st) * st; p <= top; p += st) all.push(p);
  if (all.length <= max) return all;
  const out = new Set<number>([all[0], all[all.length - 1]]);
  for (let i = 1; out.size < max; i++) out.add(all[Math.round((i * (all.length - 1)) / (max - 1))]);
  return [...out].sort((a, b) => a - b);
}
export const validRedeem = (p: number, min: number, step: number, have: number) => Number.isInteger(p) && p >= Math.max(min, step) && p % step === 0 && p <= have;
export const creditForPoints = (p: number, rwfPer100: number) => Math.floor((p / 100) * rwfPer100);
/** Progress 0..1 inside the current tier band (1 at the top tier), by lifetime points. */
export function tierProgress(lifetime: number, tiers: LoyaltyTier[], tier: string): { ratio: number; next: LoyaltyTier | null; needed: number } {
  const sorted = [...tiers].sort((a, b) => a.min_points - b.min_points); const i = Math.max(0, sorted.findIndex((x) => x.tier === tier));
  const cur = sorted[i]; const next = sorted[i + 1] ?? null;
  if (!cur || !next) return { ratio: 1, next: null, needed: 0 };
  const span = Math.max(1, next.min_points - cur.min_points);
  return { ratio: Math.min(1, Math.max(0, (lifetime - cur.min_points) / span)), next, needed: Math.max(0, next.min_points - lifetime) };
}
export const TIER_GLYPH: Record<string, string> = { bronze: '🥉', silver: '🥈', gold: '🥇' };

// ------------------------------------------------------------------ statement
/** Translation key suffix + icon for one statement line (never shows the English staff memo). */
export function entryInfo(e: Pick<WalletEntry, 'kind' | 'source'>): { key: string; glyph: string } {
  if (e.kind === 'credit') {
    const m: Record<string, [string, string]> = { refund: ['refund', '↩️'], deposit_refund: ['refund', '↩️'], promo: ['promo', '🎁'], quest: ['promo', '🎁'], referral: ['referral', '🤝'], claim: ['claim', '🛡️'], loyalty: ['loyalty', '⭐'], adjustment: ['adjustment', '🧾'], goodwill: ['adjustment', '🧾'] };
    const [key, glyph] = m[e.source ?? ''] ?? ['adjustment', '🧾']; return { key, glyph };
  }
  if (e.kind === 'debit') return { key: 'adjustment', glyph: '🧾' };
  if (e.kind === 'hold') return { key: 'hold', glyph: '🔒' };
  if (e.kind === 'release') return { key: 'release', glyph: '🔓' };
  if (e.kind === 'spend') return { key: e.source === 'deposit' ? 'deposit' : 'spend', glyph: e.source === 'deposit' ? '🔐' : '🚗' };
  if (e.kind === 'expire') return { key: 'expire', glyph: '⌛' };
  return { key: 'adjustment', glyph: '🧾' };
}
/** The amount shown on a statement line: spendable change when there is one, otherwise the reserved change. */
export const entryAmount = (e: Pick<WalletEntry, 'available_delta' | 'held_delta' | 'kind'>) => (e.kind === 'spend' && e.available_delta === 0 ? e.held_delta : e.available_delta !== 0 ? e.available_delta : e.held_delta);
/** hold/release only move credit between "free" and "reserved": they do not change the total, so they are shown neutrally. */
export const entryIsMove = (e: Pick<WalletEntry, 'kind'>) => e.kind === 'hold' || e.kind === 'release';
export const signedRwf = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

// ------------------------------------------------------------------ deposit
export type DepositUi = 'none' | 'ask' | 'pending' | 'failed' | 'paid' | 'applied' | 'refunded' | 'closed';
/** Deposit state for the UI, from server data only. `ask` = needs paying now (new or failed). */
export function depositUi(d: Pick<DepositView, 'required' | 'status'> | null | undefined): DepositUi {
  if (!d || !d.required) return 'none';
  switch (d.status) {
    case 'awaiting_payment': return 'ask'; case 'pending': return 'pending'; case 'failed': return 'failed';
    case 'paid': case 'captured': return 'paid'; case 'applied': return 'applied'; case 'refunded': case 'cancelled': return 'refunded';
    default: return 'closed';
  }
}
export const depositNeedsPayment = (d: DepositView | null | undefined) => { const u = depositUi(d); return u === 'ask' || u === 'pending' || u === 'failed'; };
/** Minutes left to pay (null when no deadline or already past). */
export function depositMinutesLeft(payBy: string | null | undefined, now = Date.now()): number | null {
  if (!payBy) return null; const ms = new Date(payBy).getTime() - now; return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

// ------------------------------------------------------------------ claims
export const CLAIM_TYPES = ['damage', 'loss', 'injury', 'other'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export const CLAIM_OPEN = ['submitted', 'under_review', 'info_requested'] as const;
export const claimIsOpen = (s: string) => (CLAIM_OPEN as readonly string[]).includes(s);
export const claimTone = (s: string): Tone => (s === 'rejected' || s === 'withdrawn' ? 'bad' : s === 'accepted' || s === 'partially_accepted' || s === 'settled' || s === 'closed' ? 'ok' : 'warn');
export const claimGlyph = (s: string) => ({ submitted: '📨', under_review: '🔎', info_requested: '❓', accepted: '✅', partially_accepted: '◑', rejected: '✕', settled: '💰', closed: '📁', withdrawn: '↩️' } as Record<string, string>)[s] ?? '•';
/** Withdraw is for the claimant before a decision. */
export const claimCanWithdraw = (c: { status: string; you_are: string }) => c.you_are === 'claimant' && claimIsOpen(c.status);
/** Reply box: the respondent while the claim is open. Info box: the claimant when staff asked for more. */
export const claimCanReply = (c: { status: string; you_are: string }) => c.you_are === 'respondent' && claimIsOpen(c.status);
export const claimCanAddInfo = (c: { status: string; you_are: string }) => c.you_are === 'claimant' && c.status === 'info_requested';
export const claimCanAddEvidence = (c: { status: string; you_are: string }) => c.you_are === 'claimant' && claimIsOpen(c.status);
/** "Hours left" text parts for a due date: {late} when past, else whole hours (min 1) or days. */
export function dueIn(iso: string | null | undefined, now = Date.now()): { late: boolean; hours: number; days: number } | null {
  if (!iso) return null; const ms = new Date(iso).getTime() - now; const h = Math.ceil(Math.abs(ms) / 3600000);
  return { late: ms < 0, hours: Math.max(1, h), days: Math.max(1, Math.round(h / 24)) };
}
export const claimFormValid = (description: string, amount: string) => description.trim().length >= 10 && description.trim().length <= 2000 && /^\d{1,9}$/.test(amount.trim()) && Number(amount) > 0;
/** Route a push/notification payload to claims screens (`template_key` claim_*, optional `claim_id`). */
export function claimRoute(data: any): { name: string; params?: any } | null {
  if (!data || typeof data !== 'object') return null;
  const key = typeof data.template_key === 'string' ? data.template_key : typeof data.type === 'string' ? data.type : '';
  if (typeof data.claim_id === 'string') return { name: 'claimDetail', params: { id: data.claim_id } };
  if (key.startsWith('claim_')) return { name: 'claims', params: typeof data.ref === 'string' ? { ref: data.ref } : undefined };
  return null;
}
