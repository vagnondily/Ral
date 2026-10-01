// Conversion Ar → USD côté client, selon la période de saisie, à partir des
// taux de référence horodatés de Paramétrage. Miroir de
// server/src/modules/common/currencyMath.js (mêmes règles).

function monthKey(period) {
  if (!period) return null;
  return String(period).slice(0, 7);
}

/** Taux (ariary pour 1 USD) applicable à `period`, ou null. */
export function pickRate(rates, period) {
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

/** Valeur USD d'un montant en ariary, ou null si pas de taux. */
export function toUsd(amountAr, rate) {
  const r = Number(rate);
  if (!(r > 0)) return null;
  const v = Number(amountAr);
  if (!Number.isFinite(v)) return null;
  return Math.round((v / r) * 100) / 100;
}

const USD_FMT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formate un montant Ar en « $ … » pour la période donnée, ou '—' sans taux. */
export function formatUsdFor(amountAr, rates, period) {
  const usd = toUsd(amountAr, pickRate(rates, period));
  return usd == null ? '—' : `$ ${USD_FMT.format(usd)}`;
}
