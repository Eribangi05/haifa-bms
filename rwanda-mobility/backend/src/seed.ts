import { pool, q, q1 } from './db.js';
import { ROLE_PERMISSIONS, STAFF_ROLES } from './rbac.js';
import { migrate } from './migrate.js';
import { config } from './config.js';
import { hashPassword, encrypt, newTotpSecret, totpUri } from './util/crypto.js';
import { audit } from './services/audit.js';
import { seedGrowth } from './services/growthSeed.js';

// Kigali operating zone: coarse bounding polygon (ASSUMPTION: replace with surveyed boundary).
const KIGALI_RING: [number, number][] = [[29.97, -2.06], [30.22, -2.06], [30.22, -1.84], [29.97, -1.84], [29.97, -2.06]];

const SERVICES = [
  // id, en, rw, vehicle_types, min_cap, comfort, pax, luggage, phase, enabled, sort
  ['moto', 'Moto', 'Moto', ['moto'], 1, false, 1, 'Small bag', 1, true, 1],
  ['standard', 'Standard car', 'Imodoka isanzwe', ['car'], 1, false, 4, '2 bags', 1, true, 2],
  ['comfort', 'Comfort car', 'Imodoka y\'icyubahiro', ['car'], 1, true, 4, '2 bags', 2, false, 3],
  ['family', 'Family / group', 'Imodoka y\'umuryango', ['minivan'], 6, false, 6, '4 bags', 2, false, 4],
  ['airport', 'Airport transfer', 'Kujya/Kuva ku kibuga', ['car', 'minivan'], 1, false, 4, '3 bags', 2, false, 5],
  ['intercity', 'Intercity ride', 'Urugendo hagati y\'imijyi', ['car', 'minivan'], 1, false, 4, '3 bags', 3, false, 6],
  ['goods', 'Pickup / light goods', 'Gutwara ibintu bito', ['pickup'], 1, false, 2, 'Cargo bed', 3, false, 7],
  ['cargo', 'Truck / cargo', 'Ikamyo', ['truck'], 1, false, 2, 'Cargo', 3, false, 8],
  ['abasare', 'Abasare: drive me home', 'Abasare: nshyire mu rugo', ['car', 'suv', 'minivan', 'pickup', 'moto'], 1, false, 4, 'Your own car', 1, true, 9],
  ['abasare_hourly', 'Abasare: driver by the hour', 'Abasare: umushoferi ku isaha', ['car', 'suv', 'minivan', 'pickup', 'moto'], 1, false, 4, 'Your own car', 1, true, 10],
] as const;

// French names + descriptions (en/rw/fr) for the catalogue. Applied only where empty, so admin edits survive re-seeding.
const SERVICE_TEXT: Record<string, [name_fr: string, d_en: string, d_rw: string, d_fr: string]> = {
  moto: ['Moto', 'Quick and affordable motorbike ride for one passenger.', 'Urugendo rwihuse kandi ruhendutse kuri moto ku muntu umwe.', 'Course rapide et économique en moto pour un passager.'],
  standard: ['Voiture standard', 'Everyday car ride for up to 4 passengers.', 'Urugendo rwa buri munsi mu modoka ku bagenzi bagera kuri 4.', 'Course quotidienne en voiture pour jusqu\'à 4 passagers.'],
  comfort: ['Voiture confort', 'A more comfortable car for up to 4 passengers.', 'Imodoka yisanzuye kurushaho ku bagenzi bagera kuri 4.', 'Une voiture plus confortable pour jusqu\'à 4 passagers.'],
  family: ['Famille / groupe', 'A larger vehicle for families and groups of up to 6.', 'Imodoka nini ku miryango no ku matsinda agera ku bantu 6.', 'Un véhicule plus grand pour les familles et les groupes jusqu\'à 6 personnes.'],
  airport: ['Transfert aéroport', 'Fixed pickup or drop-off at Kigali International Airport.', 'Kujyanwa cyangwa kuvanwa ku kibuga cy\'indege mpuzamahanga cya Kigali.', 'Prise en charge ou dépose à l\'aéroport international de Kigali.'],
  intercity: ['Course interurbaine', 'Rides between Kigali and other towns.', 'Ingendo hagati ya Kigali n\'indi mijyi.', 'Courses entre Kigali et les autres villes.'],
  goods: ['Pick-up / petites marchandises', 'A pickup truck for small loads.', 'Imodoka ya pickup yo gutwara ibintu bito.', 'Un pick-up pour les petites charges.'],
  cargo: ['Camion / cargo', 'A truck for heavy or bulky cargo.', 'Ikamyo yo gutwara imizigo iremereye cyangwa minini.', 'Un camion pour les marchandises lourdes ou volumineuses.'],
  abasare: ['Abasare : ramenez-moi chez moi', 'A verified driver drives you home in your own car.', 'Umushoferi wagenzuwe agutwara mu modoka yawe akugeza mu rugo.', 'Un chauffeur vérifié vous ramène chez vous avec votre propre voiture.'],
  abasare_hourly: ['Abasare : chauffeur à l\'heure', 'Hire a verified driver by the hour to drive your own car.', 'Kodesha umushoferi wagenzuwe ku isaha agutwarire imodoka yawe.', 'Louez les services d\'un chauffeur vérifié à l\'heure pour conduire votre voiture.'],
};
const PLACE_FR: Record<string, string> = {
  'Kigali International Airport (Kanombe)': 'Aéroport international de Kigali (Kanombe)',
  'Nyabugogo Bus Park': 'Gare routière de Nyabugogo',
  'Kigali Convention Centre': 'Kigali Convention Centre',
  'Kigali Heights': 'Kigali Heights',
  'Kimironko Market': 'Marché de Kimironko',
  'Remera Giporoso': 'Remera Giporoso',
  'Downtown / Kigali City Tower': 'Centre-ville / Kigali City Tower',
  'Kacyiru': 'Kacyiru',
  'Nyamirambo': 'Nyamirambo',
  'Gisozi Genocide Memorial': 'Mémorial du génocide de Gisozi',
  'CHUK Hospital': 'Hôpital CHUK',
  'King Faisal Hospital': 'Hôpital King Faisal',
  'Amahoro Stadium': 'Stade Amahoro',
  'Kicukiro Centre': 'Centre de Kicukiro',
};

// Placeholder tariffs (ASSUMPTION: must be replaced by the approved/regulated fare schedule before launch).
const RULES: Record<string, Partial<Record<string, number>>> = {
  moto: { base_fare: 400, per_km: 250, per_min: 20, minimum_fare: 800, booking_fee: 0, wait_per_min: 20 },
  standard: { base_fare: 1000, per_km: 700, per_min: 40, minimum_fare: 2000, booking_fee: 0, wait_per_min: 50 },
  comfort: { base_fare: 1500, per_km: 900, per_min: 50, minimum_fare: 3000, booking_fee: 0, wait_per_min: 60 },
  family: { base_fare: 2000, per_km: 1000, per_min: 60, minimum_fare: 4000, booking_fee: 0, wait_per_min: 80 },
  airport: { base_fare: 1500, per_km: 750, per_min: 40, minimum_fare: 4000, booking_fee: 0, wait_per_min: 60, airport_fee: 2000 },
};

const PLACES: [string, string, number, number, boolean][] = [
  ['Kigali International Airport (Kanombe)', 'Ikibuga cy\'indege cya Kigali', -1.9686, 30.1395, true],
  ['Nyabugogo Bus Park', 'Gare ya Nyabugogo', -1.9386, 30.0446, true],
  ['Kigali Convention Centre', 'Kigali Convention Centre', -1.9540, 30.0927, false],
  ['Kigali Heights', 'Kigali Heights', -1.9552, 30.0929, false],
  ['Kimironko Market', 'Isoko rya Kimironko', -1.9496, 30.1262, false],
  ['Remera Giporoso', 'Remera Giporoso', -1.9569, 30.1105, false],
  ['Downtown / Kigali City Tower', 'Mu mujyi rwagati', -1.9441, 30.0619, false],
  ['Kacyiru', 'Kacyiru', -1.9396, 30.0884, false],
  ['Nyamirambo', 'Nyamirambo', -1.9780, 30.0447, false],
  ['Gisozi Genocide Memorial', 'Urwibutso rwa Gisozi', -1.9304, 30.0603, false],
  ['CHUK Hospital', 'CHUK', -1.9519, 30.0610, false],
  ['King Faisal Hospital', 'King Faisal', -1.9448, 30.0881, false],
  ['Amahoro Stadium', 'Sitade Amahoro', -1.9546, 30.1048, false],
  ['Kicukiro Centre', 'Kicukiro', -1.9777, 30.1068, false],
];

const LEDGER: [string, string, string][] = [
  ['PROVIDER_CLEARING', 'Mobile-money provider clearing', 'asset'],
  ['CASH_WITH_DRIVERS', 'Cash collected held by drivers', 'asset'],
  ['CORPORATE_RECEIVABLE', 'Corporate accounts receivable', 'asset'],
  ['PLATFORM_BANK', 'Platform bank / settlement account', 'asset'],
  ['DRIVER_PAYABLE', 'Owed to drivers', 'liability'],
  ['PAYOUT_CLEARING', 'Payouts in flight', 'liability'],
  ['TAX_PAYABLE', 'Taxes collected for authorities', 'liability'],
  ['COMMISSION_REVENUE', 'Platform commission revenue', 'revenue'],
  ['FEE_REVENUE', 'Payout and service fee revenue', 'revenue'],
  ['PROCESSOR_FEES', 'Payment processing fees', 'expense'],
  ['PROMO_EXPENSE', 'Platform-funded discounts', 'expense'],
  ['REFUNDS', 'Refunds', 'expense'],
  ['ADJUSTMENTS', 'Manual adjustments', 'expense'],
  ['PASSENGER_RECEIVABLE', 'Passenger cancellation fees receivable', 'asset'],
  ['CANCELLATION_FEE_REVENUE', 'Cancellation and no-show fee revenue', 'revenue'],
  ['CANCELLATION_FEE_WAIVED', 'Cancellation fees waived by staff', 'expense'],
];

const FLAGS: [string, boolean, string][] = [
  ['payments.mtn_momo', true, 'MTN MoMo payments (sandbox/simulator until live credentials)'],
  ['payments.airtel_money', false, 'Airtel Money (adapter skeleton, PENDING INTEGRATION)'],
  ['payments.wallet', false, 'Prepaid wallet (needs legal/financial review)'],
  ['pricing.negotiated', false, 'Passenger-proposed fares (check legality)'],
  ['pricing.surge', false, 'Demand-based pricing (disabled until approved)'],
  ['booking.scheduled', true, 'Scheduled rides'],
  ['booking.requests', true, 'New ride requests (turn off to pause every new request, e.g. for maintenance; riders see the message)'],
  ['chat.enabled', true, 'In-app chat between rider and driver during a trip'],
  ['map.nearby_drivers', true, 'Show online drivers near the rider on the rider map (positions are blurred, no driver names)'],
  ['navigation.enabled', true, 'Turn-by-turn navigation view for drivers'],
  ['referral.rewards', true, 'Referral rewards screen and credit'],
  ['corporate.enabled', true, 'Corporate accounts'],
  ['fleet.enabled', true, 'Fleet operator portal'],
  ['promotions.enabled', true, 'Promotions and referrals'],
  ['payouts.automated', false, 'Automated MoMo disbursements (PENDING INTEGRATION)'],
  ['auth.social', false, 'Google/Apple sign-in (PENDING INTEGRATION)'],
  ['notifications.whatsapp', false, 'WhatsApp Business (needs approval)'],
  ['abasare.enabled', true, 'Abasare: hire a verified driver for your own car'],
];

export async function seedCore() {
  await migrate(false);
  await q(`insert into service_zones(id,name,polygon) values ('kigali','Kigali',$1) on conflict do nothing`, [JSON.stringify(KIGALI_RING)]);
  for (const s of SERVICES) {
    await q(`insert into service_categories(id,name_en,name_rw,vehicle_types,min_capacity,requires_comfort,passenger_capacity,luggage,phase,enabled,sort)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`, [...s]);
    await q(`insert into zone_services(zone_id,service_id,enabled) values ('kigali',$1,$2) on conflict do nothing`, [s[0], s[9]]);
  }
  await q("update service_categories set kind='abasare' where id like 'abasare%'");
  for (const [id, t] of Object.entries(SERVICE_TEXT))
    await q(`update service_categories set name_fr=coalesce(name_fr,$2), description_en=coalesce(description_en,$3), description_rw=coalesce(description_rw,$4), description_fr=coalesce(description_fr,$5) where id=$1`, [id, ...t]);
  for (const [sid, r] of Object.entries(RULES)) {
    const exists = await q1('select 1 from pricing_rules where service_id=$1', [sid]);
    if (exists) continue;
    await q(`insert into pricing_rules(service_id,zone_id,base_fare,per_km,per_min,minimum_fare,booking_fee,wait_per_min,airport_fee,status)
             values ($1,'kigali',$2,$3,$4,$5,$6,$7,$8,'active')`,
      [sid, r.base_fare, r.per_km, r.per_min, r.minimum_fare, r.booking_fee ?? 0, r.wait_per_min ?? 0, r.airport_fee ?? 0]);
  }
  // Abasare tariffs (PLACEHOLDERS, competitive with the 5,000-7,000 RWF per night trip reported in the press; confirm with the client).
  // Point-to-point: 2,000 + 300/km + 100/km driver-return allowance, min 4,000, +1,000 night band (22:00-05:00 Kigali time).
  if (!(await q1("select 1 from pricing_rules where service_id='abasare'")))
    await q(`insert into pricing_rules(service_id,zone_id,base_fare,per_km,per_min,minimum_fare,booking_fee,wait_per_min,free_wait_min,return_per_km,night_start_hour,night_end_hour,night_fee,rounding,status)
             values ('abasare','kigali',2000,300,0,4000,0,50,10,100,22,5,1000,100,'active')`);
  // Hourly: 4,000/h (min 2 h), 3,500/h from 8 h, overtime 2,500 per 30 min after a 10-min grace; night band +1,000.
  if (!(await q1("select 1 from pricing_rules where service_id='abasare_hourly'")))
    await q(`insert into pricing_rules(service_id,zone_id,billing,base_fare,per_km,per_min,minimum_fare,booking_fee,hourly_rate,min_hours,max_hours,long_hire_hours,long_hire_rate,overtime_per_30min,overtime_grace_min,night_start_hour,night_end_hour,night_fee,rounding,status)
             values ('abasare_hourly','kigali','hourly',0,0,0,0,0,4000,2,12,8,3500,2500,10,22,5,1000,100,'active')`);
  if (!(await q1("select 1 from commission_rules where service_id='abasare'")))
    await q(`insert into commission_rules(service_id,kind,percent_bps,status,note) values ('abasare','percent',1200,'active','Abasare introductory 12%'),('abasare_hourly','percent',1200,'active','Abasare introductory 12%')`);
  if (!(await q1("select 1 from commission_rules where service_id is null and fleet_id is null and driver_id is null"))) {
    // Default 15% (ASSUMPTION; configurable and approval-gated). Moto 12%.
    await q(`insert into commission_rules(kind,percent_bps,status,note) values ('percent',1500,'active','platform default')`);
    await q(`insert into commission_rules(service_id,kind,percent_bps,status,note) values ('moto','percent',1200,'active','moto default')`);
  }
  const docs: [string, string, boolean, boolean][] = [];
  for (const vt of ['moto', 'car', 'minivan', 'pickup', 'truck']) {
    docs.push([vt, 'national_id', true, true], [vt, 'driving_licence', true, true], [vt, 'profile_photo', true, false],
      [vt, 'vehicle_registration', true, true], [vt, 'insurance', true, true], [vt, 'transport_permit', false, true]);
    if (vt !== 'moto') docs.push([vt, 'inspection', true, true]);
  }
  for (const d of docs) await q('insert into document_requirements(vehicle_type,doc_type,mandatory,requires_expiry) values ($1,$2,$3,$4) on conflict do nothing', d);
  // Abasare documents (the driver drives the customer's car, so no vehicle documents; police clearance is mandatory)
  for (const d of [['national_id', true, true], ['driving_licence', true, true], ['profile_photo', true, false], ['police_clearance', true, true]] as const)
    await q("insert into document_requirements(vehicle_type,doc_type,mandatory,requires_expiry) values ('abasare',$1,$2,$3) on conflict do nothing", [d[0], d[1], d[2]]);
  for (const p of PLACES) {
    if (!(await q1('select 1 from places where name_en=$1', [p[0]])))
      await q("insert into places(name_en,name_rw,lat,lng,zone_id,designated_pickup) values ($1,$2,$3,$4,'kigali',$5)", [p[0], p[1], p[2], p[3], p[4]]);
  }
  for (const [en, fr] of Object.entries(PLACE_FR)) await q('update places set name_fr=$2 where name_en=$1 and name_fr is null', [en, fr]);
  for (const [c, n, t] of LEDGER) await q('insert into ledger_accounts values ($1,$2,$3) on conflict do nothing', [c, n, t]);
  for (const [k, e, d] of FLAGS) await q('insert into feature_flags(key,enabled,description) values ($1,$2,$3) on conflict do nothing', [k, e, d]);
  // flags the apps read through GET /config/flags (the rest stay server-side)
  await q("update feature_flags set client_visible=true where key = any($1) and client_visible=false and updated_by is null", [['booking.requests', 'chat.enabled', 'map.nearby_drivers', 'navigation.enabled', 'referral.rewards', 'abasare.enabled', 'booking.scheduled', 'corporate.enabled', 'promotions.enabled']]);
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    await q('insert into roles(name, builtin, is_staff) values ($1, true, $2) on conflict do nothing', [role, STAFF_ROLES.includes(role)]);
    // Rows mirror the code defaults for roles nobody has customised (informational: the code defaults apply anyway). A customised role is never overwritten.
    if (!(await q1('select 1 from roles where name=$1 and customized', [role]))) {
      await q('delete from role_permissions where role=$1', [role]);
      for (const p of perms) await q('insert into role_permissions values ($1,$2) on conflict do nothing', [role, p]);
    }
  }
  await q(`insert into promotions(code,kind,value,max_discount,min_fare,per_user_limit,first_ride_only,budget)
           values ('WELCOME','percent',20,1500,1500,1,true,500000) on conflict do nothing`);
  await seedGrowth();   // round 2: PLACEHOLDER fixed routes (inactive)
}

export async function createStaff(email: string, password: string, role: string, name = email) {
  const secret = newTotpSecret();
  const u = await q1<{ id: string }>(
    `insert into users(email,password_hash,display_name,mfa_secret_enc,mfa_enabled) values ($1,$2,$3,$4,true)
     on conflict (email) do update set password_hash=excluded.password_hash, mfa_secret_enc=excluded.mfa_secret_enc returning id`,
    [email, await hashPassword(password), name, encrypt(secret)]);
  await q('insert into user_roles values ($1,$2) on conflict do nothing', [u!.id, role]);
  return { id: u!.id, totpSecret: secret };
}

/** Create the first super admin on server start when BOOTSTRAP_ADMIN_PASSWORD is set and none exists yet.
 *  Never touches an existing admin (so a restart cannot reset a password or MFA secret). Prints the TOTP secret once. */
export async function bootstrapAdminIfMissing(log: (m: string) => void = console.log): Promise<boolean> {
  if (config.bootstrapAdminPassword.length < 12) return false;
  const exists = await q1("select 1 from user_roles where role='super_admin' limit 1");
  if (exists) return false;
  const a = await createStaff(config.bootstrapAdminEmail, config.bootstrapAdminPassword, 'super_admin', 'Super Admin');
  log(`FIRST SUPER ADMIN CREATED: ${config.bootstrapAdminEmail}\nTOTP secret (add to your authenticator app NOW, shown once): ${a.totpSecret}\n${totpUri(a.totpSecret, config.bootstrapAdminEmail)}`);
  return true;
}

/** Recovery path for a lost/invalid authenticator: generates a new TOTP secret for one staff account, once per distinct token. */
export async function resetStaffMfaIfRequested(log: (m: string) => void = console.log): Promise<boolean> {
  const email = config.adminMfaResetEmail.trim().toLowerCase(), token = config.adminMfaResetToken;
  if (!email || token.length < 8) return false;
  const done = await q1<{ value: string }>("select value from system_settings where key='admin.mfa_reset_token'");
  if (done && done.value === token) return false;                      // already applied for this token
  const u = await q1<{ id: string }>(
    "select u.id from users u join user_roles r on r.user_id=u.id where lower(u.email)=$1 and r.role not in ('passenger','driver') limit 1", [email]);
  if (!u) { log(`MFA reset requested for ${email} but no such staff account exists`); return false; }
  const secret = newTotpSecret();
  await q('update users set mfa_secret_enc=$2, mfa_enabled=true where id=$1', [u.id, encrypt(secret)]);
  await q("insert into system_settings(key,value) values ('admin.mfa_reset_token',$1::jsonb) on conflict (key) do update set value=excluded.value, updated_at=now()", [JSON.stringify(token)]);
  await audit({ id: null, role: 'system' }, 'staff.mfa_reset', 'user', u.id, undefined, { via: 'ADMIN_MFA_RESET_TOKEN' });
  log(`STAFF MFA RESET for ${email}\nNew TOTP secret (add to your authenticator app NOW, shown once): ${secret}\n${totpUri(secret, email)}`);
  return true;
}

if (process.argv[1]?.endsWith('seed.ts')) {
  (async () => {
    await seedCore();
    console.log('core seed done (zones, services, pricing, commissions, places, ledger, flags, roles)');
    if (config.bootstrapAdminPassword.length >= 12) {
      const a = await createStaff(config.bootstrapAdminEmail, config.bootstrapAdminPassword, 'super_admin', 'Super Admin');
      console.log(`super admin: ${config.bootstrapAdminEmail}\nTOTP secret (add to authenticator app NOW, shown once): ${a.totpSecret}\n${totpUri(a.totpSecret, config.bootstrapAdminEmail)}`);
    } else console.log('Set BOOTSTRAP_ADMIN_PASSWORD (>=12 chars) to create the first super admin.');
    await pool.end();
  })().catch((e) => { console.error(e); process.exit(1); });
}
