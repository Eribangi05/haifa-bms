-- 015: damage / loss / injury claims. Additive and idempotent.

create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  booking_id uuid not null references bookings(id),
  claim_type text not null check (claim_type in ('damage','loss','injury','other')),
  filed_by uuid not null references users(id),
  filer_role text not null check (filer_role in ('owner','driver','passenger')),
  respondent_id uuid references users(id),               -- the other party on the booking (right of reply)
  respondent_role text check (respondent_role in ('owner','driver','passenger')),
  description text not null,
  claimed_amount int not null default 0 check (claimed_amount >= 0),
  status text not null default 'submitted' check (status in ('submitted','under_review','info_requested','accepted','partially_accepted','rejected','settled','closed','withdrawn')),
  assigned_to uuid references users(id),
  sla_due_at timestamptz not null,
  info_due_at timestamptz,
  reply_due_at timestamptz,
  replied_at timestamptz,
  decision_amount int check (decision_amount >= 0),
  decision_reason text,
  decided_by uuid references users(id),
  decided_at timestamptz,
  settlement_kind text check (settlement_kind in ('credit','manual_payout')),
  settlement_status text not null default 'none' check (settlement_status in ('none','pending_approval','done','rejected')),
  settlement_amount int,
  settlement_requested_by uuid references users(id),
  settlement_approved_by uuid references users(id),
  settlement_reference text,
  settled_at timestamptz,
  closed_at timestamptz,
  -- optional insurer partnership fields (PENDING INTEGRATION: no insurer connection exists; staff record the data by hand)
  policy_ref text,
  insurer_claim_ref text,
  insurer_status text not null default 'not_applicable' check (insurer_status in ('not_applicable','to_submit','submitted','accepted','rejected','paid')),
  sla_warned_at timestamptz,
  reply_reminded_at timestamptz,
  info_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists claims_status on claims(status, sla_due_at);
create index if not exists claims_booking on claims(booking_id);
create index if not exists claims_filer on claims(filed_by, created_at desc);
create index if not exists claims_respondent on claims(respondent_id, created_at desc);
create unique index if not exists claims_one_open on claims(booking_id, filed_by, claim_type) where status in ('submitted','under_review','info_requested');

create table if not exists claim_events (
  id bigserial primary key,
  claim_id uuid not null references claims(id) on delete cascade,
  author_id uuid references users(id),
  author_role text not null check (author_role in ('owner','driver','passenger','staff','system')),
  kind text not null check (kind in ('filed','status','message','reply','internal_note','evidence','info_request','decision','assignment','settlement','reminder','insurer')),
  visibility text not null default 'public' check (visibility in ('public','internal')),
  body text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists claim_events_claim on claim_events(claim_id, id);

create table if not exists claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(id) on delete cascade,
  uploaded_by uuid references users(id),
  source text not null check (source in ('upload','handover')),
  handover_phase text check (handover_phase in ('pickup','dropoff')),
  file_key text not null,
  caption text,
  created_at timestamptz not null default now()
);
create index if not exists claim_evidence_claim on claim_evidence(claim_id);
create unique index if not exists claim_evidence_once on claim_evidence(claim_id, file_key);
