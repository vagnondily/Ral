/**
 * Identifiant affiché des sites (retour n° 64) — règles PURES.
 *
 * Forme : « S-7K3F-9Q2X » — 8 symboles Crockford base 32 (0-9, A-Z sans I, L,
 * O, U) tirés au hasard par la base (migration 073), uniques par compte et
 * IMMUABLES. Professionnel, lisible au téléphone, non devinable : il ne dit
 * rien de l'ordre de création ni du lieu. L'UUID interne reste la clé technique
 * et n'est jamais montré ; les anciens codes (PLAN-0001, L001, Code POI)
 * restent reconnus à l'import.
 *
 * Saisie tolérante : casse, espaces et tirets ignorés, O → 0, I et L → 1.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PATTERN = /^S-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** L'identifiant est-il déjà sous sa forme canonique ? */
const isPublicId = (s) => typeof s === 'string' && PATTERN.test(s);

/**
 * Forme canonique d'une saisie (« s 7k3f 9q2x », « S7K3F9Q2X », « S-7K3F-9Q2X »),
 * ou null si ce n'est pas un identifiant de site.
 */
function normalizePublicId(input) {
  if (input == null) return null;
  let s = String(input).toUpperCase().replace(/[\s_-]+/g, '');
  if (!s.startsWith('S')) return null;
  s = s.slice(1).replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 8 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return `S-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Tirage (même règle que la fonction SQL ; sert aux tests et aux outils). */
function randomPublicId(randomBytes = require('crypto').randomBytes) {
  const b = randomBytes(8);
  const sym = [...b].map((x) => ALPHABET[x % 32]).join('');
  return `S-${sym.slice(0, 4)}-${sym.slice(4)}`;
}

module.exports = { ALPHABET, PATTERN, isPublicId, normalizePublicId, randomPublicId };
