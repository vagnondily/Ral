/**
 * Horloge figée pour les tests : `new Date()` et `Date.now()` rendent l'instant donné (l'écoulement
 * du temps est conservé), le temps de `fn` ; l'horloge réelle revient ensuite, même sur une erreur.
 * Fuseau de l'application : `timeZone` (APP_TIMEZONE), absent = défaut de l'application (Madagascar).
 */
async function withFrozenClock(iso, fn, { timeZone } = {}) {
  const RealDate = global.Date;
  const offset = RealDate.parse(iso) - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
    static now() { return RealDate.now() + offset; }
  }
  const savedTz = process.env.APP_TIMEZONE;
  global.Date = FakeDate;
  if (timeZone === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = timeZone;
  try {
    return await fn();
  } finally {
    global.Date = RealDate;
    if (savedTz === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = savedTz;
  }
}

module.exports = { withFrozenClock };
