/**
 * Empreinte des entrées du générateur (lot 5, § 7.9) — PURE, testée.
 *
 * L'aperçu renvoie l'empreinte (SHA-256) et celle de chaque section ; « Appliquer » recharge
 * les entrées SOUS LES VERROUS des mois, recalcule et compare : la moindre différence
 * (registre, visites ou données, activation, MMR, paramètres et horizon — dont le premier
 * mois planifiable, qui dépend de l'horloge) → 409 avec les sections qui ont changé.
 * JSON canonique (clés triées, sites triés par id) : indépendant de l'ordre d'entrée.
 */
const crypto = require('node:crypto');

/** JSON canonique : clés triées, ensembles triés, fonctions et `undefined` ignorés. */
function canonical(v) {
  if (v === undefined || typeof v === 'function') return undefined;
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (v instanceof Set) return canonical([...v].sort());
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x) ?? 'null').join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== 'function').sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const SECTIONS = ['registre', 'visites', 'activation', 'mmr', 'parametres'];

/**
 * @param {object} input entrée du générateur (planInputs.assemble().input)
 * @param {object} [extra] périmètre et objectif (hors entrée du calcul mais dans l'empreinte)
 * @returns {{ fingerprint: string, sections: Record<string,string> }}
 */
function fingerprintInputs(input, extra = {}) {
  const sites = [...(input.sites || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parts = {
    registre: sites.map((s) => [s.id, s.code, s.inScope, s.poolKey, s.districtKey, s.communeKey, s.placeKey, s.risk, s.urgent,
      (s.urgentSignals || []).map((x) => `${x.code}:${x.value}`), s.finalScore]),
    visites: sites.map((s) => [s.id, s.lastReal, (s.months || []).map((c) => c.st)]),
    activation: sites.map((s) => [s.id, (s.months || []).map((c) => (c.active ? 1 : 0) + (c.forbidden ? 2 : 0))]),
    mmr: input.pools || {},
    parametres: { year: input.year, fromMonth: input.fromMonth, toMonth: input.toMonth, params: input.params || {}, ...extra },
  };
  const sections = {};
  for (const k of SECTIONS) sections[k] = sha(canonical(parts[k]));
  return { fingerprint: sha(SECTIONS.map((k) => sections[k]).join('|')), sections };
}

/** Sections dont l'empreinte diffère (ordre fixe). */
function changedSections(a = {}, b = {}) {
  return SECTIONS.filter((k) => a[k] !== b[k]);
}

/** Empreinte d'un résultat (déterminisme : deux exécutions, deux ordres d'entrée → même valeur). */
function fingerprintResult(result) {
  return sha(canonical({ proposals: result.proposals, sites: result.sites, pools: result.pools }));
}

module.exports = { canonical, fingerprintInputs, changedSections, fingerprintResult, SECTIONS };
