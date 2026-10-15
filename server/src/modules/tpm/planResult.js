/**
 * Mise en forme de l'aperçu du générateur pour l'écran (lot 5, § 7.11) — PURE, testée.
 * Le serveur rend des CODES et des nombres (pourquoi, raisons de report, modes) ; l'écran
 * les traduit (FR / EN) avec icône + libellé — jamais un texte figé en français ici.
 */
const { U } = require('./planGenerator');

const days = (units) => (units == null ? null : Math.round((units / U) * 10) / 10);

/**
 * @param {object} a  planInputs.assemble(...)
 * @param {object} r  planGenerator.generatePlan(...)
 * @param {{ fingerprint, sections }} fp
 */
function shapePreview(a, r, fp, { settings, overridden = [], scope, timings } = {}) {
  const { input, poolInfo, siteInfo } = a;
  const inScopePools = new Set(input.sites.filter((s) => s.inScope && s.poolKey).map((s) => s.poolKey));
  const pools = poolInfo.filter((p) => inScopePools.has(p.key)).map((p) => {
    const proj = r.pools[p.key] || {};
    return {
      ...p,
      dayCapDays: days(p.dayCapUnits), dayCapUnits: undefined,
      ...proj,
      months: r.months.map((mo) => {
        const c = mo.capacity[p.key];
        return c ? { month: mo.month, cap: c.visitsCap, used: c.used, existing: c.existing, generated: c.generated, quota: c.quota,
          dayCap: days(c.dayCapUnits), dayUsed: days(c.dayUsedUnits), over: c.over } : { month: mo.month, cap: 0, used: 0, existing: 0, generated: 0 };
      }),
    };
  }).sort((x, y) => String(x.activity).localeCompare(String(y.activity), 'fr') || String(x.officeName || '').localeCompare(String(y.officeName || ''), 'fr'));

  const referenced = new Set();
  const proposals = r.proposals.map((p) => {
    referenced.add(p.siteId); if (p.anchor) referenced.add(p.anchor);
    return { siteId: p.siteId, month: p.month, why: p.why, reason: p.reason, level: p.level, tour: p.tour, day: p.day, anchor: p.anchor || null, detail: p.detail };
  });
  const unplanned = [];
  for (const s of r.sites) {
    if (!s.main) continue;
    referenced.add(s.siteId);
    unplanned.push({ siteId: s.siteId, code: s.main.code, month: s.main.month, detail: s.main.detail || null });
  }
  const sites = {};
  for (const id of referenced) {
    const i = siteInfo.get(id);
    if (i) sites[id] = { name: i.name, code: i.code, publicId: i.publicId, locationId: i.locationId, activity: i.activity, district: i.district, commune: i.commune, poolKey: i.poolKey };
  }
  // Tournées par mois (district, communes, journées, visites générées) — vue « par tournée ».
  const districtName = new Map();
  for (const s of input.sites) if (!districtName.has(s.districtKey)) districtName.set(s.districtKey, (siteInfo.get(s.id) || {}).district || s.districtKey);
  const genKey = new Set(r.proposals.map((p) => `${p.siteId}|${p.month}`));
  const tours = r.months.map((mo) => ({
    month: mo.month,
    tours: mo.tours.map((t) => {
      let visits = 0; let daysN = 0; const communes = new Set();
      for (const sp of t.stops) {
        for (const d of sp.days) {
          const gen = d.visits.filter((id) => genKey.has(`${id}|${mo.month}`)).length;
          if (gen) { visits += gen; daysN += d.span; communes.add(sp.key); }
        }
      }
      return { no: t.no, district: districtName.get(t.district) || t.district, communes: communes.size, days: daysN, visits };
    }).filter((t) => t.visits > 0),
  }));

  const tot = { eligible: 0, coveredExisting: 0, covered: 0, target: 0, dueSites: 0 };
  for (const p of pools) { tot.eligible += p.eligible || 0; tot.coveredExisting += p.coveredExisting || 0; tot.covered += p.covered || 0; tot.target += p.target || 0; tot.dueSites += p.dueSites || 0; }
  const totals = {
    proposals: r.stats.proposals, sitesPlanned: r.stats.sitesPlanned, journees: r.stats.journees, tours: r.stats.tours,
    visitsPerDay: r.stats.journees ? Math.round((r.stats.proposals / r.stats.journees) * 10) / 10 : null,
    ...tot, share: tot.eligible ? tot.covered / tot.eligible : null, meetsTarget: tot.eligible > 0 && tot.covered >= tot.target,
    rbmDueGated: r.stats.rbmDueGated || 0, unplanned: unplanned.length,
  };
  return {
    year: input.year, fromMonth: input.fromMonth, toMonth: input.toMonth, firstMonth: a.firstMonth, objective: a.objective, scope: scope || {},
    fingerprint: fp.fingerprint, sections: fp.sections, settings, overridden,
    totals, pools, proposals, unplanned, sites, tours,
    // Avertissements d'un pool : seulement s'il touche le périmètre de l'aperçu.
    warnings: [...a.warnings, ...r.warnings].filter((w) => (w.pool ? inScopePools.has(w.pool) : !w.pools || w.pools.some((k) => inScopePools.has(k)))),
    timings,
  };
}

/** Résumé compact gardé avec le plan appliqué (plan_runs.summary). */
function runSummary(preview) {
  return {
    totals: preview.totals,
    pools: preview.pools.map((p) => ({ key: p.key, activity: p.activity, office: p.officeName, mode: p.mode, gateDue: p.gateDue,
      eligible: p.eligible, covered: p.covered, target: p.target, generated: p.generatedVisits, unplanned: p.unplanned })),
  };
}

/** Valeurs MMR et capacités utilisées (copie gardée avec le plan appliqué). */
function poolSnapshot(poolInfo) {
  return poolInfo.map((p) => ({ key: p.key, mmrId: p.mmrId, activity: p.activity, officeId: p.officeId, general: p.general,
    operationDuration: p.operationDuration, riskLevel: p.riskLevel, feasible: p.feasible, feasibleSource: p.feasibleSource,
    visitsCap: p.visitsCap, yearCap: p.yearCap, vpd: p.vpd, vpdSource: p.vpdSource, persons: p.persons, workingDays: p.workingDays,
    capacityMode: p.capacityMode, mode: p.mode, gateDue: p.gateDue, gateCoverage: p.gateCoverage, sitesRegistry: p.sitesRegistry }));
}

module.exports = { shapePreview, runSummary, poolSnapshot };
