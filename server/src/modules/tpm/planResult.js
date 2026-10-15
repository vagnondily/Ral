/**
 * Mise en forme de l'aperçu de la planification pour l'écran (lot 5, § 6.4 et § 7.11) — PURE,
 * testée. Le serveur rend des CODES et des nombres (pourquoi, raisons de report, modes,
 * ressources nécessaires) ; l'écran les traduit (FR / EN) avec icône + libellé — jamais un
 * texte figé en français ici.
 */
const { U } = require('./planGenerator');

const days = (units) => (units == null ? null : Math.round((units / U) * 10) / 10);

/**
 * @param {object} a  planInputs.assemble(...)
 * @param {object} r  planNeeds.scheduleNeeds(...) ou planGenerator.generatePlan(...)
 * @param {{ fingerprint, sections }} fp
 * @param {object} [opts] { settings, overridden, scope, adjust, needs (planNeeds.resourceNeeds), timings }
 */
function shapePreview(a, r, fp, { settings, overridden = [], scope, adjust, needs, timings } = {}) {
  const { input, poolInfo, siteInfo } = a;
  const strategy = (input.params && input.params.strategy) || 'besoins';
  const inScopePools = new Set(input.sites.filter((s) => s.inScope && s.poolKey).map((s) => s.poolKey));
  const pools = poolInfo.filter((p) => inScopePools.has(p.key)).map((p) => {
    const proj = r.pools[p.key] || {};
    return {
      ...p,
      dayCapDays: days(p.dayCapUnits), dayCapUnits: undefined, inScope: undefined,
      ...proj,
      months: r.months.map((mo) => {
        const c = mo.capacity[p.key];
        return c ? { month: mo.month, cap: c.visitsCap, used: c.used, existing: c.existing, generated: c.generated, quota: c.quota ?? null,
          target: c.target ?? null, mmrMin: c.mmrMin ?? null, dayCap: days(c.dayCapUnits), dayUsed: days(c.dayUsedUnits), over: c.over }
          : { month: mo.month, cap: 0, used: 0, existing: 0, generated: 0 };
      }),
    };
  }).sort((x, y) => String(x.activity).localeCompare(String(y.activity), 'fr') || String(x.officeName || '').localeCompare(String(y.officeName || ''), 'fr'));

  const slots = (needs && needs.slots) || {};
  const referenced = new Set();
  const proposals = r.proposals.map((p) => {
    referenced.add(p.siteId); if (p.anchor) referenced.add(p.anchor);
    const sl = slots[`${p.siteId}|${p.month}`] || null;
    return { siteId: p.siteId, month: p.month, why: p.why, reason: p.reason, level: p.level, tour: p.tour, day: p.day, anchor: p.anchor || null,
      detail: p.detail, fieldDay: sl ? sl.fieldDay : null, agent: sl ? sl.agent : null, date: sl ? sl.date : null };
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
  // Noms des zones (districts, communes) pour les tournées et les ressources.
  const districtName = new Map(); const communeName = new Map();
  for (const s of input.sites) {
    const i = siteInfo.get(s.id) || {};
    if (!districtName.has(s.districtKey)) districtName.set(s.districtKey, i.district || s.districtKey);
    if (!communeName.has(s.communeKey)) communeName.set(s.communeKey, i.commune || s.communeKey);
  }
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

  const tot = { eligible: 0, coveredExisting: 0, covered: 0, target: 0, dueSites: 0, requiredYear: 0, doneYear: 0, laterVisits: 0, unmet: 0, mmrPerMonth: 0 };
  for (const p of pools) {
    tot.eligible += p.eligible || 0; tot.coveredExisting += p.coveredExisting || 0; tot.covered += p.covered || 0; tot.target += p.target || 0;
    tot.dueSites += p.dueSites || 0; tot.requiredYear += p.requiredYear || 0; tot.doneYear += p.doneYear || 0; tot.laterVisits += p.laterVisits || 0;
    tot.unmet += p.unmet || 0; tot.mmrPerMonth += p.mmrPerMonth || p.targetedPerMonth || 0;
  }
  tot.mmrPerMonth = Math.round(tot.mmrPerMonth * 10) / 10;
  const totals = {
    proposals: r.stats.proposals, sitesPlanned: r.stats.sitesPlanned, journees: r.stats.journees, tours: r.stats.tours,
    visitsPerDay: r.stats.journees ? Math.round((r.stats.proposals / r.stats.journees) * 10) / 10 : null,
    ...tot, share: tot.eligible ? tot.covered / tot.eligible : null, meetsTarget: tot.eligible > 0 && tot.covered >= tot.target,
    rbmDueGated: r.stats.rbmDueGated || 0, unplanned: unplanned.length,
  };
  return {
    year: input.year, fromMonth: input.fromMonth, toMonth: input.toMonth, firstMonth: a.firstMonth, strategy, objective: a.objective, scope: scope || {},
    adjust: adjust || { excludedCommunes: [] },
    fingerprint: fp.fingerprint, sections: fp.sections, settings, overridden,
    totals, pools, proposals, unplanned, sites, tours,
    needs: needs ? shapeNeeds(needs, { districtName, communeName }) : null,
    // Avertissements d'un pool : seulement s'il touche le périmètre de l'aperçu.
    warnings: [...a.warnings, ...r.warnings].filter((w) => (w.pool ? inScopePools.has(w.pool) : !w.pools || w.pools.some((k) => inScopePools.has(k)))),
    timings,
  };
}

/** Ressources nécessaires avec les noms des zones (les créneaux restent dans les propositions). */
function shapeNeeds(needs, { districtName, communeName }) {
  return {
    agentsPerVehicle: needs.agentsPerVehicle, peak: needs.peak, offices: needs.offices,
    months: needs.months.map((m) => ({
      ...m,
      zones: m.zones.map((z) => ({ ...z, district: districtName.get(z.district) || z.district,
        communes: z.communes.map((c) => ({ ...c, commune: communeName.get(c.commune) || c.commune })) })),
    })),
  };
}

/** Résumé compact gardé avec le plan appliqué (plan_runs.summary). */
function runSummary(preview) {
  return {
    totals: preview.totals,
    pools: preview.pools.map((p) => ({ key: p.key, activity: p.activity, office: p.officeName, mode: p.mode, gateDue: p.gateDue,
      eligible: p.eligible, covered: p.covered, target: p.target ?? null, requiredYear: p.requiredYear ?? null, generated: p.generatedVisits, unplanned: p.unplanned })),
  };
}

/** Ressources nécessaires gardées avec le plan appliqué (plan_runs.needs), sans les créneaux. */
function runNeeds(needs) {
  if (!needs) return {};
  return { agentsPerVehicle: needs.agentsPerVehicle, peak: needs.peak, offices: needs.offices,
    months: needs.months.map((m) => ({ month: m.month, visits: m.visits, sites: m.sites, agentDays: m.agentDays, agentsNeeded: m.agentsNeeded,
      declared: m.declared, gap: m.gap, vehiclesPeak: m.vehiclesPeak, vehiclesAvg: m.vehiclesAvg })) };
}

/** Valeurs MMR et capacités utilisées (copie gardée avec le plan appliqué). */
function poolSnapshot(poolInfo) {
  return poolInfo.map((p) => ({ key: p.key, mmrId: p.mmrId, activity: p.activity, officeId: p.officeId, general: p.general,
    operationDuration: p.operationDuration, riskLevel: p.riskLevel, feasible: p.feasible, feasibleSource: p.feasibleSource,
    visitsCap: p.visitsCap, yearCap: p.yearCap, vpd: p.vpd, vpdSource: p.vpdSource, persons: p.persons, workingDays: p.workingDays,
    capacityMode: p.capacityMode, mode: p.mode, gateDue: p.gateDue, gateCoverage: p.gateCoverage, sitesRegistry: p.sitesRegistry,
    perSite: p.perSite, gap: p.gap, targetedPerMonth: p.targetedPerMonth }));
}

module.exports = { shapePreview, shapeNeeds, runSummary, runNeeds, poolSnapshot };
