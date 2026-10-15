/**
 * Paramètres de la planification automatique (lot 5, § 6 ; regard S&E, retours 107 et 108,
 * SPEC_LOT_5 § 6.4) — logique PURE, testée (test/planSettings.test.js).
 *
 * Le plan part des BESOINS du MMR : ce que MEMS sait déjà n'est jamais redemandé —
 * univers (grille Sites actifs / inactifs, règle unique), exigence (MMR par bureau ×
 * activité : écart minimal, visites par site, sites par mois, période), suivis par jour et
 * jours ouvrés (MMR), ordre de priorité (RBM), prestataire (contrat de la zone).
 *
 * Le compte ne règle que ce qui n'existe nulle part ailleurs (table plan_settings, une ligne
 * par compte, migration 077 ; sans ligne, les DEFAULTS — un test statique compare les deux) :
 *   - la stratégie : « besoins » (défaut : le plan suit le MMR et calcule les agents et
 *     véhicules nécessaires) ou « capacite » (le plan reste dans la capacité déclarée) ;
 *   - les agents par véhicule (pour compter les véhicules) ;
 *   - les jours de terrain par agent et par mois, utilisés SEULEMENT si le MMR ne les donne pas.
 * Un aperçu peut changer ces choix pour lui seul et noter les communes inaccessibles (ADJUST).
 * Les anciens réglages internes de l'algorithme sont FIXÉS (FIXED), dits dans les notes de calcul.
 *
 * `effectiveInterval` reste LA définition de l'intervalle de revisite d'une activité.
 */
const { deriveMmr } = require('./mmrMath');

const STRATEGIES = ['besoins', 'capacite'];

const DEFAULTS = Object.freeze({
  strategy: 'besoins',
  agentsPerVehicle: 4,
  fieldDaysPerMonth: 20,
});

/** Bornes (mêmes CHECK en base, migration 077). */
const BOUNDS = Object.freeze({ agentsPerVehicle: [1, 10], fieldDaysPerMonth: [1, 26] });
/** Exceptions d'un aperçu : au plus 500 communes exclues pour l'accès. */
const ADJUST_BOUNDS = Object.freeze({ excludedCommunes: [0, 500] });

/** Colonne SQL de chaque paramètre (plan_settings). */
const COLUMNS = Object.freeze({
  strategy: 'strategy',
  agentsPerVehicle: 'agents_per_vehicle',
  fieldDaysPerMonth: 'field_days_per_month',
});
const KEYS = Object.keys(DEFAULTS);

/**
 * Source de chaque valeur initiale (puce de l'écran) : `kind` = classeur | retour | mems,
 * `ref` = cellule ou n° de retour, `label` = phrase française (traduite à l'écran).
 */
const SOURCES = Object.freeze({
  strategy: { kind: 'retour', ref: 'Retour 108', label: 'Le plan suit le MMR et en déduit les agents et les véhicules nécessaires ; la capacité déclarée est une information' },
  agentsPerVehicle: { kind: 'retour', ref: 'Retour 108', label: '« le nombre de véhicules pour un suivi bien fait » : agents qui partent ensemble dans un véhicule' },
  fieldDaysPerMonth: { kind: 'mems', ref: 'MEMS', label: 'Utilisé seulement quand la colonne « jours ouvrés » du MMR est vide' },
});

/**
 * Ce que la planification REPREND d'ailleurs (lecture seule, avec sa source et l'endroit où
 * cela se règle) : montré dans le panneau et dans la carte des paramètres.
 */
const READ_ONLY = Object.freeze([
  { key: 'univers', link: 'sites', source: { kind: 'mems', ref: 'Sites (actifs / inactifs)', label: 'Sites actifs du mois selon la grille Sites (actifs / inactifs), moins les zones interdites (sécurité ≥ 99)' } },
  { key: 'exigence', link: 'mmr', source: { kind: 'classeur', ref: 'Overreaching Parameters!E:J', label: 'MMR par bureau et activité : écart minimal = durée ÷ risque, visites par site = risque, sites par mois = sites ÷ écart, période = durée' } },
  { key: 'rythme', link: 'mmr', source: { kind: 'mems', ref: 'Exigences (MMR)', label: 'Suivis par jour et par agent, jours ouvrés et personnes déclarées : colonnes du MMR' } },
  { key: 'priorite', link: 'priorites', source: { kind: 'mems', ref: 'Priorités du mois', label: 'RBM : recommandation urgente, risque élevé, jamais visité, puis la plus longue absence de visite' } },
  { key: 'budget', link: null, source: { kind: 'mems', ref: 'Contrats', label: 'Plafond du contrat TPM (ligne IV.suivi ÷ mois) : non vérifié, le coût d\'une journée de collecte n\'est pas connu' } },
  { key: 'prestataire', link: null, source: { kind: 'retour', ref: 'Retour 58', label: 'Prestataire du contrat de la zone, attribué à l\'enregistrement' } },
]);

/**
 * Réglages internes de l'algorithme, FIXÉS (retour 107 : un spécialiste ne les reconnaît pas).
 * Chacun est dit dans les notes de calcul de l'aperçu.
 */
const FIXED = Object.freeze({
  levels: Object.freeze(['haute', 'moyenne', 'basse']), // tous ; l'ordre vient du RBM
  dayGrouping: 'commune', // une journée = une commune, toutes activités ; tournée = district
  fillDistrict: true,
  multiActivityDays: true,
  coverageCatchUp: true,
  travelDaysPerTour: 0, // les jours de déplacement restent ceux des jours de collecte
  urgentMinGapMonths: 1,
  anticipationMonths: 0,
  defaultVisitsPerDay: 1, // colonne « Suivis/j » du MMR vide : 1 par journée, signalé « à paramétrer »
  generalRowMode: 'par_bureau', // ligne du plan général : modèle appliqué à chaque bureau
  coverageTargetPct: 100,
  minMonthsSinceVisit: 0,
  capacityMarginPct: 100,
});

/** Stratégie → objectif de l'intervalle (effectiveInterval) : les besoins suivent l'intervalle du MMR. */
const OBJECTIVE_OF = Object.freeze({ besoins: 'mmr_complet', capacite: 'auto' });

const isInt = (v) => Number.isInteger(v);
const inBounds = (b, v) => v >= b[0] && v <= b[1];

/** Contrôle complet d'un jeu de paramètres. @returns {Array<{field, message}>} (vide = valide) */
function validateSettings(s) {
  const errors = [];
  const err = (field, message) => errors.push({ field, message });
  if (!STRATEGIES.includes(s.strategy)) err('strategy', 'Stratégie inconnue.');
  for (const k of ['agentsPerVehicle', 'fieldDaysPerMonth']) {
    if (!isInt(s[k]) || !inBounds(BOUNDS[k], s[k])) err(k, `Entier de ${BOUNDS[k][0]} à ${BOUNDS[k][1]}.`);
  }
  return errors;
}

/** Exceptions d'un aperçu (communes inaccessibles), normalisées et dédoublonnées. */
function normalizeAdjust(adjust = {}) {
  const errors = [];
  const seen = new Set(); const excludedCommunes = [];
  for (const c of adjust.excludedCommunes || []) {
    const district = String((c && c.district) || '').trim(); const commune = String((c && c.commune) || '').trim();
    if (!commune) continue;
    const k = `${district.toLowerCase()}|${commune.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k); excludedCommunes.push({ district, commune });
  }
  excludedCommunes.sort((a, b) => a.district.localeCompare(b.district, 'fr') || a.commune.localeCompare(b.commune, 'fr'));
  if (excludedCommunes.length > ADJUST_BOUNDS.excludedCommunes[1]) errors.push({ field: 'excludedCommunes', message: 'Au plus 500 communes exclues.' });
  return { adjust: { excludedCommunes }, errors };
}

/** Ligne SQL (ou null) → paramètres complets ; une colonne nulle prend le défaut. */
function fromRow(row) {
  const out = { ...DEFAULTS };
  if (!row) return out;
  for (const k of KEYS) {
    const v = row[COLUMNS[k]];
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/** Paramètres modifiés par rapport aux valeurs initiales (marque « modifié » de l'écran). */
function changedKeys(s) {
  return KEYS.filter((k) => s[k] !== DEFAULTS[k]);
}

/** Choix d'un aperçu (non enregistrés) appliqués aux paramètres du compte ; seules les clés connues passent. */
function withOverrides(settings, overrides = {}) {
  const out = { ...settings };
  for (const k of KEYS) if (overrides[k] !== undefined) out[k] = overrides[k];
  return out;
}

/** Paramètres du GÉNÉRATEUR : choix du compte (ou de l'aperçu) + réglages fixés. */
function generatorParams(settings) {
  return {
    ...FIXED, levels: [...FIXED.levels],
    strategy: settings.strategy, objective: OBJECTIVE_OF[settings.strategy] || 'mmr_complet',
    agentsPerVehicle: settings.agentsPerVehicle, fieldDaysPerMonth: settings.fieldDaysPerMonth,
  };
}

const ceilMonths = (v) => Math.ceil(Number(v) - 1e-9);

/**
 * Intervalle de revisite d'une activité (ligne MMR) selon l'objectif — LA définition.
 * Les intervalles se comptent en mois calendaires ; un intervalle fractionnaire est
 * arrondi au mois supérieur (15,85 → 16 : « au moins 15,85 mois »).
 *
 * @param {object} mmr     ligne MMR (champs saisis) — `numberOfSites` = sites éligibles du registre
 * @param {string} objective auto | mmr_complet | couverture
 * @returns {{ running:boolean, mode:string, reason:string, due:number|null, coverage:number|null,
 *             interval:number|null, adjustedInterval:number|null, coverageRatio:number|null }}
 *   due      : mois minimum depuis la dernière visite pour être « dû » (null en mode couverture :
 *              dû = pas encore suivi sur l'exercice) ;
 *   coverage : intervalle minimal MMR (durée ÷ risque) — l'écart minimal entre deux visites.
 */
function effectiveInterval(mmr, objective = 'auto') {
  const d = deriveMmr(mmr || {});
  const base = { interval: d.interval, adjustedInterval: d.adjustedInterval, coverageRatio: d.coverageRatio };
  // Durée 0 (ou risque absent) : intervalle 0 ou nul — l'activité ne tourne pas cette année.
  if (!mmr || !(d.operationDuration > 0) || !(d.interval > 0)) {
    return { running: false, mode: 'non_planifiable', reason: 'duree_nulle', due: null, coverage: null, ...base };
  }
  const minimal = Math.max(1, ceilMonths(d.interval));
  if (objective === 'couverture') return { running: true, mode: 'couverture', reason: 'objectif', due: null, coverage: minimal, ...base };
  if (objective === 'mmr_complet') return { running: true, mode: 'mmr_complet', reason: 'objectif', due: minimal, coverage: minimal, ...base };
  if (d.coverageRatio == null) return { running: true, mode: 'mmr_complet', reason: 'capacite_inconnue', due: minimal, coverage: minimal, ...base };
  if (d.coverageRatio >= 1) return { running: true, mode: 'mmr_complet', reason: 'capacite_suffisante', due: minimal, coverage: minimal, ...base };
  const adjusted = Math.max(minimal, ceilMonths(Math.max(d.interval, d.adjustedInterval || 0)));
  return { running: true, mode: 'ajuste', reason: 'capacite_insuffisante', due: adjusted, coverage: minimal, ...base };
}

module.exports = {
  DEFAULTS, BOUNDS, ADJUST_BOUNDS, COLUMNS, KEYS, SOURCES, READ_ONLY, FIXED, STRATEGIES, OBJECTIVE_OF,
  validateSettings, normalizeAdjust, fromRow, changedKeys, withOverrides, generatorParams, effectiveInterval,
};
