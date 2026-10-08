-- 012: driver quests and bonuses, marketing campaigns. Additive and idempotent.

insert into ledger_accounts(code, name, type) values ('INCENTIVE_EXPENSE', 'Driver incentives and quest bonuses', 'expense') on conflict do nothing;

create table if not exists driver_quests (
  id uuid primary key default gen_random_uuid(),
  title_en text not null, title_rw text not null, title_fr text not null,
  desc_en text not null default '', desc_rw text not null default '', desc_fr text not null default '',
  kind text not null check (kind in ('trips','earnings','streak','peak_hours')),
  target int not null check (target > 0),
  quest_window text not null check (quest_window in ('daily','weekly')),
  reward int not null check (reward > 0 and reward <= 1000000),
  service_ids text[],
  starts_on date,
  ends_on date,
  budget_cap int check (budget_cap is null or budget_cap >= 0),
  spent int not null default 0 check (spent >= 0),
  active boolean not null default false,
  placeholder boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'streak' or quest_window = 'weekly')
);
create table if not exists driver_quest_awards (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references driver_quests(id),
  driver_id uuid not null references driver_profiles(user_id),
  period_key text not null,
  amount int not null check (amount > 0),
  progress int not null,
  txn_id uuid,
  created_at timestamptz not null default now(),
  unique (quest_id, driver_id, period_key)
);
create index if not exists driver_quest_awards_driver on driver_quest_awards (driver_id, created_at desc);

-- PLACEHOLDER quests: INACTIVE, rewards are examples only.
insert into driver_quests (title_en, title_rw, title_fr, desc_en, desc_rw, desc_fr, kind, target, quest_window, reward, active, placeholder)
select v.* from (values
  ('Five trips today', 'Ingendo eshanu uyu munsi', 'Cinq courses aujourd''hui', 'Complete 5 trips today to earn a bonus.', 'Zuza ingendo 5 uyu munsi ubone igihembo.', 'Effectuez 5 courses aujourd''hui pour gagner un bonus.', 'trips', 5, 'daily', 1500, false, true),
  ('Weekly earner', 'Uwinjiza menshi mu cyumweru', 'Gros gains de la semaine', 'Earn 100,000 RWF in fares this week.', 'Winjize 100,000 RWF mu byumweru bimwe.', 'Gagnez 100 000 RWF de courses cette semaine.', 'earnings', 100000, 'weekly', 8000, false, true),
  ('Rush-hour driver', 'Umushoferi w''amasaha y''ingendo nyinshi', 'Chauffeur des heures de pointe', 'Complete 6 trips in the morning and evening rush this week.', 'Zuza ingendo 6 mu masaha y''ingendo nyinshi muri iki cyumweru.', 'Effectuez 6 courses aux heures de pointe cette semaine.', 'peak_hours', 6, 'weekly', 5000, false, true)
) as v(a,b,c,d,e,f,g,h,i,j,k,l)
where not exists (select 1 from driver_quests where placeholder and title_en = v.a);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null check (channel in ('sms','push','inapp')),
  segment jsonb not null,
  title_rw text not null, title_fr text not null, title_en text not null,
  msg_rw text not null, msg_fr text not null, msg_en text not null,
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft','scheduled','sending','done','cancelled')),
  stats jsonb not null default '{}',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists campaigns_due on campaigns (scheduled_at) where status in ('scheduled','sending');
create table if not exists campaign_recipients (
  id bigserial primary key,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  lang text not null,
  status text not null default 'queued' check (status in ('queued','sent','skipped_optout','skipped_cap','skipped_no_channel','failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (campaign_id, user_id)
);
create index if not exists campaign_recipients_queue on campaign_recipients (campaign_id) where status = 'queued';
create index if not exists campaign_recipients_user_sent on campaign_recipients (user_id, sent_at) where status = 'sent';
