/**
 * Date « AAAA-MM-JJ » RÉELLE (logique pure, testée : test/isoDate.test.js) : le format seul laisse
 * passer 2026-02-31 ou 2026-13-01, que PostgreSQL refuse ensuite (22008) avec un message générique.
 * Contrôlée ici au bord, avec un message clair. Années 1900 à 2999.
 */
const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealIsoDate(s) {
  const m = RE.exec(typeof s === 'string' ? s : '');
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2999) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Schéma zod d'une date réelle (z passé par l'appelant : une seule version de zod). */
const isoDateSchema = (z, message = 'Date AAAA-MM-JJ réelle attendue') => z.string().refine(isRealIsoDate, { message });

module.exports = { isRealIsoDate, isoDateSchema };
