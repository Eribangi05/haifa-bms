# Entity-relationship overview

> **Generated** from the migrated PostgreSQL schema by `docs/tools/gen-erd.mjs` (66 tables, 106 foreign keys, migrations 001 to 008). Do not edit by hand: change a migration, run it, then regenerate:
> `DATABASE_URL=postgres://rm:rm@localhost:5432/rwanda_mobility node docs/tools/gen-erd.mjs`

Full DDL with checks, partial unique indexes and triggers lives in [`backend/migrations/`](../backend/migrations). One diagram per module showing each table's columns and its outgoing foreign keys; a table from another module appears as a bare box where a key crosses modules. Columns are marked `PK` / `FK`. The table index lists how many columns are nullable.

## Migrations

| # | File | What it adds |
|---|---|---|
| 001 | `001_init.sql` | Core schema: identity, catalogue, pricing, drivers, bookings, payments, ledger, support, safety, audit |
| 002 | `002_abasare.sql` | Abasare: customer cars, handovers and photos, hourly/night pricing columns, driver Abasare application fields |
| 003 | `003_french.sql` | French names and descriptions for services and places |
| 004 | `004_push_cancelfee.sql` | Push tokens and tickets, client error reports, passenger cancellation-fee debts |
| 005 | `005_staff_invites.sql` | Staff invitations (single-use link, own password and authenticator) |
| 006 | `006_request_codes.sql` | Request codes (venue QR codes) and `bookings.request_code_id` |
| 007 | `007_pricing_flex.sql` | Pricing time windows (`pricing_rules.time_multipliers`), promotion audiences (`segment`, `segment_phones`) |
| 008 | `008_audit_hardening.sql` | Audit follow-ups: indexes on hot paths, case-insensitive unique e-mail |

## Identity and privacy

```mermaid
erDiagram
  users ||--o{ consents : "user_id"
  users |o--o{ privacy_requests : "handled_by"
  users ||--o{ privacy_requests : "user_id"
  notifications |o--o{ push_tickets : "notification_id"
  push_tokens |o--o{ push_tickets : "token_id"
  users ||--o{ push_tokens : "user_id"
  roles ||--o{ role_permissions : "role"
  users ||--o{ sessions : "user_id"
  users |o--o{ staff_invites : "invited_by"
  users ||--o{ user_roles : "user_id"
  users {
    uuid id PK
    text phone
    text email
    text password_hash
    text display_name
    text photo_key
    text preferred_language
    text status
    text mfa_secret_enc
    boolean mfa_enabled
    text referral_code
    jsonb notif_prefs
    integer risk_score
    text device_fingerprint
    integer failed_logins
    timestamptz locked_until
    timestamptz created_at
    timestamptz updated_at
  }
  user_roles {
    uuid user_id PK
    text role PK
  }
  roles {
    text name PK
    text description
  }
  role_permissions {
    text role PK
    text permission PK
  }
  otp_challenges {
    uuid id PK
    text phone
    text code_hash
    text purpose
    timestamptz expires_at
    integer attempts
    timestamptz consumed_at
    text ip
    text device_id
    timestamptz created_at
  }
  sessions {
    uuid id PK
    uuid user_id FK
    text refresh_hash
    text device_id
    text device_name
    text ip
    boolean privileged
    timestamptz expires_at
    timestamptz revoked_at
    timestamptz created_at
    timestamptz last_used_at
  }
  consents {
    bigint id PK
    uuid user_id FK
    text kind
    text version
    boolean granted
    timestamptz created_at
  }
  privacy_requests {
    uuid id PK
    uuid user_id FK
    text kind
    text status
    timestamptz due_at
    text notes
    uuid handled_by FK
    timestamptz created_at
    timestamptz resolved_at
  }
  staff_invites {
    uuid id PK
    text email
    text display_name
    text role
    text token_hash
    text pending_mfa_enc
    uuid invited_by FK
    timestamptz expires_at
    timestamptz used_at
    timestamptz revoked_at
    timestamptz created_at
  }
  push_tokens {
    uuid id PK
    uuid user_id FK
    text token
    text platform
    text device_id
    timestamptz created_at
    timestamptz last_seen_at
    timestamptz revoked_at
  }
  push_tickets {
    text ticket_id PK
    uuid token_id FK
    uuid notification_id FK
    timestamptz created_at
    timestamptz checked_at
  }
```

## Rider

```mermaid
erDiagram
  users ||--o{ emergency_contacts : "user_id"
  users ||--o{ saved_places : "user_id"
  saved_places {
    uuid id PK
    uuid user_id FK
    text label
    text name
    float8 lat
    float8 lng
    text note
    timestamptz created_at
  }
  emergency_contacts {
    uuid id PK
    uuid user_id FK
    text name
    text phone
    timestamptz created_at
  }
```

## Catalogue and pricing

```mermaid
erDiagram
  users |o--o{ commission_rules : "approved_by"
  users |o--o{ commission_rules : "created_by"
  service_categories |o--o{ commission_rules : "service_id"
  users ||--o{ fare_quotes : "passenger_id"
  pricing_rules ||--o{ fare_quotes : "rule_id"
  service_categories ||--o{ fare_quotes : "service_id"
  service_zones ||--o{ fare_quotes : "zone_id"
  service_zones |o--o{ places : "zone_id"
  users |o--o{ pricing_rules : "approved_by"
  users |o--o{ pricing_rules : "created_by"
  service_categories ||--o{ pricing_rules : "service_id"
  service_zones |o--o{ pricing_rules : "zone_id"
  bookings ||--o{ promotion_redemptions : "booking_id"
  promotions ||--o{ promotion_redemptions : "promotion_id"
  users ||--o{ promotion_redemptions : "user_id"
  users |o--o{ promotions : "user_id"
  users ||--o{ referrals : "referee_id"
  users ||--o{ referrals : "referrer_id"
  service_categories ||--o{ zone_services : "service_id"
  service_zones ||--o{ zone_services : "zone_id"
  service_categories {
    text id PK
    text name_en
    text name_rw
    text description_en
    text description_rw
    text[] vehicle_types
    integer min_capacity
    boolean requires_comfort
    integer passenger_capacity
    text luggage
    integer phase
    boolean enabled
    jsonb restrictions
    integer sort
    text kind
    text name_fr
    text description_fr
  }
  service_zones {
    text id PK
    text name
    jsonb polygon
    boolean active
    jsonb config
  }
  zone_services {
    text zone_id PK
    text service_id PK
    boolean enabled
  }
  places {
    uuid id PK
    text name_en
    text name_rw
    text kind
    float8 lat
    float8 lng
    text zone_id FK
    boolean designated_pickup
    text name_fr
  }
  pricing_rules {
    uuid id PK
    text service_id FK
    text zone_id FK
    text model
    integer base_fare
    integer per_km
    integer per_min
    integer minimum_fare
    integer booking_fee
    integer wait_per_min
    integer free_wait_min
    integer airport_fee
    integer scheduled_fee
    integer long_distance_km
    integer long_distance_per_km
    integer tax_bps
    integer rounding
    boolean surge_enabled
    integer surge_cap_bps
    integer version
    timestamptz effective_from
    timestamptz effective_to
    text status
    uuid created_by FK
    uuid approved_by FK
    timestamptz created_at
    text billing
    integer return_per_km
    integer night_start_hour
    integer night_end_hour
    integer night_fee
    integer hourly_rate
    integer min_hours
    integer max_hours
    integer long_hire_hours
    integer long_hire_rate
    integer overtime_per_30min
    integer overtime_grace_min
    jsonb time_multipliers
  }
  commission_rules {
    uuid id PK
    text service_id FK
    uuid fleet_id
    uuid driver_id
    text kind
    integer percent_bps
    integer fixed_amount
    timestamptz exempt_until
    text note
    timestamptz effective_from
    timestamptz effective_to
    text status
    uuid created_by FK
    uuid approved_by FK
    timestamptz created_at
  }
  fare_quotes {
    uuid id PK
    uuid passenger_id FK
    text service_id FK
    text zone_id FK
    float8 pickup_lat
    float8 pickup_lng
    float8 dest_lat
    float8 dest_lng
    integer distance_m
    integer duration_s
    text route_source
    uuid rule_id FK
    integer rule_version
    text promo_code
    jsonb breakdown
    integer total
    timestamptz scheduled_for
    timestamptz expires_at
    uuid used_booking_id
    timestamptz created_at
    jsonb meta
  }
  promotions {
    uuid id PK
    text code
    text kind
    integer value
    integer max_discount
    integer min_fare
    timestamptz valid_from
    timestamptz valid_to
    integer usage_limit
    integer per_user_limit
    integer budget
    integer spent
    text[] service_ids
    text[] zone_ids
    boolean first_ride_only
    text funding
    uuid user_id FK
    boolean active
    timestamptz created_at
    text segment
    text[] segment_phones
  }
  promotion_redemptions {
    uuid id PK
    uuid promotion_id FK
    uuid user_id FK
    uuid booking_id FK
    integer amount
    timestamptz created_at
  }
  referrals {
    uuid id PK
    uuid referrer_id FK
    uuid referee_id FK
    text status
    timestamptz created_at
  }
```

## Drivers and vehicles

```mermaid
erDiagram
  driver_profiles ||--o{ driver_documents : "driver_id"
  users |o--o{ driver_documents : "reviewer_id"
  fleets |o--o{ driver_profiles : "fleet_id"
  users ||--o{ driver_profiles : "user_id"
  service_zones |o--o{ driver_profiles : "zone_id"
  driver_profiles ||--o{ driver_status_history : "driver_id"
  driver_profiles ||--o{ vehicles : "driver_id"
  fleets |o--o{ vehicles : "fleet_id"
  driver_profiles {
    uuid user_id PK
    text status
    text status_reason
    text legal_name
    text national_id_enc
    text emergency_contact_enc
    uuid fleet_id FK
    text zone_id FK
    jsonb preferred_hours
    text payout_provider
    text payout_msisdn
    boolean is_online
    float8 last_lat
    float8 last_lng
    timestamptz last_location_at
    timestamptz last_seen_at
    numeric rating_avg
    integer rating_count
    integer offers_count
    integer accepted_count
    integer rejected_count
    integer cancel_count
    integer completed_count
    timestamptz last_trip_at
    timestamptz submitted_at
    timestamptz decided_at
    timestamptz created_at
    text abasare_status
    jsonb abasare_skills
    timestamptz abasare_applied_at
    timestamptz abasare_decided_at
    text abasare_reason
    text[] accepting
  }
  driver_documents {
    uuid id PK
    uuid driver_id FK
    text doc_type
    text file_key
    text mime
    integer size
    date expiry_date
    text review_status
    uuid reviewer_id FK
    text review_note
    timestamptz reviewed_at
    boolean superseded
    integer reminder_sent_days
    timestamptz created_at
  }
  document_requirements {
    integer id PK
    text vehicle_type
    text doc_type
    boolean mandatory
    boolean requires_expiry
  }
  driver_status_history {
    bigint id PK
    uuid driver_id FK
    text from_status
    text to_status
    text reason
    uuid actor_id
    timestamptz created_at
  }
  vehicles {
    uuid id PK
    uuid driver_id FK
    uuid fleet_id FK
    text vehicle_type
    boolean comfort
    text make
    text model
    text color
    integer year
    text plate
    integer capacity
    text status
    timestamptz created_at
  }
  driver_locations {
    bigint id PK
    uuid driver_id
    uuid booking_id
    float8 lat
    float8 lng
    real accuracy
    real speed
    timestamptz recorded_at
    timestamptz received_at
  }
```

## Abasare (own-car hire)

```mermaid
erDiagram
  bookings ||--o{ abasare_handovers : "booking_id"
  users ||--o{ abasare_handovers : "submitted_by"
  users ||--o{ customer_vehicles : "owner_id"
  bookings ||--o{ handover_photos : "booking_id"
  users ||--o{ handover_photos : "uploaded_by"
  customer_vehicles {
    uuid id PK
    uuid owner_id FK
    text plate
    text make
    text model
    text color
    integer year
    text vehicle_class
    text transmission
    boolean insurance_confirmed
    date insurance_expiry
    boolean active
    timestamptz created_at
  }
  abasare_handovers {
    uuid id PK
    uuid booking_id FK
    text phase
    integer odometer_km
    integer fuel_percent
    text notes
    boolean damage_noted
    uuid submitted_by FK
    text owner_response
    text owner_note
    timestamptz owner_responded_at
    timestamptz created_at
  }
  handover_photos {
    uuid id PK
    uuid booking_id FK
    text phase
    text file_key
    uuid uploaded_by FK
    timestamptz created_at
  }
```

## Fleets and business accounts

```mermaid
erDiagram
  users |o--o{ corporate_accounts : "created_by"
  corporate_accounts ||--o{ corporate_invoices : "corporate_id"
  corporate_accounts ||--o{ corporate_members : "corporate_id"
  users ||--o{ corporate_members : "user_id"
  fleets ||--o{ fleet_invites : "fleet_id"
  fleets ||--o{ fleet_members : "fleet_id"
  users ||--o{ fleet_members : "user_id"
  users ||--o{ fleets : "owner_user_id"
  fleets {
    uuid id PK
    text name
    uuid owner_user_id FK
    integer revenue_share_bps
    text status
    timestamptz created_at
  }
  fleet_members {
    uuid fleet_id PK
    uuid user_id PK
    text role
  }
  fleet_invites {
    uuid id PK
    uuid fleet_id FK
    text phone
    text status
    timestamptz created_at
  }
  corporate_accounts {
    uuid id PK
    text legal_name
    text tin
    text status
    text billing_mode
    integer credit_limit
    integer monthly_budget
    jsonb policy
    uuid created_by FK
    timestamptz created_at
  }
  corporate_members {
    uuid corporate_id PK
    uuid user_id PK
    text role
    integer spending_limit
    text cost_centre
    boolean active
  }
  corporate_invoices {
    uuid id PK
    uuid corporate_id FK
    date period_start
    date period_end
    bigint total_amount
    integer trip_count
    text status
    timestamptz created_at
  }
```

## Bookings and dispatch

```mermaid
erDiagram
  bookings ||--o{ booking_events : "booking_id"
  corporate_accounts |o--o{ bookings : "corporate_id"
  customer_vehicles |o--o{ bookings : "customer_vehicle_id"
  driver_profiles |o--o{ bookings : "driver_id"
  users ||--o{ bookings : "passenger_id"
  users |o--o{ bookings : "pin_override_by"
  fare_quotes ||--o{ bookings : "quote_id"
  request_codes |o--o{ bookings : "request_code_id"
  service_categories ||--o{ bookings : "service_id"
  vehicles |o--o{ bookings : "vehicle_id"
  service_zones ||--o{ bookings : "zone_id"
  bookings ||--o{ dispatch_offers : "booking_id"
  driver_profiles ||--o{ dispatch_offers : "driver_id"
  bookings ||--o{ ratings : "booking_id"
  users ||--o{ ratings : "reviewee_id"
  users ||--o{ ratings : "reviewer_id"
  users |o--o{ safety_blocks : "created_by"
  users ||--o{ safety_blocks : "driver_id"
  users ||--o{ safety_blocks : "passenger_id"
  bookings ||--o{ trip_messages : "booking_id"
  users ||--o{ trip_messages : "sender_id"
  bookings ||--o{ trip_shares : "booking_id"
  users ||--o{ trip_shares : "created_by"
  bookings {
    uuid id PK
    text ref
    uuid passenger_id FK
    uuid driver_id FK
    uuid vehicle_id FK
    text service_id FK
    text zone_id FK
    text status
    float8 pickup_lat
    float8 pickup_lng
    text pickup_name
    text pickup_note
    float8 dest_lat
    float8 dest_lng
    text dest_name
    uuid quote_id FK
    integer estimated_fare
    integer final_fare
    jsonb fare_breakdown
    integer distance_m
    integer duration_s
    text payment_method
    text payer_type
    uuid corporate_id FK
    text cost_centre
    text po_ref
    text rider_name
    text rider_phone
    timestamptz scheduled_for
    text idempotency_key
    integer version
    integer pin_attempts
    timestamptz pin_verified_at
    uuid pin_override_by FK
    integer waiting_min
    jsonb extra_charges
    integer dispatch_round
    timestamptz last_round_at
    timestamptz search_started_at
    timestamptz requested_at
    timestamptz assigned_at
    timestamptz arrived_at
    timestamptz started_at
    timestamptz completed_at
    timestamptz cancelled_at
    text cancel_by
    text cancel_reason
    integer cancel_fee
    timestamptz created_at
    timestamptz updated_at
    text hire_mode
    integer hours_booked
    uuid customer_vehicle_id FK
    timestamptz owner_attested_at
    integer overtime_blocks
    uuid request_code_id FK
  }
  booking_events {
    bigint id PK
    uuid booking_id FK
    text type
    text from_status
    text to_status
    uuid actor_id
    text actor_role
    text reason
    jsonb meta
    timestamptz created_at
  }
  dispatch_offers {
    uuid id PK
    uuid booking_id FK
    uuid driver_id FK
    text status
    integer round
    integer eta_s
    integer distance_m
    integer driver_net
    timestamptz offered_at
    timestamptz expires_at
    timestamptz responded_at
    text reject_reason
    boolean excused
  }
  trip_shares {
    uuid id PK
    uuid booking_id FK
    text token_hash
    timestamptz expires_at
    timestamptz revoked_at
    uuid created_by FK
    timestamptz created_at
  }
  trip_messages {
    bigint id PK
    uuid booking_id FK
    uuid sender_id FK
    text body
    timestamptz created_at
  }
  ratings {
    uuid id PK
    uuid booking_id FK
    uuid reviewer_id FK
    uuid reviewee_id FK
    integer score
    text comment
    text[] tags
    timestamptz created_at
  }
  safety_blocks {
    uuid passenger_id PK
    uuid driver_id PK
    text reason
    uuid created_by FK
    timestamptz created_at
  }
  request_codes {
    uuid id PK
    text code
    text label
    text partner_name
    float8 lat
    float8 lng
    text address_note
    text default_service
    text pickup_note
    boolean active
    timestamptz expires_at
    integer scans
    uuid created_by
    timestamptz created_at
    timestamptz updated_at
  }
```

## Money

```mermaid
erDiagram
  bookings ||--o{ driver_earnings : "booking_id"
  driver_profiles ||--o{ driver_earnings : "driver_id"
  ledger_accounts ||--o{ ledger_entries : "account_code"
  bookings |o--o{ passenger_debts : "applied_booking_id"
  bookings ||--o{ passenger_debts : "booking_id"
  bookings |o--o{ passenger_debts : "settled_booking_id"
  users ||--o{ passenger_debts : "user_id"
  users |o--o{ passenger_debts : "waived_by"
  payments |o--o{ payment_provider_events : "payment_id"
  bookings ||--o{ payments : "booking_id"
  users |o--o{ payments : "payer_user_id"
  users |o--o{ payouts : "approved_by"
  users ||--o{ payouts : "owner_user_id"
  users |o--o{ payouts : "reviewed_by"
  reconciliation_runs ||--o{ reconciliation_items : "run_id"
  users |o--o{ reconciliation_runs : "created_by"
  users |o--o{ refunds : "approved_by"
  bookings ||--o{ refunds : "booking_id"
  payments ||--o{ refunds : "payment_id"
  users ||--o{ refunds : "requested_by"
  payments {
    uuid id PK
    uuid booking_id FK
    uuid payer_user_id FK
    text method
    text provider
    integer amount
    text currency
    text status
    text reference
    text provider_reference
    text msisdn_masked
    integer amount_collected
    integer fee_amount
    text failure_reason
    text settlement_status
    timestamptz created_at
    timestamptz updated_at
    timestamptz completed_at
  }
  payment_provider_events {
    bigint id PK
    text provider
    text event_key
    uuid payment_id FK
    jsonb payload
    boolean verified
    timestamptz processed_at
    timestamptz created_at
  }
  ledger_accounts {
    text code PK
    text name
    text type
  }
  ledger_entries {
    bigint id PK
    uuid txn_id
    text account_code FK
    uuid owner_user_id
    uuid booking_id
    uuid payment_id
    bigint debit
    bigint credit
    text currency
    text memo
    timestamptz created_at
  }
  driver_earnings {
    uuid id PK
    uuid booking_id FK
    uuid driver_id FK
    uuid fleet_id
    integer fare_subtotal
    integer discount
    integer tax
    integer passthrough
    integer commissionable
    integer commission
    integer fleet_share
    integer net
    uuid commission_rule_id
    text payment_method
    text collected_by
    timestamptz created_at
  }
  payouts {
    uuid id PK
    uuid owner_user_id FK
    text kind
    integer amount
    integer fee
    text status
    text provider
    text msisdn
    text provider_reference
    uuid reviewed_by FK
    uuid approved_by FK
    text note
    timestamptz requested_at
    timestamptz paid_at
  }
  refunds {
    uuid id PK
    uuid booking_id FK
    uuid payment_id FK
    integer amount
    text reason
    text status
    integer driver_clawback
    uuid requested_by FK
    uuid approved_by FK
    timestamptz created_at
    timestamptz processed_at
  }
  passenger_debts {
    uuid id PK
    uuid user_id FK
    uuid booking_id FK
    text kind
    integer amount
    text status
    uuid applied_booking_id FK
    uuid settled_booking_id FK
    uuid waived_by FK
    text waive_reason
    timestamptz created_at
    timestamptz settled_at
    timestamptz waived_at
  }
  reconciliation_runs {
    uuid id PK
    text provider
    date run_date
    jsonb summary
    uuid created_by FK
    timestamptz created_at
  }
  reconciliation_items {
    uuid id PK
    uuid run_id FK
    uuid payment_id
    text provider_reference
    text kind
    integer internal_amount
    integer provider_amount
    boolean resolved
    text note
  }
```

## Support and safety

```mermaid
erDiagram
  users |o--o{ case_events : "author_id"
  support_cases ||--o{ case_events : "case_id"
  users |o--o{ safety_incidents : "acknowledged_by"
  bookings |o--o{ safety_incidents : "booking_id"
  users ||--o{ safety_incidents : "reporter_id"
  users |o--o{ support_cases : "assigned_to"
  bookings |o--o{ support_cases : "booking_id"
  users ||--o{ support_cases : "reporter_id"
  support_cases {
    uuid id PK
    text ref
    uuid booking_id FK
    uuid reporter_id FK
    text category
    text priority
    text status
    text subject
    uuid assigned_to FK
    boolean sensitive
    timestamptz sla_due_at
    text resolution
    integer csat
    timestamptz created_at
    timestamptz updated_at
  }
  case_events {
    bigint id PK
    uuid case_id FK
    uuid author_id FK
    text kind
    text body
    text visibility
    text file_key
    timestamptz created_at
  }
  safety_incidents {
    uuid id PK
    text ref
    uuid booking_id FK
    uuid reporter_id FK
    text kind
    float8 lat
    float8 lng
    text description
    text status
    uuid acknowledged_by FK
    timestamptz acknowledged_at
    text resolution
    timestamptz created_at
  }
```

## Platform

```mermaid
erDiagram
  users |o--o{ client_errors : "user_id"
  users ||--o{ notifications : "user_id"
  notifications {
    uuid id PK
    uuid user_id FK
    text channel
    text template_key
    jsonb params
    text title
    text body
    text lang
    boolean critical
    text status
    integer attempts
    text error
    timestamptz read_at
    timestamptz created_at
    timestamptz sent_at
  }
  notification_templates {
    text key PK
    text lang PK
    text title
    text body
  }
  feature_flags {
    text key PK
    boolean enabled
    text description
    uuid updated_by
    timestamptz updated_at
  }
  system_settings {
    text key PK
    jsonb value
    text description
    uuid updated_by
    timestamptz updated_at
  }
  audit_logs {
    bigint id PK
    uuid actor_id
    text actor_role
    text action
    text entity_type
    text entity_id
    jsonb before
    jsonb after
    text ip
    timestamptz created_at
  }
  client_errors {
    bigint id PK
    uuid user_id FK
    text message
    text stack
    text app_version
    text platform
    text screen
    text lang
    timestamptz created_at
  }
  schema_migrations {
    text name PK
    timestamptz applied_at
  }
```

## Table index

| Table | Module | Since | Columns | Notes |
|---|---|---|---|---|
| `abasare_handovers` | Abasare (own-car hire) | 002 | 12 | 6 nullable |
| `audit_logs` | Platform | 001 | 10 | 7 nullable |
| `booking_events` | Bookings and dispatch | 001 | 10 | 5 nullable |
| `bookings` | Bookings and dispatch | 001 | 56 | altered in 002, 006; 32 nullable |
| `case_events` | Support and safety | 001 | 8 | 3 nullable |
| `client_errors` | Platform | 004 | 9 | 6 nullable |
| `commission_rules` | Catalogue and pricing | 001 | 15 | 10 nullable |
| `consents` | Identity and privacy | 001 | 6 |  |
| `corporate_accounts` | Fleets and business accounts | 001 | 10 | 3 nullable |
| `corporate_invoices` | Fleets and business accounts | 001 | 8 |  |
| `corporate_members` | Fleets and business accounts | 001 | 6 | 2 nullable |
| `customer_vehicles` | Abasare (own-car hire) | 002 | 13 | 5 nullable |
| `dispatch_offers` | Bookings and dispatch | 001 | 13 | 5 nullable |
| `document_requirements` | Drivers and vehicles | 001 | 5 |  |
| `driver_documents` | Drivers and vehicles | 001 | 14 | 5 nullable |
| `driver_earnings` | Money | 001 | 16 | 2 nullable |
| `driver_locations` | Drivers and vehicles | 001 | 9 | 3 nullable |
| `driver_profiles` | Drivers and vehicles | 001 | 33 | altered in 002; 19 nullable |
| `driver_status_history` | Drivers and vehicles | 001 | 7 | 3 nullable |
| `emergency_contacts` | Rider | 001 | 5 |  |
| `fare_quotes` | Catalogue and pricing | 001 | 21 | altered in 002; 3 nullable |
| `feature_flags` | Platform | 001 | 5 | 2 nullable |
| `fleet_invites` | Fleets and business accounts | 001 | 5 |  |
| `fleet_members` | Fleets and business accounts | 001 | 3 |  |
| `fleets` | Fleets and business accounts | 001 | 6 |  |
| `handover_photos` | Abasare (own-car hire) | 002 | 6 |  |
| `ledger_accounts` | Money | 001 | 3 |  |
| `ledger_entries` | Money | 001 | 11 | 4 nullable |
| `notification_templates` | Platform | 001 | 4 |  |
| `notifications` | Platform | 001 | 15 | 6 nullable |
| `otp_challenges` | Identity and privacy | 001 | 10 | 3 nullable |
| `passenger_debts` | Money | 004 | 13 | 6 nullable |
| `payment_provider_events` | Money | 001 | 8 | 2 nullable |
| `payments` | Money | 001 | 18 | 7 nullable |
| `payouts` | Money | 001 | 14 | 7 nullable |
| `places` | Catalogue and pricing | 001 | 9 | altered in 003; 3 nullable |
| `pricing_rules` | Catalogue and pricing | 001 | 39 | altered in 002, 007; 10 nullable |
| `privacy_requests` | Identity and privacy | 001 | 9 | 3 nullable |
| `promotion_redemptions` | Catalogue and pricing | 001 | 6 |  |
| `promotions` | Catalogue and pricing | 001 | 21 | altered in 007; 8 nullable |
| `push_tickets` | Identity and privacy | 004 | 5 | 3 nullable |
| `push_tokens` | Identity and privacy | 004 | 8 | 2 nullable |
| `ratings` | Bookings and dispatch | 001 | 8 | 2 nullable |
| `reconciliation_items` | Money | 001 | 9 | 5 nullable |
| `reconciliation_runs` | Money | 001 | 6 | 1 nullable |
| `referrals` | Catalogue and pricing | 001 | 5 |  |
| `refunds` | Money | 001 | 11 | 2 nullable |
| `request_codes` | Bookings and dispatch | 006 | 15 | 5 nullable |
| `role_permissions` | Identity and privacy | 001 | 2 |  |
| `roles` | Identity and privacy | 001 | 2 | 1 nullable |
| `safety_blocks` | Bookings and dispatch | 001 | 5 | 2 nullable |
| `safety_incidents` | Support and safety | 001 | 13 | 7 nullable |
| `saved_places` | Rider | 001 | 8 | 1 nullable |
| `schema_migrations` | Platform | 001 | 2 | 1 nullable |
| `service_categories` | Catalogue and pricing | 001 | 17 | altered in 002, 003; 5 nullable |
| `service_zones` | Catalogue and pricing | 001 | 5 |  |
| `sessions` | Identity and privacy | 001 | 11 | 4 nullable |
| `staff_invites` | Identity and privacy | 005 | 11 | 4 nullable |
| `support_cases` | Support and safety | 001 | 15 | 4 nullable |
| `system_settings` | Platform | 001 | 5 | 2 nullable |
| `trip_messages` | Bookings and dispatch | 001 | 5 |  |
| `trip_shares` | Bookings and dispatch | 001 | 7 | 1 nullable |
| `user_roles` | Identity and privacy | 001 | 2 |  |
| `users` | Identity and privacy | 001 | 18 | 9 nullable |
| `vehicles` | Drivers and vehicles | 001 | 13 | 5 nullable |
| `zone_services` | Catalogue and pricing | 001 | 3 |  |

## Unique and partial unique indexes (business rules the database enforces)

| Table | Index | Definition |
|---|---|---|
| `abasare_handovers` | `abasare_handovers_booking_id_phase_key` | `abasare_handovers USING btree (booking_id, phase)` |
| `bookings` | `bookings_passenger_id_idempotency_key_key` | `bookings USING btree (passenger_id, idempotency_key)` |
| `bookings` | `bookings_ref_key` | `bookings USING btree (ref)` |
| `bookings` | `one_active_trip_per_driver` | `bookings USING btree (driver_id) WHERE ((driver_id IS NOT NULL) AND (status = ANY (ARRAY['DRIVER_ASSIGNED'::text, 'DRIVER_ARRIVING'::text, 'DRIVER_ARRIVED'::text, 'AWAITING_PASSENGER_VERIFICATION'::text, 'IN_PROGRESS'::text])))` |
| `bookings` | `one_active_trip_per_vehicle` | `bookings USING btree (vehicle_id) WHERE ((vehicle_id IS NOT NULL) AND (status = ANY (ARRAY['DRIVER_ASSIGNED'::text, 'DRIVER_ARRIVING'::text, 'DRIVER_ARRIVED'::text, 'AWAITING_PASSENGER_VERIFICATION'::text, 'IN_PROGRESS'::text])))` |
| `bookings` | `one_open_request_per_passenger` | `bookings USING btree (passenger_id) WHERE ((payer_type = 'passenger'::text) AND (scheduled_for IS NULL) AND (status = ANY (ARRAY['REQUESTED'::text, 'SEARCHING_DRIVER'::text, 'DRIVER_ASSIGNED'::text, 'DRIVER_ARRIVING'::text, 'DRIVER_ARRIVED'::text, 'AWAITING_PASSENGER_VERIFICATION'::text, 'IN_PROGRESS'::text])))` |
| `corporate_invoices` | `corporate_invoices_corporate_id_period_start_period_end_key` | `corporate_invoices USING btree (corporate_id, period_start, period_end)` |
| `customer_vehicles` | `customer_vehicles_owner_id_plate_key` | `customer_vehicles USING btree (owner_id, plate)` |
| `dispatch_offers` | `dispatch_offers_booking_id_driver_id_key` | `dispatch_offers USING btree (booking_id, driver_id)` |
| `document_requirements` | `document_requirements_vehicle_type_doc_type_key` | `document_requirements USING btree (vehicle_type, doc_type)` |
| `driver_earnings` | `driver_earnings_booking_id_key` | `driver_earnings USING btree (booking_id)` |
| `fleet_invites` | `fleet_invites_fleet_id_phone_key` | `fleet_invites USING btree (fleet_id, phone)` |
| `passenger_debts` | `passenger_debts_booking_id_key` | `passenger_debts USING btree (booking_id)` |
| `payment_provider_events` | `payment_provider_events_event_key_key` | `payment_provider_events USING btree (event_key)` |
| `payments` | `one_live_payment_per_booking` | `payments USING btree (booking_id) WHERE (status = ANY (ARRAY['INITIATED'::text, 'PENDING'::text, 'SUCCESS'::text]))` |
| `payments` | `payments_reference_key` | `payments USING btree (reference)` |
| `promotion_redemptions` | `promotion_redemptions_booking_id_key` | `promotion_redemptions USING btree (booking_id)` |
| `promotions` | `promotions_code_key` | `promotions USING btree (code)` |
| `push_tokens` | `push_tokens_token_key` | `push_tokens USING btree (token)` |
| `ratings` | `ratings_booking_id_reviewer_id_key` | `ratings USING btree (booking_id, reviewer_id)` |
| `referrals` | `referrals_referee_id_key` | `referrals USING btree (referee_id)` |
| `request_codes` | `request_codes_code_key` | `request_codes USING btree (code)` |
| `safety_incidents` | `safety_incidents_ref_key` | `safety_incidents USING btree (ref)` |
| `sessions` | `sessions_refresh_hash_key` | `sessions USING btree (refresh_hash)` |
| `staff_invites` | `staff_invites_token_hash_key` | `staff_invites USING btree (token_hash)` |
| `support_cases` | `support_cases_ref_key` | `support_cases USING btree (ref)` |
| `trip_shares` | `trip_shares_token_hash_key` | `trip_shares USING btree (token_hash)` |
| `users` | `users_email_key` | `users USING btree (email)` |
| `users` | `users_email_lower_uniq` | `users USING btree (lower(email)) WHERE (email IS NOT NULL)` |
| `users` | `users_phone_key` | `users USING btree (phone)` |
| `users` | `users_referral_code_key` | `users USING btree (referral_code)` |
| `vehicles` | `one_active_vehicle_per_driver` | `vehicles USING btree (driver_id) WHERE (status = 'approved'::text)` |
| `vehicles` | `vehicles_plate_key` | `vehicles USING btree (plate)` |

## Triggers

| Table | Trigger |
|---|---|
| `audit_logs` | `audit_immutable` |
| `ledger_entries` | `ledger_balanced` |
| `ledger_entries` | `ledger_immutable` |

## Notable guarantees

* `ledger_balanced` (deferred constraint trigger): sum(debit) = sum(credit) per `txn_id`; `ledger_immutable` and `audit_immutable` reject UPDATE and DELETE.
* One active trip per driver and per vehicle, one open request per passenger, one live payment per booking, one active vehicle per driver (partial unique indexes above).
* `bookings (passenger_id, idempotency_key)`, `payments.reference`, `driver_earnings.booking_id` and `passenger_debts.booking_id` (one cancellation-fee debt per cancelled trip) are unique; staff e-mail is unique case-insensitively (`users_email_lower_uniq`).
* Phone check `^\+250[0-9]{9}$`; money columns are integers (RWF) with `>= 0` checks; request codes match `^[A-HJ-NP-Z2-9]{6,8}$`.
