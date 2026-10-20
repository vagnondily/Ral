/**
 * Cache « par empreinte » (pur, sans E/S) : une valeur coûteuse à construire (ex. l'index du
 * découpage d'un pays, 19 000 unités) est gardée par compte avec l'EMPREINTE des données dont
 * elle dérive ; elle n'est rendue que si l'empreinte est identique — sinon on la reconstruit.
 * Au plus `max` entrées (la plus anciennement servie sort la première). Testé
 * (test/stampedCache.test.js).
 */
function createStampedCache({ max = 8 } = {}) {
  const entries = new Map(); // clé → { stamp, value } (ordre = dernière utilisation)
  return {
    /** Valeur gardée pour `key` si elle a été construite avec la même `stamp`, sinon undefined. */
    get(key, stamp) {
      const e = entries.get(key);
      if (!e || e.stamp !== stamp) return undefined;
      entries.delete(key); entries.set(key, e); // la plus récemment servie
      return e.value;
    },
    set(key, stamp, value) {
      entries.delete(key);
      entries.set(key, { stamp, value });
      while (entries.size > max) entries.delete(entries.keys().next().value);
      return value;
    },
    delete(key) { entries.delete(key); },
    get size() { return entries.size; },
  };
}

module.exports = { createStampedCache };
