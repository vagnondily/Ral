/**
 * Conversion Ar → USD par période — logique pure, sans I/O, testée.
 *
 * Les montants de l'app sont en ariary (Ar). Pour « regarder les valeurs en
 * dollars selon la période de saisie », on garde des taux de référence
 * mensuels (ariary pour 1 USD) saisis dans Paramétrage, horodatés. Le taux
 * applicable à une période est le dernier taux dont le mois d'application est
 * ≤ la période ciblée (on n'extrapole jamais vers le futur, on reporte le
 * dernier taux connu). Aucune valeur n'est convertie sans taux applicable.
 */

/** Normalise une période ('YYYY-MM', 'YYYY-MM-DD' ou Date) en 'YYYY-MM'. */
function monthKey(period) {
  if (!period) return null;
  if (period instanceof Date) return period.toISOString().slice(0, 7);
  return String(period).slice(0, 7);
}

/**
 * Taux (ariary pour 1 USD) applicable à `period`, ou null si aucun taux n'a
 * un mois d'application antérieur ou égal.
 * @param rates  [{ effectiveMonth: 'YYYY-MM'|date, usdRate: number }]
 */
function pickRate(rates, period) {
  const target = monthKey(period);
  if (!target || !Array.isArray(rates)) return null;
  let best = null;
  for (const r of rates) {
    const m = monthKey(r.effectiveMonth);
    const rate = Number(r.usdRate);
    if (!m || !(rate > 0) || m > target) continue;
    if (!best || m > best.month) best = { month: m, rate };
  }
  return best ? best.rate : null;
}

/**
 * Valeur en USD d'un montant en ariary au taux donné (ariary pour 1 USD),
 * arrondie au cent. Renvoie null si le taux est absent ou invalide.
 */
function toUsd(amountAr, rate) {
  const r = Number(rate);
  if (!(r > 0)) return null;
  const v = Number(amountAr);
  if (!Number.isFinite(v)) return null;
  return Math.round((v / r) * 100) / 100;
}

/**
 * Total en USD de montants datés, en CENTIMES ENTIERS : chaque montant est converti au taux de
 * SON mois (pickRate) et arrondi au cent — exactement la valeur de sa cellule —, puis les cents
 * sont sommés. Un total sur plusieurs mois n'est jamais converti au taux d'un seul mois.
 * @param {{ amountAr:number, period:string }[]} items
 * @returns {number|null} cents ; null si un montant non nul n'a pas de taux applicable
 */
function sumUsdCents(items, rates) {
  let cents = 0;
  for (const it of items || []) {
    const v = Number(it.amountAr) || 0;
    if (v === 0) continue;
    const usd = toUsd(v, pickRate(rates, it.period));
    if (usd == null) return null;
    cents += Math.round(usd * 100);
  }
  return cents;
}

module.exports = { monthKey, pickRate, toUsd, sumUsdCents };
