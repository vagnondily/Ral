/**
 * Invariants de la planification automatique (planAuto.generatePlan), vérifiés INDÉPENDAMMENT du
 * moteur — PUR, sans aucune fonction importée du moteur : index des mois, premier mois
 * planifiable, communes inaccessibles, règle « actif au mois M », écart et exigence tirés de la
 * ligne MMR brute, ancrages et reste à planifier sont recodés ici d'après la règle écrite (préambule
 * de planAuto.js), pour qu'une erreur dans un utilitaire du moteur ne se cache pas derrière lui.
 * Utilisé par les tests (jeux aléatoires à graine fixe) et le test en base réelle : « 0 violation »
 * est la condition.
 *
 *  1. au plus une visite par site × mois (générée ou existante, annulée comprise) ;
 *  2. jamais sur un site hors périmètre, en zone interdite, sans activité ni MMR, d'une commune
 *     inaccessible, ni un mois inactif (grille → « Oui » explicite seulement), hors période, échu
 *     ou hors exercice ;
 *  3. intervalle respecté face à chaque visite réalisée, chaque visite PRÉVUE À VENIR (de
 *     l'exercice ou des exercices voisins), la dernière visite effective, et entre visites
 *     générées — la visite de RENFORT d'un site urgent (option) en est seule exemptée ;
 *  4. site piloté par le MMR : au plus le reste (exigées − réalisées − prévues à venir) ; renfort :
 *     au plus une, seulement un site urgent, seulement si l'option est prise, au premier mois
 *     possible de la période et sans visite existante avant ou à ce mois ;
 *  5. stratégie « besoins » : toutes les visites plaçables sont placées (pour chaque site, le
 *     maximum que permettent ses mois permis et l'intervalle, borné par son besoin) ; stratégie
 *     « capacite » : visites existantes + générées d'une activité ≤ faisable du MMR (entier
 *     inférieur ; 0 = aucune) ; les deux : MAXIMALITÉ — un site encore en manque n'a aucun mois
 *     permis qui respecte l'intervalle (et la capacité restante) à la fin du calcul : un 2ᵉ passage
 *     n'ajouterait rien ;
 *  6. comptes cohérents : résumé, répartition mensuelle, par activité et par unité = affectations ;
 *     couverts + non couverts = sites planifiables, chaque non couvert avec une raison connue ;
 *     chaque visite nouvelle a son créneau (agent, jour, date du mois, jamais avant aujourd'hui) ;
 *  7. créneaux : dans une unité de suivi (TPM de la zone, sinon le bureau du site), un agent un jour
 *     donné est dans UNE commune (tournée), et jamais sur un créneau déjà écrit (« Agent N » daté
 *     d'une visite existante) — chaque visite occupe TOUS les jours de sa durée (moins d'un suivi par
 *     jour : ⌈1 ÷ suivis/jour⌉ jours de terrain consécutifs à partir de sa date).
 */
const RBM_STEP = { elevee: 1, moyenne: 2, faible: 3 };
const REASON_CODES = new Set(['capacity', 'inactive', 'cancelled', 'gap', 'period']);
const EPS = 1e-9;

const mi = (y, m) => Number(y) * 12 + Number(m) - 1;
const p2 = (n) => String(n).padStart(2, '0');
/** Unité de suivi : TPM du segment de zone du mois, sinon le bureau (racine) du site. */
function unitOfSite(s, year, m) {
  const mm = `${year}-${p2(m)}`;
  const seg = (s.tpmSegments || []).find((g) => g && g.from <= mm && mm <= g.to && (g.providerId || g.providerName));
  if (seg) return seg.providerId ? `id:${seg.providerId}` : `nm:${seg.providerName}`;
  return `bureau:${s.unitOfficeId || 'none'}`;
}
/** Tournée d'un site : commune de son district (casse et espaces ignorés), sinon cellule GPS de 0,1°, sinon le site. */
function tourOf(s) {
  const d = String(s.district == null ? '' : s.district).trim().toLowerCase();
  const c = String(s.commune == null ? '' : s.commune).trim().toLowerCase();
  if (c) return `${d}|${c}`;
  if (s.gpsLat != null && s.gpsLng != null && Number.isFinite(Number(s.gpsLat)) && Number.isFinite(Number(s.gpsLng))) {
    return `${d}|gps:${Math.round(Number(s.gpsLat) / 0.1)}:${Math.round(Number(s.gpsLng) / 0.1)}`;
  }
  return `${d}|site:${s.id}`;
}
/** Durée d'une visite en jours de terrain : ⌈1 ÷ suivis/jour⌉ sous un suivi par jour, sinon 1. */
const spanDays = (vpd) => { const x = Number(vpd); return x > 0 && x < 1 ? Math.ceil(1 / x - EPS) : 1; };
/** Jours de terrain d'un mois : lundi–vendredi, lundi–samedi quand les jours voulus dépassent les jours de semaine. */
function fieldCalendar(year, month, wanted) {
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const week = []; const six = [];
  for (let d = 1; d <= n; d += 1) {
    const w = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (w >= 1 && w <= 5) week.push(d);
    if (w >= 1 && w <= 6) six.push(d);
  }
  return (wanted > week.length ? six : week).map((d) => `${year}-${p2(month)}-${p2(d)}`);
}
const genericAgent = (a) => { const x = /^\s*agent\s+(\d+)\s*$/i.exec(String(a == null ? '' : a)); return x ? Number(x[1]) : null; };
function parseYm(v) {
  const x = /^(\d{4})-(\d{2})/.exec(String(v == null ? '' : v));
  if (!x) return null;
  const m = Number(x[2]);
  return m >= 1 && m <= 12 ? mi(Number(x[1]), m) : null;
}
function firstOpen(year, fromMonth) {
  const f = parseYm(fromMonth);
  const jan = mi(year, 1);
  if (f == null || f <= jan) return 1;
  return Math.min(13, f - jan + 1);
}
const low = (v) => String(v == null ? '' : v).trim().toLowerCase();
const placeKey = (district, commune) => `${low(district)}|${low(commune)}`;

/** Exigées et écart d'un site piloté par le MMR, depuis la ligne MMR brute. */
function mmrStep(s, c, adjusted) {
  let req = Math.max(0, Math.round(Number(s.required) || 0));
  if (adjusted && Number(c.frequency) > 0) req = Math.min(req, Math.max(1, Math.round(Number(c.frequency))));
  const iv = Number(c.interval) > 0 ? Number(c.interval) : (RBM_STEP[s.riskLevel] || 3);
  let step = Math.max(1, Math.ceil(iv - EPS));
  if (adjusted && Number(c.adjustedInterval) > 0) step = Math.max(step, Math.ceil(Number(c.adjustedInterval) - EPS));
  const dur = Math.round(Number(c.operationDuration) || 0);
  if (dur > 1 && req > 1) step = Math.max(1, Math.min(step, Math.floor((dur - 1) / (req - 1))));
  return { req, step };
}

/** Nombre maximal de visites dans `months` (croissants), écart `step` face à `fixed` et entre elles. */
function maxFit(year, months, fixed, step, cap = Infinity) {
  const taken = [...fixed];
  let n = 0;
  for (const m of months) {
    if (n >= cap) break;
    const x = mi(year, m);
    if (taken.every((a) => Math.abs(x - a) >= step)) { taken.push(x); n += 1; }
  }
  return n;
}

/**
 * @param {{ sites, mmrByKey, settings, months, year, opts }} input  entrées du moteur
 * @param {object} result  sortie de generatePlan
 * @returns {object[]} violations ({ code, … }) — vide si tout est respecté
 */
function checkInvariants(input, result) {
  const v = [];
  const { sites = [], mmrByKey = {}, months = [], year, opts = {} } = input;
  const raw = input.settings || {};
  const strategy = raw.strategy === 'capacite' ? 'capacite' : 'besoins';
  const adjusted = strategy === 'capacite';
  const reinforce = Boolean(raw.reinforceUrgent);
  const excluded = new Set((raw.excludedCommunes || []).filter((c) => c && low(c.commune)).map((c) => placeKey(c.district, c.commune)));
  const grid = opts.yearHasGrid != null ? Boolean(opts.yearHasGrid)
    : sites.some((s) => s && s.monthStatus && Object.keys(s.monthStatus).length > 0);
  const first = firstOpen(year, opts.fromMonth);
  const nowIdx = parseYm(opts.fromMonth);
  const period = [...new Set(months.map(Number))].filter((m) => m >= 1 && m <= 12 && m >= first).sort((a, b) => a - b);
  const inPeriod = new Set(period);
  const byId = new Map(sites.map((s) => [s.id, s]));
  const statusAt = (s, m) => { const ms = s.monthStatus || {}; return ms[m] !== undefined ? ms[m] : ms[String(m)]; };
  const active = (s, m) => (grid ? statusAt(s, m) === true : statusAt(s, m) !== false);
  const driven = (s) => Boolean(s.parametered && s.mmrKey && Number(s.required) > 0);
  const keyOf = (s) => (s.parametered && s.mmrKey ? s.mmrKey : `∅rbm:${s.riskLevel || 'moyenne'}`);
  const ruleOf = (s) => (driven(s) ? mmrStep(s, mmrByKey[s.mmrKey] || {}, adjusted) : { req: 0, step: RBM_STEP[s.riskLevel] || 3 });
  const upcomingPlanned = (m) => m >= first;
  const anchorsOf = (s) => {
    const out = new Set();
    for (const x of s.visits || []) {
      const m = Number(x.month);
      if (m < 1 || m > 12) continue;
      if (x.status === 'realise' || (x.status === 'planifie' && (nowIdx == null || mi(year, m) >= nowIdx))) out.add(mi(year, m));
    }
    for (const x of s.outsideVisits || []) {
      const i = parseYm(x && x.month);
      if (i != null && (x.status === 'realise' || (x.status === 'planifie' && (nowIdx == null || i >= nowIdx)))) out.add(i);
    }
    const last = parseYm(s.lastVisitMonth);
    if (last != null && last <= mi(year, 12)) out.add(last);
    return [...out];
  };
  const remainingOf = (s) => {
    const vs = s.visits || [];
    const done = vs.filter((x) => x.status === 'realise').length;
    const planned = vs.filter((x) => x.status === 'planifie' && upcomingPlanned(Number(x.month))).length;
    return Math.max(0, ruleOf(s).req - done - planned);
  };
  const cancelledOf = (s) => new Set([...(s.cancelledMonths || []).map(Number),
    ...(s.visits || []).filter((x) => x.status === 'annule').map((x) => Number(x.month))]);
  const liveMonths = (s) => new Set((s.visits || []).filter((x) => x.status === 'planifie' || x.status === 'realise').map((x) => Number(x.month)));
  const allowedOf = (s) => { const live = liveMonths(s); const c = cancelledOf(s); return period.filter((m) => !live.has(m) && !c.has(m) && active(s, m)); };
  const candidate = (s) => s.inScope !== false && !s.forbidden && Boolean(s.activity || s.parametered)
    && !excluded.has(placeKey(s.district, s.commune));
  const plannable = sites.filter((s) => s && s.id && candidate(s) && period.some((m) => active(s, m)));
  const needOf = (s) => {
    if (driven(s)) return remainingOf(s);
    const live = liveMonths(s);
    return maxFit(year, period.filter((m) => !live.has(m) && active(s, m)), anchorsOf(s), ruleOf(s).step);
  };

  // ---- 1. et 2. : chaque affectation ----
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
    if ((s.visits || []).some((x) => Number(x.month) === m) || cancelledOf(s).has(m)) v.push({ code: 'deja_une_visite', siteId: a.siteId, month: a.month });
    if (s.inScope === false) v.push({ code: 'hors_perimetre', siteId: a.siteId });
    if (s.forbidden) v.push({ code: 'zone_interdite', siteId: a.siteId });
    if (!s.activity && !s.parametered) v.push({ code: 'sans_activite', siteId: a.siteId });
    if (excluded.has(placeKey(s.district, s.commune))) v.push({ code: 'commune_inaccessible', siteId: a.siteId });
    if (!active(s, m)) v.push({ code: 'inactif', siteId: a.siteId, month: a.month });
    if (m < first) v.push({ code: 'mois_echu', siteId: a.siteId, month: a.month });
    else if (!inPeriod.has(m)) v.push({ code: 'hors_periode', siteId: a.siteId, month: a.month });
    const map = a.source === 'renfort' ? renfort : regular;
    if (!map.has(a.siteId)) map.set(a.siteId, []);
    map.get(a.siteId).push(m);
    const slot = result.slots && result.slots[`${a.siteId}|${a.month}`];
    if (!slot) v.push({ code: 'sans_creneau', siteId: a.siteId, month: a.month });
    else if (!String(slot.date).startsWith(a.month) || !(Number(slot.agent) >= 1)) v.push({ code: 'creneau_invalide', siteId: a.siteId, month: a.month });
    else if (opts.today && String(slot.date) < String(opts.today)) v.push({ code: 'date_passee', siteId: a.siteId, date: slot.date });
  }

  // ---- 4. renfort ----
  for (const [siteId, list] of renfort) {
    const s = byId.get(siteId);
    // Au premier mois possible de la période (actif, non annulé), sans visite existante avant ou à ce mois.
    const c = cancelledOf(s);
    const firstPossible = period.find((m) => active(s, m) && !c.has(m));
    const early = [...liveMonths(s)].some((m) => inPeriod.has(m) && m <= firstPossible);
    if (!reinforce || !s.urgent || list.length > 1 || list[0] !== firstPossible || early) v.push({ code: 'renfort', siteId, n: list.length, month: list[0] });
  }
  // ---- 3. intervalle et 4. exigence MMR (visites régulières) ----
  for (const [siteId, list] of regular) {
    const s = byId.get(siteId);
    const { step } = ruleOf(s);
    const fixed = anchorsOf(s);
    const gen = list.map((m) => mi(year, m));
    gen.forEach((g, i) => {
      const bad = fixed.some((x) => Math.abs(g - x) < step) || gen.some((x, j) => j !== i && Math.abs(g - x) < step);
      if (bad) v.push({ code: 'intervalle', siteId, month: list[i], step });
    });
    if (driven(s) && list.length > remainingOf(s)) v.push({ code: 'au_dela_exigence', siteId, n: list.length, remaining: remainingOf(s) });
  }

  // ---- 5. complétude (besoins), capacité (capacite), maximalité (les deux) ----
  const load = new Map(); const base = new Map();
  const add = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  for (const s of sites) {
    for (const x of s.visits || []) {
      if ((x.status === 'planifie' || x.status === 'realise') && inPeriod.has(Number(x.month))) { add(load, `${keyOf(s)}|${Number(x.month)}`); add(base, `${keyOf(s)}|${Number(x.month)}`); }
    }
  }
  for (const a of result.assignments || []) { const s = byId.get(a.siteId); if (s) add(load, `${keyOf(s)}|${Number(String(a.month).slice(5, 7))}`); }
  const capOf = (key) => {
    const c = mmrByKey[key];
    if (!c || c.feasible == null || c.feasible === '' || !Number.isFinite(Number(c.feasible))) return null;
    return Math.max(0, Math.floor(Number(c.feasible) + EPS));
  };
  if (strategy === 'capacite') {
    for (const [k, n] of load) {
      const cap = capOf(k.slice(0, k.lastIndexOf('|')));
      if (cap != null && n > Math.max(cap, base.get(k) || 0)) v.push({ code: 'capacite_mmr', key: k, n, cap });
    }
  }
  for (const s of plannable) {
    const need = needOf(s);
    const got = regular.get(s.id) || [];
    const allowed = allowedOf(s);
    const { step } = ruleOf(s);
    const fixed = anchorsOf(s);
    if (strategy === 'besoins') {
      const expected = Math.min(need, maxFit(year, allowed, fixed, step, need));
      if (got.length !== expected) v.push({ code: 'besoin_non_place', siteId: s.id, expected, got: got.length });
    }
    if (got.length >= need) continue;
    const taken = [...fixed, ...got.map((m) => mi(year, m))];
    const open = allowed.find((m) => !got.includes(m) && !(renfort.get(s.id) || []).includes(m)
      && taken.every((x) => Math.abs(mi(year, m) - x) >= step)
      && (strategy === 'besoins' || capOf(keyOf(s)) == null || (load.get(`${keyOf(s)}|${m}`) || 0) < capOf(keyOf(s))));
    if (open !== undefined) v.push({ code: 'non_maximal', siteId: s.id, month: open, need, got: got.length });
  }

  // ---- 7. créneaux : un agent, un jour, une tournée ; jamais un créneau déjà écrit ----
  // Jours voulus d'une unité × mois : le plus petit des jours ouvrés MMR de ses visites à faire
  // (prévues existantes et nouvelles), sinon le paramètre du plan (1–26, 20 par défaut).
  const fdmRaw = Math.round(Number(raw.fieldDaysPerMonth));
  const fdm = fdmRaw >= 1 && fdmRaw <= 26 ? fdmRaw : 20;
  const rowOf = (s) => (s.parametered && s.mmrKey ? mmrByKey[s.mmrKey] || null : null);
  const wantedBy = new Map();
  const noteWanted = (s, m) => {
    const k = `${unitOfSite(s, year, m)}|${m}`;
    const wd = Number((rowOf(s) || {}).workingDays);
    const cur = wantedBy.get(k);
    if (wd > 0) wantedBy.set(k, cur == null || cur === 'p' ? wd : Math.min(cur, wd));
    else if (cur == null) wantedBy.set(k, 'p');
  };
  for (const s of sites) for (const x of s.visits || []) if (x.status === 'planifie' && inPeriod.has(Number(x.month))) noteWanted(s, Number(x.month));
  for (const a of result.assignments || []) { const s = byId.get(a.siteId); if (s) noteWanted(s, Number(String(a.month).slice(5, 7))); }
  const daysOf = (s, m, date) => {
    const k = `${unitOfSite(s, year, m)}|${m}`;
    const w = wantedBy.get(k);
    const cal = fieldCalendar(year, m, w == null || w === 'p' ? fdm : w);
    const i0 = cal.indexOf(String(date));
    return i0 < 0 ? [String(date)] : cal.slice(i0, i0 + spanDays((rowOf(s) || {}).visitsPerDay));
  };
  const cellTours = new Map(); const written = new Set(); const newCells = new Set();
  for (const s of sites) {
    for (const x of s.visits || []) {
      const n = genericAgent(x.agent);
      const m = Number(x.month);
      if (n == null || !x.date || x.status === 'annule' || !inPeriod.has(m)) continue;
      for (const d of daysOf(s, m, x.date)) {
        const k = `${unitOfSite(s, year, m)}|${n}|${d}`;
        written.add(k);
        if (!cellTours.has(k)) cellTours.set(k, new Set());
        cellTours.get(k).add(tourOf(s));
      }
    }
  }
  for (const a of result.assignments || []) {
    const s = byId.get(a.siteId); const slot = result.slots && result.slots[`${a.siteId}|${a.month}`];
    if (!s || !slot) continue;
    const m = Number(String(a.month).slice(5, 7));
    for (const d of daysOf(s, m, slot.date)) {
      const k = `${unitOfSite(s, year, m)}|${slot.agent}|${d}`;
      if (written.has(k)) v.push({ code: 'creneau_deja_ecrit', siteId: a.siteId, cell: k });
      newCells.add(k);
      if (!cellTours.has(k)) cellTours.set(k, new Set());
      cellTours.get(k).add(tourOf(s));
    }
  }
  // Seules les cellules d'un nouveau créneau sont jugées (des saisies manuelles peuvent déjà se croiser).
  for (const k of newCells) if (cellTours.get(k).size > 1) v.push({ code: 'agent_deux_tournees', cell: k, tours: [...cellTours.get(k)] });

  // ---- 6. comptes cohérents ----
  const n = (result.assignments || []).length;
  const sum = (list, k) => (list || []).reduce((a, b) => a + (Number(b[k]) || 0), 0);
  if (result.summary.planned !== n) v.push({ code: 'compte_resume', planned: result.summary.planned, n });
  if (sum(result.perMonth, 'count') !== n) v.push({ code: 'compte_mois', perMonth: sum(result.perMonth, 'count'), n });
  if (sum(result.byActivity, 'planned') !== n) v.push({ code: 'compte_activite', perAct: sum(result.byActivity, 'planned'), n });
  if (sum(result.byTpm, 'planned') !== n) v.push({ code: 'compte_unite', perUnit: sum(result.byTpm, 'planned'), n });
  const sm = result.summary;
  if (sm.sitesActivePlannable !== plannable.length) v.push({ code: 'compte_planifiables', engine: sm.sitesActivePlannable, oracle: plannable.length });
  if (sm.sitesCovered + (result.uncovered || []).length !== sm.sitesActivePlannable) v.push({ code: 'compte_couverture', covered: sm.sitesCovered, uncovered: (result.uncovered || []).length });
  for (const u of result.uncovered || []) if (!REASON_CODES.has(u.reason)) v.push({ code: 'raison_inconnue', siteId: u.siteId, reason: u.reason });
  // Couvert = une visite existante dans la période, une nouvelle, ou rien de dû.
  const genSites = new Set((result.assignments || []).map((a) => a.siteId));
  const coveredOracle = plannable.filter((s) => genSites.has(s.id) || [...liveMonths(s)].some((m) => inPeriod.has(m)) || needOf(s) === 0).length;
  if (coveredOracle !== sm.sitesCovered) v.push({ code: 'compte_couverts', engine: sm.sitesCovered, oracle: coveredOracle });
  return v;
}

module.exports = { checkInvariants };
