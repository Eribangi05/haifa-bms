-- Round 4: staff lifecycle, data-driven roles, editable places / FAQ / support categories. Additive and idempotent: safe on a database that already holds data.

-- 1) users.status gains 'removed' (soft-deleted staff) ; anonymisation timestamp
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'users'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%deletion_requested%' loop
    execute format('alter table users drop constraint %I', c);
  end loop;
  alter table users add constraint users_status_check check (status in ('active','restricted','deactivated','deletion_requested','deleted','removed'));
end $$;
alter table users add column if not exists removed_at timestamptz;
alter table users add column if not exists anonymised_at timestamptz;

-- 2) roles become the single source of truth (the code keeps the built-in defaults as a fallback)
alter table roles add column if not exists label text;
alter table roles add column if not exists builtin boolean not null default false;
alter table roles add column if not exists is_staff boolean not null default true;
alter table roles add column if not exists customized boolean not null default false;   -- built-in roles: true once an admin edited the permissions (else the code defaults apply)
alter table roles add column if not exists created_by uuid;
alter table roles add column if not exists created_at timestamptz not null default now();
alter table roles add column if not exists updated_at timestamptz not null default now();
alter table roles add column if not exists updated_by uuid;
insert into roles(name) values ('passenger'),('driver'),('fleet_manager'),('corporate_admin'),('corporate_booker'),
  ('super_admin'),('dispatcher'),('support_agent'),('support_lead'),('driver_verifier'),('finance_officer'),('finance_approver'),
  ('business_manager'),('analyst'),('partner_manager') on conflict do nothing;
update roles set builtin = true where name in ('passenger','driver','fleet_manager','corporate_admin','corporate_booker','super_admin','dispatcher','support_agent','support_lead',
  'driver_verifier','finance_officer','finance_approver','business_manager','analyst','partner_manager');
update roles set is_staff = false where name in ('passenger','driver','fleet_manager','corporate_admin','corporate_booker');
update roles set description = v.d from (values
  ('super_admin','Full access to everything. Cannot be edited.'),
  ('dispatcher','Watches live trips and assigns drivers.'),
  ('support_agent','Answers customer cases.'),
  ('support_lead','Handles sensitive cases, restrictions, privacy requests and fee waivers.'),
  ('driver_verifier','Reviews driver documents and applications.'),
  ('finance_officer','Prepares refunds, payouts and reconciliation.'),
  ('finance_approver','Approves refunds, payouts and price changes (the second pair of eyes).'),
  ('business_manager','Runs pricing, promotions, business accounts, growth and partners.'),
  ('analyst','Read-only reports and diagnostics.'),
  ('partner_manager','Venue partner: sees only their own venue.')) as v(n, d) where roles.name = v.n and roles.description is null;

-- 3) staff_invites also carry password / two-factor / full reset links for existing staff
alter table staff_invites add column if not exists purpose text not null default 'invite';
alter table staff_invites add column if not exists user_id uuid references users(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_invites_purpose_check') then
    alter table staff_invites add constraint staff_invites_purpose_check check (purpose in ('invite','password_reset','mfa_reset','full_reset'));
  end if;
end $$;
create index if not exists staff_invites_user_idx on staff_invites (user_id) where used_at is null and revoked_at is null;

-- 4) landmarks / places can be switched off without deleting history
alter table places add column if not exists active boolean not null default true;
alter table places add column if not exists updated_at timestamptz not null default now();
alter table places add column if not exists updated_by uuid;

-- 5) zones remember how they were drawn (circle or polygon) and who changed them
alter table service_zones add column if not exists updated_at timestamptz not null default now();
alter table service_zones add column if not exists updated_by uuid;

-- 6) help / FAQ moves from code to a table (the five original entries are seeded below)
create table if not exists faq_entries (
  id text primary key,
  q_en text not null default '', a_en text not null default '',
  q_rw text not null default '', a_rw text not null default '',
  q_fr text not null default '', a_fr text not null default '',
  sort int not null default 100,
  published boolean not null default true,
  updated_by uuid, updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);
insert into faq_entries(id,q_en,a_en,q_rw,a_rw,q_fr,a_fr,sort) values
 ('cancel', $$How do I cancel a ride?$$, $$Open your active trip and tap Cancel. Cancelling soon after a driver is assigned is free.$$,
  $$Nahagarika nte urugendo?$$, $$Fungura urugendo rwawe urimo hanyuma ukande "Guhagarika". Guhagarika mu gihe gito nyuma yo guhabwa umushoferi nta kiguzi bisaba.$$,
  $$Comment annuler une course ?$$, $$Ouvrez votre course en cours et appuyez sur Annuler. L'annulation peu de temps après l'attribution d'un chauffeur est gratuite.$$, 10),
 ('pin', $$What is the trip PIN?$$, $$A 4-digit code shown only to you. Give it to your driver to start the trip after checking their plate.$$,
  $$PIN y'urugendo ni iki?$$, $$Ni kode y'imibare 4 igaragara kuri wowe wenyine. Yihe umushoferi kugira ngo urugendo rutangire, nyuma yo kugenzura plaque y'imodoka ye.$$,
  $$Qu'est-ce que le code PIN de la course ?$$, $$C'est un code à 4 chiffres visible uniquement par vous. Donnez-le à votre chauffeur pour démarrer la course, après avoir vérifié sa plaque.$$, 20),
 ('pay', $$How can I pay?$$, $$Pay cash to the driver or with MTN Mobile Money. Payment is confirmed by the provider, not by a screenshot.$$,
  $$Nishyura nte?$$, $$Ushobora kwishyura mu ntoki umushoferi cyangwa ukoresheje MTN Mobile Money. Kwishyura byemezwa na MTN, ntibyemezwa n'ifoto y'ubutumwa.$$,
  $$Comment puis-je payer ?$$, $$Payez en espèces au chauffeur ou avec MTN Mobile Money. Le paiement est confirmé par l'opérateur, et non par une capture d'écran.$$, 30),
 ('lost', $$I left something in the vehicle$$, $$Open the trip in History and tap Report a problem > Lost item.$$,
  $$Nibagiwe ikintu mu modoka$$, $$Fungura urugendo mu mateka y'ingendo, ukande "Gutanga ikibazo" hanyuma uhitemo "Ikintu cyatakaye".$$,
  $$J'ai oublié un objet dans le véhicule$$, $$Ouvrez la course dans l'Historique, puis appuyez sur Signaler un problème > Objet perdu.$$, 40),
 ('sos', $$What if I feel unsafe?$$, $$Use the SOS button. We record your trip and location and alert our team. Also call 112 (police) or 912 (ambulance).$$,
  $$Nakora iki niba numva ntatekanye?$$, $$Kanda buto ya SOS. Duhita twandika urugendo n'aho uri, tukamenyesha itsinda ryacu. Hamagara kandi 112 (Polisi) cyangwa 912 (ambulance).$$,
  $$Que faire si je ne me sens pas en sécurité ?$$, $$Utilisez le bouton SOS. Nous enregistrons votre course et votre position et alertons notre équipe. Appelez aussi le 112 (police) ou le 912 (ambulance).$$, 50)
 on conflict (id) do nothing;

-- 7) support category priority / SLA / sensitivity (the category list itself stays fixed: support_cases has a CHECK on it)
create table if not exists support_categories (
  category text primary key,
  priority text not null check (priority in ('low','normal','high','urgent')),
  sla_hours int not null check (sla_hours between 1 and 720),
  sensitive boolean not null default false,
  updated_by uuid, updated_at timestamptz not null default now()
);
insert into support_categories(category, priority, sla_hours, sensitive) values
  ('safety','urgent',2,true),('payment','high',8,false),('refund','high',24,false),('fare_dispute','high',24,false),('driver_complaint','normal',24,true),
  ('lost_item','normal',24,false),('booking','normal',24,false),('appeal','normal',72,false),('account','normal',48,false),('other','low',72,false)
  on conflict (category) do nothing;
