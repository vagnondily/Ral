/**
 * Paramètres de la planification automatique (lot 5, § 6 « Paramètres du plan ») —
 * logique PURE, testée (test/planSettings.test.js).
 *
 * Deux niveaux, une seule saisie chacun :
 *  - PAR ACTIVITÉ (durée, nombre de sites, risque, faisable, personnes, suivis/jour,
 *    jours ouvrés) : la grille MMR (Exigences), inchangée ;
 *  - GLOBAUX (ce module) : table plan_settings, une ligne par compte (migration 077).
 *    Sans ligne, les DEFAULTS ci-dessous s'appliquent ; la migration en recopie les
 *    valeurs (un test statique compare les deux).
 *
 * Chaque valeur initiale dit d'où elle vient (SOURCES) : classeur RBM (cellule), retour
 * de l'utilisateur, ou choix MEMS — l'écran l'affiche en puce.
 *
 * `effectiveInterval` est LA définition de l'intervalle de revisite du plan (une seule,
 * partagée avec le générateur ; les règles de priorité du § 5 la liront aussi).
 */
const { deriveMmr } = require('./mmrMath');

const OBJECTIVES = ['auto', 'mmr_complet', 'couverture'];
const LEVELS = ['haute', 'moyenne', 'basse'];
const DAY_GROUPINGS = ['lieu', 'commune', 'district'];
const GENERAL_ROW_MODES = ['par_bureau', 'commune'];

const DEFAULTS = Object.freeze({
  objective: 'auto',
  coverageTargetPct: 80,
  levels: Object.freeze(['haute', 'moyenne', 'basse']),
  coverageCatchUp: true,
  dayGrouping: 'commune',
  fillDistrict: true,
  multiActivityDays: true,
  capacityMarginPct: 100,
  travelDaysPerTour: 0,
  urgentMinGapMonths: 1,
  anticipationMonths: 0,
  defaultVisitsPerDay: 1,
  generalRowMode: 'par_bureau',
  minMonthsSinceVisit: 0,
});

/** Bornes des valeurs numériques (mêmes CHECK en base, migration 077). */
const BOUNDS = Object.freeze({
  coverageTargetPct: [1, 100],
  capacityMarginPct: [10, 200],
  travelDaysPerTour: [0, 10],
  urgentMinGapMonths: [1, 12],
  anticipationMonths: [0, 6],
  defaultVisitsPerDay: [0.5, 10],
  minMonthsSinceVisit: [0, 24],
});

/** Colonne SQL de chaque paramètre (plan_settings). */
const COLUMNS = Object.freeze({
  objective: 'objective',
  coverageTargetPct: 'coverage_target_pct',
  levels: 'levels',
  coverageCatchUp: 'coverage_catch_up',
  dayGrouping: 'day_grouping',
  fillDistrict: 'fill_district',
  multiActivityDays: 'multi_activity_days',
  capacityMarginPct: 'capacity_margin_pct',
  travelDaysPerTour: 'travel_days_per_tour',
  urgentMinGapMonths: 'urgent_min_gap_months',
  anticipationMonths: 'anticipation_months',
  defaultVisitsPerDay: 'default_visits_per_day',
  generalRowMode: 'general_row_mode',
  minMonthsSinceVisit: 'min_months_since_visit',
});
const KEYS = Object.keys(DEFAULTS);

/**
 * Source de chaque valeur initiale (puce de l'écran) : `kind` = classeur | retour | mems,
 * `label` = phrase française (traduite à l'écran), `ref` = cellule ou n° de retour.
 */
const SOURCES = Object.freeze({
  objective: { kind: 'retour', ref: 'Retour 55', label: '« tous les sites selon le MMR … ou un minimum de 80 % » ; capacité ÷ ciblé du classeur (Overreaching Parameters!O = K/J)' },
  coverageTargetPct: { kind: 'retour', ref: 'Retour 55', label: '« un minimum de 80 % des sites » sur la période d\'activité' },
  levels: { kind: 'mems', ref: 'Priorités du mois', label: 'Niveaux de priorité du RBM (score et retard de visite)' },
  coverageCatchUp: { kind: 'retour', ref: 'Retour 55', label: 'Rattraper les sites jamais suivis sur l\'exercice pour tenir l\'objectif de couverture' },
  dayGrouping: { kind: 'retour', ref: 'Retour 55', label: '« prioriser les sites proches … même commune, même district »' },
  fillDistrict: { kind: 'retour', ref: 'Retour 55', label: 'Compléter la tournée dans le même district' },
  multiActivityDays: { kind: 'retour', ref: 'Retours 55, 57', label: 'Un lieu porte plusieurs sites (un par activité) : une équipe les suit le même jour' },
  capacityMarginPct: { kind: 'mems', ref: 'MEMS', label: 'Part de la capacité MMR mise au plan (100 % = toute la capacité)' },
  travelDaysPerTour: { kind: 'mems', ref: 'MEMS', label: 'Même notion que les jours de déplacement des jours de collecte' },
  urgentMinGapMonths: { kind: 'mems', ref: 'MEMS', label: 'Écart minimal entre deux visites d\'un site à recommandation urgente' },
  anticipationMonths: { kind: 'mems', ref: 'MEMS', label: 'Compléter une journée ouverte avec un site dû dans les N mois (0 = désactivé)' },
  defaultVisitsPerDay: { kind: 'mems', ref: 'MEMS', label: 'Suivis par jour et par agent quand la colonne « Suivis/j » du MMR est vide (valeur prudente)' },
  minMonthsSinceVisit: { kind: 'retour', ref: 'Retour 82', label: 'Ne proposer que les sites non visités depuis au moins N mois (0 = l\'intervalle du MMR suffit)' },
  generalRowMode: { kind: 'mems', ref: 'Décision lot 5', label: 'Ligne du plan général : modèle appliqué à chaque bureau (capacité par bureau), ou une capacité commune' },
});

/** Valeurs en lecture seule montrées avec les paramètres (elles ne se règlent pas ici). */
const READ_ONLY = Object.freeze([
  { key: 'rbmFrequency', value: { elevee: 1, moyenne: 2, faible: 3 }, source: { kind: 'mems', ref: 'rbmMath', label: 'Fréquence RBM par niveau de risque du site (mois), Priorités du mois' } },
  { key: 'perActivity', value: null, source: { kind: 'classeur', ref: 'Overreaching Parameters!E:K', label: 'Durée, nombre de sites, risque, faisable : grille Exigences (MMR), par activité et par bureau' } },
]);

const isInt = (v) => Number.isInteger(v);
const inBounds = (k, v) => v >= BOUNDS[k][0] && v <= BOUNDS[k][1];
const halfSteps = (v) => Number.isFinite(v) && Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;

/**
 * Contrôle complet d'un jeu de paramètres. @returns {Array<{field, message}>} (vide = valide)
 */
function validateSettings(s) {
  const errors = [];
  const err = (field, message) => errors.push({ field, message });
  if (!OBJECTIVES.includes(s.objective)) err('objective', 'Objectif inconnu.');
  if (!isInt(s.coverageTargetPct) || !inBounds('coverageTargetPct', s.coverageTargetPct)) err('coverageTargetPct', 'Part minimale : entier de 1 à 100 %.');
  if (!Array.isArray(s.levels) || !s.levels.length || s.levels.some((l) => !LEVELS.includes(l)) || new Set(s.levels).size !== s.levels.length) {
    err('levels', 'Niveaux : au moins un parmi haute, moyenne, basse, sans doublon.');
  }
  for (const k of ['coverageCatchUp', 'fillDistrict', 'multiActivityDays']) if (typeof s[k] !== 'boolean') err(k, 'Valeur oui / non attendue.');
  if (!DAY_GROUPINGS.includes(s.dayGrouping)) err('dayGrouping', 'Regroupement : lieu, commune ou district.');
  if (!GENERAL_ROW_MODES.includes(s.generalRowMode)) err('generalRowMode', 'Plan général : par bureau ou commun.');
  for (const k of ['capacityMarginPct', 'travelDaysPerTour', 'urgentMinGapMonths', 'anticipationMonths', 'minMonthsSinceVisit']) {
    if (!isInt(s[k]) || !inBounds(k, s[k])) err(k, `Entier de ${BOUNDS[k][0]} à ${BOUNDS[k][1]}.`);
  }
  if (!halfSteps(s.defaultVisitsPerDay) || !inBounds('defaultVisitsPerDay', s.defaultVisitsPerDay)) err('defaultVisitsPerDay', 'De 0,5 à 10, par pas de 0,5.');
  return errors;
}

/** Ligne SQL (ou null) → paramètres complets ; une colonne nulle prend le défaut. */
function fromRow(row) {
  const out = { ...DEFAULTS, levels: [...DEFAULTS.levels] };
  if (!row) return out;
  for (const k of KEYS) {
    const v = row[COLUMNS[k]];
    if (v === null || v === undefined) continue;
    out[k] = k === 'defaultVisitsPerDay' ? Number(v) : k === 'levels' ? LEVELS.filter((l) => v.includes(l)) : v;
  }
  return out;
}

/** Paramètres modifiés par rapport aux valeurs initiales (marque « modifié » de l'écran). */
function changedKeys(s) {
  return KEYS.filter((k) => (k === 'levels'
    ? [...s.levels].sort().join(',') !== [...DEFAULTS.levels].sort().join(',')
    : s[k] !== DEFAULTS[k]));
}

/**
 * Surcharges d'un aperçu (non enregistrées) appliquées aux paramètres du compte.
 * Seules les clés connues passent ; le résultat est revalidé par l'appelant.
 */
function withOverrides(settings, overrides = {}) {
  const out = { ...settings, levels: [...settings.levels] };
  for (const k of KEYS) if (overrides[k] !== undefined) out[k] = k === 'levels' ? [...overrides[k]] : overrides[k];
  return out;
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
 *   coverage : intervalle minimal MMR (durée ÷ risque) qu'un site non encore couvert doit
 *              respecter pour être rattrapé au titre de la couverture.
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
  DEFAULTS, BOUNDS, COLUMNS, KEYS, SOURCES, READ_ONLY, OBJECTIVES, LEVELS, DAY_GROUPINGS, GENERAL_ROW_MODES,
  validateSettings, fromRow, changedKeys, withOverrides, effectiveInterval,
};
