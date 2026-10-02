const { AppError } = require('./errors');

/**
 * Limiteur de débit en mémoire (fenêtre glissante simple), sans dépendance.
 * Protège surtout le login du bourrinage (brute-force). En mono-processus il
 * suffit ; en multi-instances, un store Redis partagé serait nécessaire — à
 * prévoir si l'API est répliquée (voir ioredis déjà présent pour BullMQ).
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, keyGenerator } = {}) {
  const hits = new Map(); // key -> { count, resetAt }
  // Purge périodique pour ne pas fuir la mémoire.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  timer.unref?.();

  return function limiter(req, res, next) {
    const now = Date.now();
    const key = (keyGenerator ? keyGenerator(req) : req.ip) || 'unknown';
    let e = hits.get(key);
    if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; hits.set(key, e); }
    e.count += 1;
    const remaining = Math.max(0, max - e.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    if (e.count > max) {
      const retry = Math.ceil((e.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return next(new AppError(429, `Trop de tentatives. Réessayez dans ${Math.ceil(retry / 60)} minute(s).`));
    }
    return next();
  };
}

module.exports = { rateLimit };
