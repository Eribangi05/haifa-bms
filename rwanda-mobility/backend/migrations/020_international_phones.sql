-- People can sign in and be listed as contacts with a phone number from any country (E.164: "+" and 8 to 15 digits).
-- Mobile-money, fleet and USSD numbers stay Rwandan (their tables keep the +250 check).
alter table users drop constraint if exists users_phone_check;
alter table users add constraint users_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$');
alter table emergency_contacts drop constraint if exists emergency_contacts_phone_check;
alter table emergency_contacts add constraint emergency_contacts_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$');
alter table sms_opt_outs drop constraint if exists sms_opt_outs_phone_check;
alter table sms_opt_outs add constraint sms_opt_outs_phone_check check (phone ~ '^\+[1-9][0-9]{7,14}$');
