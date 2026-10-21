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
  partner_not_tpm: 'ce partenaire n\'est plus un TPM',
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
/**
 * Pourquoi un gabarit est « non applicable d'office » (phrase française, bulle d'aide de la liste et de
 * l'onglet Rapports) : partenaire qui n'est plus un TPM (D-b, `partnerNotTpm`, reportExpectationSql), sinon
 * aucune visite planifiée de ce TPM sur ce contrat. null : le statut n'est pas « d'office ».
 */
export function autoNotApplicableWhy(r) {
  if (!r || !r.autoNotApplicable) return null;
  return r.partnerNotTpm
    ? 'Ce partenaire n\'est plus un TPM : aucune facture n\'est plus attendue de lui.'
    : 'Aucune visite planifiée de ce TPM sur ce contrat ce mois-là : pas de rapport à remettre.';
}
export const reportStatusDef = (r) => {
  if (r && r.autoNotApplicable) return EXPECTED_STATUS.non_applicable_auto;
  if (r && r.late) return EXPECTED_STATUS.en_retard;
  return REPORT_STATUS[r && r.status];
};

/** Documents RÉELS (jamais un gabarit) : ce que la carte « Rapports attendus » compte comme facture remise. */
const REAL_DOCUMENT = ['soumis', 'valide', 'rejete'];

/**
 * Étapes « Facture » et « Validation » du fil guidé de Rapports & dépenses pour un mois, avec la règle de la
 * carte (relecture croisée, point 16) : seules les factures RÉELLES (soumises, validées, rejetées — jamais un
 * gabarit « attendu », « en retard » ou « non applicable d'office ») dont la période [periodMonth, periodEnd]
 * COUVRE le mois (une facture pluri-mensuelle compte pour chacun de ses mois).
 * @returns {{ facturesCreees: number, facturesSoumises: number, facturesValidees: number }}
 */
export function factureFlow(reports, month) {
  const covers = (r) => {
    const from = String(r.periodMonth || '').slice(0, 7);
    const to = r.periodEnd ? String(r.periodEnd).slice(0, 7) : from;
    return Boolean(from) && from <= month && month <= (to < from ? from : to);
  };
  const real = (reports || []).filter((r) => r.kind === 'financier' && REAL_DOCUMENT.includes(reportShownStatus(r)) && covers(r));
  return {
    facturesCreees: real.length,
    facturesSoumises: real.filter((r) => r.status === 'soumis').length,
    facturesValidees: real.filter((r) => r.status === 'valide').length,
  };
}
