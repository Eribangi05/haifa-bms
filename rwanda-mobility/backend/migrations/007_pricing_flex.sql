-- Pricing flexibility: time-of-day / day-of-week multiplier windows per pricing rule, and user-segment targeting for promotions.

-- [{ "label": "Morning peak", "days": [1,2,3,4,5] (0=Sunday, empty = every day), "start_hour": 7, "end_hour": 9 (1-24), "percent": 20 (-50..100) }]
alter table pricing_rules add column time_multipliers jsonb not null default '[]';

-- segment: who may use the code. first_ride mirrors first_ride_only; phones uses segment_phones; referred = signed up through a referral.
alter table promotions
  add column segment text not null default 'all' check (segment in ('all','first_ride','corporate','referred','phones')),
  add column segment_phones text[];
update promotions set segment='first_ride' where first_ride_only;
