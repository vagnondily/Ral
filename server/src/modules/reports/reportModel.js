const { z } = require('zod');

/**
 * Concepteur de rapport — modèle PUR (testé, sans I/O).
 *
 * Un rapport = { title, period: { from, to }, page, blocks[] }. Chaque bloc a un
 * `type` du catalogue BLOCKS et ses `params`. Le texte riche est stocké en JSON
 * structuré (paragraphes / titres / listes / segments gras-italique-souligné /
 * variables), JAMAIS en HTML : le rendu se fait en éléments React, donc aucune
 * injection de script n'est possible par construction.
 *
 * Les blocs de données citent un `dataset` (DATASETS) ; le serveur les calcule
 * en SQL sur la période (reportData) et le client les met en forme.
 */

// ---- Texte riche ------------------------------------------------------------
const MAX_TEXT = 20000;
const inline = z.object({
  x: z.string().max(MAX_TEXT),
  b: z.boolean().optional(), i: z.boolean().optional(), u: z.boolean().optional(),
  v: z.string().regex(/^[a-z_]{2,40}$/).optional(), // variable : rendue depuis le contexte
});
const richNode = z.object({
  t: z.enum(['p', 'h2', 'h3', 'ul', 'ol', 'quote']),
  c: z.array(inline).max(400).optional(),          // p, h2, h3, quote
  items: z.array(z.array(inline).max(200)).max(200).optional(), // ul, ol
});
const richDoc = z.object({ nodes: z.array(richNode).max(400) });

// ---- Jeux de données ----------------------------------------------------------
/**
 * Catalogue des jeux de données : colonnes affichables et besoin d'une fiche
 * (activité). `scope: 'form'` = calculé pour UNE fiche (filtre ou bloc répété).
 */
const DATASETS = {
  activity_coverage: {
    label: 'Couverture et score par activité', scope: 'all',
    columns: [['activity', 'Activité', 'text'], ['visits', 'Visites', 'int'], ['sitesVisited', 'Sites visités', 'int'],
      ['sitesActive', 'Sites actifs', 'int'], ['coverage', 'Couverture', 'pct'], ['score', 'Score global', 'pct']],
  },
  activity_domains: {
    label: 'Scores par domaine et par activité', scope: 'all', dynamicColumns: 'domains',
    columns: [['activity', 'Activité', 'text'], ['score', 'Score global', 'pct']],
  },
  bureau_domains: {
    label: 'Scores par domaine et par bureau', scope: 'form', dynamicColumns: 'domains',
    columns: [['bureau', 'Bureau', 'text'], ['n', 'N', 'int'], ['score', 'Moyenne', 'pct']],
  },
  indicator_list: {
    label: 'Indicateurs (valeur, base, cible)', scope: 'form',
    columns: [['label', 'Indicateur', 'text'], ['module', 'Domaine', 'text'], ['value', 'Valeur', 'pct'],
      ['base', 'n', 'int'], ['target', 'Cible', 'pct'], ['band', 'Appréciation', 'band']],
  },
  bureau_coverage: {
    label: 'Couverture par bureau', scope: 'all',
    columns: [['bureau', 'Bureau', 'text'], ['sitesActive', 'Sites actifs', 'int'], ['planned', 'Visites planifiées', 'int'],
      ['done', 'Visites réalisées', 'int'], ['rate', 'Taux de réalisation', 'pct']],
  },
  plan_vs_actual: {
    label: 'Plan et réalisé par mois', scope: 'all',
    columns: [['month', 'Mois', 'month'], ['planned', 'Planifiées', 'int'], ['done', 'Réalisées', 'int'], ['rate', 'Taux', 'pct']],
  },
  completeness_monthly: {
    label: 'Complétude mensuelle par activité', scope: 'all', dynamicColumns: 'months',
    columns: [['activity', 'Activité', 'text'], ['target', 'Sites cibles', 'int']],
  },
  region_submissions: {
    label: 'Données versées par région', scope: 'all',
    columns: [['region', 'Région', 'text'], ['submissions', 'Soumissions', 'int'], ['communes', 'Communes', 'int']],
  },
  budget_contracts: {
    label: 'Situation budgétaire par contrat', scope: 'all',
    columns: [['contract', 'Contrat', 'text'], ['partner', 'Partenaire', 'text'], ['budget', 'Budget', 'money'],
      ['planned', 'Planifié', 'money'], ['actual', 'Réalisé', 'money'], ['rate', 'Consommation', 'pct'], ['remaining', 'Restant', 'money']],
  },
  pdd_by_month: {
    label: 'Distributions d\'urgence par mois', scope: 'all',
    columns: [['month', 'Mois', 'month'], ['beneficiaries', 'Bénéficiaires', 'int'], ['households', 'Ménages', 'int'],
      ['food', 'Vivres (t)', 'dec'], ['cash', 'Cash (USD)', 'money']],
  },
};

// Chiffres clés disponibles (bloc « kpis »).
const KPIS = {
  sites_active: 'Sites actifs', sites_visited: 'Sites visités', sites_visited_all: 'Sites visités (toutes fiches)', coverage: 'Couverture des sites',
  visits_done: 'Visites réalisées', visits_planned: 'Visites planifiées', execution_rate: 'Taux de réalisation',
  submissions: 'Données versées', conformity: 'Indice de conformité',
  budget_total: 'Budget de suivi', budget_actual: 'Réalisé', consumption: 'Taux de consommation',
  pdd_beneficiaries: 'Bénéficiaires (PDD)', pdd_food: 'Vivres distribués (t)', pdd_cash: 'Cash distribué (USD)',
};

// ---- Blocs ----------------------------------------------------------------------
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const datasetKey = z.enum(Object.keys(DATASETS));
const filters = z.object({
  formId: z.string().uuid().optional(), bureau: z.string().max(120).optional(), module: z.string().max(120).optional(),
}).default({});

const leafBlock = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('heading'), params: z.object({ text: z.string().min(1).max(300), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2) }) }),
  z.object({ id, type: z.literal('text'), params: z.object({ doc: richDoc }) }),
  z.object({ id, type: z.literal('callout'), params: z.object({ tone: z.enum(['info', 'success', 'warning', 'critical']).default('info'), title: z.string().max(200).optional(), doc: richDoc }) }),
  z.object({ id, type: z.literal('kpis'), params: z.object({ metrics: z.array(z.enum(Object.keys(KPIS))).min(1).max(8), filters }) }),
  z.object({ id, type: z.literal('table'), params: z.object({ title: z.string().max(200).optional(), dataset: datasetKey, columns: z.array(z.string().max(60)).max(30).optional(), limit: z.number().int().min(1).max(500).optional(), filters }) }),
  z.object({ id, type: z.literal('chart'), params: z.object({ title: z.string().max(200).optional(), dataset: datasetKey, kind: z.enum(['bar', 'line', 'matrix']).default('bar'), metric: z.string().max(60).optional(), filters }) }),
  z.object({ id, type: z.literal('bulletin'), params: z.object({ doc: richDoc.optional(), filters }) }),
  z.object({ id, type: z.literal('pagebreak'), params: z.object({}).default({}) }),
  z.object({ id, type: z.literal('divider'), params: z.object({}).default({}) }),
]);
const repeatBlock = z.object({
  id, type: z.literal('repeat'),
  params: z.object({ over: z.enum(['activity', 'bureau']), blocks: z.array(leafBlock).min(1).max(40) }),
});
const block = z.union([leafBlock, repeatBlock]);

const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const page = z.object({
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  header: z.string().max(200).optional(), footer: z.string().max(200).optional(),
  showPageNumbers: z.boolean().default(true),
}).default({});

const reportDoc = z.object({
  title: z.string().trim().min(1).max(200),
  period: z.object({ from: monthStr, to: monthStr }).refine((p) => p.from <= p.to, 'Période : début après la fin'),
  page,
  blocks: z.array(block).max(200),
}).superRefine((d, ctx) => {
  const seen = new Set();
  const visit = (b, path) => {
    if (seen.has(b.id)) ctx.addIssue({ code: 'custom', path, message: `Identifiant de bloc en double : ${b.id}` });
    seen.add(b.id);
    if (b.type === 'repeat') b.params.blocks.forEach((c, i) => visit(c, [...path, 'params', 'blocks', i]));
  };
  d.blocks.forEach((b, i) => visit(b, ['blocks', i]));
  const size = JSON.stringify(d).length;
  if (size > 1_000_000) ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'Rapport trop volumineux (1 Mo max).' });
});

/** Valide un rapport (lève une erreur zod lisible) et renvoie la version normalisée. */
const parseReport = (input) => reportDoc.parse(input);
const safeParseReport = (input) => reportDoc.safeParse(input);

// ---- Variables -------------------------------------------------------------------
const MONTHS = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
/** Libellé de période dans la langue du rapport (fr par défaut, en). */
function periodLabel({ from, to }, lang = 'fr') {
  const en = lang === 'en';
  const names = en ? MONTHS.en : MONTHS.fr;
  const lab = (m) => { const [y, mm] = m.split('-').map(Number); return { y, name: names[mm - 1] }; };
  const a = lab(from); const b = lab(to);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const sep = en ? 'to' : 'à';
  if (from === to) return `${cap(a.name)} ${a.y}`;
  if (a.y === b.y && from.endsWith('-01') && to.endsWith('-12')) return `${en ? 'Year' : 'Année'} ${a.y}`;
  return a.y === b.y ? `${cap(a.name)} ${sep} ${b.name} ${a.y}` : `${cap(a.name)} ${a.y} ${sep} ${b.name} ${b.y}`;
}

/** Variables disponibles dans le texte : période + chiffres clés calculés. */
const VARIABLES = {
  periode: 'Période du rapport', date_edition: 'Date d\'édition', ...KPIS,
};

/** Valeurs des variables pour un rapport (kpis = chiffres clés déjà calculés). */
function variableValues(period, kpis = {}, today = new Date(), lang = 'fr') {
  const out = { periode: periodLabel(period, lang), date_edition: today.toISOString().slice(0, 10) };
  for (const k of Object.keys(KPIS)) if (kpis[k] != null) out[k] = kpis[k];
  return out;
}

// ---- Collecte des besoins en données --------------------------------------------
/**
 * Liste dédupliquée des calculs nécessaires au rendu : [{ key, dataset|kpis, filters }].
 * Un bloc « repeat » est déplié côté serveur (une entrée par activité/bureau).
 */
function dataNeeds(blocks) {
  const needs = new Map();
  const add = (kind, name, f = {}) => {
    const key = `${kind}:${name}:${JSON.stringify(f, Object.keys(f).sort())}`;
    if (!needs.has(key)) needs.set(key, { key, kind, name, filters: f });
    return key;
  };
  const walk = (b) => {
    if (b.type === 'table' || b.type === 'chart') add('dataset', b.params.dataset, b.params.filters || {});
    if (b.type === 'kpis' || b.type === 'bulletin') add('kpis', 'all', b.params.filters || {});
    if (b.type === 'repeat') b.params.blocks.forEach(walk);
  };
  blocks.forEach(walk);
  return [...needs.values()];
}

module.exports = {
  DATASETS, KPIS, VARIABLES, parseReport, safeParseReport, periodLabel, variableValues, dataNeeds,
  schemas: { richDoc, block, reportDoc },
};
