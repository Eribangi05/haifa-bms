-- Optional long-pickup charge (all zero = off) and a rating for passengers (given by drivers).
alter table pricing_rules
  add column pickup_free_km int not null default 0 check (pickup_free_km >= 0),
  add column pickup_per_km int not null default 0 check (pickup_per_km >= 0),
  add column pickup_max int not null default 0 check (pickup_max >= 0);
alter table users
  add column passenger_rating_avg numeric(3,2),
  add column passenger_rating_count int not null default 0;
