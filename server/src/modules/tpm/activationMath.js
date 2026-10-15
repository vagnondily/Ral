/**
 * Grille « Sites (actifs / inactifs) » (retour n° 64) — règles PURES.
 *
 * Fidèle à la feuille « Site Actif » du classeur d'activation : par site et par
 * mois de l'exercice, Oui (actif), Non (inactif) ou vide (non renseigné). Un
 * site est identifié par « Code POI » + « Tag_code » (la colonne Identifiant
 * du classeur), à défaut par son code MEMS.
 *
 * Aucune I/O : le dépôt lit l'état courant et le classeur, ce module calcule
 * les écarts, les totaux et les libellés.
 */

/** En-têtes des mois, dans l'ordre du classeur. */
const MONTH_HEADERS = Object.freeze(['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']);
const MONTHS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

const { normalizePublicId } = require('../common/publicId');

const fold = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const YES = new Set(['oui', 'o', 'yes', 'y', '1', 'active', 'actif', 'true', 'vrai', 'x']);
const NO = new Set(['non', 'n', 'no', '0', 'inactive', 'inactif', 'false', 'faux']);

/**
 * Valeur d'une cellule de mois.
 * @returns {{ ok: true, value: boolean|null } | { ok: false }}
 *   null = cellule vide ; ok:false = valeur non reconnue.
 */
function parseYesNo(v) {
  const s = fold(v);
  if (s === '') return { ok: true, value: null };
  if (YES.has(s)) return { ok: true, value: true };
  if (NO.has(s)) return { ok: true, value: false };
  return { ok: false };
}

/** Libellé d'une valeur pour le classeur. */
const yesNo = (v) => (v === true ? 'Oui' : v === false ? 'Non' : '');

/** Clé de rapprochement normalisée (casse, espaces et accents ignorés). */
const identKey = (s) => fold(s).replace(/\s+/g, '');

/**
 * Identifiant affiché d'un site, comme la colonne « Identifiant » du classeur :
 * Code POI + Tag_code, sinon le code MEMS du site.
 */
function identifierOf({ locationId, tagCode, code } = {}) {
  const poi = String(locationId ?? '').trim();
  if (poi) return `${poi}${String(tagCode ?? '').trim()}`;
  return String(code ?? '').trim();
}

/**
 * Index de rapprochement : identifiant (Code POI + Tag_code), puis code MEMS.
 * Un identifiant porté par plusieurs sites est ambigu : jamais rapproché.
 * @param {{id, locationId, tagCode, code}[]} sites
 */
function buildSiteIndex(sites = []) {
  const byKey = new Map();
  const ambiguous = new Set();
  const add = (key, id) => {
    if (!key) return;
    if (byKey.has(key) && byKey.get(key) !== id) ambiguous.add(key);
    else byKey.set(key, id);
  };
  for (const s of sites) {
    if (s.publicId) add(identKey(s.publicId), s.id);
    add(identKey(identifierOf(s)), s.id);
    if (s.code) add(identKey(s.code), s.id);
  }
  for (const k of ambiguous) byKey.delete(k);
  return {
    /** @returns {{ siteId: string|null, ambiguous: boolean }} */
    resolve(ident, { locationId, tagCode, publicId } = {}) {
      // L'identifiant MEMS (« S-XXXX-XXXX », saisie tolérante) prime : il ne change jamais.
      const pid = normalizePublicId(publicId);
      const keys = [pid ? identKey(pid) : '', identKey(ident), identKey(`${locationId ?? ''}${tagCode ?? ''}`)].filter(Boolean);
      for (const k of keys) {
        if (ambiguous.has(k)) return { siteId: null, ambiguous: true };
        if (byKey.has(k)) return { siteId: byKey.get(k), ambiguous: false };
      }
      return { siteId: null, ambiguous: false };
    },
  };
}

/**
 * Écarts entre l'état courant et les valeurs voulues.
 * @param {Map<string, Record<number, boolean>>} current  état par site (mois → actif)
 * @param {{siteId:string, months:Record<number, boolean|null|undefined>, reason?:string|null}[]} wanted
 *   undefined = mois inchangé ; null = effacer (non renseigné).
 * @returns {{siteId, month, before:boolean|null, after:boolean|null, reason:string|null}[]}
 */
function diffActivation(current, wanted = []) {
  const out = [];
  const seen = new Set();
  for (const w of wanted) {
    const cur = current.get(w.siteId) || {};
    for (const m of MONTHS) {
      const after = w.months ? w.months[m] : undefined;
      if (after === undefined) continue;
      const key = `${w.siteId}|${m}`;
      if (seen.has(key)) continue; // première occurrence : un site en double dans le fichier ne change pas deux fois
      seen.add(key);
      const before = cur[m] === undefined ? null : cur[m];
      if (before === after) continue;
      out.push({ siteId: w.siteId, month: m, before, after, reason: cleanReason(w.reason) });
    }
  }
  return out;
}

/** Motif nettoyé (≤ 500 caractères) ou null. */
function cleanReason(r) {
  if (typeof r !== 'string') return null;
  const s = [...r.trim()].slice(0, 500).join('').trim();
  return s || null;
}

/** Compte des écarts par nature. */
function summarizeChanges(changes = []) {
  const sites = new Set();
  let activated = 0; let deactivated = 0; let cleared = 0;
  for (const c of changes) {
    sites.add(c.siteId);
    if (c.after === true) activated += 1;
    else if (c.after === false) deactivated += 1;
    else cleared += 1;
  }
  return { changes: changes.length, sites: sites.size, activated, deactivated, cleared };
}

/**
 * Totaux par mois : actifs, inactifs, non renseignés.
 * @param {{months: Record<number, boolean>}[]} rows
 */
function monthTotals(rows = []) {
  return MONTHS.map((m) => {
    let active = 0; let inactive = 0; let unknown = 0;
    for (const r of rows) {
      const v = r.months ? r.months[m] : undefined;
      if (v === true) active += 1; else if (v === false) inactive += 1; else unknown += 1;
    }
    return { month: m, active, inactive, unknown };
  });
}

/** « Actif » de l'exercice, comme la colonne du classeur : au moins un mois à Oui. */
const activeInYear = (months = {}) => MONTHS.some((m) => months[m] === true);

module.exports = {
  MONTH_HEADERS, MONTHS,
  parseYesNo, yesNo, identKey, identifierOf, buildSiteIndex,
  diffActivation, cleanReason, summarizeChanges, monthTotals, activeInYear,
};
