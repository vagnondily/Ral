/**
 * Horloge figée pour les tests : `new Date()` et `Date.now()` rendent l'instant donné (l'écoulement
 * du temps est conservé), le temps de `fn` ; l'horloge réelle et APP_TIMEZONE reviennent ensuite,
 * même sur une erreur. Fuseau : `timeZone` (APP_TIMEZONE) ; absent ou null = variable retirée, donc
 * le fuseau par défaut de l'application (Madagascar) — jamais la chaîne « null ».
 * Jamais deux horloges figées à la fois (appels qui se chevauchent : l'ordre de restauration serait
 * faux) : un 2ᵉ appel pendant le 1ᵉʳ lève une erreur.
 */
let frozen = false;

async function withFrozenClock(iso, fn, { timeZone = null } = {}) {
  if (frozen) throw new Error('withFrozenClock : horloge déjà figée (appels imbriqués ou simultanés)');
  frozen = true;
  const RealDate = global.Date;
  const savedTz = process.env.APP_TIMEZONE;
  try {
    const offset = RealDate.parse(iso) - RealDate.now();
    if (!Number.isFinite(offset)) throw new Error(`withFrozenClock : instant illisible « ${iso} »`);
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
      static now() { return RealDate.now() + offset; }
    }
    global.Date = FakeDate;
    if (timeZone == null) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = String(timeZone);
    return await fn();
  } finally {
    global.Date = RealDate;
    if (savedTz === undefined) delete process.env.APP_TIMEZONE; else process.env.APP_TIMEZONE = savedTz;
    frozen = false;
  }
}

module.exports = { withFrozenClock };
