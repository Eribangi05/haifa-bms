// Idempotent seed of the growth round: PLACEHOLDER fixed routes, INACTIVE, with example prices. Called at the end of seedCore().
import { q, q1 } from '../db.js';

const ROUTES: [string, string, string, number, number, number, number, number, number, number][] = [
  ['Kigali Airport - City centre', 'Ikibuga cy\'indege cya Kigali - Mu mujyi rwagati', 'Aéroport de Kigali - Centre-ville', -1.9686, 30.1395, 1500, -1.9441, 30.0619, 2000, 8000],
  ['Kigali - Musanze', 'Kigali - Musanze', 'Kigali - Musanze', -1.9441, 30.0619, 6000, -1.4998, 29.6344, 4000, 60000],
  ['Kigali - Huye', 'Kigali - Huye', 'Kigali - Huye', -1.9441, 30.0619, 6000, -2.5967, 29.7394, 4000, 90000],
  ['Kigali - Rubavu', 'Kigali - Rubavu', 'Kigali - Rubavu', -1.9441, 30.0619, 6000, -1.6776, 29.2614, 4000, 110000],
];
export async function seedGrowth() {
  if (!(await q1("select 1 from service_categories where id='standard'"))) return;
  for (const r of ROUTES) {
    if (await q1('select 1 from fixed_routes where placeholder and name_en=$1', [r[0]])) continue;
    await q(`insert into fixed_routes(name_en,name_rw,name_fr,from_lat,from_lng,from_radius_m,to_lat,to_lng,to_radius_m,service_id,price,bidirectional,active,placeholder)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'standard',$10,true,false,true)`, r);
  }
}
