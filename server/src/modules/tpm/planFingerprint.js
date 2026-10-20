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
const { agentNumber } = require('./planResources');

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

const pad = (m) => String(m).padStart(2, '0');

/**
 * Une visite telle que le moteur la LIT : le mois et le statut ; la date et l'agent seulement là où
 * ils réservent un créneau (planAuto.pushVisit + planResources.coveredOf) — visite prévue ou
 * réalisée d'un mois OUVERT de la période, datée, agent générique « Agent N » (son numéro). Ailleurs
 * (mois hors période, agent nommé, date sans agent) ils ne changent pas le plan : jamais un 409 pour
 * rien.
 */
function visitKey(v, open) {
  const base = `${Number(v.month)}:${v.status}`;
  const n = agentNumber(v.agent);
  if (n == null || !v.date || !open.has(Number(v.month)) || (v.status !== 'planifie' && v.status !== 'realise')) return base;
  return `${base}:${String(v.date)}:${n}`;
}

/** Le site a-t-il un TPM de zone à ce mois (même règle que planAuto.tpmAt) ? */
const hasTpmAt = (s, mm) => (s.tpmSegments || []).some((x) => x && x.from <= mm && mm <= x.to && (x.providerId || x.providerName));

/**
 * @param {{ sites: object[], mmrByKey: object, yearHasGrid: boolean }} input entrée du moteur
 * @param {object} params période effective, premier mois planifiable, réglages normalisés, périmètre
 * @returns {{ fingerprint: string, sections: Record<string,string> }}
 */
function fingerprintInputs(input = {}, params = {}) {
  const sites = [...(input.sites || [])].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const open = new Set((params.months || []).map(Number));
  // Bureau racine du suivi interne : l'unité des agents d'un site sans TPM de zone un mois ouvert
  // (sans période connue : toujours compté).
  const officeCounts = (s) => !params.year || !open.size || [...open].some((m) => !hasTpmAt(s, `${params.year}-${pad(m)}`));
  const parts = {
    // Registre, priorité du RBM (urgence, score final : l'ordre des communes en dépend) et bureau
    // racine du suivi interne (unité des agents : un bureau ou une antenne déplacé change le plan).
    registre: sites.map((s) => [s.id, s.district, s.commune, s.activity, s.riskLevel, Boolean(s.forbidden), s.mmrKey,
      Boolean(s.parametered), Number(s.required) || 0, s.gpsLat ?? null, s.gpsLng ?? null, s.inScope !== false,
      Boolean(s.urgent), Number(s.finalScore) || 0, s.fieldOfficeId || null, officeCounts(s) ? s.unitOfficeId || null : null]),
    // Visites de l'exercice (la date et l'agent là où ils réservent un créneau : visitKey), mois
    // annulés et visites des exercices voisins (ancrages de l'intervalle).
    visites: sites.map((s) => [s.id, s.lastVisitMonth || null,
      (s.visits || []).map((v) => visitKey(v, open)).sort(),
      [...(s.cancelledMonths || [])].map(Number).sort((a, b) => a - b),
      [...(s.outsideVisits || [])].map((v) => `${v.month}:${v.status}`).sort()]),
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

module.exports = { canonical, fingerprintInputs, changedSections, visitKey, SECTIONS };
