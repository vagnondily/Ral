// Glossaire des rôles d'un partenaire (retour 113) — UNE source pour tous les écrans. Les libellés
// sont des phrases françaises traduites par tr() (anglais : web/src/locales/en/roles.js).
// Un test (server/test/webRoles.test.js) vérifie qu'aucun écran n'écrit plus « Prestataire » seul.
//
//  - Partenaire : le mot générique (tout organisme du référentiel).
//  - Titulaire : le partenaire qui signe un contrat (FLA). En général un « partenaire de mise en
//    œuvre » (il met le programme en œuvre sur les sites) ; parfois un TPM qui a son propre contrat.
//  - TPM (tierce partie de suivi) : il suit la mise en œuvre ; payé sur la ligne IV.suivi du contrat
//    qu'il suit, ou par son propre contrat.
// Règle serveur jumelle : server/src/modules/tpm/contractTpm.js (roleOf, TPM d'un contrat).

export const ROLE_LABELS = {
  partner: 'Partenaire',
  partners: 'Partenaires',
  holder: 'Titulaire',
  holders: 'Titulaires',
  holderType: 'Type de titulaire',
  implementer: 'Partenaire de mise en œuvre',
  implementers: 'Partenaires de mise en œuvre',
  tpm: 'TPM',
  tpmLong: 'TPM — tierce partie de suivi',
  allTpm: 'Tous les TPM',
  allHolders: 'Tous les titulaires',
  chooseTpm: 'Choisir un TPM…',
  // Sans TPM rattaché (et titulaire qui n'est pas un TPM) : le suivi est INTERNE (équipe S&E, retour 114).
  noTpm: 'Interne',
  noTpmHint: 'Suivi interne (équipe S&E) : aucun TPM rattaché à ce contrat.',
};

/** Rôle d'un partenaire d'après le code de son type (jumeau de contractTpm.roleOf). */
export function roleOf(typeCode) {
  if (typeCode === 'tpm') return 'tpm';
  if (typeCode === 'prestataire') return 'mise_en_oeuvre';
  return 'autre';
}

/** Rôle → libellé et ton du badge (l'icône est choisie par components/RoleBadge.jsx). */
export const PARTNER_ROLE = {
  tpm: { label: ROLE_LABELS.tpm, tone: 'blue' },
  mise_en_oeuvre: { label: ROLE_LABELS.implementer, tone: 'green' },
  autre: { label: ROLE_LABELS.partner, tone: null },
};

/** Libellé du type d'un partenaire : le glossaire pour les deux rôles connus, sinon le libellé du compte. */
export function typeLabelOf(typeCode, dbLabel) {
  const r = roleOf(typeCode);
  if (r === 'tpm') return ROLE_LABELS.tpmLong;
  if (r === 'mise_en_oeuvre') return ROLE_LABELS.implementer;
  return dbLabel || ROLE_LABELS.partner;
}

/** Parties non vides jointes par « · » (jamais de « · » final quand une partie manque). */
export function joinParts(...parts) {
  return parts.flat().filter((p) => p != null && String(p).trim() !== '').join(' · ');
}

// Une ligne de rapport ou de plan porte le contrat en contractFla / contractNumero (son `reference`
// est celle du rapport, jamais celle du contrat) ; une ligne de contrat porte numeroFla / numero.
const isDocRow = (c) => c.contractNumero !== undefined || c.contractFla !== undefined;

/** N° affiché d'un contrat : numéro FLA (référence d'avenant comprise), sinon numéro interne CTR-…. */
export function contractNo(c) {
  if (!c) return null;
  if (isDocRow(c)) return c.contractFla || c.contractNumero || null;
  return c.reference || c.numeroFla || c.numero || null;
}

/** Numéro interne (CTR-…) d'un contrat quand il diffère du n° affiché, sinon null (information secondaire). */
export function internalNo(c) {
  if (!c) return null;
  const internal = isDocRow(c) ? c.contractNumero : c.numero;
  return internal && internal !== contractNo(c) ? internal : null;
}

/** Identité d'un contrat, partout la même : « n° · titulaire ». */
export function contractIdentity(c, holderName) {
  // Ligne de rapport ou de plan : partnerName y est le TPM ; le titulaire est contractPartner.
  const holder = holderName ?? (c && (isDocRow(c) ? (c.contractPartner || c.holderName) : (c.partnerName || c.holderName)));
  return joinParts(contractNo(c), holder);
}

/** Noms des TPM d'un contrat (vue serveur { state, tpms }) ; [] sans TPM rattaché. */
export function tpmNames(view) {
  return ((view && view.tpms) || []).map((t) => t.name);
}

/** Statuts d'un contrat qui couvrent des mois (jumeau de tpmAttribution.COVERING_STATUSES, mems_tpm_cells). */
export const COVERING_CONTRACT_STATUSES = ['actif', 'resilie'];

/**
 * TPM d'un contrat dans une liste : 'tpm' (au moins un TPM), 'interne' (contrat qui couvre des mois,
 * sans TPM : suivi par l'équipe S&E, ROLE_LABELS.noTpm), sinon 'aucun' (brouillon, en validation,
 * rejeté : il ne couvre aucun mois, ni TPM ni « Interne » — « — »).
 */
export function contractTpmKind(c) {
  if (c && c.tpm && (c.tpm.tpms || []).length) return 'tpm';
  return c && COVERING_CONTRACT_STATUSES.includes(c.status) ? 'interne' : 'aucun';
}
