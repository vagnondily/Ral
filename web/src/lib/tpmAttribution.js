import { monthLabel, shortMonthLabel } from './format.js';

/**
 * Affectation des TPM par zone (retour 58) — statuts et libellés partagés par l'onglet
 * « Affectation des TPM », la colonne du Plan de suivi et Affectation & visites.
 * Statut = couleur + icône + libellé (jamais la couleur seule) : rendu par <StatusBadge def={…} />.
 * Les calculs font foi côté serveur (modules/tpm/tpmAttribution.js) ; ici on n'affiche que.
 */

/** État d'une zone × mois (TPM retenu). */
export const TPM_ZONE_STATE = {
  contrat: { label: 'Selon contrat', tone: 'green', icon: 'check' },
  modifie: { label: 'Modifié', tone: 'orange', icon: 'edit' },
  aucun_tpm: { label: 'Aucun TPM (décidé)', tone: null, icon: 'ban' },
  a_arbitrer: { label: 'Deux contrats — à arbitrer', tone: 'red', icon: 'warn' },
  sans_contrat: { label: 'Sans contrat', tone: null, icon: 'na' },
  district_inconnu: { label: 'District inconnu', tone: 'orange', icon: 'warn' },
};

/** Drapeaux d'une cellule (affichés à côté de l'état). */
export const TPM_FLAGS = {
  a_confirmer: { label: 'À confirmer (contrat changé)', tone: 'orange', icon: 'clock' },
  partiel: { label: 'Partiel (par commune)', tone: 'blue', icon: 'dot' },
  hors_contrat: { label: 'Hors contrat ce mois', tone: 'orange', icon: 'warn' },
  prestataire_inactif: { label: 'Prestataire désactivé', tone: 'red', icon: 'ban' },
};
/** Drapeaux montrés ligne par ligne (« titulaire non TPM » est dit une fois, en bannière). */
export const ROW_FLAGS = ['a_confirmer', 'hors_contrat', 'prestataire_inactif', 'partiel'];

/** TPM d'une visite : origine (zone / visite / reprise) + état de sa zone. */
export const TPM_VISIT = {
  'zone:contrat': { label: 'Selon contrat', tone: 'green', icon: 'check' },
  'zone:modifie': { label: 'Modifié (zone)', tone: 'orange', icon: 'edit' },
  'zone:aucun_tpm': { label: 'Aucun TPM (zone)', tone: null, icon: 'ban' },
  'zone:a_arbitrer': { label: 'À affecter — deux contrats', tone: 'red', icon: 'warn' },
  'zone:sans_contrat': { label: 'À affecter — sans contrat', tone: 'orange', icon: 'clock' },
  'zone:district_inconnu': { label: 'À affecter — district inconnu', tone: 'orange', icon: 'warn' },
  'zone:anterieur': { label: 'Antérieur à la règle', tone: null, icon: 'na' },
  'zone:': { label: 'En cours d\'affectation', tone: null, icon: 'clock' },
  visite: { label: 'Modifié pour cette visite', tone: 'orange', icon: 'edit' },
  reprise: { label: 'Saisi avant (à vérifier)', tone: 'blue', icon: 'draft' },
};

/** Clé TPM_VISIT d'une visite ({ providerSource, providerZoneState }). */
export function visitTpmKey(v) {
  const src = v.providerSource || 'zone';
  return src === 'zone' ? `zone:${v.providerZoneState || ''}` : src;
}

/** Une visite est-elle « à affecter » (aucun TPM, et ce n'est pas une décision) ? */
export const visitToAssign = (v) => (v.providerSource || 'zone') === 'zone'
  && ['sans_contrat', 'a_arbitrer', 'district_inconnu'].includes(v.providerZoneState);

/** Libellé d'une plage de mois : « Octobre 2026 » ou « oct. 26 – déc. 26 ». */
export function rangeLabel(from, to) {
  if (!from) return '';
  return from === to ? monthLabel(from) : `${shortMonthLabel(from)} – ${shortMonthLabel(to)}`;
}

/** Mois de from à to inclus (« AAAA-MM »), au plus `max`. */
export function monthsBetween(from, to, max = 60) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < max) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Suggestions de raison (insèrent un texte modifiable). */
export const REASON_SUGGESTIONS = [
  'Contrat en cours de renouvellement',
  'Capacité insuffisante du prestataire',
  'Accès / sécurité',
  'Arbitrage entre deux contrats',
];

/** Bornes de la raison (comme le serveur : common/reasonText, CHECK de la migration 070). */
export const REASON_MIN = 10;
export const REASON_MAX = 500;
