# Emergency response playbook (SOS)

> **Principle**: the app and this system *record* and *alert*. They never claim that police, an ambulance or an agent has been contacted unless a person actually did it and wrote it down.

## What happens when a user taps SOS

1. A `safety_incidents` row (`kind='sos'`) is created with booking, reporter and the best-known location (the user's last fix, or the assigned driver's last position).
2. An **urgent, sensitive** support case is opened (SLA 15 min).
3. An SMS is sent to each number in the `safety.escalation_contacts` setting (**configure these before launch**: duty phones, not shared inboxes). The response tells the user how many were attempted.
4. The user sees: *"Your SOS is recorded. No one has confirmed contact yet."* with one-tap calls to **Police 112** and **Ambulance 912** (Traffic Police 113). Confirm current numbers with the authorities before launch.

## Responder checklist (support lead on duty)

| Step | Action | Target |
|---|---|---|
| 1 | Admin -> Safety: open the incident, **Acknowledge** (stops it being "unseen") | <= 5 min |
| 2 | Open the booking: who, where, which vehicle (plate), last driver position (Live map) | |
| 3 | **Call the user** from the duty phone. No answer -> call the driver. Still nothing -> step 5 | <= 5 min |
| 4 | If danger is confirmed or cannot be ruled out: **call 112 yourself**, give plate, last location, trip details. Record who you spoke to and the time in the case note | |
| 5 | Dispatcher: do not cancel the trip on the user's behalf unless asked; keep the live map open | |
| 6 | After: **Resolve** the incident with what *actually* happened (who was contacted, outcome). Suspend the driver pending investigation if warranted; add a safety block; preserve evidence (booking events, location trail - it is kept for `retention.location_days`; export before it expires if needed) | |
| 7 | Review within 48 h; update this playbook | |

## Drills

Run a monthly test SOS from a staff phone and measure time-to-acknowledge and time-to-first-call.

## Limits to be aware of

* SOS needs data connectivity. Remind users to also call 112 directly.
* Location may be missing/stale if GPS was off; the record says so (`location_recorded:false`).
* SMS to duty phones is best effort; a failed SMS is visible in `notifications` (`status='failed'`). Staff must also watch the Safety tab.
