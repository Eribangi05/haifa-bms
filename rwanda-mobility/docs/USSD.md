# USSD booking gateway

Riders without a smartphone book, check and cancel a ride by dialling a shortcode. The gateway is built and tested against a local simulator; **the telecom side (shortcode, aggregator contract, live traffic) is PENDING** and nothing here has been run on a real network.

## What the telecom or aggregator must configure

| Item | Value |
|---|---|
| Shortcode | A USSD shortcode (for example `*123#`) allocated by the regulator and the MNO. Which code is a business decision; the backend does not depend on it. |
| Callback URL | `POST https://<api-host>/ussd/callback` (public, outside `/api/v1`) |
| Authentication | A shared secret of at least 16 characters, sent as header `x-ussd-secret: <secret>` or as query `?secret=<secret>` (use the header when the aggregator can set one, because query strings reach access logs; the API log redacts `secret` but the aggregator's own logs may not). Set the same value in the API environment as `USSD_SHARED_SECRET`. With no secret, or one shorter than 16 characters, the endpoint answers 503 and serves nobody. |
| IP allow-list (optional) | `USSD_ALLOWED_IPS=203.0.113.10,198.51.100.0/24` (exact addresses or IPv4 CIDR). Behind a load balancer set `TRUST_PROXY` correctly so the API sees the aggregator's address. |
| Rate limits | Per source IP `USSD_RATE_MAX` (default 600 per minute) and per phone number `USSD_PHONE_RATE_MAX` (default 40 screens per minute). |
| Session timeout | The network closes a dialogue after its own idle time (usually 30 to 120 s). The API keeps its own `ussd.session_ttl_s` (default 120 s, editable in Settings, group USSD). A late answer restarts the dialogue from the menu and is not applied to the old screen. |
| Phone number | The number sent by the network is treated as verified. First use creates a passenger account only after the person accepts the terms on screen. |
| SMS | Trip updates for USSD bookings go out as SMS through the normal SMS provider (`SMS_PROVIDER`, see `ENVIRONMENT_VARIABLES.md`). The sender id and delivery contract with the SMS aggregator are PENDING. |

## Message limits

* Every screen the API produces is **160 characters or fewer** (tests check this for every screen and language). List screens drop entries from the bottom rather than cut a sentence.
* A screen is plain text with `\n` line breaks. No emoji or characters outside Latin-1 plus the accents used in French and Kinyarwanda.
* Africa's Talking style replies start with `CON ` (the dialogue continues) or `END ` (final message). Some networks cap a final message lower than 160; confirm with the aggregator.
* One language per screen. The only trilingual screen is the first language picker, because the language is not known yet. The language is remembered per phone number and also stored on the account.

## Request formats

### 1. Africa's Talking style (default)

`POST /ussd/callback`, `Content-Type: application/x-www-form-urlencoded`

| Field | Meaning |
|---|---|
| `sessionId` | Dialogue id, unique per dialogue |
| `serviceCode` | The shortcode that was dialled (recorded only) |
| `phoneNumber` | MSISDN, `+2507...` (also accepted: `07...`, `2507...`) |
| `text` | All inputs so far joined by `*` (empty on the first request). The API acts on the last segment. |

Reply: `200`, `text/plain`, body `CON <screen>` or `END <screen>`.

Retries: if the aggregator repeats a request with exactly the same `text` for the same `sessionId`, the API returns the same reply and does not advance the dialogue (no second booking).

### 2. Generic JSON mode

`POST /ussd/callback`, `Content-Type: application/json`

```json
{ "session_id": "abc123", "phone": "+250788123456", "input": "1", "service_code": "*123#", "new_session": false, "provider": "acme" }
```

`input` is the latest key presses only (omit or `null` on the first request, or send `"new_session": true`). `text` (cumulative, `*` joined) is also accepted and enables the retry protection above.

Reply: `{ "message": "...", "end": false, "continue_session": true }`.

Errors for both modes: `401 unauthorized` (wrong secret), `403 forbidden` (IP not allowed), `503 ussd_not_configured`, `400 validation_error` (body not recognised).

## The menu

Language first (once per phone), terms on first use, then:

```
Abasare
1 Request a ride
2 My trip
3 Abasare (my car)
4 Help
0 Language
```

* **1 Request a ride.** Numbered pickup (saved places first, then popular landmarks), numbered destination, fares of the available services (cash), confirm. Creates a booking with `channel = 'ussd'` and `payment_method = 'cash'`. An SMS follows. If the rider already has an open trip they are told so.
* **2 My trip.** Status. With a driver: name, plate and the trip PIN. Option 1 cancels (with confirmation); the normal free-cancel window and fee rules apply and the fee is stated.
* **3 Abasare.** Only for riders who registered a car in the app (insurance confirmed there). Choose car, pickup, hours (2, 3, 4 or 6), confirm that the car is theirs and insured. Cash. If `abasare.deposit_percent` is above 0, a mobile-money prompt for the deposit is sent to the same phone (SIMULATED until MoMo credentials exist); if that fails the rider is told to pay it in the app, and the booking stays undispatched until it is paid.
* **4 Help.** Police 112, Ambulance 912 (the same numbers as the in-app SOS text). Confirm any further national numbers with the client before adding them.
* **0 Language.** Kinyarwanda, French or English; remembered.

Invalid input shows "Invalid choice." (in the user's language) and the same screen again. Starting over after the session expired shows the menu. Restricted accounts get a refusal message.

## SMS templates for USSD bookings

`booking_confirmed_ussd`, `driver_assigned_ussd`, `driver_arrived_ussd`, `trip_completed_ussd` replace the app templates for bookings made over USSD and are always sent as SMS (the app versions tell the rider to look in the app). Each exists in rw, fr and en and is under 160 characters. Staff can override them under Settings, Templates.

## Operating it

* Staff with `ussd.view` see the session log (phones masked) and channel statistics in the admin console, tab **USSD channel**, and via `GET /admin/ussd/sessions` and `GET /admin/ussd/stats?days=30`.
* Sessions are deleted after 30 days by the retention job.
* Settings: `ussd.enabled` (kill switch), `ussd.session_ttl_s`.
* Local testing: start the API with `USSD_SHARED_SECRET=...`, then

  ```
  USSD_SHARED_SECRET=... npx tsx scripts/ussd-sim.ts --phone +250788123456 --url http://localhost:8080/ussd/callback
  ```

  Add `--mode json` for the generic JSON mode. The simulator prints each screen with its length.

## Not done / assumptions

* No real shortcode, aggregator or MNO test has been done. Africa's Talking field names are taken from their public documentation; check them against the contract of the aggregator actually chosen.
* Rides over USSD are cash only by design (no mobile-money push for fares); only the Abasare deposit may trigger a MoMo prompt.
* The place lists are the first five saved or popular places; there is no free-text search over USSD.
* A rider cannot rate, tip, share a trip or change the destination over USSD.
