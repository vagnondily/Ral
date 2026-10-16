/**
 * Empreinte des entrées de la planification automatique — PURE, testée.
 *
 * L'aperçu renvoie l'empreinte (SHA-256) et celle de chaque section ; « Appliquer » relit les
 * entrées SOUS LES VERROUS des mois, dans la même transaction que l'écriture, recalcule et
 * compare : la moindre différence (registre, visites, activation, MMR, TPM de zone, paramètres
 * et période — dont le premier mois planifiable, qui dépend de l'horloge) → 409 avec les
 * sections qui ont changé ; l'écran demande de relancer l'aperçu. On n'écrit jamais un plan
 * calculé sur des données que l'utilisateur n'a pas vues.
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

const SECTIONS = ['registre', 'visites', 'activation', 'mmr', 'tpm', 'parametres'];

const byMonth = (a, b) => (Number(a.month) - Number(b.month)) || String(a.status).localeCompare(String(b.status));

/**
 * @param {{ sites: object[], mmrByKey: object, yearHasGrid: boolean }} input entrée du moteur
 * @param {object} params période effective, premier mois planifiable, réglages normalisés, périmètre
 * @returns {{ fingerprint: string, sections: Record<string,string> }}
 */
function fingerprintInputs(input = {}, params = {}) {
  const sites = [...(input.sites || [])].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const parts = {
    registre: sites.map((s) => [s.id, s.district, s.commune, s.activity, s.riskLevel, Boolean(s.forbidden), s.mmrKey,
      Boolean(s.parametered), Number(s.required) || 0, s.gpsLat ?? null, s.gpsLng ?? null, s.inScope !== false]),
    visites: sites.map((s) => [s.id, s.lastVisitMonth || null, [...(s.visits || [])].sort(byMonth).map((v) => `${v.month}:${v.status}`),
      [...(s.cancelledMonths || [])].map(Number).sort((a, b) => a - b)]),
    activation: { yearHasGrid: Boolean(input.yearHasGrid), sites: sites.map((s) => [s.id, s.monthStatus || {}]) },
    mmr: input.mmrByKey || {},
    tpm: sites.map((s) => [s.id, (s.tpmSegments || []).map((g) => [g.from, g.to, g.providerId || null, g.providerName || null])]),
    parametres: params,
  };
  const sections = {};
  for (const k of SECTIONS) sections[k] = sha(canonical(parts[k]));
  return { fingerprint: sha(SECTIONS.map((k) => sections[k]).join('|')), sections };
}

/** Sections dont l'empreinte diffère (ordre fixe). */
function changedSections(a = {}, b = {}) {
  return SECTIONS.filter((k) => a[k] !== b[k]);
}

module.exports = { canonical, fingerprintInputs, changedSections, SECTIONS };
