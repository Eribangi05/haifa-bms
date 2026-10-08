// Shared API payload types (the subset of the backend responses the app reads).
export type Pt = { lat: number; lng: number; name?: string };
export type Place = { id?: string; name: string; lat: number; lng: number; kind?: string; designated_pickup?: boolean };
export type SavedPlace = Place & { id: string; label: 'home' | 'work' | 'school' | 'other' };
export type Svc = 'ride' | 'abasare';
export type Venue = Pt & { note?: string; code?: string };

export type FareLine = { label_en: string; label_rw?: string; label_fr?: string; amount: number };
export type Fare = { total: number; discount?: number; lines: FareLine[] };
export type FareOption = {
  service_id: string; kind: 'ride' | 'abasare'; available: boolean; reason?: string; quote_id?: string; capacity?: number; fare?: Fare;
  name_en: string; name_rw?: string; name_fr?: string; pickup_eta_s?: number | null; route_source?: string; promo?: { discount?: number } | null;
};
export type Estimate = { options: FareOption[]; alternatives: unknown[] };

export type PaymentView = { id: string; method: string; status: string; amount: number; amount_collected?: number | null; reference?: string; failure_reason?: string | null; outstanding?: number; simulated?: boolean };
export type HandoverRec = { phase: 'pickup' | 'dropoff'; odometer_km: number; fuel_percent: number; notes?: string | null; damage_noted?: boolean; owner_response?: 'ok' | 'issue' | null; photos: string[] };
export type CustomerCar = { id: string; plate: string; make?: string | null; model?: string | null; color?: string | null; vehicle_class: string; transmission: string; insurance_confirmed?: boolean };
export type AbasareView = { mode: 'p2p' | 'hourly'; hours?: number; vehicle: CustomerCar; handovers: HandoverRec[]; photos_pending: { pickup: number; dropoff: number } };
export type DriverView = { name: string; rating: number; rating_count: number; trips?: number; photo_url?: string | null; abasare?: { years_experience?: number | null; return_mode?: string | null } };

export type Booking = {
  id: string; ref: string; status: string; service_id?: string;
  pickup: Pt & { note?: string | null }; destination: Pt;
  estimated_fare: number | null; final_fare: number | null; payment_method: string; payer_type?: string; scheduled_for?: string | null;
  requested_at: string; completed_at?: string | null; cancel_fee?: number | null; distance_m?: number; duration_s?: number;
  started_at?: string | null; passenger?: { first_name: string }; estimated_driver_net?: number | null;
  driver?: DriverView; vehicle?: { make?: string; model?: string; color?: string; plate: string; type?: string };
  driver_location?: { lat: number; lng: number; at?: string }; trip_pin?: string; payment?: PaymentView; abasare?: AbasareView;
};
export type Receipt = { receipt_no: string; issued_at: string; status: string; currency: string; total: number | null; route: { from?: string; to?: string; distance_m?: number; duration_s?: number }; fare?: Fare; payment: { method: string; status: string; reference?: string; paid_at?: string } | null; driver?: { name: string; plate?: string } | null };
export type ChatMessage = { id: string; sender_id: string; body: string; created_at?: string };

export type Offer = { booking_id: string; expires_at: string; eta_s: number; distance_m: number; driver_net: number; pickup_name?: string; pickup_note?: string; dest_name?: string; payment_method: string; trip_distance_m: number; trip_duration_s: number; hire_mode?: 'p2p' | 'hourly' | null; hours_booked?: number; cv_class?: string; cv_transmission?: string };
export type Requirement = { doc_type: string; mandatory: boolean; requires_expiry?: boolean };
export type DriverDoc = { id: string; doc_type: string; review_status: string; review_note?: string | null; expiry_date?: string | null };
export type Permission = { can_work: boolean; reasons?: string[]; expired_documents?: string[]; missing_documents?: string[] };
export type DriverStatus = {
  profile: { status: string; status_reason?: string | null; is_online?: boolean; accepting?: string[]; legal_name?: string; payout_msisdn?: string; rating_avg: number | string; completed_count: number };
  vehicle?: { vehicle_type: string; make: string; model: string; color: string; plate: string; capacity: number } | null;
  abasare?: { status: string; reason?: string | null; permission?: Permission; skills?: { licence_since?: string; years_experience?: number; transmissions?: string[]; classes?: string[]; return_mode?: string } };
  permission?: Permission; requirements?: Requirement[]; documents: DriverDoc[]; fleet_invites?: { id: string; name: string }[];
};
export type EarningsView = { net: number; trips: number; total_fares: number; commission: number; cash_collected: number; mobile_money_collected: number; rating: number; balance?: { eligible_payout: number; owed_to_platform: number } };
export type SupportCase = { id: string; ref: string; subject: string; status: string };
export type Faq = { id: string; [k: string]: unknown };
export type Contact = { id: string; name: string; phone: string };
