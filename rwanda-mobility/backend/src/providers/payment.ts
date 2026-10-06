import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export type ProviderStatus = { status: 'PENDING' | 'SUCCESS' | 'FAILED'; providerRef?: string; fee?: number; amount?: number; reason?: string };
export interface PaymentProvider {
  readonly name: string;
  readonly simulated: boolean;
  initiate(p: { reference: string; amount: number; msisdn: string; note: string }): Promise<{ providerRef?: string }>;
  status(reference: string): Promise<ProviderStatus>;
}

// ------------------------------------------------------------------------------------------
// MTN MoMo Collections (official API shape: https://momodeveloper.mtn.com). Needs real/sandbox credentials.
// ------------------------------------------------------------------------------------------
class MtnMomo implements PaymentProvider {
  readonly name = 'mtn_momo';
  readonly simulated = false;
  private token?: { v: string; exp: number };
  private h(extra: Record<string, string> = {}) {
    return { 'Ocp-Apim-Subscription-Key': config.momo.subscriptionKey, 'X-Target-Environment': config.momo.targetEnv, ...extra };
  }
  private async bearer(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 30_000) return this.token.v;
    const basic = Buffer.from(`${config.momo.apiUser}:${config.momo.apiKey}`).toString('base64');
    const r = await fetch(`${config.momo.baseUrl}/collection/token/`, { method: 'POST', headers: { ...this.h(), Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`momo token ${r.status}`);
    const j: any = await r.json();
    this.token = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return this.token.v;
  }
  async initiate(p: { reference: string; amount: number; msisdn: string; note: string }) {
    const body = {
      amount: String(p.amount), currency: config.momo.currency, externalId: p.reference,
      payer: { partyIdType: 'MSISDN', partyId: p.msisdn.replace('+', '') }, payerMessage: p.note, payeeNote: p.note,
    };
    const r = await fetch(`${config.momo.baseUrl}/collection/v1_0/requesttopay`, {
      method: 'POST', signal: AbortSignal.timeout(10000), body: JSON.stringify(body),
      headers: this.h({
        Authorization: `Bearer ${await this.bearer()}`, 'X-Reference-Id': p.reference, 'Content-Type': 'application/json',
        ...(config.momo.callbackUrl ? { 'X-Callback-Url': `${config.momo.callbackUrl}?token=${config.momo.callbackToken}` } : {}),
      }),
    });
    if (r.status !== 202) throw new Error(`momo requesttopay ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return { providerRef: p.reference };
  }
  async status(reference: string): Promise<ProviderStatus> {
    const r = await fetch(`${config.momo.baseUrl}/collection/v1_0/requesttopay/${reference}`, {
      headers: this.h({ Authorization: `Bearer ${await this.bearer()}` }), signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`momo status ${r.status}`);
    const j: any = await r.json();
    const s = j.status === 'SUCCESSFUL' ? 'SUCCESS' : j.status === 'FAILED' || j.status === 'REJECTED' || j.status === 'TIMEOUT' ? 'FAILED' : 'PENDING';
    return { status: s, providerRef: j.financialTransactionId, amount: j.amount != null ? Number(j.amount) : undefined, reason: j.reason?.message ?? j.reason };
  }
}

// ------------------------------------------------------------------------------------------
// SIMULATOR: in-process stand-in used when MOMO_MODE=simulator. Labelled SIMULATED everywhere it surfaces.
// msisdn ending 0000 -> FAILED, 9999 -> stays PENDING until settled manually, anything else -> SUCCESS on first poll.
// ------------------------------------------------------------------------------------------
export const simulatorState = new Map<string, { amount: number; msisdn: string; status: ProviderStatus['status']; reason?: string; fin: string }>();
class MomoSimulator implements PaymentProvider {
  readonly name = 'mtn_momo';
  readonly simulated = true;
  async initiate(p: { reference: string; amount: number; msisdn: string }) {
    const status = p.msisdn.endsWith('0000') ? 'FAILED' : p.msisdn.endsWith('9999') ? 'PENDING' : 'SUCCESS';
    simulatorState.set(p.reference, { amount: p.amount, msisdn: p.msisdn, status, reason: status === 'FAILED' ? 'PAYER_REJECTED' : undefined, fin: String(Date.now()) });
    return { providerRef: p.reference };
  }
  async status(reference: string): Promise<ProviderStatus> {
    const s = simulatorState.get(reference);
    if (!s) return { status: 'FAILED', reason: 'NOT_FOUND' };
    return { status: s.status, providerRef: s.fin, amount: s.amount, reason: s.reason };
  }
}

/** Airtel Money: adapter skeleton only. PENDING INTEGRATION: confirm merchant eligibility and API access with Airtel Rwanda first. */
class AirtelStub implements PaymentProvider {
  readonly name = 'airtel_money';
  readonly simulated = false;
  async initiate(): Promise<{ providerRef?: string }> { throw new Error('Airtel Money integration is not configured (PENDING INTEGRATION)'); }
  async status(): Promise<ProviderStatus> { throw new Error('Airtel Money integration is not configured (PENDING INTEGRATION)'); }
}

let override: PaymentProvider | null = null;
export const setMomoProvider = (p: PaymentProvider | null) => { override = p; };
export function providerFor(method: string): PaymentProvider {
  if (method === 'mtn_momo') return override ?? (config.momo.mode === 'simulator' ? new MomoSimulator() : new MtnMomo());
  if (method === 'airtel_money') return new AirtelStub();
  throw new Error(`no provider for ${method}`);
}
export const newReference = () => randomUUID();   // MTN requires a UUID X-Reference-Id; we reuse it as our payment reference
