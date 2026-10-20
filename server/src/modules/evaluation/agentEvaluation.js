/**
 * Évaluation des agents (lot 8, retour 28.3) — assemblage PUR (sans I/O), testé
 * (test/agentEvaluation.test.js) : note automatique (agentScore), appréciation qualitative
 * (grille gridScore, portée « agent »), note finale et bande, statut de l'évaluation.
 *
 * Note finale = automatique × p + qualitative × (100 − p), p = 60 % par défaut (réglage du
 * compte). Une des deux absente : l'autre seule (et on le dit : `basis`). L'appréciation
 * qualitative retenue pour une période est la dernière évaluation VALIDÉE qui la chevauche ;
 * les « anciennes évaluations » (note saisie à la main avant le lot 8) restent affichées à part,
 * jamais combinées.
 */
const { gridScore, combine, bandOf, weightsOf } = require('./gridScore');
const { formScore, autoScore } = require('./agentScore');

const BAND_LABELS = { excellent: 'Excellent', bon: 'Bon', moyen: 'Moyen', insuffisant: 'Insuffisant' };

/** Mois « AAAA-MM » d'une date ou d'un mois. */
const m7 = (d) => (d ? String(d).slice(0, 7) : null);
/** L'intervalle [from, to] (mois) chevauche-t-il la période ? */
const overlaps = (from, to, p) => !!p && m7(from) <= p.to && m7(to) >= p.from;

/**
 * Note automatique d'un agent sur la période : une note par fiche configurée, puis la moyenne.
 * @param {object[]} configs   fiches configurées { formId, formLabel, minSubmissions, minCoveragePct, criteria }
 * @param {Map<string, object>} measures       formId → comptages de l'agent
 * @param {Map<string, Map<string, number|null>>} indicatorValues  formId → (indicatorId → valeur)
 */
function agentAuto(configs, measures, indicatorValues) {
  const forms = (configs || []).map((c) => formScore(c, measures.get(c.formId) || { valid: 0, excluded: 0, withGps: 0, withSite: 0 },
    indicatorValues.get(c.formId) || new Map()));
  return autoScore(forms.filter((f) => f.submissions > 0 || f.status === 'note'));
}

/**
 * Appréciation qualitative retenue pour une période : la dernière évaluation validée (hors
 * anciennes) qui chevauche la période ; et le brouillon en cours, s'il y en a un.
 * @param {Array<{ id, status, legacy, periodFrom, periodTo, qualScore, finalScore, band, validatedAt }>} evaluations  triées récentes d'abord
 */
function qualitativeFor(evaluations, period) {
  const list = (evaluations || []).filter((e) => !e.legacy && overlaps(e.periodFrom, e.periodTo, period));
  const validated = list.find((e) => e.status === 'validee') || null;
  const draft = list.find((e) => e.status === 'brouillon') || null;
  return { validated, draft };
}

/**
 * Ligne d'un agent pour la période : note automatique, qualitative, finale, bande, statut.
 * Statut de l'évaluation : 'validee' | 'brouillon' | 'a_evaluer'.
 */
function agentRow(agent, { configs, measures, indicatorValues, evaluations, settings, period }) {
  const auto = agentAuto(configs, measures, indicatorValues);
  const q = qualitativeFor(evaluations, period);
  const w = weightsOf(settings);
  const qual = q.validated ? Number(q.validated.qualScore) : null;
  const c = combine(auto.score, qual, w.agentAutoWeight);
  return {
    ...agent,
    submissions: auto.submissions,
    auto: { score: auto.score, status: auto.status, forms: auto.forms },
    qualScore: qual,
    finalScore: c.score, basis: c.basis, band: bandOf(c.score), autoWeight: w.agentAutoWeight,
    evaluation: q.validated ? { id: q.validated.id, status: 'validee', periodFrom: q.validated.periodFrom, periodTo: q.validated.periodTo }
      : q.draft ? { id: q.draft.id, status: 'brouillon', periodFrom: q.draft.periodFrom, periodTo: q.draft.periodTo } : null,
    evaluationStatus: q.validated ? 'validee' : q.draft ? 'brouillon' : 'a_evaluer',
  };
}

/**
 * Notes figées à la validation d'une appréciation : grille recalculée, note automatique de la
 * période (recalculée par le serveur, jamais prise du client), combinaison, bande et détail.
 */
function freezeAgent(current, { auto, settings, userId }) {
  const w = weightsOf(settings);
  const grid = gridScore(current.scores);
  const c = combine(auto.score, grid.score, w.agentAutoWeight);
  return {
    qualScore: grid.score, autoScore: auto.score, autoWeight: w.agentAutoWeight, finalScore: c.score, band: bandOf(c.score),
    appreciation: BAND_LABELS[bandOf(c.score)] || null, validatedBy: userId,
    autoDetail: {
      basis: c.basis, autoStatus: auto.status, submissions: auto.submissions, forms: auto.forms, grid: grid.detail,
      rule: 'note finale = automatique × p + qualitative × (100 − p) ; qualitative = 20 × Σ poids × (note − 1) / 3 ÷ Σ poids',
    },
  };
}

module.exports = { BAND_LABELS, overlaps, agentAuto, qualitativeFor, agentRow, freezeAgent };
