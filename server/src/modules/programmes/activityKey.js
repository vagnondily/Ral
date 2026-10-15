/**
 * Clé normalisée d'un libellé d'activité de programme — logique PURE, jumelle EXACTE
 * de la fonction SQL `mems_activity_key(text)` (migration 105, SPEC_PROGRAMMES § 7).
 *
 * Mêmes étapes, dans le même ordre :
 *   1. `translate` des lettres accentuées (tables ACCENTS_FROM → ACCENTS_TO) ;
 *   2. `lower` ;
 *   3. suppression de tout ce qui n'est pas [a-z0-9].
 * « Distribution générale », « DISTRIBUTION-GENERALE » et « distribution  générale »
 * donnent la même clé « distributiongenerale ». La parité JS / SQL est testée
 * (activityKey.test.js : constantes lues dans le fichier SQL ; base réelle si
 * MEMS_TEST_DATABASE_URL est fourni).
 *
 * La clé d'ALIAS (table programme_activity_aliases) est cette clé coupée à 160
 * caractères (CHECK de la colonne) ; une clé vide (libellé sans lettre ni
 * chiffre) ne désigne aucune activité.
 */

// Recopiées à l'identique dans 105_programme_activities.sql (test de parité).
const ACCENTS_FROM = 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ';
const ACCENTS_TO = 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy';
const MAX_ALIAS_KEY = 160;

const FROM = [...ACCENTS_FROM];
const TO = [...ACCENTS_TO];
const TRANSLATE = new Map(FROM.map((ch, i) => [ch, TO[i]]));

/** translate(s, ACCENTS_FROM, ACCENTS_TO) de PostgreSQL (caractère par caractère). */
function translateAccents(s) {
  let out = '';
  for (const ch of s) out += TRANSLATE.has(ch) ? TRANSLATE.get(ch) : ch;
  return out;
}

/**
 * Jumelle de mems_activity_key : null / undefined → '' (coalesce).
 * @param {unknown} s
 * @returns {string}
 */
function activityKey(s) {
  const str = s == null ? '' : String(s);
  return translateAccents(str).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Clé d'alias d'un texte (left(mems_activity_key(s), 160) en SQL), ou null si le
 * texte ne porte ni lettre ni chiffre.
 * @param {unknown} s
 * @returns {string|null}
 */
function aliasKeyOf(s) {
  const k = activityKey(s).slice(0, MAX_ALIAS_KEY);
  return k || null;
}

/**
 * Libellé nettoyé tel qu'il est enregistré : espaces de bord retirés, espaces
 * répétés réduits à un seul (comme la reprise SQL). '' si vide.
 * @param {unknown} s
 * @returns {string}
 */
function cleanLabel(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// ---- Code d'une activité de programme --------------------------------------------
/** Motif du code (CHECK de programme_activities.code). */
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/;
const CODE_MAX = 30;

/**
 * Code proposé pour un libellé (jumelle de la reprise SQL de la migration 105) :
 * accents retirés, majuscules, tout caractère hors [A-Z0-9._-] → « - », tirets
 * répétés fusionnés, premier caractère alphanumérique, 30 caractères au plus,
 * séparateurs de fin retirés ; « ACT » si rien ne reste.
 * Ex. « Distribution générale (GD) » → « DISTRIBUTION-GENERALE-GD ».
 * @param {unknown} label
 * @returns {string}
 */
function codeFromLabel(label) {
  // upper() de PostgreSQL agit caractère par caractère : « ß » reste « ß » (puis devient « - »),
  // alors que toUpperCase() en ferait « SS ».
  let c = [...translateAccents(label == null ? '' : String(label))]
    .map((ch) => { const u = ch.toUpperCase(); return u.length === ch.length ? u : ch; }).join('');
  c = c.replace(/[^A-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-');
  c = c.replace(/^[^A-Z0-9]+/, '');
  c = c.slice(0, CODE_MAX).replace(/[._-]+$/, '');
  return c || 'ACT';
}

/**
 * Premier code libre : `base`, puis `base-2`, `base-3`… (coupé pour rester à 30
 * caractères). `taken` = codes déjà pris, comparés sans casse.
 * @param {string} base
 * @param {Iterable<string>} taken
 * @returns {string}
 */
function uniqueCode(base, taken) {
  const used = new Set([...taken].map((c) => String(c).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, CODE_MAX - suffix.length).replace(/[._-]+$/, '')}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

module.exports = {
  ACCENTS_FROM, ACCENTS_TO, MAX_ALIAS_KEY, CODE_RE, CODE_MAX,
  activityKey, aliasKeyOf, cleanLabel, codeFromLabel, uniqueCode, translateAccents,
};
