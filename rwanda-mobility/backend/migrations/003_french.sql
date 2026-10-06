-- French (fr) alongside Kinyarwanda (rw) and English (en): the UI never mixes languages, so the catalogue needs fr text too.
alter table service_categories add column name_fr text, add column description_fr text;
alter table places add column name_fr text;

-- backfill existing rows (idempotent; descriptions only where still empty so admin edits are kept)
update service_categories s set
  name_fr = coalesce(s.name_fr, v.name_fr),
  description_en = coalesce(s.description_en, v.d_en),
  description_rw = coalesce(s.description_rw, v.d_rw),
  description_fr = coalesce(s.description_fr, v.d_fr)
from (values
  ('moto','Moto','Quick and affordable motorbike ride for one passenger.','Urugendo rwihuse kandi ruhendutse kuri moto ku muntu umwe.','Course rapide et économique en moto pour un passager.'),
  ('standard','Voiture standard','Everyday car ride for up to 4 passengers.','Urugendo rwa buri munsi mu modoka ku bagenzi bagera kuri 4.','Course quotidienne en voiture pour jusqu''à 4 passagers.'),
  ('comfort','Voiture confort','A more comfortable car for up to 4 passengers.','Imodoka yisanzuye kurushaho ku bagenzi bagera kuri 4.','Une voiture plus confortable pour jusqu''à 4 passagers.'),
  ('family','Famille / groupe','A larger vehicle for families and groups of up to 6.','Imodoka nini ku miryango no ku matsinda agera ku bantu 6.','Un véhicule plus grand pour les familles et les groupes jusqu''à 6 personnes.'),
  ('airport','Transfert aéroport','Fixed pickup or drop-off at Kigali International Airport.','Kujyanwa cyangwa kuvanwa ku kibuga cy''indege mpuzamahanga cya Kigali.','Prise en charge ou dépose à l''aéroport international de Kigali.'),
  ('intercity','Course interurbaine','Rides between Kigali and other towns.','Ingendo hagati ya Kigali n''indi mijyi.','Courses entre Kigali et les autres villes.'),
  ('goods','Pick-up / petites marchandises','A pickup truck for small loads.','Imodoka ya pickup yo gutwara ibintu bito.','Un pick-up pour les petites charges.'),
  ('cargo','Camion / cargo','A truck for heavy or bulky cargo.','Ikamyo yo gutwara imizigo iremereye cyangwa minini.','Un camion pour les marchandises lourdes ou volumineuses.'),
  ('abasare','Abasare : ramenez-moi chez moi','A verified driver drives you home in your own car.','Umushoferi wagenzuwe agutwara mu modoka yawe akugeza mu rugo.','Un chauffeur vérifié vous ramène chez vous avec votre propre voiture.'),
  ('abasare_hourly','Abasare : chauffeur à l''heure','Hire a verified driver by the hour to drive your own car.','Kodesha umushoferi wagenzuwe ku isaha agutwarire imodoka yawe.','Louez les services d''un chauffeur vérifié à l''heure pour conduire votre voiture.')
) as v(id, name_fr, d_en, d_rw, d_fr) where s.id = v.id;

update places p set name_fr = v.name_fr
from (values
  ('Kigali International Airport (Kanombe)','Aéroport international de Kigali (Kanombe)'),
  ('Nyabugogo Bus Park','Gare routière de Nyabugogo'),
  ('Kigali Convention Centre','Kigali Convention Centre'),
  ('Kigali Heights','Kigali Heights'),
  ('Kimironko Market','Marché de Kimironko'),
  ('Remera Giporoso','Remera Giporoso'),
  ('Downtown / Kigali City Tower','Centre-ville / Kigali City Tower'),
  ('Kacyiru','Kacyiru'),
  ('Nyamirambo','Nyamirambo'),
  ('Gisozi Genocide Memorial','Mémorial du génocide de Gisozi'),
  ('CHUK Hospital','Hôpital CHUK'),
  ('King Faisal Hospital','Hôpital King Faisal'),
  ('Amahoro Stadium','Stade Amahoro'),
  ('Kicukiro Centre','Centre de Kicukiro')
) as v(name_en, name_fr) where p.name_en = v.name_en and p.name_fr is null;
