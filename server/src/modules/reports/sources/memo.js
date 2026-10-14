/** Calcul partagé pendant un rendu (`ctx.memo`) : une promesse par clé ; une erreur n'est jamais gardée. */
function memo(ctx, key, fn) {
  if (!ctx.memo) ctx.memo = new Map();
  if (!ctx.memo.has(key)) {
    const p = Promise.resolve().then(fn);
    ctx.memo.set(key, p);
    p.catch(() => ctx.memo.delete(key));
  }
  return ctx.memo.get(key);
}

/** JSON à clés triées : deux objets égaux donnent la même clé. */
function stableKey(v) {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableKey(v[k])}`).join(',')}}`;
}

module.exports = { memo, stableKey };
