/**
 * Rapprochement des PERSONNES MORALES et des AGENTS d'un formulaire reçu avec
 * les objets MEMS (retour n° 3) — logique pure, sans I/O, testée.
 *
 * Un formulaire Kobo porte un code (« 2 ») et son libellé (« LALANA »), ou un
 * texte (« TOMPY - Ampanihy »). On cherche :
 *   - le partenaire MEMS (partners : nom ou sigle) ;
 *   - l'agent MEMS (tpm_agents : code d'enquêteur, puis nom), dans le
 *     partenaire reconnu quand il l'est.
 * Seule une correspondance EXACTE (après normalisation) est appliquée seule ;
 * un nom seulement proche est PROPOSÉ (l'utilisateur confirme dans l'écran
 * « Correspondances »). Jamais de nom proche pour une personne : attribuer une
 * collecte au mauvais enquêteur fausserait son évaluation.
 */
const { normPlace, similarity } = require('./placeMatch');

// Mots génériques d'une raison sociale, sans valeur pour reconnaître l'organisation.
const ORG_WORDS = new Set(['association', 'asso', 'ong', 'ngo', 'organisation', 'organization', 'cabinet', 'sarl', 'sa', 'ltd', 'the', 'de', 'des', 'du', 'la', 'le', 'l']);
const NEAR = 0.88;

/** Clé d'un nom d'organisation : normalisé, sans les mots génériques. */
function orgKey(name) {
  return normPlace(String(name || '')).key.split(' ').filter((w) => w && !ORG_WORDS.has(w)).join(' ');
}
/** Clé d'un nom de personne ou d'un code : normalisé (accents, casse, ponctuation). */
/**
 * Clé d'une personne (ou d'un code) : casse, accents et ponctuation ignorés, et ordre des mots
 * aussi — les fiches écrivent « NOM Prénom » ou « Prénom NOM » pour la même personne.
 */
const personKey = (name) => normPlace(String(name || '')).key.split(' ').filter(Boolean).sort().join(' ');

/** Variantes d'un libellé d'organisation : entier, puis avant « - », « / » ou « ( » (« TOMPY - Ampanihy » → « TOMPY »). */
function orgVariants(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const head = s.split(/\s[-–/]\s|\s*\(/)[0];
  return [...new Set([orgKey(s), orgKey(head)].filter(Boolean))];
}

/** Index des partenaires : clé du nom et du sigle → partenaires. */
function buildPartnerIndex(partners) {
  const byKey = new Map();
  const add = (k, p) => { if (!k) return; if (!byKey.has(k)) byKey.set(k, []); if (!byKey.get(k).includes(p)) byKey.get(k).push(p); };
  for (const p of partners || []) { add(orgKey(p.name), p); add(orgKey(p.shortName), p); }
  return { byKey, all: partners || [] };
}

/**
 * Partenaire MEMS d'une valeur reçue.
 * @param {{ byKey, all }} index
 * @param {{ raw: string, label?: string }} q
 * @returns {{ status: 'exact'|'propose'|'ambigu'|'introuvable'|'vide', partner: object|null, candidates: object[] }}
 */
function resolvePartner(index, { raw, label }) {
  const texts = [label, raw].filter((x) => x != null && String(x).trim() !== '');
  if (!texts.length) return { status: 'vide', partner: null, candidates: [] };
  for (const t of texts) {
    for (const k of orgVariants(t)) {
      const hit = index.byKey.get(k) || [];
      if (hit.length === 1) return { status: 'exact', partner: hit[0], candidates: [] };
      if (hit.length > 1) return { status: 'ambigu', partner: null, candidates: hit };
    }
  }
  // Proche (proposé, jamais appliqué seul) : nom voisin, ou un nom MEMS qui commence le libellé (« YP » / « YPA »).
  const keys = texts.flatMap(orgVariants);
  const near = [];
  for (const p of index.all) {
    const pk = [orgKey(p.name), orgKey(p.shortName)].filter(Boolean);
    const score = Math.max(0, ...keys.flatMap((k) => pk.map((x) => (x.length >= 2 && (k.startsWith(`${x} `) || x.startsWith(k)) ? 0.9 : similarity(k, x)))));
    if (score >= NEAR) near.push({ p, score });
  }
  near.sort((a, b) => b.score - a.score);
  if (near.length) return { status: 'propose', partner: null, candidates: near.slice(0, 3).map((x) => x.p) };
  return { status: 'introuvable', partner: null, candidates: [] };
}

/** Index des agents : code et nom normalisés. */
function buildAgentIndex(agents) {
  const byCode = new Map(); const byName = new Map();
  const add = (m, k, a) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(a); };
  for (const a of agents || []) { add(byCode, personKey(a.code), a); add(byName, personKey(a.name), a); }
  return { byCode, byName };
}

/**
 * Agent MEMS d'une valeur reçue. Le code d'enquêteur n'est unique que DANS un
 * prestataire (uq_tpm_agents_code) : il ne relie seul que si le partenaire de
 * la soumission est reconnu, et seulement si le libellé du choix (le nom) ne
 * désigne pas quelqu'un d'autre — sinon c'est une proposition. Puis nom exact,
 * dans le partenaire quand il est connu (deux homonymes = ambigu, rien d'appliqué).
 * @param {{ byCode, byName }} index
 * @param {{ raw: string, label?: string, partnerId?: string|null }} q
 */
function resolveAgent(index, { raw, label, partnerId }) {
  const blank = (v) => v == null || String(v).trim() === '';
  if (blank(raw) && blank(label)) return { status: 'vide', agent: null, candidates: [] };
  const codeHits = blank(raw) ? [] : index.byCode.get(personKey(raw)) || [];
  if (partnerId) {
    const mine = codeHits.filter((a) => a.partnerId === partnerId);
    if (mine.length === 1) {
      const a = mine[0];
      if (blank(label) || personKey(label) === personKey(a.name)) return { status: 'code', agent: a, candidates: [] };
      // Le libellé désigne quelqu'un d'autre : la personne de ce nom chez ce partenaire, si elle est unique.
      const named = (index.byName.get(personKey(label)) || []).filter((x) => x.partnerId === partnerId);
      if (named.length === 1) return { status: 'nom', agent: named[0], candidates: [] };
      return { status: 'propose', agent: null, candidates: [a] };
    }
  }
  const scoped = (list) => (partnerId ? (list || []).filter((a) => a.partnerId === partnerId) : list || []);
  for (const text of [label, raw]) {
    if (blank(text)) continue;
    const hits = scoped(index.byName.get(personKey(text)));
    if (hits.length === 1) return { status: 'nom', agent: hits[0], candidates: [] };
    if (hits.length > 1) return { status: 'ambigu', agent: null, candidates: hits };
  }
  // Même code chez un autre prestataire, ou partenaire inconnu : proposé, jamais appliqué seul —
  // et seulement si le libellé reçu ne désigne pas quelqu'un d'autre (les fiches numérotent
  // les mêmes personnes différemment).
  const coherent = blank(label) ? codeHits : codeHits.filter((a) => personKey(a.name) === personKey(label));
  if (coherent.length) return { status: 'propose', agent: null, candidates: coherent.slice(0, 3) };
  return { status: 'introuvable', agent: null, candidates: [] };
}

module.exports = { orgKey, personKey, orgVariants, buildPartnerIndex, resolvePartner, buildAgentIndex, resolveAgent };
