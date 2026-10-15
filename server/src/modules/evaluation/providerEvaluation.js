/**
 * Évaluation d'un prestataire TPM (retour 28.1) — règles PURES (sans I/O), testées
 * (test/providerEvaluation.test.js) : construction de la grille, cycle brouillon → validée,
 * notes figées à la validation. La note elle-même vient de gridScore (une seule règle).
 *
 * Cycle : un évaluateur (administrateur ou gestionnaire) crée et complète un BROUILLON ; une
 * AUTRE personne de ces rôles le VALIDE (séparation des tâches, aussi contrainte en base).
 * À la validation, le serveur recalcule la grille et la moyenne des notes des agents du
 * prestataire sur la période, combine, et fige le tout avec son détail (« Pourquoi cette
 * note ? ») ; une évaluation validée n'est plus modifiable ni supprimable.
 */
const { gridScore, providerScore, ratingOf, weightsOf, RATINGS } = require('./gridScore');

class RuleError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Notes saisies → Map(code → { rating, comment }) ; un critère inconnu est refusé. */
function ratingsByCode(ratings, knownCodes) {
  const out = new Map();
  for (const r of ratings || []) {
    if (!knownCodes.has(r.code)) throw new RuleError('unknown_criterion', `Critère inconnu : ${r.code}.`);
    out.set(r.code, { rating: ratingOf(r.rating), comment: r.comment ? String(r.comment).trim() || null : null });
  }
  return out;
}

/**
 * Grille d'un nouveau brouillon : une ligne par critère ACTIF, avec son libellé et son poids du
 * moment (copie : l'historique ne change pas si la grille est modifiée ensuite).
 */
function buildGrid(criteria, ratings) {
  const given = ratingsByCode(ratings, new Set(criteria.map((c) => c.code)));
  const scores = criteria.map((c, i) => ({
    code: c.code, label: c.label, weight: Number(c.weight), sortOrder: c.sortOrder ?? (i + 1) * 10,
    rating: given.has(c.code) ? given.get(c.code).rating : null,
    comment: given.has(c.code) ? given.get(c.code).comment : null,
  }));
  return { scores, gridScore: gridScore(scores).score };
}

/**
 * Brouillon modifié : seules les lignes de SA grille ; un critère absent de la grille est refusé.
 * Seul l'évaluateur modifie son brouillon (le valideur relit puis valide, sans retoucher la grille).
 */
function applyRatings(current, ratings, userId) {
  if (current.status !== 'brouillon') throw new RuleError('validated', 'Évaluation validée : elle ne peut plus être modifiée.');
  if (current.evaluatedBy !== userId) {
    throw new RuleError('duty', 'Seul l\'évaluateur modifie son brouillon ; la personne qui valide ne retouche pas la grille.');
  }
  const given = ratingsByCode(ratings, new Set(current.scores.map((s) => s.code)));
  const scores = current.scores.map((s) => (given.has(s.code) ? { ...s, ...given.get(s.code) } : s));
  return { scores: scores.filter((s) => given.has(s.code)), gridScore: gridScore(scores).score };
}

/**
 * Contrôles de la validation, dans l'ordre : déjà validée → 409 ; même personne que
 * l'évaluateur → 403 (séparation des tâches) ; grille incomplète → 400 (avec les critères à noter).
 */
function checkValidation(current, userId) {
  if (current.status !== 'brouillon') throw new RuleError('validated', 'Cette évaluation est déjà validée.');
  if (current.evaluatedBy === userId) {
    throw new RuleError('duty', 'Séparation des tâches : l\'évaluation est validée par une autre personne que l\'évaluateur.');
  }
  const missing = current.scores.filter((s) => ratingOf(s.rating) == null).map((s) => s.label);
  if (!current.scores.length || missing.length) {
    const e = new RuleError('incomplete', `Notez tous les critères avant de valider (${missing.length} restant${missing.length > 1 ? 's' : ''}).`);
    e.missing = missing;
    throw e;
  }
}

/**
 * Notes figées à la validation : grille recalculée, moyenne des agents de la période,
 * combinaison selon le réglage du compte, bande, et le détail qui l'explique.
 * @param {object} current   évaluation (avec sa grille)
 * @param {{ agents: Array<{ agentId, name, score: number|null }>, settings: object, userId: string }} ctx
 */
function freeze(current, { agents, settings, userId }) {
  const w = weightsOf(settings);
  const scored = (agents || []).filter((a) => a.score != null);
  const p = providerScore({ answers: current.scores, agentScores: scored.map((a) => a.score), agentsWeight: w.providerAgentsWeight });
  return {
    gridScore: p.grid.score, agentsScore: p.agentsScore, agentsCount: p.agentsCount, agentsWeight: w.providerAgentsWeight,
    finalScore: p.score, band: p.band, validatedBy: userId,
    detail: {
      basis: p.basis,
      rule: 'note = moyenne des agents × q + grille × (100 − q) ; grille = 20 × Σ poids × (note − 1) / 3 ÷ Σ poids',
      grid: p.grid.detail,
      agents: (agents || []).map((a) => ({ agentId: a.agentId, name: a.name, score: a.score })),
      scale: RATINGS,
    },
  };
}

/** Aperçu non enregistré (brouillon affiché) : même calcul que freeze, sans valideur. */
function preview(current, ctx) {
  const f = freeze(current, { ...ctx, userId: null });
  return { gridScore: f.gridScore, agentsScore: f.agentsScore, agentsCount: f.agentsCount, agentsWeight: f.agentsWeight,
    finalScore: f.finalScore, band: f.band, detail: f.detail };
}

module.exports = { RuleError, buildGrid, applyRatings, checkValidation, freeze, preview };
