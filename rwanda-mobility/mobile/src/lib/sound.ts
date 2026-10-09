import { Platform, Vibration } from 'react-native';
import { setAudioModeAsync, createAudioPlayer } from 'expo-audio';

/**
 * Alert sounds. A new trip request must be heard at once, so it plays a loud, distinctive chime that REPEATS (with vibration) until the driver answers,
 * the request expires or the app leaves the screen. Chat messages and "your driver arrived" use a short ping. Sounds can be switched off in Settings.
 * Every call is recorded in globalThis.__abasareSounds so browser tests can check that the app asked for a sound (a browser test cannot hear it).
 */
const OFFER = require('../../assets/sounds/offer.wav');
const PING = require('../../assets/sounds/ping.wav');
type Player = { play: () => void; pause: () => void; seekTo: (s: number) => Promise<void> | void; remove: () => void; loop: boolean; volume: number };

const log = (what: string) => { try { const g = globalThis as { __abasareSounds?: { what: string; at: number }[] }; (g.__abasareSounds ??= []).push({ what, at: Date.now() }); } catch { /* ignore */ } };
let offerPlayer: Player | null = null, pingPlayer: Player | null = null, modeSet = false, offerTimer: ReturnType<typeof setTimeout> | null = null;
export const OFFER_MAX_MS = 25_000;   // never ring longer than an offer can live (offers expire after about 20 s)

async function ensureMode() {
  if (modeSet) return; modeSet = true;
  try { await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'duckOthers', shouldRouteThroughEarpiece: false }); } catch { /* web or old OS: default mode */ }
}
function player(kind: 'offer' | 'ping'): Player | null {
  try {
    if (kind === 'offer') { if (!offerPlayer) { offerPlayer = createAudioPlayer(OFFER) as unknown as Player; offerPlayer.volume = 1; } return offerPlayer; }
    if (!pingPlayer) { pingPlayer = createAudioPlayer(PING) as unknown as Player; pingPlayer.volume = 1; }
    return pingPlayer;
  } catch { return null; }
}
const vibrate = (pattern: number[], repeat: boolean) => { try { Vibration.vibrate(pattern, repeat && Platform.OS === 'android'); } catch { /* no vibrator */ } };

/** New trip request: ring until stopOffer() (or OFFER_MAX_MS). Calling it again while ringing just keeps ringing. */
export async function playOffer(opts: { sound?: boolean } = {}) {
  log('offer'); vibrate([0, 700, 350, 700, 350, 700, 900], true);
  if (opts.sound === false) return;
  await ensureMode(); const p = player('offer'); if (!p) return;
  try { p.loop = true; await p.seekTo(0); p.play(); } catch { /* audio unavailable: the vibration still alerts */ }
  if (offerTimer) clearTimeout(offerTimer); offerTimer = setTimeout(() => stopOffer(), OFFER_MAX_MS);
}
export function stopOffer() {
  if (offerTimer) { clearTimeout(offerTimer); offerTimer = null; }
  try { Vibration.cancel(); } catch { /* ignore */ }
  try { offerPlayer?.pause(); } catch { /* ignore */ }
  log('offer-stop');
}
/** Short ping: new chat message, driver arrived. */
export async function playPing() { log('ping'); vibrate([0, 200], false); await ensureMode(); const p = player('ping'); if (!p) return; try { p.loop = false; await p.seekTo(0); p.play(); } catch { /* ignore */ } }
/** "Test the sound" in Settings: one pass of the new-request chime (no repeat), so a driver can set the phone volume. */
export async function testOfferSound() { log('offer-test'); vibrate([0, 500], false); await ensureMode(); const p = player('offer'); if (!p) return; try { p.loop = false; await p.seekTo(0); p.play(); } catch { /* ignore */ } }
