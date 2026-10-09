// Navigation redesign strings (English source): bottom tabs, Home overview, Trips, Wallet, Account and the driver tabs.
// r4.rw.ts and r4.fr.ts must define exactly the same keys.
export const tabsEn = {
  'tab.home': 'Home', 'tab.book': 'Book', 'tab.trips': 'Trips', 'tab.wallet': 'Wallet', 'tab.account': 'Account',
  'tab.drv.work': 'Jobs', 'tab.drv.earn': 'Earnings', 'tab.drv.car': 'Profile',
  'mo.1': 'January', 'mo.2': 'February', 'mo.3': 'March', 'mo.4': 'April', 'mo.5': 'May', 'mo.6': 'June', 'mo.7': 'July', 'mo.8': 'August', 'mo.9': 'September', 'mo.10': 'October', 'mo.11': 'November', 'mo.12': 'December',

  // Home overview
  'ov.greet.morning': 'Good morning', 'ov.greet.afternoon': 'Good afternoon', 'ov.greet.evening': 'Good evening',
  'ov.hero.sub': 'Where would you like to go today?', 'ov.where': 'Where to?', 'ov.where.hint': 'Search a place or landmark',
  'ov.quick': 'Quick actions',
  'ov.qa.ride': 'Book a ride', 'ov.qa.abasare': 'Hire a driver', 'ov.qa.scan': 'Scan QR code', 'ov.qa.schedule': 'Scheduled rides', 'ov.qa.places': 'Saved places', 'ov.qa.help': 'Help and support',
  'ov.stats': 'Your activity', 'ov.stat.trips': 'Trips', 'ov.stat.km': 'Kilometres', 'ov.stat.spent': 'Spent', 'ov.stat.credit': 'Credit', 'ov.stat.time': 'Minutes on the road',
  'ov.stats.empty': 'Your trip statistics will appear here after your first ride.',
  'ov.stats.note': 'Based on your latest 50 trips.',
  'ov.safety.title': 'Your safety', 'ov.safety.body': 'Trusted contacts can follow your trips live. Emergency numbers are always one tap away.',
  'ov.safety.contacts': 'Trusted contacts', 'ov.safety.police': 'Police {n}', 'ov.safety.ambulance': 'Ambulance {n}',
  'ov.trending': 'Trending places', 'ov.trending.sub': 'Popular destinations in Rwanda. Tap one to book.',
  'ov.recent': 'Recent trips', 'ov.seeall': 'See all',
  'ov.drive.title': 'Earn with Abasare', 'ov.drive.body': 'Drive with your own vehicle, or drive customers\' cars, and earn on every trip.', 'ov.drive.cta': 'Start driving',
  'ov.drive.switch': 'Open driver mode',
  'ov.tip.title': 'Good to know', 'ov.tip.1': 'Check the plate before you get in, and share the trip PIN only inside the vehicle.', 'ov.tip.2': 'Share your trip with a trusted contact from the trip screen.', 'ov.tip.3': 'You can schedule a ride in advance for early flights and appointments.',
  'ov.active.open': 'Open trip',

  // Book (map) tab
  'book.title': 'Book a ride', 'book.map': 'Map',

  // Trips tab
  'trips.title': 'My trips', 'trips.f.all': 'All', 'trips.f.done': 'Completed', 'trips.f.cancelled': 'Cancelled', 'trips.f.upcoming': 'Upcoming',
  'trips.empty.filter': 'No trips match this filter.', 'trips.latest': 'Showing your latest 50 trips.', 'trips.summary': 'Summary',

  // Wallet tab
  'wal.title': 'Wallet and payments', 'wal.credit': 'Credit balance', 'wal.credit.open': 'Credit and rewards', 'wal.credit.sub': 'Statement, loyalty points and redeeming',
  'wal.spend': 'Spending', 'wal.spend.month': 'This month', 'wal.spend.all': 'Latest 50 trips', 'wal.avg': 'Average fare',
  'wal.mix': 'How you paid', 'wal.mix.cash': 'Cash', 'wal.mix.momo': 'Mobile Money', 'wal.mix.credit': 'Credit', 'wal.mix.other': 'Other',
  'wal.months': 'Month by month', 'wal.month.trips': '{n} trips',
  'wal.debt.title': 'Balance to pay', 'wal.debt.body': 'You owe {n} RWF from earlier trips. It is added to your next fare.',
  'wal.history': 'Payment history', 'wal.history.empty.title': 'No payments yet', 'wal.history.empty': 'Your receipts will appear here after your first completed trip.',
  'wal.methods': 'Payment methods', 'wal.methods.body': 'Pay by cash, MTN Mobile Money or credit. You choose when you book a ride.',
  'wal.claims': 'Claims and refunds', 'wal.claims.sub': 'Report a lost item, damage or a wrong charge',
  'wal.receipt': 'Receipt',

  // Account tab
  'acc.title': 'Account', 'acc.edit': 'Edit profile', 'acc.edit.sub': 'Name, notifications, saved places, trusted contacts',
  'acc.language': 'Language', 'acc.language.sub': 'The whole app switches to the language you choose.',
  'acc.g.account': 'My account', 'acc.g.rides': 'Rides and safety', 'acc.g.money': 'Money', 'acc.g.driving': 'Driving', 'acc.g.app': 'App', 'acc.g.help': 'Help',
  'acc.help': 'Help and support', 'acc.help.sub': 'Common questions and contact',
  'acc.invite': 'Invite friends', 'acc.invite.sub': 'Share your code and earn rewards',
  'acc.rider': 'Rider', 'acc.driver': 'Driver',
  'acc.mode.driver': 'Switch to driver mode', 'acc.mode.rider': 'Switch to rider mode', 'acc.mode.sub': 'Use the app as a passenger or as a driver',
  'acc.version': 'Version {v}',
  'acc.signout.sub': 'You can sign in again with your phone number',

  // Driver tabs
  'dh.today': 'Today', 'dh.stat.trips': 'Trips', 'dh.stat.earned': 'Earned', 'dh.stat.rating': 'Rating', 'dh.stat.online': 'Status',
  'dh.switch': 'Switch to rider mode',
  'dt.title': 'My trips', 'dt.empty.title': 'No trips yet', 'dt.empty': 'Trips you complete will be listed here with their fares.', 'dt.net': 'You earn {n} RWF', 'dt.total': 'Trips total', 'dt.today': 'Today',
  'de.title': 'Earnings and payouts',
  'vh.title': 'Vehicle and driving record', 'vh.record': 'Driving record', 'vh.rating': 'Rating', 'vh.trips': 'Completed trips', 'vh.status': 'Account status',
  'vh.vehicle': 'My vehicle', 'vh.novehicle': 'No vehicle added yet. Complete your driver application to add one.', 'vh.apply': 'Open driver application',
  'vh.docs': 'Documents', 'vh.docs.valid': 'Valid', 'vh.docs.until': 'Valid until {date}', 'vh.docs.review': 'Under review', 'vh.docs.rejected': 'Rejected', 'vh.docs.missing': 'Missing', 'vh.docs.manage': 'Manage documents',
  'vh.abasare': 'Abasare driver', 'vh.badges': 'Badges', 'vh.growth': 'Grow your earnings',
} as const;
