/**
 * Rapport trimestriel par activité (retour 54) — règles PURES, testées
 * (test/quarterlyMath.test.js). Fidèle au classeur de suivi MMR de l'utilisateur :
 * par activité et par trimestre, sites uniques actifs / prévus / réalisés,
 * Couverture = réalisés ÷ actifs, Taux d'exécution = réalisés ÷ prévus, une ligne
 * « Total » et une colonne « Année ».
 *
 * Les comptes viennent du service unique des faits site × mois (siteMonthFactsCtes,
 * lot 1b) en mode « données » comme la carte et la tuile Couverture (lot 6a) : un site
 * est « réalisé » s'il a une visite réalisée OU une soumission rattachée à CE site un
 * mois où il est actif ; il est compté une fois par trimestre (sites distincts).
 * Jamais « #DIV/0! » : un taux sans dénominateur vaut null (affiché « — »).
 */

const QUARTERS = [1, 2, 3, 4];
const PERIOD_KEYS = ['Q1', 'Q2', 'Q3', 'Q4', 'year'];

/** Les quatre trimestres d'une année et l'année entière, en périodes « du … au … ». */
function quarterPeriods(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('Année invalide');
  const mm = (m) => `${y}-${String(m).padStart(2, '0')}`;
  return [
    ...QUARTERS.map((q) => ({ key: `Q${q}`, from: mm(q * 3 - 2), to: mm(q * 3) })),
    { key: 'year', from: mm(1), to: mm(12) },
  ];
}

/** Taux n ÷ d, ou null quand il n'y a pas de dénominateur (jamais une division par zéro). */
function rate(n, d) {
  const num = Number(n) || 0;
  const den = Number(d) || 0;
  return den > 0 ? num / den : null;
}

/**
 * Bande de couleur d'un taux (rouge → vert), toujours affichée AVEC la valeur (un statut
 * n'est jamais porté par la couleur seule). Bornes du classeur : < 40 %, < 60 %, < 80 %, ≥ 80 %.
 */
function band(r) {
  if (r == null) return 'none';
  if (r < 0.4) return 'low';
  if (r < 0.6) return 'mid';
  if (r < 0.8) return 'fair';
  return 'high';
}

/** Une cellule (activité × période) à partir des comptes bruts. */
function cell(c = {}) {
  const active = Number(c.active) || 0;
  const planned = Number(c.planned) || 0;
  const realised = Number(c.realised) || 0;
  const coverage = rate(realised, active);
  const execution = rate(realised, planned);
  return { active, planned, realised, coverage, execution, coverageBand: band(coverage), executionBand: band(execution) };
}

/** Clé d'activité : « — » (site sans activité) regroupé sous une ligne « Sans activité ». */
const NONE = '—';

/**
 * Met en forme le tableau.
 * @param {object} p
 * @param {number} p.year
 * @param {Record<string, Array<{activity: string|null, active, planned, realised}>>} p.byPeriod
 *        lignes par période (clé Q1…Q4 / year) : une ligne par activité ET une ligne de total
 *        (activity === null, issue de GROUPING SETS — le total compte les sites distincts, il
 *        n'est jamais une somme des activités).
 * @param {string} [p.currentMonth] AAAA-MM : les trimestres qui commencent après sont « à venir ».
 */
function shapeQuarterly({ year, byPeriod, currentMonth = null }) {
  const periods = quarterPeriods(year);
  const activities = new Set();
  for (const k of PERIOD_KEYS) for (const r of byPeriod[k] || []) if (r.activity != null) activities.add(r.activity);
  const order = [...activities].sort((a, b) => (a === NONE) - (b === NONE) || a.localeCompare(b, 'fr'));
  const find = (k, act) => (byPeriod[k] || []).find((r) => (act === null ? r.activity == null : r.activity === act));
  const rowOf = (act) => {
    const cells = {};
    for (const k of PERIOD_KEYS) cells[k] = cell(find(k, act));
    return cells;
  };
  return {
    year: Number(year),
    periods: periods.map((p) => ({ ...p, upcoming: Boolean(currentMonth && p.key !== 'year' && p.from > currentMonth) })),
    rows: order.map((a) => ({ activity: a, label: a === NONE ? null : a, cells: rowOf(a) })),
    total: rowOf(null),
  };
}

module.exports = { QUARTERS, PERIOD_KEYS, NONE, quarterPeriods, rate, band, cell, shapeQuarterly };
