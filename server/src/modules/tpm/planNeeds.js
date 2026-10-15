/**
 * Plan selon les BESOINS du MMR (lot 5, § 6.4 — retours 107 et 108) : module PUR et
 * DÉTERMINISTE (aucune horloge, aucun hasard, aucune I/O ; sites triés par code, ordre total).
 * Testé (test/planNeeds.test.js), vérifié par planInvariants, mesuré au banc (perfPlan).
 *
 * « Le MMR te donne déjà le nombre de sites à suivre minimal par mois et le nombre total de
 * suivis à faire par site, avec les écarts minimaux, la période de l'activité […] ; calculer le
 * nombre de sites à faire par jour par zone (prioriser les mêmes communes sans distinction
 * d'activités) […] ; à partir d'une telle répartition, on calcule le nombre d'agents […] et le
 * nombre de véhicules. » (retour 108)
 *
 * 1. `scheduleNeeds(input)` — même entrée et même forme de résultat que planGenerator :
 *    - exigence par pool (ligne MMR) : visites dues par site = fréquence (= risque), écart
 *      minimal H = intervalle arrondi au mois supérieur ; un site reçoit ses visites RESTANTES
 *      (dues − réalisées ou prévues dans l'exercice), à H mois d'écart au moins (en arrière ET
 *      en avant des visites existantes), dans ses mois libres (activité qui tourne, site actif,
 *      hors zone interdite, commune accessible, sans visite ni annulation ce mois) ;
 *    - la répartition couvre la fin de l'exercice (du premier mois planifiable à décembre) ;
 *      seules les propositions de la période choisie sont rendues ;
 *    - chaque mois, part équilibrée du pool = ⌈visites restantes plaçables ÷ mois restants⌉ ;
 *      un site dont c'est le dernier mois possible (« échéance ») passe toujours ; parmi les
 *      autres, l'ordre du RBM : recommandation urgente, risque élevé, jamais visité, échéance
 *      la plus proche, plus longue absence de visite ;
 *    - zones : chaque placement entraîne les sites possibles du même lieu puis de la même
 *      commune (toutes activités) tant que leur activité a de la place, puis les communes du
 *      district ; enfin, la place libre des journées déjà ouvertes d'une commune est complétée
 *      par ses sites possibles (aucun déplacement de plus). Une journée = un agent dans une
 *      commune ; une visite coûte U ÷ suivis par jour de son activité (unités entières).
 * 2. `resourceNeeds(result, poolInfo, opts)` — ressources NÉCESSAIRES par mois et par bureau :
 *    agents = ⌈journées-agent ÷ jours de terrain par agent⌉ ; journées réparties entre ces
 *    agents dans l'ordre des tournées (la journée suivante à l'agent libre le plus tôt) ;
 *    véhicules d'un jour = Σ par district ⌈agents ÷ agents par véhicule⌉ (pic et moyenne) ;
 *    comparaison au déclaré (personnes du MMR) : information, jamais une limite.
 */
const { U, mainReason } = require('./planGenerator');

const pad = (m) => String(m).padStart(2, '0');
const monthStr = (year, m) => `${year}-${pad(m)}`;
const monthIdx = (s) => { const [y, m] = String(s).split('-').map(Number); return y * 12 + (m - 1); };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const RISK_RANK = { elevee: 3, moyenne: 2, faible: 1 };

/** Classe de priorité RBM (petite = d'abord) : urgent, risque élevé calculé, jamais visité, autres. */
function priorityClass(site, since) {
  if (site.urgent) return 0;
  if (site.finalScore === 2) return 1;
  if (since == null) return 2;
  return 3;
}
/** Niveau des Priorités du mois (affiché) : même règle que planGenerator.defaultLevelOf. */
const levelOf = (site) => (site.urgent || site.finalScore === 2 ? 'haute' : 'moyenne');

function sortedSites(sites) {
  return [...sites].sort((a, b) => cmp(String(a.code), String(b.code)) || cmp(String(a.id), String(b.id)));
}

const runningAt = (p, m) => Boolean(p && p.interval && p.interval.running && (!p.runningMonths || p.runningMonths.has(m)));

/**
 * @param {object} input planInputs.assemble().input (params.strategy = 'besoins')
 * @returns {{ proposals, months, sites, pools, warnings, stats }}
 */
function scheduleNeeds(input) {
  const { year, fromMonth, toMonth } = input;
  const pools = input.pools || {};
  const sites = sortedSites(input.sites || []);
  const warnings = [];
  const out = { proposals: [], months: [], sites: [], pools: {}, warnings, stats: {} };
  if (!(fromMonth >= 1 && toMonth <= 12 && fromMonth <= toMonth)) {
    warnings.push({ code: 'horizon_passe' });
    out.stats = { proposals: 0, tours: 0, journees: 0, sitesPlanned: 0 };
    return out;
  }
  const lastMonth = 12; // la répartition va jusqu'à la fin de l'exercice

  // ---- état initial par site ----------------------------------------------------------------
  const st = new Map();
  for (const s of sites) {
    const pool = pools[s.poolKey];
    const months = s.months || [];
    let last = s.lastReal || null;
    let done = 0;
    for (let m = 1; m <= 12; m += 1) {
      const c = months[m - 1];
      if (!c || !c.st || c.st === 'annule') continue;
      if (c.st === 'realise') {
        done += 1;
        if (m < fromMonth && (!last || monthStr(year, m) > last)) last = monthStr(year, m);
      } else if (m >= fromMonth) done += 1; // prévue dans la période restante
    }
    const running = Boolean(pool && pool.interval && pool.interval.running);
    const required = running ? Math.max(0, Math.round(Number(pool.frequency) || 0)) : 0;
    const gap = running ? Math.max(1, Number(pool.interval.coverage) || 1) : null;
    st.set(s.id, { site: s, pool, last, done, required, k: Math.max(0, required - done), gap,
      placed: [], existing: [], codes: {}, details: {}, candidate: false });
  }
  for (const key of Object.keys(pools).sort()) {
    const p = pools[key];
    if (!p.interval || !p.interval.running) warnings.push({ code: 'duree_nulle', pool: key });
  }

  /** Le site peut-il recevoir une NOUVELLE visite au mois m ? */
  const freeAt = (s, m) => {
    const e = st.get(s.id); const c = s.months[m - 1] || {};
    return Boolean(e.pool) && runningAt(e.pool, m) && c.active && !c.forbidden && !s.excluded && !c.st;
  };
  /** Mois (index absolus) des visites EXISTANTES du site (réalisées ou prévues) à partir de `m`. */
  const existingFrom = (s, m) => {
    const list = [];
    for (let k = m; k <= 12; k += 1) { const c = s.months[k - 1]; if (c && (c.st === 'planifie' || c.st === 'realise')) list.push(k); }
    return list;
  };

  /**
   * Fenêtre d'un site à partir du mois M : nombre de visites encore plaçables (gloutonne au plus
   * tôt — optimale pour un écart minimal) et dernier mois où commencer pour toutes les placer
   * (gloutonne au plus tard). `last` = dernière visite connue ('AAAA-MM' | null).
   */
  function windowOf(s, M) {
    const e = st.get(s.id);
    if (!e.pool || e.k <= 0) return { fit: 0, latest: null };
    const H = e.gap;
    const ex = existingFrom(s, M);
    const lastAbs = e.last ? monthIdx(e.last) : null;
    const abs = (m) => year * 12 + (m - 1);
    const okBack = (m, prev) => prev == null || abs(m) - prev >= H;
    // au plus tôt
    let fit = 0; let prev = lastAbs; let first = null;
    for (let m = M; m <= lastMonth && fit < e.k; m += 1) {
      if (ex.includes(m)) { prev = abs(m); continue; }
      if (!freeAt(s, m) || !okBack(m, prev)) continue;
      const nextEx = ex.find((x) => x > m);
      if (nextEx != null && nextEx - m < H) continue;
      fit += 1; prev = abs(m); if (first == null) first = m;
    }
    if (!fit) return { fit: 0, latest: null };
    // au plus tard : `fit` visites placées depuis décembre en remontant
    let need = fit; let next = null; let latest = null;
    for (let m = lastMonth; m >= M && need > 0; m -= 1) {
      if (ex.includes(m)) { next = m; continue; }
      if (!freeAt(s, m)) continue;
      if (next != null && next - m < H) continue;
      const before = [...ex].filter((x) => x < m).pop();
      const prevAbs = before != null ? abs(before) : lastAbs;
      if (!okBack(m, prevAbs)) continue;
      need -= 1; next = m; latest = m;
    }
    return { fit, latest: need > 0 ? first : latest };
  }

  for (let M = fromMonth; M <= lastMonth; M += 1) {
    const mStr = monthStr(year, M);
    // ---- journées du mois : tournée = district, arrêt = commune, journée = un agent ------------
    const tours = new Map(); let tourSeq = 0;
    const counts = {}; // poolKey → { existing, generated, target, mmrMin, dayUnits, genDayUnits }
    const cnt = (key) => (counts[key] = counts[key] || { existing: 0, generated: 0, target: 0, dayUnits: 0, genDayUnits: 0 });
    function openDay(s, pool, { generated }) {
      let t = tours.get(s.districtKey);
      if (!t) { t = { key: s.districtKey, order: (tourSeq += 1), stops: new Map() }; tours.set(s.districtKey, t); }
      let stop = t.stops.get(s.communeKey);
      if (!stop) { stop = { key: s.communeKey, days: [] }; t.stops.set(s.communeKey, stop); }
      const cost = pool.costUnits;
      let day = cost <= U ? stop.days.find((d) => d.span === 1 && d.used + cost <= U) : null;
      if (!day) {
        const span = Math.max(1, Math.ceil(cost / U));
        day = { used: 0, span, pool: pool.key, visits: [], todo: [] };
        stop.days.push(day);
        cnt(pool.key).dayUnits += span * U;
        if (generated) cnt(pool.key).genDayUnits += span * U;
      }
      day.used += Math.min(cost, U * day.span);
      day.visits.push(s.id);
      return day;
    }
    const roomInOpenDay = (s, pool) => {
      const t = tours.get(s.districtKey); const stop = t && t.stops.get(s.communeKey);
      return Boolean(stop && pool.costUnits <= U && stop.days.some((d) => d.span === 1 && d.used + pool.costUnits <= U));
    };

    // 1. visites existantes (réalisées ou prévues) : elles ouvrent leurs journées
    for (const s of sites) {
      const c = s.months[M - 1];
      if (!c || (c.st !== 'planifie' && c.st !== 'realise')) continue;
      const e = st.get(s.id);
      e.existing.push(M);
      if (!e.pool) continue;
      const day = openDay(s, e.pool, { generated: false });
      if (c.st === 'planifie') day.todo.push(s.id); // une visite réalisée n'appelle plus de ressources
      cnt(e.pool.key).existing += 1;
    }

    // 2. candidats et raisons de ceux qui ne le sont pas
    const cands = [];
    const remaining = {}; // poolKey → visites restantes plaçables (pour la part équilibrée)
    for (const s of sites) {
      if (!s.inScope) continue;
      const e = st.get(s.id);
      const c = s.months[M - 1] || {};
      const code = (k, d) => { e.codes[M] = k; if (d) e.details[M] = d; };
      if (c.st === 'planifie' || c.st === 'realise') continue;
      if (!e.pool) { code('sans_mmr'); continue; }
      // Visites encore plaçables d'ici décembre : comptées pour la part équilibrée, même quand le
      // site n'est pas libre ce mois-ci (inactif, déjà visité récemment…).
      const w = e.k > 0 ? windowOf(s, M) : { fit: 0, latest: null };
      if (w.fit > 0) remaining[e.pool.key] = (remaining[e.pool.key] || 0) + Math.min(e.k, w.fit);
      if (!runningAt(e.pool, M)) { code('hors_calendrier'); continue; }
      if (c.forbidden) { code('zone_interdite'); continue; }
      if (!c.active) { code('inactif'); continue; }
      if (s.excluded) { code('acces'); continue; }
      if (c.st === 'annule') { code('annulee'); continue; }
      if (e.k <= 0) { code('besoin_couvert', { required: e.required }); continue; }
      const since = e.last ? monthIdx(mStr) - monthIdx(e.last) : null;
      const ex = existingFrom(s, M + 1);
      const backOk = since == null || since >= e.gap;
      const fwdOk = !ex.length || ex[0] - M >= e.gap;
      if (!w.fit || !backOk || !fwdOk) {
        code('intervalle', { since, last: e.last, gate: e.gap, next: ex.length ? monthStr(year, ex[0]) : null });
        continue;
      }
      e.candidate = true;
      cands.push({ site: s, e, pool: e.pool, since, must: w.latest === M, latest: w.latest, cls: priorityClass(s, since), done: false });
    }
    // Sites hors périmètre : leurs visites restantes ne comptent pas dans la part du périmètre.

    // 3. part équilibrée du mois par pool : ⌈restantes ÷ mois restants où le pool peut encore placer⌉
    for (const key of Object.keys(remaining)) {
      const p = pools[key];
      let left = 0;
      for (let m = M; m <= lastMonth; m += 1) if (runningAt(p, m)) left += 1;
      cnt(key).target = left > 0 ? Math.ceil(remaining[key] / left) : remaining[key];
    }
    const room = (c) => c.must || cnt(c.pool.key).generated < cnt(c.pool.key).target;

    // 4. ordre : échéance, classe RBM, échéance la plus proche, plus longue absence, risque, lieu
    cands.sort((a, b) => (Number(b.must) - Number(a.must)) || (a.cls - b.cls)
      || ((a.latest ?? 99) - (b.latest ?? 99))
      || ((b.since == null ? Infinity : b.since) - (a.since == null ? Infinity : a.since))
      || ((RISK_RANK[b.site.risk] || 0) - (RISK_RANK[a.site.risk] || 0))
      || cmp(a.site.districtKey, b.site.districtKey) || cmp(a.site.communeKey, b.site.communeKey)
      || cmp(a.site.placeKey, b.site.placeKey) || cmp(String(a.site.code), String(b.site.code)) || cmp(String(a.site.id), String(b.site.id)));
    const byPlace = new Map(); const byCommune = new Map(); const byDistrict = new Map();
    const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    for (const c of cands) {
      push(byPlace, c.site.placeKey, c); push(byCommune, c.site.communeKey, c);
      if (!byDistrict.has(c.site.districtKey)) byDistrict.set(c.site.districtKey, new Map());
      push(byDistrict.get(c.site.districtKey), c.site.communeKey, c);
    }
    const take = (c, why, anchor) => {
      if (c.done) return false;
      c.done = true; c.why = why; c.anchor = anchor ? anchor.site.id : null;
      c.day = openDay(c.site, c.pool, { generated: true });
      c.day.todo.push(c.site.id);
      cnt(c.pool.key).generated += 1;
      return true;
    };
    function fill(anchor) {
      for (const n of byPlace.get(anchor.site.placeKey) || []) if (!n.done && room(n)) take(n, 'meme_lieu', anchor);
      for (const n of byCommune.get(anchor.site.communeKey) || []) if (!n.done && room(n)) take(n, 'meme_commune', anchor);
      const communes = byDistrict.get(anchor.site.districtKey);
      if (!communes) return;
      const order = [...communes.entries()]
        .filter(([k]) => k !== anchor.site.communeKey)
        .map(([k, list]) => [k, list.filter((n) => !n.done && room(n)).length, list])
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
      for (const [, , list] of order) for (const n of list) if (!n.done && room(n)) take(n, 'meme_district', anchor);
    }
    const own = (c) => (c.must ? 'echeance' : c.site.urgent ? 'urgent' : 'du');
    // a. Échéances, urgences et risque élevé d'abord, sans rien entraîner : la place de leur
    //    activité leur revient avant tout regroupement.
    const first = cands.filter((c) => c.must || c.cls <= 1);
    for (const c of first) if (!c.done && room(c)) take(c, own(c), null);
    // b. Leurs voisins du même lieu et de la même commune (aucun déplacement de plus).
    for (const c of first) {
      if (!c.done) continue;
      for (const n of byPlace.get(c.site.placeKey) || []) if (!n.done && room(n)) take(n, 'meme_lieu', c);
      for (const n of byCommune.get(c.site.communeKey) || []) if (!n.done && room(n)) take(n, 'meme_commune', c);
    }
    // c. Les autres, dans l'ordre du RBM, chacun entraînant son lieu, sa commune puis son district.
    for (const c of cands) {
      if (c.done || !room(c)) continue;
      take(c, own(c), null);
      fill(c);
    }
    // 5. place libre des journées ouvertes : sites possibles de la même commune (aucun déplacement de plus)
    for (const c of cands) {
      if (c.done || !roomInOpenDay(c.site, c.pool)) continue;
      const anchor = (byCommune.get(c.site.communeKey) || []).find((n) => n.done && n !== c) || null;
      take(c, 'meme_commune', anchor);
    }

    // 6. numérotation, propositions, état pour les mois suivants
    const tourList = [...tours.values()].sort((a, b) => a.order - b.order);
    let dayNo = 0; const tourNo = new Map();
    tourList.forEach((t, i) => {
      tourNo.set(t.key, i + 1);
      for (const stop of t.stops.values()) for (const d of stop.days) { d.no = dayNo + 1; dayNo += d.span; }
    });
    const inHorizon = M <= toMonth;
    for (const c of cands) {
      const e = c.e;
      if (!c.done) continue;
      e.placed.push(M);
      e.k -= 1;
      if (inHorizon) {
        out.proposals.push({
          siteId: c.site.id, month: M, why: c.why, reason: c.must ? 'echeance' : c.site.urgent ? 'urgent' : 'du', level: levelOf(c.site), tier: c.cls,
          tour: tourNo.get(c.site.districtKey), day: c.day.no, anchor: c.anchor,
          detail: { since: c.since, last: e.last, gate: e.gap, risk: c.site.risk || null, required: e.required, visitNo: e.required - e.k,
            signals: c.site.urgent ? c.site.urgentSignals || [] : undefined },
        });
      }
      e.last = mStr;
    }
    for (const s of sites) { const c = s.months[M - 1]; if (c && (c.st === 'planifie' || c.st === 'realise')) st.get(s.id).last = mStr; }
    for (const c of cands) if (!c.done) { c.e.codes[M] = 'plus_tard'; c.e.details[M] = { must: false }; }
    if (inHorizon) {
      const capacity = {};
      for (const key of Object.keys(counts)) {
        const k = counts[key]; const p = pools[key];
        capacity[key] = { visitsCap: null, used: k.existing + k.generated, existing: k.existing, generated: k.generated, target: k.target,
          mmrMin: p && p.targetedPerMonth != null ? p.targetedPerMonth : null, dayCapUnits: null, dayUsedUnits: k.dayUnits, genDayUnits: k.genDayUnits, over: false };
      }
      out.months.push({
        month: M, capacity,
        tours: tourList.map((t) => ({
          no: tourNo.get(t.key), district: t.key,
          stops: [...t.stops.values()].map((sp) => ({ key: sp.key, days: sp.days.map((d) => ({ no: d.no, span: d.span, pool: d.pool, used: d.used, visits: d.visits, todo: d.todo })) })),
        })),
      });
    }
  }

  // ---- sites : visites de la période, report « plus tard » (mois prévu au-delà), raison principale
  for (const s of sites) {
    if (!s.inScope) continue;
    const e = st.get(s.id);
    const generated = e.placed.filter((m) => m <= toMonth);
    const later = e.placed.find((m) => m > toMonth) || null;
    const codes = {}; const details = {};
    for (let m = fromMonth; m <= toMonth; m += 1) {
      if (e.codes[m] === undefined) continue;
      codes[m] = e.codes[m];
      details[m] = e.codes[m] === 'plus_tard' ? { next: later ? monthStr(year, later) : null } : e.details[m] || null;
    }
    // « plus tard » sans mois prévu dans l'exercice : l'écart minimal l'empêche → « intervalle »
    for (const m of Object.keys(codes)) if (codes[m] === 'plus_tard' && !later) { codes[m] = 'intervalle'; details[m] = { since: null, gate: e.gap, next: null }; }
    const main = generated.length || e.existing.some((m) => m >= fromMonth && m <= toMonth) ? null : mainReason(codes, details);
    out.sites.push({ siteId: s.id, poolKey: s.poolKey || null, generated, existing: e.existing.filter((m) => m >= fromMonth && m <= toMonth),
      later: later ? monthStr(year, later) : null, candidate: e.candidate, main, codes });
  }

  // ---- projection par pool --------------------------------------------------------------------
  for (const key of Object.keys(pools).sort()) {
    const p = pools[key];
    let eligible = 0; let required = 0; let done = 0; let horizon = 0; let laterN = 0; let unmet = 0; let covered = 0;
    for (const s of sites) {
      if (!s.inScope || s.poolKey !== key) continue;
      const e = st.get(s.id);
      if (!s.months.some((c, i) => runningAt(p, i + 1) && c.active && !c.forbidden)) continue;
      eligible += 1; required += e.required; done += e.done;
      horizon += e.placed.filter((m) => m <= toMonth).length;
      laterN += e.placed.filter((m) => m > toMonth).length;
      unmet += Math.max(0, e.k);
      if (e.done > 0 || e.placed.length) covered += 1;
    }
    let runningMonths = 0; for (let m = fromMonth; m <= toMonth; m += 1) if (runningAt(p, m)) runningMonths += 1;
    const unplanned = {};
    for (const r of out.sites) if (r.poolKey === key && r.main) unplanned[r.main.code] = (unplanned[r.main.code] || 0) + 1;
    out.pools[key] = {
      key, eligible, requiredYear: required, doneYear: done, generatedVisits: horizon, laterVisits: laterN, unmet,
      covered, share: eligible ? covered / eligible : null, perSite: p.interval && p.interval.running ? Math.round(Number(p.frequency) || 0) : 0,
      gap: p.interval && p.interval.running ? p.interval.coverage : null, mmrPerMonth: p.targetedPerMonth ?? null, runningMonths,
      existingVisits: out.months.reduce((a, mo) => a + ((mo.capacity[key] || {}).existing || 0), 0), unplanned,
    };
  }
  out.stats = {
    proposals: out.proposals.length,
    tours: new Set(out.proposals.map((x) => `${x.month}|${x.tour}`)).size,
    journees: out.months.reduce((a, mo) => a + Object.values(mo.capacity).reduce((b, c) => b + Math.round(c.genDayUnits / U), 0), 0),
    sitesPlanned: new Set(out.proposals.map((x) => x.siteId)).size,
  };
  return out;
}

/* ------------------------------------------------------------------ ressources nécessaires */

/**
 * Jours de terrain d'un mois, dans l'ordre du calendrier : du lundi au vendredi ; du lundi au
 * samedi quand le MMR compte plus de jours ouvrés que de jours de semaine.
 */
function fieldDays(year, month, workingDays = 0) {
  const week = []; const six = [];
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= n; d += 1) {
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (wd >= 1 && wd <= 5) week.push(d);
    if (wd >= 1 && wd <= 6) six.push(d);
  }
  return workingDays > week.length ? six : week;
}
/** Date ('AAAA-MM-JJ') du f-ième jour de terrain du mois (borné au dernier jour de terrain). */
function fieldDate(year, month, f, workingDays = 0) {
  const list = fieldDays(year, month, workingDays);
  const day = list[Math.max(1, Math.min(f, list.length)) - 1];
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Agents et véhicules NÉCESSAIRES pour les visites à faire de chaque mois (visites prévues
 * existantes + proposées), par bureau ; comparés aux personnes déclarées au MMR.
 * @param {object} result  scheduleNeeds(...) ou planGenerator.generatePlan(...)
 * @param {object[]} poolInfo planInputs.assemble().poolInfo (bureau, jours ouvrés, personnes)
 * @param {{ year:number, agentsPerVehicle:number, fieldDaysPerMonth:number, generatedOnly?:boolean }} opts
 * @returns {{ months, offices, slots, peak }}
 *   slots : 'siteId|mois' → { fieldDay, agent, date, tour } (visites PROPOSÉES)
 */
function resourceNeeds(result, poolInfo = [], { year, agentsPerVehicle = 4, fieldDaysPerMonth = 20 } = {}) {
  const info = new Map(poolInfo.map((p) => [p.key, p]));
  const officeOf = (poolKey) => { const p = info.get(poolKey); return p && p.officeId ? p.officeId : 'general'; };
  const officePools = new Map();
  for (const p of poolInfo) { const o = p.officeId || 'general'; if (!officePools.has(o)) officePools.set(o, []); officePools.get(o).push(p); }
  const proposed = new Set(result.proposals.map((p) => `${p.siteId}|${p.month}`));
  const apv = Math.max(1, Math.round(agentsPerVehicle) || 1);
  const slots = {}; const months = []; const offices = [];
  for (const mo of result.months) {
    const M = mo.month;
    const days = [];
    for (const t of [...mo.tours].sort((a, b) => a.no - b.no)) {
      for (const sp of t.stops) {
        for (const d of sp.days) {
          const todo = d.todo || d.visits.filter((id) => proposed.has(`${id}|${M}`));
          if (!todo.length) continue;
          days.push({ office: officeOf(d.pool), tour: t.no, district: t.district, commune: sp.key, span: d.span, visits: todo, no: d.no });
        }
      }
    }
    const byOffice = new Map();
    for (const d of days) { if (!byOffice.has(d.office)) byOffice.set(d.office, []); byOffice.get(d.office).push(d); }
    const perDayVehicles = new Map(); // jour de terrain → véhicules (tous bureaux)
    let monthAgents = 0; let monthDeclared = null; let monthAgentDays = 0; let monthVisits = 0;
    for (const officeId of [...byOffice.keys()].sort()) {
      const list = byOffice.get(officeId);
      const ps = (officePools.get(officeId) || []).filter((p) => p.inScope !== false);
      const wds = ps.map((p) => Number(p.workingDays)).filter((x) => x > 0);
      const wd = wds.length ? Math.min(...wds) : fieldDaysPerMonth;
      const agentDays = list.reduce((a, d) => a + d.span, 0);
      const visits = list.reduce((a, d) => a + d.visits.length, 0);
      let agents = Math.max(1, Math.ceil(agentDays / wd));
      let assign;
      // Répartition : la journée suivante (ordre des tournées) va à l'agent libre le plus tôt.
      for (;;) {
        const free = Array(agents).fill(1);
        assign = list.map((d) => {
          let a = 0; for (let i = 1; i < agents; i += 1) if (free[i] < free[a]) a = i;
          const f = free[a]; free[a] += d.span;
          return { d, agent: a + 1, fieldDay: f };
        });
        if (assign.every((x) => x.fieldDay + x.d.span - 1 <= wd) || agents >= agentDays) break;
        agents += 1;
      }
      // Véhicules : par jour, agents d'un même district ensemble.
      const byDay = new Map();
      for (const x of assign) {
        for (let k = 0; k < x.d.span; k += 1) {
          const f = x.fieldDay + k;
          if (!byDay.has(f)) byDay.set(f, new Map());
          const m = byDay.get(f); m.set(x.d.district, (m.get(x.d.district) || 0) + 1);
        }
        const date = fieldDate(year, M, x.fieldDay, wd);
        for (const id of x.d.visits) if (proposed.has(`${id}|${M}`)) slots[`${id}|${M}`] = { fieldDay: x.fieldDay, agent: x.agent, date, tour: x.d.tour };
      }
      const vehiclesByDay = [...byDay.entries()].map(([f, m]) => [f, [...m.values()].reduce((a, n) => a + Math.ceil(n / apv), 0)]);
      for (const [f, v] of vehiclesByDay) perDayVehicles.set(f, (perDayVehicles.get(f) || 0) + v);
      const vPeak = vehiclesByDay.reduce((a, [, v]) => Math.max(a, v), 0);
      const vAvg = vehiclesByDay.length ? Math.round((vehiclesByDay.reduce((a, [, v]) => a + v, 0) / vehiclesByDay.length) * 10) / 10 : 0;
      const declaredList = ps.filter((p) => Number(p.persons) > 0);
      const declared = declaredList.length ? declaredList.reduce((a, p) => a + Number(p.persons), 0) : null;
      const row = {
        month: M, officeId: officeId === 'general' ? null : officeId, officeName: ps[0] ? ps[0].officeName || null : null,
        visits, agentDays, communes: new Set(list.map((d) => d.commune)).size, districts: new Set(list.map((d) => d.district)).size,
        workingDays: wd, workingDaysSource: wds.length ? 'mmr' : 'parametre', agentsNeeded: agents, declared,
        gap: declared == null ? null : agents - declared, vehiclesPeak: vPeak, vehiclesAvg: vAvg, fieldDaysUsed: byDay.size,
      };
      offices.push(row);
      monthAgents += agents; monthAgentDays += agentDays; monthVisits += visits;
      if (declared != null) monthDeclared = (monthDeclared || 0) + declared;
    }
    const vehicles = [...perDayVehicles.values()];
    // Zones : district → communes (journées, visites, sites par jour).
    const zones = new Map();
    for (const d of days) {
      if (!zones.has(d.district)) zones.set(d.district, { district: d.district, tour: d.tour, communes: new Map(), agentDays: 0, visits: 0 });
      const z = zones.get(d.district);
      z.agentDays += d.span; z.visits += d.visits.length;
      const c = z.communes.get(d.commune) || { commune: d.commune, agentDays: 0, visits: 0 };
      c.agentDays += d.span; c.visits += d.visits.length; z.communes.set(d.commune, c);
    }
    months.push({
      month: M, visits: monthVisits, sites: new Set(days.flatMap((d) => d.visits)).size, agentDays: monthAgentDays,
      agentsNeeded: monthAgents, declared: monthDeclared, gap: monthDeclared == null ? null : monthAgents - monthDeclared,
      vehiclesPeak: vehicles.length ? Math.max(...vehicles) : 0,
      vehiclesAvg: vehicles.length ? Math.round((vehicles.reduce((a, v) => a + v, 0) / vehicles.length) * 10) / 10 : 0,
      zones: [...zones.values()].sort((a, b) => a.tour - b.tour).map((z) => ({
        district: z.district, tour: z.tour, agentDays: z.agentDays, visits: z.visits,
        sitesPerDay: z.agentDays ? Math.round((z.visits / z.agentDays) * 10) / 10 : null,
        communes: [...z.communes.values()].map((c) => ({ ...c, sitesPerDay: c.agentDays ? Math.round((c.visits / c.agentDays) * 10) / 10 : null })),
      })),
    });
  }
  const peakOf = (arr, k) => arr.reduce((best, x) => (x[k] > (best ? best[k] : -1) ? x : best), null);
  const pa = peakOf(months, 'agentsNeeded'); const pv = peakOf(months, 'vehiclesPeak');
  return {
    agentsPerVehicle: apv, months, offices, slots,
    peak: { agents: pa ? pa.agentsNeeded : 0, agentsMonth: pa ? pa.month : null, vehicles: pv ? pv.vehiclesPeak : 0, vehiclesMonth: pv ? pv.month : null },
  };
}

module.exports = { scheduleNeeds, resourceNeeds, fieldDays, fieldDate, priorityClass };
