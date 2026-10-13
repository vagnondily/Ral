/**
 * Règles de définition d'un indicateur (création, modification) — logique
 * PURE, sans I/O, testée. La base garde ses contraintes (méthode, sens, codes
 * hors base ≤ 20, code unique par fiche) ; ici, ce qui dépend de plusieurs
 * champs à la fois, appliqué à la définition EFFECTIVE (l'indicateur enregistré
 * + la modification partielle).
 */

/** Champs modifiables d'un indicateur (clé d'API). */
const INDICATOR_KEYS = ['code', 'label', 'module', 'sourceField', 'agg', 'positiveValue', 'target', 'direction', 'sortOrder', 'active', 'naValues', 'scored'];

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

/** Modification partielle : seules les clés PRÉSENTES (null = effacer) — l'absence ne touche à rien. */
function presentKeys(patch) {
  return INDICATOR_KEYS.filter((k) => has(patch || {}, k));
}

/** Définition effective après modification : l'enregistré, recouvert des seules clés présentes. */
function effectiveDefinition(current, patch) {
  const out = { ...(current || {}) };
  for (const k of presentKeys(patch)) out[k] = patch[k];
  return out;
}

/** Codes « hors base » nettoyés : sans espaces autour, sans doublon (casse ignorée), 20 au plus. */
function normalizeNaValues(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out.slice(0, 20);
}

/**
 * Erreur de définition (message lisible), ou null si la définition est cohérente :
 *   - « % = valeur » exige la (les) valeur(s) comptée(s) ;
 *   - une cible doit être un nombre fini ;
 *   - une valeur comptée n'est pas aussi un code « hors base » (elle ne serait jamais comptée).
 */
function definitionError(def) {
  const d = def || {};
  const positive = d.positiveValue == null ? '' : String(d.positiveValue).trim();
  if (d.agg === 'percent_value' && !positive) {
    return 'Méthode « % = valeur » : précisez la valeur comptée (ex. 1, ou 1|2 pour plusieurs).';
  }
  if (d.target != null && d.target !== '' && !Number.isFinite(Number(d.target))) return 'Cible invalide : saisissez un nombre.';
  if (positive && (d.agg === 'percent_value' || d.agg === 'percent_yes' || d.agg == null)) {
    const na = new Set((d.naValues || []).map((x) => String(x).trim().toLowerCase()));
    const clash = positive.split('|').map((x) => x.trim()).find((x) => x && na.has(x.toLowerCase()));
    if (clash) return `La valeur « ${clash} » est à la fois comptée et hors base : retirez-la de l'une des deux listes.`;
  }
  return null;
}

module.exports = { INDICATOR_KEYS, presentKeys, effectiveDefinition, normalizeNaValues, definitionError };
