/**
 * Invariants de la planification automatique (planAuto.generatePlan), vérifiés
 * INDÉPENDAMMENT du moteur à partir de ses entrées et de son résultat — PUR. Utilisé par les
 * tests (jeux aléatoires à graine fixe) et le test en base réelle : « 0 violation » est la
 * condition.
 *
 *  1. au plus une visite par site × mois (générée ou existante, annulée comprise) ;
 *  2. jamais sur un site hors périmètre, en zone interdite, sans activité ni MMR, ni un mois
 *     inactif (règle commune siteActivity.isActiveMonth), exclu, hors période ou échu ;
 *  3. intervalle respecté face à CHAQUE visite existante prévue ou réalisée (avant ou après), à
 *     la dernière visite effective (exercice précédent compris) et entre visites générées ;
 *  4. site piloté par le MMR : au plus les visites restantes (exigées − réalisées − prévues dans
 *     la période) ;
 *  5. capacités (MMR × débordement, globale, par TPM) : visites existantes + générées du mois ≤
 *     plafond — sauf 1er passage forcé (« couvrir tous les sites au moins une fois ») ;
 *  6. comptes cohérents : résumé, répartition mensuelle et par activité = affectations.
 */
const { frequencyFor } = require('./rbmMath');
const { isActiveMonth } = require('../common/siteActivity');
const { normalizeSettings, firstPlannableMonth, monthIdx } = require('./planAuto');

const LIVE = new Set(['planifie', 'realise']);
const idxOf = (v) => {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}/.test(s)) return null;
  return monthIdx(Number(s.slice(0, 4)), Number(s.slice(5, 7)));
};

/**
 * @param {{ sites, mmrByKey, settings, months, year, opts }} input  entrées du moteur
 * @param {object} result  sortie de generatePlan
 * @returns {object[]} violations ({ code, … }) — vide si tout est respecté
 */
function checkInvariants(input, result) {
  const v = [];
  const { sites = [], mmrByKey = {}, months = [], year, opts = {} } = input;
  const cfg = normalizeSettings(input.settings || {});
  const yearHasGrid = opts.yearHasGrid != null ? Boolean(opts.yearHasGrid)
    : sites.some((s) => s.monthStatus && Object.keys(s.monthStatus).length > 0);
  const first = firstPlannableMonth(year, opts.fromMonth);
  const excluded = new Set(cfg.excludeMonths);
  const inPeriod = months.map(Number).filter((m) => m >= 1 && m <= 12 && m >= first);
  const period = new Set(inPeriod.filter((m) => !excluded.has(m)));
  const periodStart = inPeriod.length ? Math.min(...inPeriod) : 13;
  const byId = new Map(sites.map((s) => [s.id, s]));
  const driven = (s) => Boolean(s.parametered && s.mmrKey && Number(s.required) > 0);
  const stepOf = (s) => {
    if (driven(s)) {
      const c = mmrByKey[s.mmrKey] || {};
      const iv = (cfg.adjusted && c.adjustedInterval ? c.adjustedInterval : c.interval) || frequencyFor(s.riskLevel, cfg.frequency);
      return Math.max(1, Math.ceil(iv));
    }
    return Math.max(1, Math.ceil(frequencyFor(s.riskLevel, cfg.frequency)));
  };
  const keyOf = (s) => (s.parametered && s.mmrKey ? s.mmrKey : `∅rbm:${s.riskLevel || 'moyenne'}`);

  const seen = new Set();
  const bySite = new Map();
  for (const a of result.assignments || []) {
    const m = Number(String(a.month).slice(5, 7));
    const k = `${a.siteId}|${m}`;
    if (seen.has(k)) v.push({ code: 'doublon', siteId: a.siteId, month: a.month });
    seen.add(k);
    const s = byId.get(a.siteId);
    if (!s) { v.push({ code: 'site_inconnu', siteId: a.siteId }); continue; }
    if (String(a.month).slice(0, 4) !== String(year)) v.push({ code: 'hors_exercice', siteId: a.siteId, month: a.month });
    if ((s.visits || []).some((x) => Number(x.month) === m) || (s.cancelledMonths || []).map(Number).includes(m)) {
      v.push({ code: 'deja_une_visite', siteId: a.siteId, month: a.month });
    }
    if (s.inScope === false) v.push({ code: 'hors_perimetre', siteId: a.siteId });
    if (s.forbidden) v.push({ code: 'zone_interdite', siteId: a.siteId });
    if (!s.activity && !s.parametered) v.push({ code: 'sans_activite', siteId: a.siteId });
    if (!isActiveMonth((s.monthStatus || {})[m], yearHasGrid)) v.push({ code: 'inactif', siteId: a.siteId, month: a.month });
    if (m < first) v.push({ code: 'mois_echu', siteId: a.siteId, month: a.month });
    else if (!period.has(m)) v.push({ code: 'hors_periode', siteId: a.siteId, month: a.month });
    if (!bySite.has(a.siteId)) bySite.set(a.siteId, []);
    bySite.get(a.siteId).push(m);
  }

  // 3. intervalle et 4. exigence MMR
  for (const [siteId, list] of bySite) {
    const s = byId.get(siteId);
    const step = stepOf(s);
    const anchors = (s.visits || []).filter((x) => LIVE.has(x.status)).map((x) => monthIdx(year, x.month));
    const last = idxOf(s.lastVisitMonth);
    if (last != null && last <= monthIdx(year, 12)) anchors.push(last);
    const gen = list.map((m) => monthIdx(year, m));
    gen.forEach((g, i) => {
      const bad = anchors.find((x) => Math.abs(g - x) < step) ?? gen.find((x, j) => j !== i && Math.abs(g - x) < step);
      if (bad !== undefined) v.push({ code: 'intervalle', siteId, month: g - monthIdx(year, 1) + 1, step });
    });
    if (driven(s)) {
      const done = (s.visits || []).filter((x) => x.status === 'realise').length
        + (s.visits || []).filter((x) => x.status === 'planifie' && Number(x.month) >= periodStart).length;
      if (list.length > Math.max(0, Number(s.required) - done)) v.push({ code: 'au_dela_exigence', siteId, n: list.length });
    }
  }

  // 5. capacités (existantes + générées) — le 1er passage forcé y échappe par construction.
  if (!cfg.coverAllOnce) {
    const load = new Map(); const keyLoad = new Map(); const tpmLoad = new Map();
    const tpmKeyAt = (s, m) => {
      const mm = `${year}-${String(m).padStart(2, '0')}`;
      const seg = (s.tpmSegments || []).find((x) => x && x.from <= mm && mm <= x.to);
      const id = seg && seg.providerId ? String(seg.providerId) : null;
      const name = seg && seg.providerName ? String(seg.providerName) : null;
      return id ? `id:${id}` : (name ? `nm:${name}` : 'non_affecte');
    };
    const add = (map, k) => map.set(k, (map.get(k) || 0) + 1);
    const count = (s, m) => { add(load, m); add(keyLoad, `${keyOf(s)}|${m}`); add(tpmLoad, `${tpmKeyAt(s, m)}|${m}`); };
    for (const s of sites) for (const x of s.visits || []) if (LIVE.has(x.status) && period.has(Number(x.month))) count(s, Number(x.month));
    const baseLoad = new Map(load); const baseKey = new Map(keyLoad); const baseTpm = new Map(tpmLoad);
    for (const a of result.assignments || []) { const s = byId.get(a.siteId); if (s) count(s, Number(String(a.month).slice(5, 7))); }
    const over = (map, base, k, cap) => cap != null && map.get(k) > Math.max(cap, base.get(k) || 0);
    for (const m of period) {
      if (over(load, baseLoad, m, cfg.capacityPerMonth)) v.push({ code: 'capacite_globale', month: m });
    }
    for (const [k] of keyLoad) {
      const key = k.slice(0, k.lastIndexOf('|'));
      const c = cfg.useMmrCapacity ? mmrByKey[key] : null;
      const lim = c && (c.feasible != null ? c.feasible : c.targetedPerMonth);
      const cap = lim == null ? null : Math.max(1, Math.round(lim * (1 + cfg.overflowPct / 100)));
      if (over(keyLoad, baseKey, k, cap)) v.push({ code: 'capacite_mmr', key: k });
    }
    for (const [k] of tpmLoad) if (over(tpmLoad, baseTpm, k, cfg.tpmCapacityPerMonth)) v.push({ code: 'capacite_tpm', key: k });
  }

  // 6. comptes cohérents
  const n = (result.assignments || []).length;
  if (result.summary.planned !== n) v.push({ code: 'compte_resume', planned: result.summary.planned, n });
  const perMonth = (result.perMonth || []).reduce((a, b) => a + b.count, 0);
  if (perMonth !== n) v.push({ code: 'compte_mois', perMonth, n });
  const perAct = (result.byActivity || []).reduce((a, b) => a + b.planned, 0);
  if (perAct !== n) v.push({ code: 'compte_activite', perAct, n });
  return v;
}

module.exports = { checkInvariants };
