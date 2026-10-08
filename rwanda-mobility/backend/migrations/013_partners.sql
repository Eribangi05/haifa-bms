-- 013: venue partner portal. Additive and idempotent.

-- A role is now any row of `roles` (the fixed CHECK list could not take new roles). NOT VALID: existing rows are not re-checked.
alter table user_roles drop constraint if exists user_roles_role_check;
insert into roles(name) values ('partner_manager') on conflict do nothing;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_roles_role_fk') then
    alter table user_roles add constraint user_roles_role_fk foreign key (role) references roles(name) not valid;
  end if;
end $$;

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text, contact_phone text, contact_email text,
  status text not null default 'active' check (status in ('pending','active','suspended')),
  billing_terms jsonb not null default '{}',     -- {cycle:'monthly', payment_days, monthly_cap, max_fare, notes}
  corporate_id uuid references corporate_accounts(id),   -- the invoice engine is the corporate one
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists partners_name_uniq on partners (lower(name));
-- one staff user belongs to at most one partner: this row is the ONLY source of a partner manager's scope
create table if not exists partner_users (
  user_id uuid primary key references users(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists partner_users_partner on partner_users (partner_id);

alter table corporate_accounts add column if not exists partner_id uuid references partners(id);
alter table request_codes add column if not exists partner_id uuid references partners(id) on delete set null;
alter table request_codes add column if not exists bill_to_partner boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'request_codes_bill_needs_partner') then
    alter table request_codes add constraint request_codes_bill_needs_partner check (not bill_to_partner or partner_id is not null);
  end if;
end $$;
create index if not exists request_codes_partner on request_codes (partner_id) where partner_id is not null;
alter table bookings add column if not exists partner_id uuid references partners(id);
alter table bookings add column if not exists partner_billed boolean not null default false;
create index if not exists bookings_partner on bookings (partner_id, created_at desc) where partner_id is not null;
alter table staff_invites add column if not exists partner_id uuid references partners(id);
