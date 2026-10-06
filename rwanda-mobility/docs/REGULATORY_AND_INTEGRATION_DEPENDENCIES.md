# Outstanding regulatory and third-party dependencies

> Software cannot make a business compliant. Everything under "Regulatory" must be confirmed with qualified Rwandan advisers and the competent authorities. Nothing here is legal advice, and nothing in this repository constitutes approval.

## Regulatory (owner: management + counsel)

| # | Topic | What to confirm before live bookings |
|---|---|---|
| R1 | Business registration & licensing | Company form, tax registration (RRA), whether a platform/ride-hailing operator licence or authorisation is required, and from which authority (transport regulator; city of Kigali for city-level rules). |
| R2 | Driver & vehicle rules | Licence categories per vehicle type (moto vs car), mandatory permits/inspections, insurance minimums, moto-taxi specific rules (helmets, passenger limits, operating zones). **Edit `document_requirements` to match** - the seeded list is an assumption. |
| R3 | Fares | Whether tariffs are regulated or must be filed/approved; whether negotiated fares or surge pricing are lawful. Seeded tariffs are **placeholders**; `pricing.negotiated` and `pricing.surge` stay **off**. |
| R4 | Data protection | Law no. 058/2021 on personal data and privacy: controller/processor registration or authorisation, lawful basis for location and ID data, cross-border storage/transfer conditions, retention periods, DPO contact, breach notification timelines, user-rights procedure. The Data Protection and Privacy Office has indicated that ride-hailing apps are in scope. |
| R5 | Taxes | VAT/other levies on platform fees and rides (`pricing_rules.tax_bps`, default 0), withholding, driver income-tax treatment, invoicing format for companies (EBM/receipts?). |
| R6 | Payments & money handling | Whether holding driver earnings (`DRIVER_PAYABLE`) and cash-commission netting require a payment-service licence or bank partnership; National Bank of Rwanda rules on e-money. **Prepaid wallets are deliberately not built.** |
| R7 | Consumer protection | Terms of service, cancellation/refund policy wording, price disclosure, complaint handling timelines. |
| R8 | Emergency response | Agree the 112/912 escalation arrangement and whether any formal integration with Rwanda National Police is available; the app claims none. |
| R9 | Insurance | Passenger/third-party/accident cover for trips on the platform; who pays on incidents. |
| R10 | Employment/contractor status | How drivers are classified; fleet-operator agreements (`revenue_share_bps`). |
| R11 | Child/vulnerable users, accessibility | Policy for minors, accessible-transport service (modelled but disabled). |

## Third-party integrations

| # | Integration | Status in this repo | To go live |
|---|---|---|---|
| I1 | **MTN MoMo Collections** | Adapter implements the official API shape (token, `requesttopay`, status, callback). Verified against an in-repo **simulator** and fake provider tests; **not yet run against MTN's sandbox** (needs your credentials). | Create a developer account at the MTN MoMo developer portal (Rwanda), subscribe to Collections, create API user/key, set `MOMO_*`, set `MOMO_MODE=sandbox` and run the end-to-end test; then apply for production access and test settlement + callbacks on a public HTTPS URL. |
| I2 | **MoMo Disbursements** (automated payouts) | **Pending integration**. Payouts are approved and released manually; ledger and states already support it. | Subscribe to Disbursements, add adapter `payout()`, behind flag `payouts.automated`. |
| I3 | **Airtel Money** | Adapter **skeleton only** (`providers/payment.ts`), flag off. | Confirm Airtel Rwanda's merchant API route and eligibility first. Not a launch blocker. |
| I4 | **SMS gateway** | Generic HTTP adapter + console simulator. | Contract a licensed Rwandan SMS aggregator; adapt request format; set sender ID; consider delivery-receipt webhooks and spend caps. |
| I5 | **Push notifications (FCM)** | Not integrated: notifications are stored in-app and critical ones go by SMS. | Create Firebase project, add `expo-notifications`, store device tokens, send from `notify()`. |
| I6 | **Maps/routing** | OSM tiles in a WebView; OSRM/Nominatim adapter; fallback estimator calibrated on 5 routes. | Choose and contract a production provider (see `MAP_PROVIDER_EVALUATION.md`); do not use public demo servers at scale. |
| I7 | **Masked calling** | Not integrated (in-app chat implemented). | Telephony provider with number masking. |
| I8 | **Identity / licence verification** | Manual document review only. | Integrate with the relevant national ID/licence verification service if access is granted. |
| I9 | **Object storage** | Local private disk. | S3-compatible bucket with server-side encryption and lifecycle rules; implement the same `saveFile/readFileByKey` interface. |
| I10 | **Google / Apple sign-in** | Not built (flag exists). | OAuth credentials per platform. |
| I11 | **WhatsApp Business** | Not built (flag exists). | Meta approval + template messages. |
| I12 | **Email provider** | Not built (email stored, unverified). | Transactional email service + verification flow. |
| I13 | **Play Store / App Store** | APK build verified locally (see `ANDROID_BUILD.md`); not published. | Developer accounts, signing keys, data-safety forms (location, camera, documents), privacy policy URL. |
