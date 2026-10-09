// Driver categories (owner-driver, Abasare driver, both): chooser, application progress, guide pages, profile pages, earnings split.
// r5.rw.ts and r5.fr.ts must define exactly the same keys.
export const r5en = {
  // categories
  'dk.own': 'Owner-driver', 'dk.abasare': 'Abasare driver', 'dk.both': 'Owner-driver and Abasare', 'dk.new': 'New driver',
  'dk.own.sub': 'You drive your own vehicle and take ride requests.',
  'dk.abasare.sub': 'No vehicle needed: you drive customers\' own cars, at home time or by the hour.',
  'dk.both.sub': 'You take ride requests in your vehicle and Abasare jobs in customers\' cars.',
  'dk.new.sub': 'Choose how you want to drive to get started.',
  'dk.jobs': 'Jobs you can receive', 'dk.job.ride': 'Rides in my vehicle', 'dk.job.abasare': 'Abasare: drive a customer\'s car',
  'dk.guide': 'How it works', 'dk.badge.own': 'Own vehicle', 'dk.badge.abasare': 'Abasare',

  // chooser
  'ds.title': 'How do you want to drive?', 'ds.sub': 'Pick what fits you today. You can add the other option later.',
  'ds.own.title': 'I have a vehicle', 'ds.own.tag': 'OWN VEHICLE',
  'ds.own.b1': 'Take ride requests with your moto or car', 'ds.own.b2': 'You choose when to work', 'ds.own.b3': 'You can also take Abasare jobs once approved',
  'ds.own.need': 'You need: national ID, driving licence, vehicle registration, insurance, profile photo',
  'ds.ab.title': 'I do not have a vehicle', 'ds.ab.tag': 'ABASARE',
  'ds.ab.b1': 'Drive customers\' own cars: home after a night out, or by the hour', 'ds.ab.b2': 'No vehicle, fuel or repair costs for you', 'ds.ab.b3': 'Trusted work with photo checks of the car at start and end',
  'ds.ab.need': 'You need: national ID, driving licence with experience, police clearance, profile photo',
  'ds.cta.own': 'Start with my vehicle', 'ds.cta.ab': 'Apply as an Abasare driver', 'ds.both': 'Own a vehicle? You can do both: ride jobs in your vehicle and Abasare jobs in customers\' cars.',
  'ds.guide': 'See how each option works',

  // application progress
  'st.title': 'Your application', 'st.path': 'Choose', 'st.details': 'Details', 'st.documents': 'Documents', 'st.review': 'Review', 'st.approved': 'Approved',
  'st.help.path': 'Choose how you want to drive.', 'st.help.documents': 'Upload every required document, then submit.', 'st.help.review': 'We are checking your documents. This usually takes a short while.', 'st.help.approved': 'You can go online and receive jobs.',
  'st.help.info': 'We need more information. Check the note on the document below and upload it again.',

  // guide pages
  'dg.own.title': 'Driving with your vehicle', 'dg.ab.title': 'Driving with Abasare',
  'dg.next': 'Next', 'dg.back': 'Back', 'dg.done': 'Got it', 'dg.skip': 'Skip', 'dg.step': 'Step {n} of {total}',
  'dg.own.1.t': 'Go online', 'dg.own.1.d': 'Switch on Go online. Your location is shared only while you are online or on a trip.',
  'dg.own.2.t': 'Accept a ride', 'dg.own.2.d': 'Each offer shows your earnings and the distance. Accept the ones you like before the timer ends.',
  'dg.own.3.t': 'Start with the PIN', 'dg.own.3.d': 'Drive to the pickup, tap arrived, then ask the passenger for the 4-digit trip PIN to start.',
  'dg.own.4.t': 'Get paid', 'dg.own.4.d': 'Cash or Mobile Money. Earnings, commission and payouts are always visible in Earnings.',
  'dg.ab.1.t': 'Drive the customer\'s car', 'dg.ab.1.d': 'Abasare customers hire you to drive their own car, home after an evening out or by the hour. You need no vehicle.',
  'dg.ab.2.t': 'Check the car first', 'dg.ab.2.d': 'At pickup you take photos of the car and note fuel and the odometer. The owner confirms them.',
  'dg.ab.3.t': 'Drive with care', 'dg.ab.3.d': 'Keep the car and the owner safe. Follow the route the owner asks for and report any problem at once.',
  'dg.ab.4.t': 'Check out together', 'dg.ab.4.d': 'At the end you repeat the photos, fuel and odometer. The owner confirms: no surprises for anyone.',
  'dg.ab.5.t': 'Get back home', 'dg.ab.5.d': 'Your way back is planned: moto, taxi, your own way or on foot, as you chose in your application.',
  'dg.ab.6.t': 'Get paid fairly', 'dg.ab.6.d': 'Hourly packages or trips home. Night rates are shown before you accept.',

  // profile pages
  'pf.title': 'My driver profile', 'pf.overview': 'Overview', 'pf.vehicle': 'Vehicle', 'pf.abasare': 'Abasare', 'pf.documents': 'Documents',
  'pf.cat': 'Your driver category', 'pf.perm': 'What you may do', 'pf.perm.ride': 'Ride jobs', 'pf.perm.abasare': 'Abasare jobs',
  'pf.allowed': 'Allowed', 'pf.notyet': 'Not allowed yet', 'pf.notapplied': 'Not applied',
  'pf.v.none': 'You drive customers\' cars, so you do not need a vehicle. Your work is on the Abasare page.',
  'pf.v.rides': 'Ride jobs with this vehicle', 'pf.v.recent': 'Recent ride jobs', 'pf.v.norides': 'Your ride jobs will be listed here.',
  'pf.v.add': 'Own a vehicle too? Ask support to add it to your account.', 'pf.v.support': 'Contact support',
  'pf.a.status': 'Abasare status', 'pf.a.skills': 'Your driving profile', 'pf.a.licence': 'Licence since', 'pf.a.exp': 'Years of experience', 'pf.a.trans': 'Gearboxes', 'pf.a.classes': 'Car types', 'pf.a.return': 'How you get home',
  'pf.a.jobs': 'Abasare jobs', 'pf.a.jobs.empty': 'Your Abasare jobs will appear here.', 'pf.a.mode.p2p': 'Drive me home', 'pf.a.mode.hourly': 'By the hour: {h} h',
  'pf.a.apply': 'Add Abasare to my account', 'pf.a.apply.sub': 'You have a vehicle and can also drive customers\' cars. Apply to unlock Abasare jobs.', 'pf.a.guide': 'Abasare driver guide',
  'pf.d.intro': 'Keep every document valid to keep receiving jobs. Replace a document before it expires.',

  // earnings split
  'er.split': 'Earnings by job type', 'er.ride': 'Rides', 'er.abasare': 'Abasare', 'er.jobs': '{n} jobs', 'er.latest': 'Latest 50 jobs',
  'dt.f.all': 'All jobs', 'dt.f.ride': 'Rides', 'dt.f.abasare': 'Abasare',
  'ap.title': 'Apply for Abasare', 'ap.sub': 'Tell us about your driving. We check your documents before you receive Abasare jobs.', 'ap.sent': 'Application sent. We will review it.',
} as const;
