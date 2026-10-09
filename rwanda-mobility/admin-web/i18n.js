'use strict';
// Console language (Kinyarwanda / French / English). The views are written in English; this file translates what the page shows, one language at a time,
// by exact text: menu, headings, buttons, table headings, statuses and the most used sentences. A text that is not in the lists below stays in English
// (never a half-translated sentence), and is easy to add: put it in RW and FR. Review by a native speaker is still pending (docs/FEATURE_STATUS.md).
const L_RW = {
  'Operations': 'Imikorere', 'People and support': 'Abantu n\'ubufasha', 'Money': 'Amafaranga', 'Business': 'Ubucuruzi', 'Administration': 'Ubuyobozi',
  'Overview': 'Incamake', 'Live map': 'Ikarita ihita', 'Bookings': 'Ingendo zasabwe', 'Drivers': 'Abashoferi', 'Review queue': 'Ibitegereje isuzuma', 'Operations dashboard': 'Imbonerahamwe y\'imikorere',
  'Alerts': 'Impuruza', 'Abasare': 'Abasare', 'Safety': 'Umutekano', 'Trust and safety': 'Icyizere n\'umutekano', 'USSD channel': 'USSD', 'Demand map': 'Ikarita y\'ibisabwa', 'Passengers': 'Abagenzi', 'Support': 'Ubufasha',
  'Privacy': 'Ibanga', 'Claims': 'Ibirego', 'Finance': 'Imari', 'Credit & loyalty': 'Inguzanyo n\'ibihembo', 'Pricing': 'Ibiciro', 'Services': 'Serivisi', 'Promotions': 'Kugabanya ibiciro', 'Request codes': 'Kode z\'ubusabe',
  'Fixed-price routes': 'Inzira z\'igiciro kimwe', 'Driver quests': 'Intego z\'abashoferi', 'Referrals': 'Gutumira', 'Campaigns': 'Ubukangurambaga', 'Venue partners': 'Abafatanyabikorwa', 'Business & fleets': 'Ibigo n\'imodoka',
  'Settings': 'Igenamiterere', 'Audit log': 'Amateka y\'ibikorwa', 'Staff': 'Abakozi', 'Places and zones': 'Ahantu n\'uturere', 'Content and rules': 'Ibikubiyemo n\'amategeko', 'Feature flags': 'Ibyemezo by\'ibiranga', 'Your venue': 'Aho ukorera',
  'Sign out': 'Sohoka', 'Sign in': 'Injira', 'Staff sign-in': 'Injira nk\'umukozi', 'Email': 'Imeri', 'Password': 'Ijambobanga', '6-digit authenticator code': 'Kode y\'imibare 6 ya authenticator',
  'Go to…  (press /)': 'Jya kuri…  (kanda /)', 'Skip to content': 'Simbuka ujye ku bikubiyemo', 'Operations console for the Abasare team: bookings, drivers, support and safety in one place.': 'Aho abakozi ba Abasare bayobora ingendo, abashoferi, ubufasha n\'umutekano ahantu hamwe.',
  'Ride · Work · Explore': 'Genda · Kora · Sura', 'Abasare · Kigali, Rwanda': 'Abasare · Kigali, u Rwanda', 'Staff accounts require two-factor authentication. Lost your authenticator? Ask a super admin.': 'Konti z\'abakozi zisaba kwemeza kabiri. Wataye authenticator? Baza umuyobozi mukuru.',
  'Operations overview': 'Incamake y\'imikorere', 'Needs attention': 'Bisaba kwitabwaho', 'Right now': 'Ubu', 'Demand and fulfilment': 'Ibisabwa n\'ibyakozwe', 'Refresh': 'Vugurura', 'Last 7 days': 'Iminsi 7 ishize', 'Last 30 days': 'Iminsi 30 ishize', 'Last 90 days': 'Iminsi 90 ishize',
  'Drivers waiting for verification': 'Abashoferi bategereje kugenzurwa', 'Refunds awaiting approval': 'Gusubizwa amafaranga bitegereje kwemezwa', 'Support cases past SLA': 'Ibibazo byarenze igihe', 'Open safety incidents': 'Ibibazo by\'umutekano bifunguye',
  'Disputed trips': 'Ingendo zifite impaka', 'Requests with no driver found': 'Ubusabe butabonewe umushoferi', 'Drivers online': 'Abashoferi bari ku murongo', 'Active bookings': 'Ingendo zirimo gukorwa', 'Avg. time to assign a driver': 'Igihe giciriritse cyo kubona umushoferi', 'Avg. driver arrival': 'Igihe umushoferi agera',
  'Requests': 'Ubusabe', 'Completed trips': 'Ingendo zarangiye', 'Cancelled': 'Zahagaritswe', 'Fulfilment rate': 'Ijanisha ry\'ibyakozwe', 'Cancellation rate': 'Ijanisha ryo guhagarika',
  'Status': 'Imiterere', 'Ref': 'Nomero', 'Service': 'Serivisi', 'Passenger': 'Umugenzi', 'Driver': 'Umushoferi', 'Fare': 'Igiciro', 'Paid by': 'Yishyuwe na', 'Code': 'Kode', 'Created': 'Byakozwe', 'Name': 'Izina', 'Phone': 'Telefone', 'Vehicle': 'Imodoka', 'Online': 'Ari ku murongo', 'Rating': 'Amanota', 'Trips': 'Ingendo', 'Submitted': 'Yoherejwe',
  'Search': 'Shakisha', 'Any status': 'Imiterere yose', 'Download CSV': 'Kuramo CSV', 'Filter these rows...': 'Shungura iyi mirongo...', 'Save': 'Bika', 'Cancel': 'Bireke', 'Close': 'Funga', 'Edit': 'Hindura', 'Approve': 'Emeza', 'Reject': 'Anga', 'Reason': 'Impamvu', 'Resolve': 'Gukemura', 'Remove': 'Kuraho', 'Enable': 'Gushyira ku murongo', 'Disable': 'Guhagarika',
  'Delete': 'Siba', 'Reset': 'Subiza uko byari bimeze', 'Clear': 'Siba byose', 'Yes': 'Yego', 'No': 'Oya', 'Back': 'Inyuma', 'Next': 'Komeza', 'Previous': 'Ibibanza', 'View': 'Reba', 'Note': 'Icyitonderwa', 'Amount': 'Amafaranga', 'Type': 'Ubwoko', 'Title': 'Umutwe', 'Message': 'Ubutumwa', 'Action': 'Igikorwa', 'When': 'Igihe', 'Active': 'Bikora', 'Waiting': 'Bitegereje', 'Completed': 'Byarangiye',
  'Find a setting': 'Shakisha igenamiterere', 'Light / dark': 'Urumuri / umwijima', 'Switch between light and dark theme': 'Hindura urumuri cyangwa umwijima', 'Main navigation': 'Menu nkuru', 'Breadcrumb': 'Inzira y\'impapuro', 'Open menu': 'Fungura menu', 'Find a page': 'Shakisha urupapuro',
  'Safety incidents': 'Ibibazo by\'umutekano', 'Staff alerts': 'Impuruza z\'abakozi', 'Daily digest': 'Incamake y\'umunsi', 'Trips': 'Ingendo', 'Language': 'Ururimi', 'Sound alerts': 'Amajwi y\'impuruza', 'Turn on sound alerts': 'Fungura amajwi y\'impuruza', 'Sound alerts on': 'Amajwi y\'impuruza arafunguye',
  'New safety incident (SOS)': 'Ikibazo gishya cy\'umutekano (SOS)', 'New support cases': 'Ibibazo bishya by\'ubufasha', 'New staff alert': 'Impuruza nshya y\'abakozi', 'Requests with no driver': 'Ubusabe butabonewe umushoferi', 'Drivers waiting': 'Abashoferi bategereje',
  'Date': 'Itariki', 'Requested': 'Byasabwe', 'No driver found': 'Nta mushoferi wabonetse', 'Cancellation rate (%)': 'Ijanisha ryo guhagarika (%)', 'Platform commission': 'Komisiyo ya porogaramu', 'Cash collected': 'Amafaranga yakiriwe mu ntoki', 'New users': 'Abakoresha bashya', 'Suspicious activity': 'Ibikorwa bikekwa', 'Gross booking value': 'Agaciro kose k\'ingendo', 'Driver earnings': 'Ibyo abashoferi binjije',
};
const L_FR = {
  'Operations': 'Opérations', 'People and support': 'Personnes et assistance', 'Money': 'Argent', 'Business': 'Activité', 'Administration': 'Administration',
  'Overview': 'Vue d\'ensemble', 'Live map': 'Carte en direct', 'Bookings': 'Réservations', 'Drivers': 'Chauffeurs', 'Review queue': 'File de validation', 'Operations dashboard': 'Tableau des opérations',
  'Alerts': 'Alertes', 'Abasare': 'Abasare', 'Safety': 'Sécurité', 'Trust and safety': 'Confiance et sécurité', 'USSD channel': 'Canal USSD', 'Demand map': 'Carte de la demande', 'Passengers': 'Passagers', 'Support': 'Assistance',
  'Privacy': 'Confidentialité', 'Claims': 'Réclamations', 'Finance': 'Finances', 'Credit & loyalty': 'Crédit et fidélité', 'Pricing': 'Tarifs', 'Services': 'Services', 'Promotions': 'Promotions', 'Request codes': 'Codes de demande',
  'Fixed-price routes': 'Trajets à prix fixe', 'Driver quests': 'Défis chauffeurs', 'Referrals': 'Parrainages', 'Campaigns': 'Campagnes', 'Venue partners': 'Lieux partenaires', 'Business & fleets': 'Entreprises et flottes',
  'Settings': 'Paramètres', 'Audit log': 'Journal d\'audit', 'Staff': 'Personnel', 'Places and zones': 'Lieux et zones', 'Content and rules': 'Contenus et règles', 'Feature flags': 'Interrupteurs de fonctions', 'Your venue': 'Votre lieu',
  'Sign out': 'Se déconnecter', 'Sign in': 'Se connecter', 'Staff sign-in': 'Connexion du personnel', 'Email': 'E-mail', 'Password': 'Mot de passe', '6-digit authenticator code': 'Code à 6 chiffres de l\'authentificateur',
  'Go to…  (press /)': 'Aller à…  (touche /)', 'Skip to content': 'Aller au contenu', 'Operations console for the Abasare team: bookings, drivers, support and safety in one place.': 'La console de l\'équipe Abasare : réservations, chauffeurs, assistance et sécurité au même endroit.',
  'Ride · Work · Explore': 'Roulez · Travaillez · Explorez', 'Abasare · Kigali, Rwanda': 'Abasare · Kigali, Rwanda', 'Staff accounts require two-factor authentication. Lost your authenticator? Ask a super admin.': 'Les comptes du personnel exigent une double authentification. Authentificateur perdu ? Demandez à un super administrateur.',
  'Operations overview': 'Vue d\'ensemble des opérations', 'Needs attention': 'À traiter', 'Right now': 'En ce moment', 'Demand and fulfilment': 'Demande et exécution', 'Refresh': 'Actualiser', 'Last 7 days': '7 derniers jours', 'Last 30 days': '30 derniers jours', 'Last 90 days': '90 derniers jours',
  'Drivers waiting for verification': 'Chauffeurs en attente de vérification', 'Refunds awaiting approval': 'Remboursements à approuver', 'Support cases past SLA': 'Dossiers hors délai', 'Open safety incidents': 'Incidents de sécurité ouverts',
  'Disputed trips': 'Courses contestées', 'Requests with no driver found': 'Demandes sans chauffeur trouvé', 'Drivers online': 'Chauffeurs en ligne', 'Active bookings': 'Réservations en cours', 'Avg. time to assign a driver': 'Délai moyen d\'attribution', 'Avg. driver arrival': 'Arrivée moyenne du chauffeur',
  'Requests': 'Demandes', 'Completed trips': 'Courses terminées', 'Cancelled': 'Annulées', 'Fulfilment rate': 'Taux d\'exécution', 'Cancellation rate': 'Taux d\'annulation',
  'Status': 'Statut', 'Ref': 'Réf.', 'Service': 'Service', 'Passenger': 'Passager', 'Driver': 'Chauffeur', 'Fare': 'Tarif', 'Paid by': 'Payé par', 'Code': 'Code', 'Created': 'Créé', 'Name': 'Nom', 'Phone': 'Téléphone', 'Vehicle': 'Véhicule', 'Online': 'En ligne', 'Rating': 'Note', 'Trips': 'Courses', 'Submitted': 'Envoyé',
  'Search': 'Rechercher', 'Any status': 'Tous les statuts', 'Download CSV': 'Télécharger en CSV', 'Filter these rows...': 'Filtrer ces lignes...', 'Save': 'Enregistrer', 'Cancel': 'Annuler', 'Close': 'Fermer', 'Edit': 'Modifier', 'Approve': 'Approuver', 'Reject': 'Rejeter', 'Reason': 'Motif', 'Resolve': 'Résoudre', 'Remove': 'Retirer', 'Enable': 'Activer', 'Disable': 'Désactiver',
  'Delete': 'Supprimer', 'Reset': 'Réinitialiser', 'Clear': 'Effacer', 'Yes': 'Oui', 'No': 'Non', 'Back': 'Retour', 'Next': 'Suivant', 'Previous': 'Précédent', 'View': 'Voir', 'Note': 'Note', 'Amount': 'Montant', 'Type': 'Type', 'Title': 'Titre', 'Message': 'Message', 'Action': 'Action', 'When': 'Quand', 'Active': 'Actif', 'Waiting': 'En attente', 'Completed': 'Terminé',
  'Find a setting': 'Chercher un paramètre', 'Light / dark': 'Clair / sombre', 'Switch between light and dark theme': 'Passer du thème clair au thème sombre', 'Main navigation': 'Navigation principale', 'Breadcrumb': 'Fil d\'Ariane', 'Open menu': 'Ouvrir le menu', 'Find a page': 'Chercher une page',
  'Safety incidents': 'Incidents de sécurité', 'Staff alerts': 'Alertes du personnel', 'Daily digest': 'Résumé du jour', 'Language': 'Langue', 'Sound alerts': 'Alertes sonores', 'Turn on sound alerts': 'Activer les alertes sonores', 'Sound alerts on': 'Alertes sonores activées',
  'New safety incident (SOS)': 'Nouvel incident de sécurité (SOS)', 'New support cases': 'Nouveaux dossiers d\'assistance', 'New staff alert': 'Nouvelle alerte du personnel', 'Requests with no driver': 'Demandes sans chauffeur', 'Drivers waiting': 'Chauffeurs en attente',
  'Date': 'Date', 'Requested': 'Demandées', 'No driver found': 'Aucun chauffeur trouvé', 'Cancellation rate (%)': 'Taux d\'annulation (%)', 'Platform commission': 'Commission de la plateforme', 'Cash collected': 'Espèces encaissées', 'New users': 'Nouveaux utilisateurs', 'Suspicious activity': 'Activité suspecte', 'Gross booking value': 'Valeur brute des réservations', 'Driver earnings': 'Gains des chauffeurs',
};
const DICT = { rw: L_RW, fr: L_FR };
const LANG_KEY = 'rm_lang';
let curLang = (() => { const v = pref.get(LANG_KEY); return v === 'rw' || v === 'fr' ? v : 'en'; })();
const origText = new WeakMap(), origAttr = new WeakMap();
const ATTRS = ['placeholder', 'aria-label', 'title'];
const tr = (s) => { if (curLang === 'en') return s; const d = DICT[curLang], k = String(s).trim(); const v = d[k]; return v ? String(s).replace(k, v) : s; };
function trNode(n) {
  if (n.nodeType === 3) {
    const p = n.parentNode; if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE')) return;
    const rec = origText.get(n);
    if (rec && n.data === rec.shown) return;      // already our translation
    const o = n.data, t = tr(o); origText.set(n, { orig: o, shown: t }); if (t !== o) n.data = t;
  } else if (n.nodeType === 1) {
    for (const a of ATTRS) if (n.hasAttribute(a)) { const m = origAttr.get(n) || {}; const cur = n.getAttribute(a); if (m[a] && m[a].shown === cur) continue; const t = tr(cur); m[a] = { orig: cur, shown: t }; origAttr.set(n, m); if (t !== cur) n.setAttribute(a, t); }
    for (const c of n.childNodes) trNode(c);
  }
}
function applyLang(lang) {
  curLang = lang; pref.set(LANG_KEY, lang); document.documentElement.lang = lang;
  const walk = (n) => {
    if (n.nodeType === 3) { const r = origText.get(n); const o = r ? r.orig : n.data; const t = tr(o); origText.set(n, { orig: o, shown: t }); if (n.data !== t) n.data = t; }
    else if (n.nodeType === 1) { for (const a of ATTRS) if (n.hasAttribute(a)) { const m = origAttr.get(n) || {}; const o = m[a] ? m[a].orig : n.getAttribute(a); const t = tr(o); m[a] = { orig: o, shown: t }; origAttr.set(n, m); n.setAttribute(a, t); } n.childNodes.forEach(walk); }
  };
  walk(document.body); { const page = tr(String(LIVE?.base ?? document.title).replace(/ · Abasare Operations$/, '')) + ' · Abasare Operations'; if (typeof refreshTitle === 'function') refreshTitle(page); else document.title = page; }
}
new MutationObserver((muts) => { for (const m of muts) { if (m.type === 'characterData') trNode(m.target); else if (m.type === 'attributes') trNode(m.target); else m.addedNodes.forEach(trNode); } })
  .observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
document.documentElement.lang = curLang;
const langSelect = () => h('select', { class: 'langsel', 'aria-label': 'Language', title: 'Language', onchange: (e) => applyLang(e.target.value) },
  [['en', 'English'], ['fr', 'Français'], ['rw', 'Kinyarwanda']].map(([v, l]) => h('option', { value: v, selected: v === curLang }, l)));
