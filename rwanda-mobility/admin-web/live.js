'use strict';
// Live signals for staff who keep the console open: the console asks GET /admin/pulse every 15 s. A new safety incident (SOS) rings a repeating alarm
// until it is looked at; new support cases, staff alerts, waiting drivers and requests with no driver give a short ping. The tab title shows the count,
// and the menu shows a number beside Safety, Support, Drivers and Alerts. Browsers only allow sound after a click, so staff turn it on once (remembered).
// Sounds are generated here with the Web Audio API (no audio files).
const LIVE = { prev: null, timer: null, ctx: null, alarm: null, blink: null, base: document.title, counts: {} };
const SOUND_KEY = 'rm_sound';
const soundOn = () => pref.get(SOUND_KEY) === '1';
function tone(freq, start, dur, vol = 0.25) {
  const c = LIVE.ctx; if (!c) return; const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.value = freq; o.connect(g); g.connect(c.destination);
  const t = c.currentTime + start; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.start(t); o.stop(t + dur + 0.05);
}
function ensureAudio() { try { LIVE.ctx = LIVE.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (LIVE.ctx.state === 'suspended') LIVE.ctx.resume(); return true; } catch { return false; } }
function ping() { if (soundOn() && ensureAudio()) { tone(880, 0, 0.18); tone(1320, 0.2, 0.28); } }
function stopAlarm() { if (LIVE.alarm) { clearInterval(LIVE.alarm); LIVE.alarm = null; } }
function startAlarm() {
  if (!soundOn() || !ensureAudio() || LIVE.alarm) return; let n = 0;
  const beat = () => { tone(988, 0, 0.22, 0.35); tone(740, 0.25, 0.22, 0.35); tone(988, 0.5, 0.22, 0.35); tone(740, 0.75, 0.22, 0.35); if (++n >= 12) stopAlarm(); };   // about 15 s, or until the staff member looks at it
  beat(); LIVE.alarm = setInterval(beat, 1300);
}
function setBadge(tab, n) {
  const b = document.querySelector(`#sidenav button[data-tab="${tab}"]`); if (!b) return; let el = b.querySelector('.nb');
  if (!n) { el?.remove(); return; } if (!el) { el = document.createElement('span'); el.className = 'nb'; b.append(el); } el.textContent = n > 99 ? '99+' : String(n);
}
function titleFor(total, sos) {
  clearInterval(LIVE.blink); LIVE.blink = null;
  if (!total) { document.title = LIVE.base; return; }
  const a = `(${total}) ${LIVE.base}`, b = sos ? `⚠ SOS · ${LIVE.base}` : a; let on = false;
  document.title = b; if (sos) LIVE.blink = setInterval(() => { on = !on; document.title = on ? a : b; }, 1000);
}
async function pulse() {
  if (!S.access) return;
  let p; try { p = await api('GET', '/admin/pulse'); } catch { return; }
  const c = { sos: p.sos?.open ?? 0, support: p.support?.open ?? 0, drivers: p.drivers_waiting ?? 0, alerts: p.alerts?.open ?? 0, nodriver: p.no_driver_recent ?? 0 };
  const stamp = { sos: p.sos?.newest_at, support: p.support?.newest_at, alerts: p.alerts?.newest_at };
  const prev = LIVE.prev; LIVE.prev = { c, stamp }; LIVE.counts = c;
  setBadge('safety', c.sos); setBadge('support', c.support); setBadge('drivers', c.drivers); setBadge('alerts', c.alerts);
  titleFor(c.sos + c.alerts + c.nodriver, c.sos > 0);
  if (!prev) return;                                    // first look only sets the baseline: no sound for what was already waiting
  const fresh = (k) => c[k] > prev.c[k] || (stamp[k] && stamp[k] !== prev.stamp[k] && c[k] > 0 && new Date(stamp[k]) > new Date(prev.stamp[k] || 0));
  if (fresh('sos')) { startAlarm(); toast(tr('New safety incident (SOS)'), true); }
  else if (fresh('support') || fresh('alerts') || c.nodriver > prev.c.nodriver || c.drivers > prev.c.drivers) { ping(); if (fresh('support')) toast(tr('New support cases')); if (fresh('alerts')) toast(tr('New staff alert')); }
  if (!c.sos) stopAlarm();
}
function startLive() { if (LIVE.timer) return; LIVE.base = document.title.replace(/^\(\d+\) /, ''); void pulse(); LIVE.timer = setInterval(pulse, 15000); document.addEventListener('visibilitychange', () => { if (!document.hidden) void pulse(); }); }
function stopLive() { clearInterval(LIVE.timer); LIVE.timer = null; LIVE.prev = null; stopAlarm(); titleFor(0, false); }
// Looking at the safety page, or any click on the page, silences the alarm (the incident stays open until someone handles it).
document.addEventListener('click', () => stopAlarm(), true);
const soundToggle = () => {
  const b = h('button', { class: 'iconbtn', title: 'Sound alerts', 'aria-pressed': String(soundOn()), 'aria-label': 'Sound alerts', onclick: () => { const on = !soundOn(); pref.set(SOUND_KEY, on ? '1' : '0'); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '🔔' : '🔕'; if (on) { ensureAudio(); ping(); toast(tr('Sound alerts on')); } } }, soundOn() ? '🔔' : '🔕');
  return b;
};

// Phone layout: every table cell gets its column heading as data-label, so on a narrow screen each row can be shown as a card (style.css).
function labelCells() {
  document.querySelectorAll('#view table').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim()); if (!heads.length) return;
    t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (td.tagName === 'TD' && heads[i] && td.dataset.label !== heads[i]) td.dataset.label = heads[i]; }));
  });
}
let labelTimer = null;
new MutationObserver(() => { clearTimeout(labelTimer); labelTimer = setTimeout(labelCells, 80); }).observe(document.documentElement, { childList: true, subtree: true });
