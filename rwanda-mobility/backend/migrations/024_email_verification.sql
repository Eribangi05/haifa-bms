-- Optional email address with proof of ownership (a code sent to the address). Changing the address clears the proof.
alter table users add column email_verified_at timestamptz;
create table email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_verifications_user_idx on email_verifications(user_id, created_at desc);
