/**
 * Invariants de la planification automatique (planAuto.generatePlan), vérifiés
 * INDÉPENDAMMENT du moteur à partir de ses entrées et de son résultat — PUR. Utilisé par les
 * tests (jeux aléatoires à graine fixe) et le test en base réelle : « 0 violation » est la
 * condition.
 *
 *  1. au plus une visite par site × mois (générée ou existante, annulée comprise) ;
 *  2. jamais sur un site hors périmètre, en zone interdite, sans activité ni MMR, d'une commune
 *     inaccessible, ni un mois inactif (règle commune siteActivity.isActiveMonth), hors période
 *     ou échu ;
 *  3. intervalle respecté face à CHAQUE visite existante prévue ou réalisée (avant ou après), à
 *     la dernière visite effective (exercice précédent compris) et entre visites générées — la
 *     visite de RENFORT d'un site urgent (option) en est seule exemptée ;
 *  4. site piloté par le MMR : au plus les visites restantes (exigées − réalisées − prévues dans
 *     la période) ; renfort : au plus une, seulement un site urgent, seulement si l'option est prise ;
 *  5. stratégie « besoins » : TOUTES les visites plaçables sont placées (pour chaque site, le
 *     maximum que permettent ses mois libres et actifs et l'intervalle, borné par son besoin) ;
 *     stratégie « capacite » : visites existantes + générées d'une activité ≤ faisable du MMR ;
 *  6. comptes cohérents : résumé, répartition mensuelle, par activité et par unité = affectations ;
 *     chaque visite nouvelle a son créneau (agent, jour, date du mois).
 */
const { frequencyFor, DEFAULT_FREQUENCY } = require('./rbmMath');
const { isActiveMonth } = require('../common/siteActivity');
const { normalizeSettings, firstPlannableMonth, monthIdx, fitCount, anchorsOf, siteRemaining, communeKey } = require('./planAuto');

const LIVE = new Set(['planifie', 'realise']);

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
  const inPeriod = months.map(Number).filter((m) => m >= 1 && m <= 12 && m >= first);
  const period = new Set(inPeriod);
  const periodStart = inPeriod.length ? Math.min(...inPeriod) : 13;
  const excluded = new Set(cfg.excludedCommunes.map((c) => communeKey(c.district, c.commune)));
  const byId = new Map(sites.map((s) => [s.id, s]));
  const active = (s, m) => isActiveMonth((s.monthStatus || {})[m], yearHasGrid);
  const driven = (s) => Boolean(s.parametered && s.mmrKey && Number(s.required) > 0);
  const stepOf = (s) => {
    if (driven(s)) {
      const c = mmrByKey[s.mmrKey] || {};
      const iv = (cfg.adjusted && c.adjustedInterval ? c.adjustedInterval : c.interval) || frequencyFor(s.riskLevel, DEFAULT_FREQUENCY);
      return Math.max(1, Math.ceil(iv));
    }
    return Math.max(1, Math.ceil(frequencyFor(s.riskLevel, DEFAULT_FREQUENCY)));
  };
  const keyOf = (s) => (s.parametered && s.mmrKey ? s.mmrKey : `∅rbm:${s.riskLevel || 'moyenne'}`);

  const seen = new Set();
  const regular = new Map(); const renfort = new Map();
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
    if (excluded.has(communeKey(s.district, s.commune))) v.push({ code: 'commune_inaccessible', siteId: a.siteId });
    if (!active(s, m)) v.push({ code: 'inactif', siteId: a.siteId, month: a.month });
    if (m < first) v.push({ code: 'mois_echu', siteId: a.siteId, month: a.month });
    else if (!period.has(m)) v.push({ code: 'hors_periode', siteId: a.siteId, month: a.month });
    const map = a.source === 'renfort' ? renfort : regular;
    if (!map.has(a.siteId)) map.set(a.siteId, []);
    map.get(a.siteId).push(m);
    if (!result.slots || !result.slots[`${a.siteId}|${a.month}`]) v.push({ code: 'sans_creneau', siteId: a.siteId, month: a.month });
    else if (!String(result.slots[`${a.siteId}|${a.month}`].date).startsWith(a.month)) v.push({ code: 'date_hors_mois', siteId: a.siteId, month: a.month });
  }

  // 4. renfort
  for (const [siteId, list] of renfort) {
    const s = byId.get(siteId);
    if (!cfg.reinforceUrgent || !s.urgent || list.length > 1) v.push({ code: 'renfort', siteId, n: list.length });
  }
  // 3. intervalle et 4. exigence MMR (visites régulières)
  for (const [siteId, list] of regular) {
    const s = byId.get(siteId);
    const step = stepOf(s);
    const anchors = anchorsOf(s, year);
    const gen = list.map((m) => monthIdx(year, m));
    gen.forEach((g, i) => {
      const bad = anchors.find((x) => Math.abs(g - x) < step) ?? gen.find((x, j) => j !== i && Math.abs(g - x) < step);
      if (bad !== undefined) v.push({ code: 'intervalle', siteId, month: g - monthIdx(year, 1) + 1, step });
    });
    if (driven(s) && list.length > siteRemaining(s, periodStart).remaining) v.push({ code: 'au_dela_exigence', siteId, n: list.length });
  }

  // 5. besoins : tout ce qui est plaçable est placé ; capacité : faisable respecté.
  if (cfg.strategy === 'besoins') {
    for (const s of sites) {
      if (s.inScope === false || s.forbidden || (!s.activity && !s.parametered) || excluded.has(communeKey(s.district, s.commune))) continue;
      const busy = new Set((s.visits || []).map((x) => Number(x.month)));
      const cancelled = new Set((s.cancelledMonths || []).map(Number));
      const allowed = [...period].sort((a, b) => a - b).filter((m) => !busy.has(m) && !cancelled.has(m) && active(s, m));
      const anchors = anchorsOf(s, year);
      const step = stepOf(s);
      const need = driven(s) ? siteRemaining(s, periodStart).remaining : fitCount(year, allowed, anchors, step);
      const expected = Math.min(need, fitCount(year, allowed, anchors, step, need));
      const got = (regular.get(s.id) || []).length;
      if (got !== expected) v.push({ code: 'besoin_non_place', siteId: s.id, expected, got });
    }
  } else {
    const load = new Map(); const base = new Map();
    const add = (map, k) => map.set(k, (map.get(k) || 0) + 1);
    for (const s of sites) for (const x of s.visits || []) if (LIVE.has(x.status) && period.has(Number(x.month))) add(load, `${keyOf(s)}|${Number(x.month)}`);
    for (const [k, n] of load) base.set(k, n);
    for (const a of result.assignments || []) { const s = byId.get(a.siteId); if (s) add(load, `${keyOf(s)}|${Number(String(a.month).slice(5, 7))}`); }
    for (const [k, n] of load) {
      const key = k.slice(0, k.lastIndexOf('|'));
      const c = mmrByKey[key];
      const cap = c && c.feasible != null ? Math.floor(Number(c.feasible)) : null;
      if (cap != null && n > Math.max(cap, base.get(k) || 0)) v.push({ code: 'capacite_mmr', key: k, n, cap });
    }
  }

  // 6. comptes cohérents
  const n = (result.assignments || []).length;
  if (result.summary.planned !== n) v.push({ code: 'compte_resume', planned: result.summary.planned, n });
  const perMonth = (result.perMonth || []).reduce((a, b) => a + b.count, 0);
  if (perMonth !== n) v.push({ code: 'compte_mois', perMonth, n });
  const perAct = (result.byActivity || []).reduce((a, b) => a + b.planned, 0);
  if (perAct !== n) v.push({ code: 'compte_activite', perAct, n });
  const perUnit = (result.byTpm || []).reduce((a, b) => a + b.planned, 0);
  if (perUnit !== n) v.push({ code: 'compte_unite', perUnit, n });
  return v;
}

module.exports = { checkInvariants };
