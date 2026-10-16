// Règles de visualisation du concepteur de rapport (lot 7a, guide de visualisation du retour 45)
// — logique PURE (sans DOM), testée depuis le serveur (server/test/reportViz.test.js) :
//  - axe des valeurs TOUJOURS à zéro pour les barres et les colonnes, pourcentages sur 0–100,
//    jamais d'échelle brisée ni de double axe ;
//  - palette sobre validée (validate_palette.js), dans un ORDRE FIXE ; le rouge n'est JAMAIS une
//    couleur de série (il signale « Action urgente » et le ton « critique ») ;
//  - prévu / réalisé : ambre et bleu, comme les tableaux de bord ;
//  - au-delà de 7 catégories : regroupement « Autres » ;
//  - légende dès 2 séries ; légende de figure = numéro, titre, source, n, date.
import { yScale } from './chartAxis.js';

/** Catégories, ordre fixe, 7 au plus (séparation daltonisme la plus faible 9,1). */
export const PALETTE = ['#0f6cbd', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
/** Série unique : l'accent du système. */
export const SINGLE = '#0f6cbd';
/** Prévu / réalisé (séparation 25,4 et 31,5, contraste ≥ 3:1). */
export const PLAN_ACTUAL = { planned: '#c77700', actual: '#0f6cbd' };
/** Intensité (matrices, cartes) : rampe bleue unique, du plus clair au plus foncé. */
export const RAMP = ['#cde2fb', '#a7cbf6', '#7aaeee', '#4d8fe0', '#2a71c8', '#16539f', '#0d366b'];
/** Nombre maximal de catégories distinctes avant « Autres ». */
export const MAX_CATEGORIES = 7;

// Rouges réservés au ton « critique » (jetons --red, --cd-urg et anciens rouges des séries).
const RESERVED_RED = new Set(['#d13438', '#c50f1f', '#a4262c', '#e81123', '#ff0000', '#b10e1c', '#c4314b']);
/** Vrai pour une couleur réservée au critique : jamais attribuée à une série. */
export const isReservedRed = (hex) => RESERVED_RED.has(String(hex || '').toLowerCase());

// Colonnes qui portent le « prévu » ou le « réalisé » (jeux du catalogue).
const PLANNED = new Set(['planned', 'planifie', 'sitesPlanned', 'plannedFunder', 'need', 'budget']);
const ACTUAL = new Set(['done', 'realise', 'actual', 'sitesRealised', 'available']);

/**
 * Couleur de chaque série, dans l'ordre fixe de la palette. Une paire prévu / réalisé reçoit
 * ambre / bleu ; une série seule reçoit le bleu du système.
 * @param {string[]} keys clés des séries, dans l'ordre d'affichage
 * @returns {Object<string,string>}
 */
export function seriesColors(keys) {
  const list = [...(keys || [])];
  if (list.length === 1) return { [list[0]]: SINGLE };
  if (list.length === 2 && PLANNED.has(list[0]) && ACTUAL.has(list[1])) return { [list[0]]: PLAN_ACTUAL.planned, [list[1]]: PLAN_ACTUAL.actual };
  if (list.length === 2 && ACTUAL.has(list[0]) && PLANNED.has(list[1])) return { [list[0]]: PLAN_ACTUAL.actual, [list[1]]: PLAN_ACTUAL.planned };
  return Object.fromEntries(list.map((k, i) => [k, PALETTE[i % PALETTE.length]]));
}

/**
 * Échelle des valeurs, ZÉRO TOUJOURS COMPRIS : [min(0, v), max(0, v)] arrondis, sans échelle
 * brisée ; un pourcentage va de 0 à 100 (ou plus si une valeur dépasse 100).
 * @returns {{ min:number, max:number, ticks:number[] }}
 */
export function zeroScale(values, { percent = false, intervals = 4 } = {}) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  const hi = Math.max(0, ...nums);
  const lo = Math.min(0, ...nums);
  if (percent && hi <= 100 && lo >= 0) return { min: 0, ...yScale(100, { intervals, fixedMax: 100 }) };
  if (hi === 0 && lo === 0) return { min: 0, max: 1, ticks: [0, 1] }; // rien à montrer : un axe minimal
  if (lo === 0) {
    const s = yScale(hi, { intervals, integer: nums.every(Number.isInteger) && hi >= intervals });
    return { min: 0, max: s.max, ticks: s.ticks };
  }
  // Valeurs négatives (écart) : même pas de part et d'autre de zéro, zéro toujours une graduation.
  const span = Math.max(hi, -lo);
  const step = yScale(span, { intervals: Math.max(1, Math.ceil(intervals / 2)), integer: false }).ticks[1];
  const down = Math.ceil(-lo / step);
  const up = Math.ceil(hi / step);
  const ticks = Array.from({ length: down + up + 1 }, (_, i) => (i - down) * step);
  return { min: -down * step, max: up * step, ticks };
}

/**
 * Plus de `max` catégories : les max − 1 plus grandes (selon la 1re mesure) et une ligne
 * « Autres » qui additionne le reste (mesures numériques). Les lignes de total ne comptent pas.
 */
export function groupOthers(rows, { valueKeys, labelKey, max = MAX_CATEGORIES, othersLabel = 'Autres' } = {}) {
  const list = (rows || []).filter((r) => !r._total);
  if (list.length <= max) return list;
  const k = valueKeys[0];
  const sorted = [...list].sort((a, b) => (Number(b[k]) || 0) - (Number(a[k]) || 0));
  const keep = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1);
  const others = { _key: '__others', _others: true, [labelKey]: othersLabel, count: rest.length };
  for (const v of valueKeys) others[v] = rest.reduce((s, r) => s + (Number(r[v]) || 0), 0);
  return [...keep, others];
}

/** Légende obligatoire dès 2 séries. */
export const legendNeeded = (seriesCount) => Number(seriesCount) >= 2;

const NUMERIC = new Set(['int', 'dec', 'pct', 'money', 'rate']);
/**
 * Séries d'un graphique : la mesure choisie, sinon les mesures déclarées par le jeu (présentes
 * dans les colonnes), sinon les colonnes numériques (sans les % quand il y a des comptes),
 * 3 au plus pour des barres ou des colonnes.
 * @param {{measures?:string[]}} def jeu du catalogue ; @param {{columns:object[]}} data
 */
export function chartSeries(def, data, { measure = null, max = 3 } = {}) {
  const cols = ((data && data.columns) || []).filter((c) => NUMERIC.has(c.type) && !c.key.startsWith('m:') && !c.key.startsWith('d:'));
  if (measure) { const c = cols.find((x) => x.key === measure); if (c) return [c]; }
  const declared = ((def && def.measures) || []).map((k) => cols.find((c) => c.key === k)).filter(Boolean);
  if (declared.length) return declared.slice(0, max);
  const counts = cols.filter((c) => c.type !== 'pct' && c.type !== 'rate');
  return (counts.length ? counts : cols).slice(0, max);
}

/** Colonne des catégories (1re colonne texte ou mois). */
export const categoryColumn = (data) => ((data && data.columns) || []).find((c) => c.type === 'text' || c.type === 'month' || c.type === 'date') || null;

/**
 * Conseil de forme selon le but (volet « Présentation ») : un code, traduit par l'interface.
 *  - anneau de plus de 5 parts → barres empilées ou barres ;
 *  - un seul chiffre en graphique → tuile ;
 *  - plus de 7 catégories → « Autres » ou tableau.
 */
export function viewAdvice(view, { rows = 0, series = 1, timeSeries = false } = {}) {
  if (view === 'donut' && rows > 5) return 'donut_too_many';
  if ((view === 'bar' || view === 'column') && rows === 1 && series === 1) return 'single_value';
  // Une suite de mois n'est jamais regroupée en « Autres » : pas de conseil pour une évolution.
  if (!timeSeries && (view === 'bar' || view === 'column' || view === 'donut' || view === 'stacked') && rows > MAX_CATEGORIES) return 'too_many_categories';
  if (view === 'line' && rows < 3) return 'line_too_short';
  return null;
}

/**
 * Largeur estimée d'une étiquette d'axe (px), police Inter à chiffres tabulaires : chiffre 0,62 em,
 * majuscule 0,68, minuscule 0,52, espace et ponctuation 0,30, autre 0,58 (estimation prudente).
 */
export function labelWidth(s, fontPx = 10) {
  let em = 0;
  for (const ch of String(s == null ? '' : s)) {
    if (/[0-9]/.test(ch)) em += 0.62;
    else if (/[\s.,:;'’()/-]/.test(ch)) em += 0.3;
    else if (ch !== ch.toLowerCase()) em += 0.68;
    else if (ch !== ch.toUpperCase()) em += 0.52;
    else em += 0.58;
  }
  return em * fontPx;
}

const ROTATE = 40; // degrés
/**
 * Étiquettes de l'axe des catégories SANS CHEVAUCHEMENT (retour 87 : « Octobre 2025Novembre 2025… ») :
 *  - toutes, droites, si chacune tient dans sa case ;
 *  - sinon toutes, inclinées de −40°, s'il y en a `maxRotated` au plus et que deux étiquettes
 *    voisines restent séparées d'une hauteur de ligne (case × sin 40°) ;
 *  - sinon une sur k, droites, ANCRÉES SUR LA DERNIÈRE (le mois le plus récent est toujours lu).
 * @param {string[]} labels étiquettes (courtes : « oct. 25 »)
 * @param {{ plotW: number, slot?: number, fontPx?: number, gap?: number, maxRotated?: number }} opts
 *   `slot` = distance entre deux catégories (par défaut plotW ÷ nombre d'étiquettes)
 * @returns {{ show: number[], rotate: number, every: number, height: number }} `height` = hauteur à
 *   réserver sous l'axe (px)
 */
export function axisLabelLayout(labels, { plotW, slot = null, fontPx = 10, gap = 6, maxRotated = 24 } = {}) {
  const n = (labels || []).length;
  const flat = fontPx + 6;
  if (!n) return { show: [], rotate: 0, every: 1, height: flat };
  const step = slot != null ? slot : (Number(plotW) || 0) / n;
  const widest = Math.max(...labels.map((l) => labelWidth(l, fontPx)));
  const all = labels.map((_, i) => i);
  if (n === 1 || widest + gap <= step) return { show: all, rotate: 0, every: 1, height: flat };
  const rad = (ROTATE * Math.PI) / 180;
  const lineH = fontPx * 1.25;
  if (n <= maxRotated && step * Math.sin(rad) >= lineH) {
    return { show: all, rotate: -ROTATE, every: 1, height: Math.ceil(widest * Math.sin(rad) + lineH * Math.cos(rad)) + 6 };
  }
  const every = Math.max(2, Math.ceil((widest + gap) / Math.max(step, 1e-6)));
  const show = [];
  for (let i = n - 1; i >= 0; i -= every) show.unshift(i);
  return { show, rotate: 0, every, height: flat };
}

/** Nombre de mois de « AAAA-MM » à « AAAA-MM », bornes comprises. */
const monthSpan = (from, to) => {
  const [a, b] = [from, to].map((m) => { const [y, mo] = String(m).split('-').map(Number); return y * 12 + mo - 1; });
  return b - a + 1;
};

/**
 * Période RÉELLEMENT couverte par les données d'une figure quand elle diffère de celle du bloc
 * (retour 87 : une tendance montre 12 mois jusqu'au mois du rapport, un plan annuel l'exercice
 * entier) — à dire dans sa légende, sinon le n (2 845) contredit celui du rapport (228).
 * @param {{ period?: {from,to}, dataPeriod?: {from,to} }} meta
 * @returns {null | { kind: 'months', n: number, to: string } | { kind: 'year', year: string } | { kind: 'range', from: string, to: string }}
 */
export function dataScope(meta) {
  const d = meta && meta.dataPeriod;
  const p = meta && meta.period;
  if (!d || !/^\d{4}-\d{2}$/.test(d.from || '') || !/^\d{4}-\d{2}$/.test(d.to || '')) return null;
  if (p && p.from === d.from && p.to === d.to) return null;
  if (d.from.slice(0, 4) === d.to.slice(0, 4) && d.from.endsWith('-01') && d.to.endsWith('-12')) return { kind: 'year', year: d.from.slice(0, 4) };
  if (!p || d.to === p.to) return { kind: 'months', n: monthSpan(d.from, d.to), to: d.to };
  return { kind: 'range', from: d.from, to: d.to };
}

/**
 * Pied de figure : source, n et date de situation, dans l'ordre (guide de visualisation).
 * @returns {{ source: string|null, n: number|null, nLabel: string|null, asOf: string|null }}
 */
export function figureFoot(meta, { showN = true, source = null } = {}) {
  const m = meta || {};
  return {
    source: source || m.source || null,
    n: showN && m.n != null ? Number(m.n) : null,
    nLabel: m.nLabel || null,
    asOf: m.asOf || null,
  };
}

/** Position d'une valeur dans la rampe d'intensité (0 → clair, max → foncé ; null → aucune). */
export function rampColor(v, max) {
  if (v == null || !Number.isFinite(Number(v)) || !(max > 0)) return null;
  const i = Math.min(RAMP.length - 1, Math.max(0, Math.floor((Number(v) / max) * (RAMP.length - 1) + 1e-9)));
  return RAMP[i];
}
