/**
 * Jour LOCAL de l'application (fuseau APP_TIMEZONE, Madagascar par défaut — le même que les
 * contrats, contracts.service) — PUR pour une date donnée, testé (test/localDay.test.js). Entre
 * minuit et 3 h, heure de Madagascar, le jour UTC est encore la veille : « jamais une date passée »
 * se juge sur le jour local. C'est aussi le « mois courant » du serveur (rbmMath.currentMonth) et
 * celui que l'écran de planification lit (GET /api/tpm/plan-auto/clock) : un seul mois courant.
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

/** Fuseau effectivement utilisé : APP_TIMEZONE s'il est valide, sinon Madagascar ; 'UTC' en dernier recours. */
function appTimeZone(timeZone = process.env.APP_TIMEZONE || DEFAULT_TZ) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

module.exports = { localDay, appTimeZone, DEFAULT_TZ };
