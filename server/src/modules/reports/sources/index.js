const { DATASETS, KPIS } = require('../catalog');
const { memo, stableKey } = require('./memo');

/**
 * Sources du concepteur de rapport (lot 7a) : la SEULE couche qui appelle les dépôts
 * ou services existants (jamais de SQL ici). Une source est l'unité de calcul et de
 * cache : plusieurs jeux de données la partagent.
 *
 * Source = { key, domains, varies, params(def, eff, args, ctx) → objet, load(tenantId, params, ctx) }.
 *  - `domains` : domaines de données lus (versions du cache, migration 064) ;
 *  - `varies`  : contexte dont dépend le résultat ('lang', 'actor', 'today') — il entre dans
 *    la clé de cache, jamais partagé entre deux langues ou deux lecteurs.
 * Pendant un rendu, un même calcul (source + paramètres) n'est fait qu'une fois (`ctx.memo`,
 * promesse partagée ; une erreur n'est pas gardée).
 */
const SOURCES = Object.fromEntries([
  ...require('./monitoring'),
  ...require('./coverage'),
  require('./legacy'),
].map((s) => [s.key, s]));

// Toute source citée par le catalogue existe (contrôle au chargement).
for (const d of [...Object.values(DATASETS), ...Object.values(KPIS)]) {
  if (d.available !== false && !SOURCES[d.source]) throw new Error(`Catalogue du concepteur : source inconnue « ${d.source} » (${d.key}).`);
}

/** Contexte qui entre dans la clé d'une source (langue, lecteur, jour). */
function variesKey(src, ctx) {
  return (src.varies || []).map((v) => `${v}=${v === 'actor' ? (ctx.actor && ctx.actor.userId) || '-' : ctx[v] || '-'}`).join('&');
}

/** Paramètres et clé du calcul d'un jeu (ou d'un chiffre clé). */
function sourceCall(def, eff, args, ctx) {
  const src = SOURCES[def.source];
  if (!src) throw new Error(`Source inconnue : ${def.source}`);
  const params = src.params(def, eff, args || {}, ctx);
  return { src, params, key: `${src.key}|${stableKey(params)}|${variesKey(src, ctx)}` };
}

/** Résultat brut de la source d'un jeu (ou d'un chiffre clé) pour des filtres effectifs. */
function loadFor(def, tenantId, eff, args, ctx) {
  const { src, params, key } = sourceCall(def, eff, args, ctx);
  return memo(ctx, key, () => src.load(tenantId, params, ctx));
}

module.exports = { SOURCES, loadFor, sourceCall, memo, stableKey };
