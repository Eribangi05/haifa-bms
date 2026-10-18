import type { upEn } from './up.en';
export const upFr: Record<keyof typeof upEn, string> = {
  'up.perkm': 'RWF par km', 'up.perkm.only': 'Prix au kilomètre, rien d\'autre en plus',
  'up.web.loc.title': 'Activez la localisation dans votre navigateur',
  'up.web.loc.body': 'Cliquez sur le cadenas (ou l\'icône de réglages) à côté de l\'adresse, mettez Localisation sur Autoriser, puis rechargez la page. Sur iPhone : Réglages, Confidentialité, Service de localisation, Safari.',
  'up.web.driver.note': 'Vous utilisez Abasare dans un navigateur. Gardez cet onglet ouvert et l\'écran allumé pour recevoir des offres. Pour une journée complète de travail, utilisez l\'application Android.',
  'up.moto.title': 'Sécurité à moto', 'up.moto.body': 'Un seul passager. Portez le casque fourni par le conducteur et vérifiez que la plaque correspond à l\'application avant de monter.',
  'up.rate.title': 'Comment était le passager ?', 'up.rate.send': 'Envoyer la note', 'up.rate.done': 'Merci. Votre note aide les autres chauffeurs.', 'up.rate.passenger': 'Note du passager',
  'up.neg.title': 'Proposez votre prix', 'up.neg.hint': 'Les chauffeurs peuvent accepter, refuser ou répondre par un prix intermédiaire. Rien n\'est convenu tant que quelqu\'un n\'accepte pas.',
  'up.neg.usual': 'Prix habituel', 'up.neg.yours': 'Votre prix', 'up.neg.off': 'Prix habituel', 'up.neg.proposed': 'Vous avez proposé {amount} RWF. En attente de la réponse d\'un chauffeur.',
  'up.neg.counter': '{name} répond {amount} RWF', 'up.neg.accept': 'Accepter', 'up.neg.decline': 'Non merci', 'up.neg.agreed': 'Prix convenu : {amount} RWF',
  'up.neg.rider.offers': 'Le passager propose {amount} RWF (prix habituel {usual})', 'up.neg.accept.at': 'Accepter {amount} RWF', 'up.neg.counter.btn': 'Répondre avec un autre prix', 'up.neg.counter.sent': 'Votre réponse est envoyée. En attente du passager.', 'up.neg.counter.pick': 'Choisissez votre prix',
  'up.payout.speed': 'Les paiements approuvés sont versés sous {h} heures.',
};
