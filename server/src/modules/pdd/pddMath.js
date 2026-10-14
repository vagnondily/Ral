/**
 * Plan de Distribution d'urgence (PDD) — logique pure, sans I/O.
 * Agrège des lignes de distribution (chacune : zone, aléa, bénéficiaires,
 * ménages, cash, et un dictionnaire de tonnages par denrée) en synthèses
 * (par zone, par denrée, par aléa, par mois) et calcule le pipeline
 * (besoin vs stock disponible, écart et couverture).
 */

const zeroAgg = () => ({ lines: 0, beneficiaries: 0, households: 0, cashUsd: 0, totalFood: 0, byCommodity: {} });

// Une ligne de distribution compte pour 1 ; une ligne déjà agrégée en SQL (GROUP BY) porte `lines`.
function addInto(agg, d) {
  agg.lines += d.lines != null ? (Number(d.lines) || 0) : 1;
  agg.beneficiaries += Number(d.beneficiaries) || 0;
  agg.households += Number(d.households) || 0;
  agg.cashUsd += Number(d.cashUsd) || 0;
  agg.totalFood += Number(d.totalFood) || 0;
  for (const [c, q] of Object.entries(d.items || {})) agg.byCommodity[c] = round3((agg.byCommodity[c] || 0) + (Number(q) || 0));
}
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/**
 * Synthèse globale + par aléa + par mois + arbre région→district→commune.
 * Accepte des lignes de distribution OU des groupes déjà agrégés en SQL (mois × aléa ×
 * région × district × commune, avec `lines` et les tonnages sommés) : même résultat,
 * lecture bornée (repository.summaryData).
 */
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

/**
 * Stock de référence par denrée sur plusieurs mois : le DERNIER mois renseigné
 * (jamais une ligne prise au hasard). Renvoie { [denrée]: { qty, donor, month } }.
 * @param {Array<{commodity:string, qty:number, donor?:string, month:string}>} rows  mois au format AAAA-MM
 */
function latestStock(rows = []) {
  const out = {};
  for (const r of rows) {
    const cur = out[r.commodity];
    if (!cur || String(r.month) > String(cur.month)) out[r.commodity] = { qty: r.qty, donor: r.donor || null, month: r.month };
  }
  return out;
}

/**
 * Pic mensuel (lot 1b) : le mois où le plus de bénéficiaires ont été servis, avec ses
 * ménages. Il n'existe pas d'identifiant de personne : la somme d'une période compte des
 * « bénéficiaires-distributions » ; le pic est la borne basse honnête des personnes
 * atteintes. Égalité : le mois le plus ancien. null sans mois.
 * @param {Record<string,{beneficiaries:number,households:number}>} byMonth  (summarize().byMonth)
 */
function peakMonth(byMonth = {}) {
  let best = null;
  for (const m of Object.keys(byMonth).sort()) {
    const b = Number(byMonth[m].beneficiaries) || 0;
    if (!best || b > best.beneficiaries) best = { month: m, beneficiaries: b, households: Number(byMonth[m].households) || 0 };
  }
  return best;
}

/**
 * Pipeline sur une période, MOIS PAR MOIS (lot 1b) : un stock est un niveau, jamais
 * additionné ; le besoin d'un mois est comparé au stock en vigueur ce mois-là (dernier
 * stock saisi ≤ mois). Par denrée :
 *  - need = Σ besoins des mois ; available = stock au dernier mois (`stockMonth`) ;
 *  - months[] = { month, need, available, stockMonth, gap, coverage, shortfall } ;
 *  - shortfallMonths = mois en rupture ; uncovered = Σ des manques mensuels (t) ;
 *  - sur UN mois : gap = available − need et coverage = available ÷ need (règle de
 *    `pipeline`) ; sur plusieurs : gap = −uncovered et coverage = part des besoins
 *    mensuels couverte par le stock du mois (Σ min(besoin, stock) ÷ Σ besoin).
 * @param {{commodity:string, month:string, qty:number}[]} needRows  besoins par denrée × mois
 * @param {{commodity:string, month:string, qty:number, donor?:string}[]} stockRows  stocks saisis ≤ dernier mois
 * @param {string[]} months  mois de la période, du plus ancien au plus récent
 */
function pipelineOverMonths(needRows = [], stockRows = [], months = []) {
  if (!months.length) return [];
  const last = months[months.length - 1];
  const need = new Map(); // denrée → mois → t
  for (const r of needRows) {
    if (!need.has(r.commodity)) need.set(r.commodity, new Map());
    const byM = need.get(r.commodity);
    byM.set(r.month, round3((byM.get(r.month) || 0) + (Number(r.qty) || 0)));
  }
  const stocks = new Map(); // denrée → stocks triés par mois
  for (const r of stockRows) {
    if (String(r.month) > last) continue;
    if (!stocks.has(r.commodity)) stocks.set(r.commodity, []);
    stocks.get(r.commodity).push(r);
  }
  for (const list of stocks.values()) list.sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const names = new Set([...need.keys(), ...stocks.keys()]);
  const rows = [...names].map((commodity) => {
    const list = stocks.get(commodity) || [];
    const byM = need.get(commodity) || new Map();
    let k = -1; // dernier stock ≤ mois courant de la boucle
    let totalNeed = 0; let covered = 0; let uncovered = 0; let shortfallMonths = 0;
    const lines = months.map((month) => {
      while (k + 1 < list.length && String(list[k + 1].month) <= month) k += 1;
      const s = k >= 0 ? list[k] : null;
      const [line] = pipeline({ [commodity]: byM.get(month) || 0 }, { [commodity]: s ? s.qty : 0 });
      totalNeed += line.need;
      covered += Math.min(line.need, line.available);
      uncovered += Math.max(0, line.need - line.available);
      if (line.shortfall) shortfallMonths += 1;
      return { month, need: line.need, available: line.available, stockMonth: s ? s.month : null, donor: s ? s.donor || null : null,
        gap: line.gap, coverage: line.coverage, shortfall: line.shortfall };
    });
    const end = lines[lines.length - 1];
    const one = lines.length === 1;
    const needT = round3(totalNeed);
    return {
      commodity, need: needT, available: end.available, stockMonth: end.stockMonth, donor: end.donor,
      gap: one ? end.gap : -round3(uncovered),
      coverage: one ? end.coverage : (needT > 0 ? covered / totalNeed : (end.available > 0 ? 1 : 0)),
      shortfall: shortfallMonths > 0, shortfallMonths, uncovered: round3(uncovered), months: lines,
    };
  });
  rows.sort((a, b) => b.need - a.need);
  return rows;
}

module.exports = { summarize, pipeline, latestStock, peakMonth, pipelineOverMonths };
