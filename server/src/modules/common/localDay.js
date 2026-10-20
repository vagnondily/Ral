/**
 * Jour LOCAL de l'application (fuseau APP_TIMEZONE, Madagascar par défaut — le même que les
 * contrats, contracts.service) — PUR pour une date donnée, testé (test/localDay.test.js). Entre
 * minuit et 3 h, heure de Madagascar, le jour UTC est encore la veille : « jamais une date passée »
 * se juge sur le jour local.
 */
const DEFAULT_TZ = 'Indian/Antananarivo';

/** 'AAAA-MM-JJ' du jour local de `date` dans `timeZone` (fuseau invalide → UTC). */
function localDay(date = new Date(), timeZone = process.env.APP_TIMEZONE || DEFAULT_TZ) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

module.exports = { localDay, DEFAULT_TZ };
