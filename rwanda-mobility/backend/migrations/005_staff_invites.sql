-- Staff onboarding by single-use invite: the new person sets their own password and enrols their own authenticator.
-- The inviting admin never sees the person's authenticator secret.
create table staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  role text not null,
  token_hash text not null unique,
  pending_mfa_enc text,
  invited_by uuid references users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index staff_invites_email_idx on staff_invites (lower(email)) where used_at is null and revoked_at is null;
