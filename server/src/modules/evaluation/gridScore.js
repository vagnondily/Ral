/**
 * Grilles d'appréciation et notes combinées (lot 8, retours 28.1 et 28.3) — logique PURE,
 * sans I/O, testée (test/gridScore.test.js). Une seule règle pour la grille d'un prestataire
 * TPM et celle d'un agent, une seule échelle, une seule table de bandes.
 *
 *  - Chaque critère est noté de 1 à 4 : 1 Insuffisant · 2 À améliorer · 3 Satisfaisant ·
 *    4 Très bien. Un critère a un poids (> 0).
 *  - Note de la grille, sur 20 : 20 × Σ poids × (note − 1) / 3 ÷ Σ poids, sur les critères
 *    NOTÉS (« 1 » vaut 0, « 4 » vaut 20). Aucune note → pas de note (jamais 0).
 *  - Notes combinées (pondération en %, entiers) :
 *      note finale d'un agent  = automatique × p + qualitative × (100 − p)   (p = 60 par défaut)
 *      note d'un prestataire   = moyenne de ses agents × q + grille × (100 − q) (q = 30 par défaut)
 *    Une des deux absente → l'autre seule (et on le dit : `basis`).
 *  - Bandes : ≥ 16 Excellent · ≥ 12 Bon · ≥ 10 Moyen · sinon Insuffisant.
 *  - Arrondi au dixième, demi vers le haut, UNE fois, en fin de calcul, en arithmétique
 *    ENTIÈRE (poids en centièmes, notes en dixièmes) : jamais d'écart de flottant.
 */

const SCALE = 20;
const RATINGS = [
  { value: 1, label: 'Insuffisant' },
  { value: 2, label: 'À améliorer' },
  { value: 3, label: 'Satisfaisant' },
  { value: 4, label: 'Très bien' },
];
const BANDS = [
  { code: 'excellent', min: 16, label: 'Excellent' },
  { code: 'bon', min: 12, label: 'Bon' },
  { code: 'moyen', min: 10, label: 'Moyen' },
  { code: 'insuffisant', min: 0, label: 'Insuffisant' },
];
const DEFAULT_WEIGHTS = { agentAutoWeight: 60, providerAgentsWeight: 30 };

/**
 * Critères proposés par défaut (créés à la première lecture d'un compte, modifiables ensuite).
 * Prestataire : les critères cités par l'utilisateur (retour 28.1). Agent : la grille de la
 * conception (docs/REFONTE_UX.md § 6.5) et la proactivité citée au retour 28.3.
 */
const DEFAULT_CRITERIA = {
  prestataire: [
    ['proactivite', 'Proactivité', 'Anticipe les difficultés, propose des solutions sans attendre qu\'on les lui demande.'],
    ['budgetisation', 'Budgétisation et maîtrise des coûts', 'Budgets prévisionnels justes, dépenses conformes au plan et justifiées.'],
    ['deploiement', 'Déploiement des équipes sur le terrain', 'Équipes déployées à temps sur les sites prévus, couverture du plan de suivi.'],
    ['facilite_travail', 'Facilité de travail et collaboration', 'Réactivité, communication, souplesse face aux changements.'],
    ['personnel_requis', 'Disponibilité du personnel requis', 'Agents et superviseurs en nombre suffisant, formés, aux profils demandés.'],
    ['respect_accord', 'Respect de l\'accord', 'Respect des termes du contrat (livrables, conditions, confidentialité).'],
    ['delai_rapportage', 'Respect des délais de rapportage', 'Rapports et factures remis à la date prévue.'],
    ['pertinence_rapports', 'Pertinence et qualité des rapports', 'Rapports complets, exacts, utiles à la décision.'],
    ['qualite_donnees', 'Qualité des données collectées', 'Formulaires complets et cohérents, peu de rejets au nettoyage.'],
  ],
  agent: [
    ['ponctualite', 'Ponctualité et respect du calendrier', 'Présent aux dates prévues, visites faites dans les délais.'],
    ['protocole', 'Respect du protocole de collecte', 'Suit la méthode, l\'échantillonnage et les consignes du formulaire.'],
    ['comportement', 'Comportement avec les bénéficiaires et les communautés', 'Respect, écoute, neutralité.'],
    ['observations', 'Qualité des observations', 'Observations précises, justifiées, utiles.'],
    ['proactivite', 'Proactivité et initiative', 'Signale les problèmes, propose des solutions.'],
    ['communication', 'Communication avec le superviseur', 'Rend compte, répond, transmet à temps.'],
    ['ethique', 'Éthique et sécurité (consentement)', 'Consentement recueilli, confidentialité et sécurité respectées.'],
  ],
};

/** Poids en centièmes entiers (numeric(5,2) en base). */
const weightUnits = (w) => Math.round(Number(w) * 100);
/** Arrondi demi vers le haut de n / d (entiers positifs) : floor((2n + d) / 2d). */
const roundDiv = (n, d) => Math.floor((2 * n + d) / (2 * d));
/** Dixièmes entiers → nombre affiché (une décimale). */
const fromTenths = (t) => (t == null ? null : t / 10);
const toTenths = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 10));

/** Note valide de 1 à 4, sinon null (non notée). */
function ratingOf(r) {
  const n = Number(r);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

/**
 * Note d'une grille.
 * @param {Array<{ code?, label?, weight: number, rating: number|null }>} answers
 * @returns {{ score: number|null, rated: number, total: number, complete: boolean, detail: object[] }}
 *   detail : par critère, la note, son équivalent sur 20 et sa part du poids (%).
 */
function gridScore(answers) {
  const list = (answers || []).filter((a) => weightUnits(a.weight) > 0);
  let num = 0; let den = 0; let rated = 0;
  const totalW = list.reduce((s, a) => s + weightUnits(a.weight), 0);
  const detail = list.map((a) => {
    const r = ratingOf(a.rating);
    const w = weightUnits(a.weight);
    if (r != null) { num += w * (r - 1); den += w; rated += 1; }
    return {
      code: a.code || null, label: a.label || null, rating: r,
      on20: r == null ? null : fromTenths(roundDiv(SCALE * 10 * (r - 1), 3)),
      weightPct: totalW ? fromTenths(roundDiv(w * 1000, totalW)) : null,
    };
  });
  // score × 10 = 200 × Σ w (r − 1) / (3 Σ w)
  const tenths = den ? roundDiv(SCALE * 10 * num, 3 * den) : null;
  return { score: fromTenths(tenths), rated, total: list.length, complete: list.length > 0 && rated === list.length, detail };
}

/**
 * Combinaison pondérée de deux notes sur 20 (part de la première en %, entier 0 à 100).
 * @returns {{ score: number|null, basis: 'both'|'first'|'second'|'none' }}
 */
function combine(first, second, firstPct) {
  const a = toTenths(first); const b = toTenths(second);
  const p = Math.round(Number(firstPct));
  if (!(p >= 0 && p <= 100)) throw new Error('Pondération invalide (0 à 100).');
  if (a == null && b == null) return { score: null, basis: 'none' };
  if (a == null) return { score: fromTenths(b), basis: 'second' };
  if (b == null) return { score: fromTenths(a), basis: 'first' };
  return { score: fromTenths(roundDiv(p * a + (100 - p) * b, 100)), basis: 'both' };
}

/** Moyenne de notes sur 20 (dixièmes entiers, demi vers le haut) ; null sans note. */
function average(scores) {
  const t = (scores || []).map(toTenths).filter((x) => x != null);
  return t.length ? fromTenths(roundDiv(t.reduce((s, x) => s + x, 0), t.length)) : null;
}

/** Bande d'une note sur 20 (code), null sans note. */
function bandOf(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  return BANDS.find((b) => Number(score) >= b.min).code;
}

/** Note d'un prestataire : grille + moyenne de ses agents (pondération q). */
function providerScore({ answers, agentScores, agentsWeight = DEFAULT_WEIGHTS.providerAgentsWeight }) {
  const grid = gridScore(answers);
  const agents = average(agentScores);
  const c = combine(agents, grid.score, agentsWeight);
  return {
    grid, agentsScore: agents, agentsCount: (agentScores || []).filter((x) => toTenths(x) != null).length,
    agentsWeight, score: c.score, basis: c.basis, band: bandOf(c.score),
  };
}

/** Pondérations du compte (réglage), avec les valeurs par défaut. */
function weightsOf(settings) {
  const s = settings || {};
  const pick = (v, d) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 100 && v !== null && v !== '' ? Number(v) : d);
  return {
    agentAutoWeight: pick(s.agentAutoWeight, DEFAULT_WEIGHTS.agentAutoWeight),
    providerAgentsWeight: pick(s.providerAgentsWeight, DEFAULT_WEIGHTS.providerAgentsWeight),
  };
}

module.exports = {
  SCALE, RATINGS, BANDS, DEFAULT_WEIGHTS, DEFAULT_CRITERIA,
  gridScore, combine, average, bandOf, providerScore, weightsOf, ratingOf, roundDiv,
};
