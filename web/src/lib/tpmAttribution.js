import { formatInt, monthLabel, shortMonthLabel } from './format.js';

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
  a_arbitrer: { label: 'Plusieurs contrats : choisir', tone: 'orange', icon: 'warn' },
  sans_contrat: { label: 'Aucun contrat (à affecter)', tone: 'red', icon: 'na' },
  district_inconnu: { label: 'District inconnu (à affecter)', tone: 'red', icon: 'warn' },
};

/** Drapeaux d'une cellule (affichés à côté de l'état). */
export const TPM_FLAGS = {
  a_confirmer: { label: 'À confirmer (contrat changé)', tone: 'orange', icon: 'clock' },
  partiel: { label: 'Partiel (par commune)', tone: 'blue', icon: 'dot' },
  hors_contrat: { label: 'TPM hors contrat', tone: 'orange', icon: 'warn' },
  prestataire_inactif: { label: 'TPM désactivé', tone: 'red', icon: 'ban' },
  zone_a_reselectionner: { label: 'Zone de contrat à resélectionner', tone: 'orange', icon: 'warn' },
};
/** Drapeaux montrés ligne par ligne (« titulaire non TPM » est dit une fois, en bannière). */
export const ROW_FLAGS = ['a_confirmer', 'hors_contrat', 'prestataire_inactif', 'zone_a_reselectionner', 'partiel'];

/**
 * Aucun contrat ne couvre la zone, mais un contrat de suivi y a une zone DÉTACHÉE de même nom
 * (découpage réimporté) : « zone du contrat X à resélectionner » — jamais un TPM deviné.
 */
export const detachedHint = (tr, cell) => ((cell && (cell.flags || []).includes('zone_a_reselectionner') && (cell.detached || []).length)
  ? tr('zone à resélectionner (avenant) : contrat {n}', { n: cell.detached.map((d) => d.contractLabel || d.numero).join(', ') })
  : null);

/** TPM d'une visite : origine (zone / visite / reprise) + état de sa zone. */
export const TPM_VISIT = {
  'zone:contrat': { label: 'Selon contrat', tone: 'green', icon: 'check' },
  'zone:modifie': { label: 'Modifié (zone)', tone: 'orange', icon: 'edit' },
  'zone:aucun_tpm': { label: 'Aucun TPM (zone)', tone: null, icon: 'ban' },
  'zone:a_arbitrer': { label: 'Plusieurs contrats : choisir', tone: 'orange', icon: 'warn' },
  'zone:sans_contrat': { label: 'À affecter — aucun contrat', tone: 'red', icon: 'na' },
  'zone:district_inconnu': { label: 'À affecter — district inconnu', tone: 'red', icon: 'warn' },
  'zone:anterieur': { label: 'Antérieur à la règle', tone: null, icon: 'na' },
  'zone:': { label: 'En cours d\'affectation', tone: null, icon: 'clock' },
  visite: { label: 'Modifié pour cette visite', tone: 'orange', icon: 'edit' },
  reprise: { label: 'TPM saisi avant la règle', tone: 'blue', icon: 'draft' },
};

/** Actions du journal d'affectation (tpm_attribution_log.action) : couleur + icône + libellé. */
export const TPM_LOG_ACTION = {
  modifier: { label: 'TPM modifié', tone: 'orange', icon: 'edit' },
  confirmer: { label: 'Modification confirmée', tone: 'green', icon: 'check' },
  revenir_contrat: { label: 'Retour au contrat', tone: 'blue', icon: 'dot' },
  reappliquer: { label: 'TPM des contrats appliqués', tone: 'blue', icon: 'check' },
  visite_modifier: { label: 'TPM d\'une visite modifié', tone: 'orange', icon: 'edit' },
  visite_garder: { label: 'TPM saisi avant la règle gardé', tone: 'orange', icon: 'edit' },
  visite_zone: { label: 'Visite rendue à sa zone', tone: 'green', icon: 'check' },
};

/** Libellé d'un état inscrit au journal : état de zone, origine de visite (« visite », « reprise »). */
export const tpmStateLabel = (s) => (TPM_ZONE_STATE[s] || TPM_VISIT[s] || TPM_VISIT[`zone:${s}`] || {}).label || s || '';

/** Clé TPM_VISIT d'une visite ({ providerSource, providerZoneState }). */
export function visitTpmKey(v) {
  const src = v.providerSource || 'zone';
  return src === 'zone' ? `zone:${v.providerZoneState || ''}` : src;
}

/** Une visite est-elle « à affecter » (aucun TPM, et ce n'est pas une décision) ? */
export const visitToAssign = (v) => (v.providerSource || 'zone') === 'zone'
  && ['sans_contrat', 'district_inconnu'].includes(v.providerZoneState);

/**
 * Compte rendu de « Appliquer les TPM des contrats » (Affectation & visites, onglet Affectation des
 * TPM) : visites PRÉVUES mises à jour, et celles gardées telles quelles (réalisées ou annulées, déjà
 * facturées, au TPM motivé, antérieures à la règle) — `v` = réponse `visits` de POST /apply.
 */
export function applyResultMessage(tr, v, emptyPhrase) {
  const k = (v && v.kept) || {};
  const kept = [
    k.done && tr('{n} réalisée(s) ou annulée(s)', { n: formatInt(k.done) }),
    k.invoiced && tr('{n} déjà facturée(s)', { n: formatInt(k.invoiced) }),
    k.reasoned && tr('{n} au TPM motivé', { n: formatInt(k.reasoned) }),
    k.anterieur && tr('{n} antérieure(s) à la règle', { n: formatInt(k.anterieur) }),
  ].filter(Boolean);
  const main = v && v.changed
    ? tr('TPM des contrats appliqués : {n} visite(s) prévue(s) mise(s) à jour sur {t}.', { n: formatInt(v.changed), t: formatInt(v.visits) })
    : tr(emptyPhrase);
  return kept.length ? `${main} ${tr('Gardées telles quelles : {list}.', { list: kept.join(', ') })}` : main;
}

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
  'Capacité insuffisante du TPM',
  'Accès / sécurité',
  'Arbitrage entre deux contrats',
];

/** Bornes de la raison (comme le serveur : common/reasonText, CHECK de la migration 070). */
export const REASON_MIN = 10;
export const REASON_MAX = 500;
