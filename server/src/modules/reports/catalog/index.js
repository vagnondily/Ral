const { VIEWS } = require('../reportSchema');

/**
 * Registre du catalogue du concepteur de rapport (lot 7a) — PUR (déclarations et mises
 * en forme, aucune I/O), testé (test/reportCatalog.test.js).
 *
 * Un JEU DE DONNÉES = { key, label, group, origin, source, filters, periodMode, views,
 * defaultView, columns, measures, args, available, reason, shape(raw, eff, ctx) }.
 *  - `source` : clé d'une source (sources/index.js) — la SEULE couche qui appelle les
 *    dépôts ou services existants ; plusieurs jeux partagent une source et un calcul ;
 *  - `shape` : mise en forme pure du résultat de la source → { columns, rows, meta } ;
 *    meta = { n, nLabel, source, asOf, note, definition, warnings } ;
 *  - `filters` : filtres pris en charge EN PLUS de la période ('office', 'activity',
 *    'partner', 'form', 'module') ; un filtre non pris en charge rend un bloc vide avec
 *    sa raison (« Non disponible par bureau. »), jamais un total national présenté
 *    comme celui d'un bureau ;
 *  - `periodMode` : 'range' (la plage), 'asOf' (situation au dernier mois), 'year'
 *    (année du dernier mois), 'now' (aujourd'hui).
 * Un CHIFFRE CLÉ = { key, label, unit, group, source, filters, pick(raw, eff) → { value, base?, note? } }.
 * Libellés en français : l'interface les traduit avec tr() (test reportsI18n).
 */

const GROUPS = [
  { key: 'monitoring', label: 'Suivi de processus' },
  { key: 'coverage', label: 'Couverture et plan' },
  { key: 'rbm', label: 'Risk-Based Monitoring et sites' },
  { key: 'map', label: 'Carte' },
  { key: 'budget', label: 'Budget et contrats' },
  { key: 'tpm', label: 'Partenaires et TPM' },
  { key: 'pdd', label: 'Distribution d\'urgence' },
  { key: 'alerts', label: 'Alertes' },
  { key: 'quality', label: 'Qualité des données' },
];
const FILTER_KEYS = ['office', 'activity', 'partner', 'form', 'module'];
const PERIOD_MODES = ['range', 'asOf', 'year', 'now'];
const COLUMN_TYPES = ['text', 'int', 'dec', 'pct', 'money', 'month', 'band', 'status', 'date', 'rate'];
const UNITS = ['int', 'pct', 'money', 'dec', 'mt', 'rate'];
// Clés de bureau qu'une source sait filtrer : 'id' (bureau MEMS et ses antennes), 'unlinked'
// (sans bureau), 'lib' / 'code' (libellé ou code d'une fiche — soumissions seulement).
const OFFICE_KINDS = ['id', 'lib', 'code', 'unlinked'];
const ARG_TYPES = ['uuid', 'number', 'enum', 'text'];

// Déclarations (un fichier par domaine).
const DATASET_LIST = [
  ...require('./monitoring'),
  ...require('./coverage'),
  ...require('./rbm'),
  ...require('./legacy'),
];
const KPI_LIST = [
  ...require('./kpis'),
];

/** Contrôles du registre au chargement : une erreur de déclaration empêche le démarrage. */
function checkRegistry(datasets, kpis) {
  const issues = [];
  const seen = new Set();
  const groups = new Set(GROUPS.map((g) => g.key));
  for (const d of datasets) {
    const at = `jeu ${d.key}`;
    if (!/^[a-z]+\.[a-z_0-9]+$/.test(d.key || '')) issues.push(`${at} : clé invalide`);
    if (seen.has(d.key)) issues.push(`${at} : clé en double`);
    seen.add(d.key);
    if (!d.label) issues.push(`${at} : libellé manquant`);
    if (!groups.has(d.group)) issues.push(`${at} : groupe inconnu ${d.group}`);
    if (!d.source) issues.push(`${at} : source manquante`);
    if (!PERIOD_MODES.includes(d.periodMode)) issues.push(`${at} : mode de période inconnu ${d.periodMode}`);
    if (!Array.isArray(d.views) || !d.views.length || d.views.some((v) => !VIEWS.includes(v))) issues.push(`${at} : vues invalides`);
    if (!d.views || !d.views.includes(d.defaultView)) issues.push(`${at} : vue par défaut hors des vues`);
    if ((d.filters || []).some((f) => !FILTER_KEYS.includes(f))) issues.push(`${at} : filtre inconnu`);
    if (!Array.isArray(d.columns) || d.columns.some((c) => !c.key || !c.label || !COLUMN_TYPES.includes(c.type))) issues.push(`${at} : colonnes invalides`);
    if (d.available !== false && typeof d.shape !== 'function') issues.push(`${at} : mise en forme manquante`);
    if (d.available === false && !d.reason) issues.push(`${at} : indisponible sans raison`);
    if (d.officeKinds && d.officeKinds.some((k) => !OFFICE_KINDS.includes(k))) issues.push(`${at} : type de bureau inconnu`);
    for (const [name, a] of Object.entries(d.args || {})) {
      if (!ARG_TYPES.includes(a.type) || !a.label) issues.push(`${at} : argument ${name} invalide`);
      if (a.type === 'enum' && (!Array.isArray(a.choices) || !a.choices.length)) issues.push(`${at} : argument ${name} sans choix`);
    }
    if (d.measures && d.measures.some((m) => !(d.columns || []).some((c) => c.key === m) && !['exc', 'sat', 'imp', 'urg', 'na'].includes(m))) issues.push(`${at} : mesure inconnue`);
  }
  const kseen = new Set();
  for (const k of kpis) {
    if (!/^[a-z_0-9]{2,40}$/.test(k.key || '')) issues.push(`chiffre ${k.key} : clé invalide`);
    if (kseen.has(k.key)) issues.push(`chiffre ${k.key} : clé en double`);
    kseen.add(k.key);
    if (!k.label || !UNITS.includes(k.unit) || !k.source || (k.available !== false && typeof k.pick !== 'function')) issues.push(`chiffre ${k.key} : déclaration incomplète`);
  }
  return issues;
}

const REGISTRY_ISSUES = checkRegistry(DATASET_LIST, KPI_LIST);
if (REGISTRY_ISSUES.length) throw new Error(`Catalogue du concepteur invalide :\n${REGISTRY_ISSUES.join('\n')}`);

const DATASETS = Object.fromEntries(DATASET_LIST.map((d) => [d.key, { filters: [], args: {}, measures: null, available: true, reason: null, ...d }]));
const KPIS = Object.fromEntries(KPI_LIST.map((k) => [k.key, { filters: [], available: true, reason: null, ...k }]));

const datasetDef = (key) => DATASETS[key] || null;
const kpiDef = (key) => KPIS[key] || null;

/** Colonnes numériques d'un jeu (mesures possibles d'un graphique). */
const numericColumns = (def) => def.columns.filter((c) => ['int', 'dec', 'pct', 'money', 'rate'].includes(c.type)).map((c) => c.key);

/**
 * Paramètres d'un bloc « données » contre la déclaration du jeu : vue permise, arguments
 * requis, mesure, colonnes et tri connus. Renvoie la liste des problèmes ({ path, message }).
 */
function validateBlockParams(def, params) {
  const issues = [];
  if (!def) return [{ path: ['dataset'], message: `Jeu de données inconnu : ${params && params.dataset}` }];
  const p = params || {};
  if (p.view && !def.views.includes(p.view)) issues.push({ path: ['view'], message: `Vue « ${p.view} » non permise pour ce jeu (${def.views.join(', ')}).` });
  for (const [name, spec] of Object.entries(def.args || {})) {
    const v = p.args ? p.args[name] : undefined;
    if (v == null || v === '') {
      if (spec.required) issues.push({ path: ['args', name], message: `Argument requis : ${spec.label || name}.` });
      continue;
    }
    if (spec.type === 'uuid' && !/^[0-9a-fA-F-]{36}$/.test(String(v))) issues.push({ path: ['args', name], message: `Identifiant invalide : ${name}.` });
    if (spec.type === 'number' && !Number.isFinite(Number(v))) issues.push({ path: ['args', name], message: `Nombre attendu : ${name}.` });
    if (spec.type === 'enum' && !spec.choices.includes(v)) issues.push({ path: ['args', name], message: `Valeur non permise pour ${name} : ${v}.` });
    if (spec.type === 'text' && String(v).length > 200) issues.push({ path: ['args', name], message: `Texte trop long : ${name}.` });
  }
  for (const name of Object.keys(p.args || {})) if (!(def.args || {})[name]) issues.push({ path: ['args', name], message: `Argument inconnu : ${name}.` });
  const known = new Set(def.columns.map((c) => c.key));
  const dynamic = (k) => def.dynamicColumns && /^[dm]:/.test(k);
  for (const c of p.columns || []) if (!known.has(c) && !dynamic(c)) issues.push({ path: ['columns'], message: `Colonne inconnue : ${c}.` });
  if (p.measure && !numericColumns(def).includes(p.measure) && !dynamic(p.measure)) issues.push({ path: ['measure'], message: `Mesure inconnue : ${p.measure}.` });
  if (p.sort && !known.has(p.sort.key) && !dynamic(p.sort.key)) issues.push({ path: ['sort'], message: `Tri sur une colonne inconnue : ${p.sort.key}.` });
  return issues;
}

/** Catalogue publié au client (libellés en français, traduits par l'interface). */
function catalogForClient() {
  const pub = (d) => ({
    label: d.label, group: d.group, origin: d.origin || null, views: d.views, defaultView: d.defaultView,
    filters: d.filters, periodMode: d.periodMode, args: d.args, columns: d.columns, measures: d.measures || numericColumns(d),
    dynamicColumns: d.dynamicColumns || null, available: d.available !== false, reason: d.reason || null, keywords: d.keywords || [],
    officeKinds: d.officeKinds || OFFICE_KINDS, annotate: d.annotate || null,
  });
  return {
    groups: GROUPS.map((g) => ({ ...g, items: Object.values(DATASETS).filter((d) => d.group === g.key).map((d) => d.key) })),
    datasets: Object.fromEntries(Object.values(DATASETS).map((d) => [d.key, pub(d)])),
    kpis: Object.fromEntries(Object.values(KPIS).map((k) => [k.key, { label: k.label, unit: k.unit, group: k.group, filters: k.filters, available: k.available !== false, reason: k.reason || null }])),
  };
}

module.exports = {
  GROUPS, FILTER_KEYS, PERIOD_MODES, COLUMN_TYPES, OFFICE_KINDS, DATASETS, KPIS,
  datasetDef, kpiDef, numericColumns, validateBlockParams, catalogForClient, checkRegistry,
};
