/**
 * Raison d'un changement (retour 58 : « s'il y a modifications on doit donner la raison ») —
 * règle PURE, sans I/O, réutilisable (justificatifs, motifs). Testée : test/reasonText.test.js.
 *
 *  1. espaces fusionnés, bords rognés ;
 *  2. vide → `reason_required` si la raison est exigée, sinon null ;
 *  3. moins de `min` caractères → `reason_short` ; plus de `max` → `reason_long` ;
 *  4. moins de 5 lettres, ou moins de 3 caractères alphanumériques distincts →
 *     `reason_meaningless` (« .......... », « aaaaaaaaaa », « 1234567890 » ne disent rien) ;
 *  5. sinon le texte nettoyé.
 * Les bornes 10..500 sont aussi celles des CHECK de la base (migration 070) : la base refuse ce
 * que la route laisserait passer par erreur.
 *
 * Comme common/period.parsePeriod, le module rend un résultat au lieu de lever une erreur HTTP
 * (il ne charge pas middleware/errors) : `requireReason` (service) le traduit en 400.
 */
const REASON_MIN = 10;
const REASON_MAX = 500;

const MESSAGES = {
  reason_required: 'Indiquez la raison du changement (10 caractères au moins).',
  reason_short: 'La raison doit compter 10 caractères au moins.',
  reason_long: 'La raison ne doit pas dépasser 500 caractères.',
  reason_meaningless: 'La raison doit expliquer le changement : quelques mots suffisent.',
};

/**
 * @param {unknown} raw
 * @param {{ required?: boolean, min?: number, max?: number }} [opts]
 * @returns {{ ok: true, reason: string|null } | { ok: false, code: string, message: string }}
 */
function checkReason(raw, { required = true, min = REASON_MIN, max = REASON_MAX } = {}) {
  const text = typeof raw === 'string' ? raw.replace(/\s+/gu, ' ').trim() : '';
  const fail = (code) => ({ ok: false, code, message: MESSAGES[code] });
  if (!text) return required ? fail('reason_required') : { ok: true, reason: null };
  const chars = [...text];
  if (chars.length < min) return fail('reason_short');
  if (chars.length > max) return fail('reason_long');
  const letters = text.match(/\p{L}/gu) || [];
  const distinct = new Set((text.toLowerCase().match(/[\p{L}\p{N}]/gu) || []));
  if (letters.length < 5 || distinct.size < 3) return fail('reason_meaningless');
  return { ok: true, reason: text };
}

module.exports = { checkReason, REASON_MIN, REASON_MAX, REASON_MESSAGES: MESSAGES };
