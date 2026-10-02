const { AppError } = require('./errors');
const logger = require('../config/logger');

/**
 * Limiteur de débit (fenêtre fixe). Protège surtout le login du bourrinage.
 *
 * - Sans Redis : compteur en mémoire (suffit en mono-processus).
 * - Avec Redis (option `redis`) : compteur partagé entre toutes les instances
 *   de l'API (INCR + PEXPIRE), indispensable si l'API est répliquée.
 * En cas d'erreur Redis, on retombe sur le compteur mémoire (fail-open côté
 * disponibilité : une panne du limiteur ne doit pas bloquer les connexions).
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, keyGenerator, redis, prefix = 'rl' } = {}) {
  const hits = new Map(); // fallback mémoire : key -> { count, resetAt }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  timer.unref?.();

  function memoryCount(key) {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; hits.set(key, e); }
    e.count += 1;
    return { count: e.count, resetMs: e.resetAt - now };
  }

  async function redisCount(key) {
    const rkey = `${prefix}:${key}`;
    const count = await redis.incr(rkey);
    if (count === 1) await redis.pexpire(rkey, windowMs);
    let ttl = await redis.pttl(rkey);
    if (ttl < 0) { await redis.pexpire(rkey, windowMs); ttl = windowMs; }
    return { count, resetMs: ttl };
  }

  return async function limiter(req, res, next) {
    const key = (keyGenerator ? keyGenerator(req) : req.ip) || 'unknown';
    let count; let resetMs;
    try {
      ({ count, resetMs } = redis ? await redisCount(key) : memoryCount(key));
    } catch (err) {
      logger.warn({ err }, 'rate-limit: Redis indisponible, repli mémoire');
      ({ count, resetMs } = memoryCount(key));
    }
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));
    if (count > max) {
      const retry = Math.ceil(resetMs / 1000);
      res.setHeader('Retry-After', String(retry));
      return next(new AppError(429, `Trop de tentatives. Réessayez dans ${Math.max(1, Math.ceil(retry / 60))} minute(s).`));
    }
    return next();
  };
}

module.exports = { rateLimit };
