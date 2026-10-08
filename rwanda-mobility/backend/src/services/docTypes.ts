// The document kinds a driver can upload (the upload endpoint accepts exactly these) with plain-English labels for the requirements editor.
export const DOC_LABELS: Record<string, string> = {
  national_id: 'National ID', driving_licence: 'Driving licence', profile_photo: 'Profile photo', vehicle_registration: 'Vehicle registration',
  insurance: 'Insurance certificate', transport_permit: 'Transport permit', inspection: 'Technical inspection', ownership_authorisation: 'Ownership authorisation', police_clearance: 'Police clearance certificate',
};
export const KNOWN_DOCS = Object.keys(DOC_LABELS);
