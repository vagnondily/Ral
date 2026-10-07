/**
 * Plan de Distribution d'urgence (PDD) — logique pure, sans I/O.
 * Agrège des lignes de distribution (chacune : zone, aléa, bénéficiaires,
 * ménages, cash, et un dictionnaire de tonnages par denrée) en synthèses
 * (par zone, par denrée, par aléa, par mois) et calcule le pipeline
 * (besoin vs stock disponible, écart et couverture).
 */

const zeroAgg = () => ({ lines: 0, beneficiaries: 0, households: 0, cashUsd: 0, totalFood: 0, byCommodity: {} });

function addInto(agg, d) {
  agg.lines += 1;
  agg.beneficiaries += Number(d.beneficiaries) || 0;
  agg.households += Number(d.households) || 0;
  agg.cashUsd += Number(d.cashUsd) || 0;
  agg.totalFood += Number(d.totalFood) || 0;
  for (const [c, q] of Object.entries(d.items || {})) agg.byCommodity[c] = round3((agg.byCommodity[c] || 0) + (Number(q) || 0));
}
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** Synthèse globale + par aléa + par mois + arbre région→district→commune. */
function summarize(distributions) {
  const total = zeroAgg();
  const byHazard = {};
  const byMonth = {};
  const regions = new Map();
  for (const d of distributions || []) {
    addInto(total, d);
    const hz = d.hazard || 'autre';
    (byHazard[hz] = byHazard[hz] || zeroAgg()); addInto(byHazard[hz], d);
    const m = d.periodMonth ? String(d.periodMonth).slice(0, 7) : '—';
    (byMonth[m] = byMonth[m] || zeroAgg()); addInto(byMonth[m], d);
    // Arbre zone
    const rk = d.region || '—';
    if (!regions.has(rk)) regions.set(rk, { name: rk, agg: zeroAgg(), districts: new Map() });
    const R = regions.get(rk); addInto(R.agg, d);
    const dk = d.district || '—';
    if (!R.districts.has(dk)) R.districts.set(dk, { name: dk, agg: zeroAgg(), communes: new Map() });
    const D = R.districts.get(dk); addInto(D.agg, d);
    const ck = d.commune || '—';
    if (!D.communes.has(ck)) D.communes.set(ck, { name: ck, agg: zeroAgg() });
    addInto(D.communes.get(ck).agg, d);
  }
  total.totalFood = round3(total.totalFood);
  const byZone = [...regions.values()].sort((a, b) => b.agg.beneficiaries - a.agg.beneficiaries).map((R) => ({
    name: R.name, ...R.agg,
    districts: [...R.districts.values()].sort((a, b) => b.agg.beneficiaries - a.agg.beneficiaries).map((D) => ({
      name: D.name, ...D.agg,
      communes: [...D.communes.values()].sort((a, b) => b.agg.beneficiaries - a.agg.beneficiaries).map((C) => ({ name: C.name, ...C.agg })),
    })),
  }));
  return { total, byHazard, byMonth, byZone };
}

/**
 * Pipeline : pour chaque denrée, besoin (somme des tonnages planifiés) vs stock
 * disponible, écart (dispo − besoin) et taux de couverture.
 * @param needByCommodity { denrée: tonnage }
 * @param stockByCommodity { denrée: tonnage disponible }
 */
function pipeline(needByCommodity = {}, stockByCommodity = {}) {
  const names = new Set([...Object.keys(needByCommodity), ...Object.keys(stockByCommodity)]);
  const rows = [...names].map((commodity) => {
    const need = round3(needByCommodity[commodity] || 0);
    const available = round3(stockByCommodity[commodity] || 0);
    const gap = round3(available - need);
    const coverage = need > 0 ? available / need : (available > 0 ? 1 : 0);
    return { commodity, need, available, gap, coverage, shortfall: gap < 0 };
  });
  rows.sort((a, b) => b.need - a.need);
  return rows;
}

module.exports = { summarize, pipeline };
