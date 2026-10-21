import { REPORT_STATUS } from './contracts.js';
import { ROLE_LABELS } from './roles.js';

/**
 * Rapports attendus (retour 114) — statuts et libellés partagés. Les décisions font foi côté serveur
 * (server/src/modules/tpm/reportExpectation.js : TPM sans visite planifiée → « non applicable »
 * d'office, jamais « en retard » ; suivi interne → rapport interne attendu). Statut = couleur +
 * icône + libellé (StatusBadge), jamais la couleur seule.
 */
export const EXPECTED_STATUS = {
  attendu: { label: 'Attendu', tone: null, icon: 'clock' },
  en_retard: { label: 'En retard', tone: 'red', icon: 'warn' },
  soumis: REPORT_STATUS.soumis,
  valide: REPORT_STATUS.valide,
  rejete: REPORT_STATUS.rejete,
  non_applicable: { label: 'Non applicable', tone: null, icon: 'na' },
  non_applicable_auto: { label: 'Non applicable d\'office', tone: null, icon: 'na' },
  interne: { label: 'Rapport interne attendu', tone: 'blue', icon: 'team' },
};

/** Rapports en retard sans période choisie : les N derniers mois, mois courant compris (jumeau : alertsMath.LATE_REPORTS_LOOKBACK). */
export const LATE_REPORTS_LOOKBACK = 12;

/** Clé d'affichage d'une ligne : rapport interne, non applicable d'office, sinon le statut serveur. */
export function expectedKey(r) {
  if (r.unit && r.unit.kind === 'interne') return 'interne';
  if (r.status === 'non_applicable' && r.auto) return 'non_applicable_auto';
  return r.status;
}

/** Pourquoi ce statut (phrase française, variables {due}). */
export const EXPECTED_REASON = {
  aucune_visite: 'aucune visite planifiée ce mois',
  tpm_indisponible: 'TPM déclaré indisponible ce mois',
  saisi_non_applicable: 'déclaré non applicable',
  a_remettre: 'à remettre au plus tard en {due}',
  echeance_depassee: 'échéance dépassée ({due})',
  rapport_interne: 'à produire par l\'équipe S&E',
  document: '',
};

/** Qui fait le rapport : le TPM, ou « Interne — équipe S&E » et ses bureaux. */
export function expectedWho(tr, r) {
  if (r.unit && r.unit.kind === 'interne') {
    const offices = (r.unit.offices || []).join(', ');
    return offices ? tr('{i} — équipe S&E ({o})', { i: tr(ROLE_LABELS.noTpm), o: offices }) : tr('{i} — équipe S&E', { i: tr(ROLE_LABELS.noTpm) });
  }
  return (r.unit && r.unit.name) || '—';
}

/**
 * Statut AFFICHÉ d'un rapport stocké (liste des rapports, fiche 360°) : un gabarit « attendu » sans visite
 * planifiée de son TPM sur son contrat pendant ses mois (`autoNotApplicable`, calculé par le serveur :
 * reportExpectationSql) est « non applicable d'office » ; un gabarit « attendu » dont l'échéance est passée
 * (`late`, stubLateSql) est « en retard » — la même règle que la carte « Rapports attendus » et la cloche.
 */
export const reportShownStatus = (r) => {
  if (r && r.autoNotApplicable) return 'non_applicable';
  if (r && r.late) return 'en_retard';
  return r && r.status;
};
export const reportStatusDef = (r) => {
  if (r && r.autoNotApplicable) return EXPECTED_STATUS.non_applicable_auto;
  if (r && r.late) return EXPECTED_STATUS.en_retard;
  return REPORT_STATUS[r && r.status];
};
