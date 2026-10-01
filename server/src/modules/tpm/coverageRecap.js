/**
 * Récap de couverture des sites (feuille « Site Coverage Recap » du Plan de
 * suivi). Logique pure, sans I/O. Pour chaque niveau de risque (qui pilote la
 * fréquence MMR), on compte les sites actifs, combien ont été visités 1 / 2 /
 * 3 / 4+ fois sur la durée d'opération, la couverture (≥ 1 visite) et la
 * conformité MMR (sites ayant atteint le nombre de visites requis).
 */
const { frequencyFor } = require('./rbmMath');

const LEVELS = ['elevee', 'moyenne', 'faible'];

/** Nombre de visites requises sur la durée d'opération pour un risque donné. */
function requiredVisits(riskLevel, operationMonths) {
  const interval = frequencyFor(riskLevel); // mois entre deux visites
  const dur = Number(operationMonths) || 0;
  if (dur <= 0 || interval <= 0) return 0;
  return Math.floor(dur / interval);
}

/**
 * @param rows  [{ riskLevel, visitCount }] — une entrée par site (visites réalisées).
 * @param operationMonths durée d'opération (mois) pour le calcul des visites requises.
 */
function coverageRecap(rows, operationMonths = 12) {
  const by = {};
  for (const lv of LEVELS) {
    by[lv] = {
      riskLevel: lv, required: requiredVisits(lv, operationMonths),
      active: 0, once: 0, twice: 0, thrice: 0, fourPlus: 0,
      visitedToDate: 0, totalVisits: 0, compliant: 0,
    };
  }
  for (const r of rows || []) {
    const lv = LEVELS.includes(r.riskLevel) ? r.riskLevel : 'moyenne';
    const g = by[lv];
    const n = Math.max(0, Number(r.visitCount) || 0);
    g.active += 1;
    g.totalVisits += n;
    if (n >= 1) g.visitedToDate += 1;
    if (n === 1) g.once += 1;
    else if (n === 2) g.twice += 1;
    else if (n === 3) g.thrice += 1;
    else if (n >= 4) g.fourPlus += 1;
    if (g.required > 0 && n >= g.required) g.compliant += 1;
  }
  const finish = (g) => {
    g.notVisited = g.active - g.visitedToDate;
    g.coverageRate = g.active ? g.visitedToDate / g.active : 0;
    g.compliance = g.active && g.required > 0 ? g.compliant / g.active : (g.active ? g.coverageRate : 0);
    return g;
  };
  const groups = LEVELS.map((lv) => finish(by[lv]));
  const total = groups.reduce((a, g) => {
    for (const k of ['active', 'once', 'twice', 'thrice', 'fourPlus', 'visitedToDate', 'totalVisits', 'compliant']) a[k] += g[k];
    return a;
  }, { active: 0, once: 0, twice: 0, thrice: 0, fourPlus: 0, visitedToDate: 0, totalVisits: 0, compliant: 0 });
  total.notVisited = total.active - total.visitedToDate;
  total.coverageRate = total.active ? total.visitedToDate / total.active : 0;
  total.compliance = total.active ? total.compliant / total.active : 0;
  return { groups, total };
}

module.exports = { requiredVisits, coverageRecap };
