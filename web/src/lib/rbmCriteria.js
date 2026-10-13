/**
 * RBM — critères de risque éditables d'un site (« Éditer les critères »), logique
 * PURE sans React (testée dans server/test/webRbmCriteria.test.js).
 *
 * Chaque raison que le panneau « Pourquoi ? » peut afficher (rbmScore.riskReasons
 * côté serveur) doit pouvoir être corrigée depuis le formulaire : REASON_FIELDS
 * relie chaque code de raison aux champs qui la produisent. Les échelles sont
 * celles du classeur RBM (sécurité 0 / 1 / 3 / 99, problèmes 0 / 1 / 2…) et les
 * libellés sont des phrases françaises, traduites à l'écran par tr().
 */

export const SECURITY = [[0, 'Pas de restriction'], [1, 'Restriction modérée'], [3, 'Restriction stricte'], [99, 'Zone interdite']];
export const securityLabel = (v) => (SECURITY.find(([k]) => k === Number(v || 0)) || [null, null])[1];
export const LABEL02 = {
  issues: ['Aucun', 'Important', 'Urgent'],
  fraud: ['Non suspectée', 'Fraude suspectée', 'Partenaire impliqué'],
  experience: ['Bonne expérience', 'Expérience moyenne', 'Mauvaise expérience'],
};
export const LABEL01 = {
  synergies: ['Une seule activité', 'Plusieurs activités'],
  caseload: ['≤ 200', '> 200'],
  newPartner: ['Expérimenté', 'Nouveau'],
};

const indexed = (labels) => labels.map((l, i) => [i, l]);

/**
 * Critères éditables, dans l'ordre du formulaire : { key, label, options } pour une liste,
 * { key, label, kind: 'number', hint } pour une saisie numérique facultative.
 * `beneficiaryNumber` est PRIORITAIRE sur `beneficiaryOver200` (même règle que le score).
 */
export const RBM_CRITERIA = [
  { key: 'security', label: 'Situation sécuritaire', options: SECURITY },
  { key: 'issuesProcess', label: 'Problèmes — suivi interne', options: indexed(LABEL02.issues) },
  { key: 'issuesPartnerReport', label: 'Problèmes — rapport partenaire', options: indexed(LABEL02.issues) },
  { key: 'issuesCFM', label: 'Problèmes — mécanisme de plainte (CFM)', options: indexed(LABEL02.issues) },
  { key: 'fraud', label: 'Fraude / corruption', options: indexed(LABEL02.fraud) },
  { key: 'synergies', label: 'Synergies de programme', options: indexed(LABEL01.synergies) },
  { key: 'beneficiaryNumber', label: 'Nombre de bénéficiaires', kind: 'number',
    hint: 'Prioritaire sur « Taille (bénéficiaires) » : plus de 200 = caseload élevé. Laissez vide pour utiliser le choix ≤ 200 / > 200.' },
  { key: 'beneficiaryOver200', label: 'Taille (bénéficiaires)', options: indexed(LABEL01.caseload) },
  { key: 'newPartner', label: 'Partenaire', options: indexed(LABEL01.newPartner) },
  { key: 'experiencedPartner', label: 'Expérience du partenaire', options: indexed(LABEL02.experience) },
];

/** Code de raison (« Pourquoi ? ») → champs du formulaire qui la produisent. */
export const REASON_FIELDS = {
  security: ['security'],
  issuesProcess: ['issuesProcess'],
  issuesPartnerReport: ['issuesPartnerReport'],
  issuesCFM: ['issuesCFM'],
  fraud: ['fraud'],
  synergies: ['synergies'],
  caseload: ['beneficiaryNumber', 'beneficiaryOver200'],
  newPartner: ['newPartner'],
  experiencedPartner: ['experiencedPartner'],
};

// Borne du PATCH /sites/:id (zod : entier 0 … 10 000 000).
const MAX_BENEFICIARIES = 10_000_000;

/** Nombre de bénéficiaires saisi ? ('' ou null = non renseigné). */
export const hasBeneficiaryNumber = (v) => v != null && String(v).trim() !== '';

/**
 * Taille retenue par le score (0/1) : le nombre de bénéficiaires s'il est saisi (> 200 ⇒ 1),
 * sinon le choix ≤ 200 / > 200 — miroir de rbmScore.scoreSite (le serveur reste la référence).
 */
export function caseloadOf({ beneficiaryNumber, beneficiaryOver200 } = {}) {
  if (hasBeneficiaryNumber(beneficiaryNumber)) return Number(beneficiaryNumber) > 200 ? 1 : 0;
  return Math.min(1, Math.max(0, Number(beneficiaryOver200) || 0));
}

/** Valeurs initiales du formulaire depuis une ligne RBM (nombre de bénéficiaires vide si absent). */
export function criteriaForm(site = {}) {
  const form = {};
  for (const c of RBM_CRITERIA) {
    form[c.key] = c.kind === 'number'
      ? (hasBeneficiaryNumber(site[c.key]) ? String(site[c.key]) : '')
      : (Number(site[c.key]) || 0);
  }
  return form;
}

/**
 * Corps du PATCH /sites/:id : listes en nombres, nombre de bénéficiaires vide ⇒ null (effacé).
 * @returns {{ patch?: object, error?: string }}  error = phrase française (traduite à l'écran)
 */
export function criteriaPatch(form = {}) {
  const patch = {};
  for (const c of RBM_CRITERIA) {
    const v = form[c.key];
    if (c.kind !== 'number') { patch[c.key] = Number(v) || 0; continue; }
    if (!hasBeneficiaryNumber(v)) { patch[c.key] = null; continue; }
    const n = Number(String(v).trim());
    if (!Number.isInteger(n) || n < 0 || n > MAX_BENEFICIARIES) {
      return { error: 'Nombre de bénéficiaires : nombre entier de 0 à 10 000 000 attendu (ou laissez vide).' };
    }
    patch[c.key] = n;
  }
  return { patch };
}
