/**
 * Jour LOCAL de l'application (fuseau APP_TIMEZONE, Madagascar par défaut — le même que les
 * contrats, contracts.service) — PUR pour une date donnée, testé (test/localDay.test.js). Entre
 * minuit et 3 h, heure de Madagascar, le jour UTC est encore la veille : « jamais une date passée »
 * se juge sur le jour local. C'est aussi le « mois courant » du serveur (rbmMath.currentMonth) et
 * celui que l'écran de planification lit (GET /api/tpm/plan-auto/clock) : un seul mois courant.
 */
const DEFAULT_TZ = 'Indian/Antananarivo';

// Un formateur par fuseau, créé une seule fois : rbmMath.currentMonth est appelé par site dans les
// boucles du Plan de suivi et du RBM (créer un Intl.DateTimeFormat coûte ≈ 80 µs, le réutiliser
// ≈ 1 µs). Fuseau invalide → null (mis en cache aussi) : repli UTC, comme avant ; un fuseau qui
// n'est pas une chaîne (objet, nombre…) → UTC, jamais une exception.
const FORMATTERS = new Map();
const MAX_FORMATTERS = 64;
function formatterFor(timeZone) {
  if (typeof timeZone !== 'string') return null;
  if (FORMATTERS.has(timeZone)) return FORMATTERS.get(timeZone);
  let f = null;
  try {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    f = null;
  }
  if (FORMATTERS.size >= MAX_FORMATTERS) FORMATTERS.clear();
  FORMATTERS.set(timeZone, f);
  return f;
}

/** Vide le cache des formateurs (tests seulement : compter les créations quel que soit l'ordre). */
function clearFormatterCache() {
  FORMATTERS.clear();
}

/** 'AAAA-MM-JJ' du jour local de `date` dans `timeZone` (fuseau invalide → UTC). */
function localDay(date = new Date(), timeZone = process.env.APP_TIMEZONE || DEFAULT_TZ) {
  const f = formatterFor(timeZone);
  if (!f) return date.toISOString().slice(0, 10);
  try {
    return f.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Fuseau effectivement utilisé : APP_TIMEZONE s'il est valide, sinon Madagascar ; 'UTC' en dernier recours. */
function appTimeZone(timeZone = process.env.APP_TIMEZONE || DEFAULT_TZ) {
  const f = formatterFor(timeZone);
  return f ? f.resolvedOptions().timeZone : 'UTC';
}

module.exports = { localDay, appTimeZone, formatterFor, clearFormatterCache, DEFAULT_TZ };
