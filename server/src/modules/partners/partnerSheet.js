/**
 * Fiche partenaire 360° — logique PURE (testée, sans I/O) : faits clés, zones
 * d'intervention calculées et frise du parcours. Les montants suivent la
 * définition unique du Réalisé (tpm/realised.js : factures validées), comme le
 * Suivi budgétaire. Un fait qu'on ne sait pas encore mesurer est renvoyé
 * « non_mesurable » (jamais 0).
 */
const { pathKey } = require('../common/placeMatch');

const ratio = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/**
 * @param {object} r  comptages bruts (partners.repository.sheetCounts)
 */
function buildFacts(r) {
  const c = r.contract;
  return {
    contract: c ? {
      status: 'mesure', id: c.id, numero: c.numero, dateFin: c.dateFin, budget: c.budget, actual: c.actual,
      consumption: ratio(c.actual, c.budget), pending: c.pending,
    } : { status: 'aucun' },
    visits: { status: 'mesure', month: r.month, assigned: r.visitsAssigned, realised: r.visitsRealised, rate: ratio(r.visitsRealised, r.visitsAssigned) },
    // Les formulaires ne sont reliés à un prestataire qu'avec le lot K (colonne « prestataire de suivi »).
    submissions: { status: 'non_mesurable' },
    agentScore: { status: 'non_mesurable' },
    team: { status: 'mesure', active: r.agentsActive, total: r.agentsTotal },
    invoicesPending: r.invoicesPending,
    sitesFollowed: r.sitesFollowed,
  };
}

/**
 * Zones d'intervention CALCULÉES (aucune saisie) : zones des contrats + districts
 * des visites, sans doublon (comparaison normalisée), triées.
 * @param {string[]} contractPaths  « Région > District »
 * @param {Array<{region?, district}>} visitDistricts
 */
function mergeZones(contractPaths = [], visitDistricts = []) {
  const out = new Map();
  for (const p of contractPaths) if (p) out.set(pathKey(p), { path: p, source: 'contrat' });
  for (const v of visitDistricts) {
    if (!v.district) continue;
    const path = v.region ? `${v.region} > ${v.district}` : v.district;
    const k = pathKey(path);
    const already = [...out.keys()].some((x) => x === k || x.endsWith(` > ${pathKey(v.district)}`));
    if (!already) out.set(k, { path, source: 'visites' });
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path, 'fr'));
}

// Libellés de la frise : phrase française à paramètres (traduite par l'interface).
const EVENT_TEXT = {
  'contrat:creation': 'Contrat {label} créé',
  'contrat:soumission': 'Contrat {label} soumis pour validation',
  'contrat:approbation': 'Contrat {label} validé',
  'contrat:rejet': 'Contrat {label} rejeté',
  'contrat:avenant_demande': 'Avenant demandé sur le contrat {label}',
  'contrat:avenant_approuve': 'Avenant approuvé sur le contrat {label}',
  'contrat:avenant_rejete': 'Avenant rejeté sur le contrat {label}',
  'contrat:renouvellement': 'Contrat {label} renouvelé',
  'contrat:resiliation': 'Contrat {label} résilié',
  'facture:soumis': 'Facture de {extra} soumise',
  'facture:valide': 'Facture de {extra} validée',
  'facture:rejete': 'Facture de {extra} rejetée',
  'terrain:debut': 'Premières visites dans le district {label}',
  'terrain:dernier': 'Dernières visites dans le district {label}',
  'formation:formation': 'Formation « {label} » suivie par {extra}',
  'evaluation:evaluation': 'Évaluation de {extra} ({label})',
};
const KIND_ORDER = { contrat: 0, facture: 1, terrain: 2, formation: 3, evaluation: 4 };
// À date égale, l'étape la plus avancée d'abord (ex. « validé » avant « soumis » avant « créé »).
const STEP = Object.fromEntries(Object.keys(EVENT_TEXT).map((k, i) => [k, i]));
const byDateDesc = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1
  : (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || (STEP[`${b.kind}:${b.code}`] ?? -1) - (STEP[`${a.kind}:${a.code}`] ?? -1));

/**
 * Frise : événements triés du plus récent au plus ancien (à date égale, ordre
 * stable par nature), bornés à `limit`, avec le curseur de la page suivante.
 * @param {Array<{at, kind, code, label, ref, extra}>} rows
 */
function shapeTimeline(rows, { limit = 50 } = {}) {
  const items = rows
    .filter((r) => r.at)
    .map((r) => ({ ...r, at: new Date(r.at).toISOString() }))
    .sort(byDateDesc)
    .slice(0, limit)
    .map((r) => ({
      at: r.at, kind: r.kind, ref: r.ref || null,
      message: { text: EVENT_TEXT[`${r.kind}:${r.code}`] || `${r.kind} : {label}`, params: { label: r.label || '', extra: r.extra || '' } },
    }));
  return { items, next: items.length === limit ? items[items.length - 1].at : null };
}

module.exports = { buildFacts, mergeZones, shapeTimeline, EVENT_TEXT };
