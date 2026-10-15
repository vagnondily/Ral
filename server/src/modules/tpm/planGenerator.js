/**
 * Générateur de plan de suivi réaliste (lot 5, § 7) — module PUR et DÉTERMINISTE :
 * aucune horloge, aucun hasard, aucune I/O ; sites triés par code, ordre total partout.
 * Testé exhaustivement (test/planGenerator.test.js) ; mesuré au banc (scripts/perfPlan.js).
 *
 * Entrées (préparées par planInputs.assemble) — un exercice (année) :
 *   fromMonth..toMonth  mois planifiables de l'exercice (1..12 ; fromMonth ≥ mois courant) ;
 *   sites[]  { id, code, inScope, poolKey|null, districtKey, communeKey, placeKey, risk,
 *              urgent, urgentSignals[], finalScore, lastReal ('AAAA-MM' avant l'exercice | null),
 *              months[12] { active, forbidden, st: null|'planifie'|'realise'|'annule' } } ;
 *   pools{}  une capacité par activité × bureau (ligne MMR effective) :
 *            { key, interval (planSettings.effectiveInterval), runningMonths: Set|null,
 *              visitsCap, yearCap|null, costUnits, dayCapUnits|null, frequency, workingDays, vpd } ;
 *   params   paramètres du plan (planSettings) + levelOf (adaptateur des niveaux de priorité).
 *
 * Mois par mois : engagements existants d'abord (ils consomment la capacité, ouvrent leurs
 * journées, et un dépassement est SIGNALÉ, jamais corrigé), puis candidats (garde-fous,
 * intervalle de revisite en arrière ET en avant, niveau), classés, puis placés par paliers
 * (0 urgent + Haute, 1 Moyenne, 2 Basse, 3 couverture sous quota lissé) ; chaque placement
 * tire ses voisins : même lieu (multi-activités), même commune, même district (tournée).
 *
 * Capacité en UNITÉS ENTIÈRES : une journée-personne = U = 252 000 unités (divisible pour
 * 0,5 … 10 suivis par jour) ; une visite coûte ⌈U ÷ suivis/jour⌉. Une journée ouverte coûte
 * une journée-personne (⌈coût ÷ U⌉ si une visite dépasse la journée) à l'activité qui
 * l'ouvre, plus les jours de déplacement à l'ouverture d'une tournée (district × mois) par
 * cette activité ; les visites d'autres activités qui s'y ajoutent ne consomment que leur
 * capacité de visites. Jamais de flottant.
 *
 * Invariants (tests + banc, 0 violation) : ≤ 1 visite par site × mois ; jamais sur un
 * site × mois soumis à un garde-fou ; visites générées ≤ capacité restante ; journée ≤ 100 % ;
 * jours-personne générés ≤ capacité ; intervalle de revisite respecté (sauf urgent et
 * anticipation, dits dans l'explication) ; résultat identique quel que soit l'ordre d'entrée.
 */
const { isDue } = require('./rbmMath');

const U = 252000;

/** Coût d'une visite en unités pour `vpd` suivis par jour (0,5 … 10, deux décimales au plus). */
function costUnits(vpd) {
  const v100 = Math.round(Number(vpd) * 100);
  if (!(v100 > 0)) throw new Error('suivis par jour invalides');
  return Math.ceil((U * 100) / v100);
}

const pad = (m) => String(m).padStart(2, '0');
const monthStr = (year, m) => `${year}-${pad(m)}`;
const monthIdx = (s) => { const [y, m] = String(s).split('-').map(Number); return y * 12 + (m - 1); };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const TIER_OF_LEVEL = { haute: 0, moyenne: 1, basse: 2 };
const LEVEL_RANK = { haute: 3, moyenne: 2, basse: 1 };
const RISK_RANK = { elevee: 3, moyenne: 2, faible: 1 };

/**
 * Codes de report, du plus « actionnable » au moins : la raison principale d'un site non
 * planifié est le premier rencontré dans cet ordre sur l'horizon.
 */
const POSTPONE_ORDER = ['capacite_visites', 'capacite_jours', 'capacite_exercice', 'quota_couverture', 'intervalle',
  'deja_couvert', 'non_du', 'hors_calendrier', 'inactif', 'zone_interdite', 'annulee', 'sans_mmr'];
const WHY = ['urgent', 'du', 'meme_lieu', 'meme_commune', 'meme_district', 'couverture', 'anticipee'];
/** Codes « durs » pour le mois : inutile de réessayer le site ce mois-là. */
const HARD = new Set(['capacite_visites', 'capacite_exercice', 'quota_couverture']);

/** Niveau de priorité par défaut d'un site « dû » : priorités du mois du RBM (rbmScore). */
function defaultLevelOf(site) {
  // Même règle que rbmScore.priorityBasisOf avec overdue = true : urgent ou score élevé → Haute, sinon Moyenne.
  return site.urgent || site.finalScore === 2 ? 'haute' : 'moyenne';
}

function sortedSites(sites) {
  return [...sites].sort((a, b) => cmp(String(a.code), String(b.code)) || cmp(String(a.id), String(b.id)));
}

/** Clé de classement totale (voir § 7.2, étape 4). */
function rankCompare(a, b) {
  return (Number(b.urgentPick) - Number(a.urgentPick))
    || ((LEVEL_RANK[b.level] || 0) - (LEVEL_RANK[a.level] || 0))
    || (Number(a.tier === 3) - Number(b.tier === 3))
    || (Number(a.covered) - Number(b.covered))
    || ((b.since == null ? Infinity : b.since) - (a.since == null ? Infinity : a.since))
    || ((RISK_RANK[b.site.risk] || 0) - (RISK_RANK[a.site.risk] || 0))
    || cmp(a.site.districtKey, b.site.districtKey) || cmp(a.site.communeKey, b.site.communeKey)
    || cmp(a.site.placeKey, b.site.placeKey) || cmp(String(a.site.code), String(b.site.code))
    || cmp(String(a.site.id), String(b.site.id));
}

/**
 * @param {object} input voir l'en-tête
 * @returns {{ proposals, months, sites, pools, warnings, stats }}
 */
function generatePlan(input) {
  const { year, fromMonth, toMonth } = input;
  const params = { levels: ['haute', 'moyenne', 'basse'], coverageCatchUp: true, dayGrouping: 'commune', fillDistrict: true,
    multiActivityDays: true, travelDaysPerTour: 0, urgentMinGapMonths: 1, anticipationMonths: 0, coverageTargetPct: 80, ...input.params };
  const levelOf = params.levelOf || defaultLevelOf;
  const pools = input.pools || {};
  const sites = sortedSites(input.sites || []);
  const warnings = [];
  const out = { proposals: [], months: [], sites: [], pools: {}, warnings, stats: {} };
  if (!(fromMonth >= 1 && toMonth <= 12 && fromMonth <= toMonth)) {
    warnings.push({ code: 'horizon_passe' });
    return finish(out, sites, pools, params, input);
  }
  const stopKeyOf = (s) => (params.dayGrouping === 'lieu' ? s.placeKey : params.dayGrouping === 'district' ? s.districtKey : s.communeKey);

  // ---- état initial par site et par pool -----------------------------------------
  const st = new Map(); // siteId → état de projection
  for (const s of sites) {
    const months = s.months || [];
    let last = s.lastReal || null;
    let coveredBefore = false;
    for (let m = 1; m < fromMonth; m += 1) {
      const c = months[m - 1];
      if (c && c.st === 'realise') {
        if (!last || monthStr(year, m) > last) last = monthStr(year, m);
        const pool = pools[s.poolKey];
        if (!pool || !pool.runningMonths || pool.runningMonths.has(m)) coveredBefore = true;
      }
    }
    let coveredLater = false;
    for (let m = fromMonth; m <= 12; m += 1) { const c = months[m - 1]; if (c && (c.st === 'planifie' || c.st === 'realise')) coveredLater = true; }
    st.set(s.id, { site: s, last, covered: coveredBefore || coveredLater, coveredBefore, coveredExisting: coveredBefore || coveredLater,
      urgentUsed: false, generated: [], existing: [], codes: {}, details: {} });
  }
  // Consommation de l'exercice par pool : visites réalisées (tout l'exercice) et prévues (à partir du 1er mois planifiable).
  const poolState = {};
  for (const key of Object.keys(pools).sort()) {
    const p = pools[key];
    let usedYear = 0;
    for (const s of sites) {
      if (s.poolKey !== key) continue;
      (s.months || []).forEach((c, i) => { if (c && (c.st === 'realise' || (c.st === 'planifie' && i + 1 >= fromMonth))) usedYear += 1; });
    }
    poolState[key] = { usedYear, yearLeftStart: p.yearCap == null ? null : Math.max(0, p.yearCap - usedYear), generatedDays: 0, generated: 0, existing: 0, over: false };
    if (!p.interval || !p.interval.running) warnings.push({ code: 'duree_nulle', pool: key });
    else if (!(p.visitsCap > 0)) warnings.push({ code: 'capacite_inconnue', pool: key });
  }
  const runningAt = (p, m) => Boolean(p && p.interval && p.interval.running && (!p.runningMonths || p.runningMonths.has(m)));

  // Projection de couverture : sites éligibles (dans le périmètre) par pool.
  const eligible = {};
  for (const s of sites) {
    if (!s.inScope || !s.poolKey || !pools[s.poolKey]) continue;
    const p = pools[s.poolKey];
    let ok = false;
    for (let m = 1; m <= 12 && !ok; m += 1) { const c = s.months[m - 1]; if (runningAt(p, m) && c && c.active && !c.forbidden) ok = true; }
    if (ok) (eligible[s.poolKey] = eligible[s.poolKey] || new Set()).add(s.id);
  }
  const targetOf = (key) => Math.ceil(((eligible[key] ? eligible[key].size : 0) * params.coverageTargetPct) / 100);
  const coveredCount = (key) => { let n = 0; for (const id of eligible[key] || []) if (st.get(id).covered) n += 1; return n; };

  // Prochain engagement existant d'un site APRÈS le mois m (pour l'intervalle « en avant »).
  const nextExisting = (s, m) => {
    for (let k = m + 1; k <= 12; k += 1) { const c = s.months[k - 1]; if (c && (c.st === 'planifie' || c.st === 'realise')) return k; }
    return null;
  };
  let rbmGated = 0;

  for (let M = fromMonth; M <= toMonth; M += 1) {
    const mStr = monthStr(year, M);
    const runningLeft = (p) => { let n = 0; for (let k = M; k <= toMonth; k += 1) if (runningAt(p, k)) n += 1; return n; };
    // 1. capacité du mois par pool
    const mp = {};
    for (const key of Object.keys(pools).sort()) {
      const p = pools[key]; const ps = poolState[key];
      const running = runningAt(p, M);
      const yearLeft = p.yearCap == null ? Infinity : Math.max(0, p.yearCap - ps.usedYear);
      mp[key] = { running, cap: running ? (p.visitsCap || 0) : 0, used: 0, existing: 0, generated: 0, yearLeft,
        dayCap: running ? p.dayCapUnits : 0, dayUsed: 0, genDayUnits: 0, toursCharged: new Set(), quota: 0, coverageGenerated: 0, over: false };
    }
    const tours = new Map(); // districtKey → { key, order, stops: Map, opened }
    let tourSeq = 0;
    const tourOf = (s, create) => {
      let t = tours.get(s.districtKey);
      if (!t && create) { t = { key: s.districtKey, order: tourSeq += 1, stops: new Map() }; tours.set(s.districtKey, t); }
      return t;
    };
    const stopOf = (t, s, create) => {
      const k = stopKeyOf(s);
      let stop = t.stops.get(k);
      if (!stop && create) { stop = { key: k, days: [] }; t.stops.set(k, stop); }
      return stop;
    };

    /** Place une visite (engagement existant : `force`, sans contrôle de capacité). */
    function place(s, pool, { force = false, tier = null } = {}) {
      const ps = mp[pool.key];
      const cost = pool.costUnits;
      if (!force) {
        if (ps.used >= ps.cap) return { fail: 'capacite_visites' };
        if (ps.yearLeft <= 0) return { fail: 'capacite_exercice' };
        if (tier === 3 && ps.coverageGenerated >= ps.quota) return { fail: 'quota_couverture' };
      }
      const t0 = tourOf(s, false);
      const stop0 = t0 ? stopOf(t0, s, false) : null;
      let day = null;
      if (stop0 && cost <= U) {
        day = stop0.days.find((d) => d.span === 1 && d.used + cost <= U && (params.multiActivityDays || d.pool === pool.key)) || null;
      }
      if (!day) {
        const span = Math.max(1, Math.ceil(cost / U));
        const travel = !(t0 && ps.toursCharged.has(t0.key)) ? (params.travelDaysPerTour || 0) : 0;
        const need = (span + travel) * U;
        if (!force && ps.dayCap != null && ps.dayUsed + need > ps.dayCap) return { fail: 'capacite_jours' };
        const t = tourOf(s, true);
        const stop = stopOf(t, s, true);
        day = { used: 0, span, pool: pool.key, visits: [], generatedOpen: !force };
        stop.days.push(day);
        ps.toursCharged.add(t.key);
        ps.dayUsed += need;
        if (!force) { ps.genDayUnits += need; poolState[pool.key].generatedDays += span; }
        if (ps.dayCap != null && ps.dayUsed > ps.dayCap) ps.over = true;
      }
      day.used += Math.min(cost, U * day.span);
      day.visits.push(s.id);
      ps.used += 1;
      // Un engagement existant est déjà compté dans la consommation de l'exercice (usedYear initial).
      if (!force) { ps.yearLeft -= 1; poolState[pool.key].usedYear += 1; }
      if (ps.used > ps.cap) ps.over = true;
      return { day };
    }

    // 2. engagements existants (tous les sites du pool, dans ou hors périmètre)
    for (const s of sites) {
      const c = s.months[M - 1];
      if (!c || (c.st !== 'planifie' && c.st !== 'realise')) continue;
      const e = st.get(s.id);
      e.existing.push(M);
      e.urgentUsed = true; // une visite au plan sur l'horizon : l'écart urgent ne s'applique plus
      const pool = pools[s.poolKey];
      if (pool && mp[pool.key]) {
        place(s, pool, { force: true });
        mp[pool.key].existing += 1; poolState[pool.key].existing += 1;
      }
    }

    // 3. candidats
    const cands = [];
    for (const s of sites) {
      if (!s.inScope) continue;
      const e = st.get(s.id);
      const c = s.months[M - 1] || {};
      const pool = pools[s.poolKey];
      const code = (k, d) => { e.codes[M] = k; if (d) e.details[M] = d; };
      if (c.st === 'planifie' || c.st === 'realise') continue; // engagement existant (déjà placé)
      if (!pool) { code('sans_mmr'); continue; }
      if (!runningAt(pool, M)) { code('hors_calendrier'); continue; }
      if (c.forbidden) { code('zone_interdite'); continue; }
      if (!c.active) { code('inactif'); continue; }
      if (c.st === 'annule') { code('annulee'); continue; }
      const since = e.last ? monthIdx(mStr) - monthIdx(e.last) : null;
      const next = nextExisting(s, M);
      const gap = (g) => (since == null || since >= g) && (next == null || next - M >= g);
      const iv = pool.interval;
      const cand = { site: s, pool, since, last: e.last, covered: e.covered, next, tier: null, why: null, level: null, urgentPick: false, done: false, fail: null };
      if (s.urgent && !e.urgentUsed && gap(params.urgentMinGapMonths)) {
        Object.assign(cand, { tier: 0, why: 'urgent', level: 'haute', urgentPick: true, gate: params.urgentMinGapMonths });
      } else {
        const dueGate = iv.mode === 'couverture' ? iv.coverage : iv.due;
        const dueOk = gap(dueGate) && (iv.mode !== 'couverture' || !e.covered);
        let lvl = null;
        if (dueOk) {
          lvl = levelOf(s, { month: mStr, since, gate: dueGate });
          if (params.levels.includes(lvl)) Object.assign(cand, { tier: TIER_OF_LEVEL[lvl], why: 'du', level: lvl, gate: dueGate });
        }
        if (cand.tier == null && params.coverageCatchUp && !e.covered && gap(iv.coverage)) {
          Object.assign(cand, { tier: 3, why: 'couverture', level: lvl || 'basse', gate: iv.coverage });
        }
        if (cand.tier == null) {
          if (dueOk) code('non_du', { level: lvl });
          else if (iv.mode === 'couverture' && e.covered && gap(dueGate)) code('deja_couvert');
          else {
            code('intervalle', { since, last: e.last, gate: dueGate, next: next ? monthStr(year, next) : null });
            // Dû selon les Priorités du mois (fréquence RBM du risque du site) mais reporté par l'intervalle MMR : compté, montré.
            if (M === fromMonth && isDue(s.risk, e.last, mStr)) rbmGated += 1;
            if (params.anticipationMonths > 0) cands.push({ ...cand, anticipation: true, gated: dueGate });
          }
          continue;
        }
      }
      e.candidate = true;
      cands.push(cand);
    }

    // 4. quota de couverture, lissé sur les mois d'activité restants
    for (const key of Object.keys(mp)) {
      const left = runningLeft(pools[key]);
      const missing = Math.max(0, targetOf(key) - coveredCount(key));
      mp[key].quota = left > 0 ? Math.ceil(missing / left) : 0;
    }

    // 5. placement par paliers, chaque placement tirant ses voisins
    const active = cands.filter((c) => !c.anticipation).sort(rankCompare);
    const byPlace = new Map(); const byCommune = new Map(); const byDistrict = new Map();
    const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    for (const c of active) {
      push(byPlace, c.site.placeKey, c); push(byCommune, c.site.communeKey, c);
      if (!byDistrict.has(c.site.districtKey)) byDistrict.set(c.site.districtKey, new Map());
      push(byDistrict.get(c.site.districtKey), c.site.communeKey, c);
    }
    const hardFull = (c) => {
      const ps = mp[c.pool.key];
      return ps.used >= ps.cap || ps.yearLeft <= 0 || (c.tier === 3 && ps.coverageGenerated >= ps.quota);
    };
    function attempt(c, why, anchor) {
      if (c.done) return false;
      const r = place(c.site, c.pool, { tier: c.tier });
      if (r.fail) { if (!c.fail || !HARD.has(c.fail)) c.fail = r.fail; return false; }
      c.done = true; c.day = r.day; c.placedWhy = why; c.anchor = anchor ? anchor.site.id : null;
      const ps = mp[c.pool.key];
      ps.generated += 1; poolState[c.pool.key].generated += 1;
      if (c.tier === 3) ps.coverageGenerated += 1;
      const e = st.get(c.site.id);
      e.covered = true;
      if (c.why === 'urgent') e.urgentUsed = true;
      return true;
    }
    function fill(anchor, tier) {
      for (const n of byPlace.get(anchor.site.placeKey) || []) {
        if (n !== anchor && !n.done && !hardFull(n) && (n.tier <= 2 || n.tier === tier)) attempt(n, 'meme_lieu', anchor);
      }
      for (const n of byCommune.get(anchor.site.communeKey) || []) {
        if (!n.done && n.tier <= tier && !hardFull(n)) attempt(n, 'meme_commune', anchor);
      }
      if (!params.fillDistrict) return;
      const communes = byDistrict.get(anchor.site.districtKey);
      if (!communes) return;
      const order = [...communes.entries()]
        .filter(([k]) => k !== anchor.site.communeKey)
        .map(([k, list]) => [k, list.filter((n) => !n.done && n.tier <= tier).length, list])
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
      for (const [, , list] of order) {
        for (const n of list) if (!n.done && n.tier <= tier && !hardFull(n)) attempt(n, 'meme_district', anchor);
      }
    }
    for (let tier = 0; tier <= 3; tier += 1) {
      for (const c of active) {
        if (c.tier !== tier || c.done) continue;
        if (hardFull(c)) { attempt(c, c.why, null); continue; } // enregistre le code « dur »
        if (attempt(c, c.why, null)) fill(c, tier);
      }
    }

    // 6. anticipation : seulement dans la place restante d'une journée déjà ouverte
    if (params.anticipationMonths > 0) {
      for (const c of cands.filter((x) => x.anticipation).sort(rankCompare)) {
        if (c.gated == null || (c.since != null && c.gated - c.since > params.anticipationMonths)) continue;
        if (c.next != null && c.next - M < c.gated) continue;
        const ps = mp[c.pool.key];
        if (ps.used >= ps.cap || ps.yearLeft <= 0) continue;
        const t = tourOf(c.site, false); const stop = t ? stopOf(t, c.site, false) : null;
        const day = stop && stop.days.find((d) => d.span === 1 && d.used + c.pool.costUnits <= U && (params.multiActivityDays || d.pool === c.pool.key));
        if (!day) continue;
        day.used += c.pool.costUnits; day.visits.push(c.site.id);
        ps.used += 1; ps.yearLeft -= 1; poolState[c.pool.key].usedYear += 1;
        ps.generated += 1; poolState[c.pool.key].generated += 1;
        Object.assign(c, { done: true, day, placedWhy: 'anticipee', why: 'anticipee', level: c.level || null });
        const e = st.get(c.site.id); e.covered = true; delete e.codes[M]; delete e.details[M];
        active.push(c);
      }
    }

    // 7. numérotation des tournées et des journées, propositions, codes de report
    const tourList = [...tours.values()].sort((a, b) => a.order - b.order);
    let dayNo = 0;
    const tourNo = new Map();
    tourList.forEach((t, i) => {
      tourNo.set(t.key, i + 1);
      for (const stop of t.stops.values()) for (const d of stop.days) { d.no = dayNo + 1; dayNo += d.span; }
    });
    for (const c of active) {
      const e = st.get(c.site.id);
      if (c.done) {
        e.generated.push(M);
        e.last = mStr;
        out.proposals.push({
          siteId: c.site.id, month: M, why: c.placedWhy, reason: c.why, level: c.level, tier: c.tier,
          tour: tourNo.get(c.site.districtKey), day: c.day.no, anchor: c.anchor,
          detail: { since: c.since, last: c.last, gate: c.gate ?? null, risk: c.site.risk || null, signals: c.why === 'urgent' ? c.site.urgentSignals || [] : undefined },
        });
      } else {
        e.codes[M] = c.fail || 'capacite_visites';
        e.details[M] = { level: c.level, tier: c.tier };
      }
    }
    // Les engagements existants valent visite pour la projection des mois suivants.
    for (const s of sites) { const c = s.months[M - 1]; if (c && (c.st === 'planifie' || c.st === 'realise')) st.get(s.id).last = mStr; }

    const capacity = {};
    for (const key of Object.keys(mp)) {
      const ps = mp[key];
      if (!ps.running && !ps.existing) continue;
      if (ps.over) { poolState[key].over = true; }
      capacity[key] = { visitsCap: ps.cap, used: ps.used, existing: ps.existing, generated: ps.generated,
        dayCapUnits: ps.dayCap, dayUsedUnits: ps.dayUsed, genDayUnits: ps.genDayUnits, quota: ps.quota, over: ps.over };
    }
    out.months.push({
      month: M, capacity,
      tours: tourList.map((t) => ({
        no: tourNo.get(t.key), district: t.key,
        stops: [...t.stops.values()].map((sp) => ({ key: sp.key, days: sp.days.map((d) => ({ no: d.no, span: d.span, pool: d.pool, used: d.used, visits: d.visits })) })),
      })),
    });
  }
  out.stats.rbmDueGated = rbmGated || 0;
  for (const key of Object.keys(poolState)) if (poolState[key].over) warnings.push({ code: 'engagements_depassent', pool: key });
  return finish(out, sites, pools, params, input, st, poolState, eligible);
}

/** Raison principale d'un site non planifié (code le plus actionnable sur l'horizon). */
function mainReason(codes, details) {
  let best = null;
  for (const m of Object.keys(codes).map(Number).sort((a, b) => a - b)) {
    const rank = POSTPONE_ORDER.indexOf(codes[m]);
    if (best == null || rank < best.rank) best = { rank, code: codes[m], month: m, detail: details[m] || null };
  }
  return best ? { code: best.code, month: best.month, detail: best.detail } : null;
}

/**
 * Résultat : décisions par site (périmètre), projection de couverture par pool, totaux.
 * Projection : une visite planifiée (existante ou générée) compte comme faite POUR LA
 * PROJECTION SEULEMENT (une visite planifiée ne rend jamais un site « à jour » ailleurs).
 */
function finish(out, sites, pools, params, input, st = new Map(), poolState = {}, eligible = {}) {
  const { fromMonth, toMonth } = input;
  const bySite = new Map();
  for (const s of sites) {
    if (!s.inScope) continue;
    const e = st.get(s.id);
    if (!e) continue;
    const row = { siteId: s.id, poolKey: s.poolKey || null, generated: e.generated, existing: e.existing,
      candidate: Boolean(e.candidate), main: e.generated.length || e.existing.length ? null : mainReason(e.codes, e.details), codes: e.codes };
    bySite.set(s.id, row);
    out.sites.push(row);
  }
  for (const key of Object.keys(pools).sort()) {
    const p = pools[key];
    const ps = poolState[key] || { generated: 0, existing: 0, generatedDays: 0, yearLeftStart: null };
    const ids = eligible[key] || new Set();
    let coveredBefore = 0; let coveredExisting = 0; let covered = 0;
    for (const id of ids) {
      const e = st.get(id);
      if (e.coveredBefore) coveredBefore += 1;
      if (e.coveredExisting) coveredExisting += 1;
      if (e.covered) covered += 1;
    }
    const n = ids.size;
    const target = Math.ceil((n * params.coverageTargetPct) / 100);
    const missing = Math.max(0, target - covered);
    let runningMonths = 0;
    for (let m = fromMonth; m <= toMonth; m += 1) if (p.interval && p.interval.running && (!p.runningMonths || p.runningMonths.has(m))) runningMonths += 1;
    // Visites par journée-personne RÉELLEMENT obtenues (regroupement compris), sinon suivis/jour de l'activité.
    const perDay = ps.generatedDays > 0 ? ps.generated / ps.generatedDays : (p.vpd || null);
    const personDays = missing > 0 && perDay ? Math.ceil(missing / perDay) : 0;
    const extraPersons = personDays && p.workingDays && runningMonths > 0 ? Math.ceil(personDays / (p.workingDays * runningMonths)) : null;
    let capacityVisits = 0;
    for (const mo of out.months) { const c = mo.capacity[key]; if (c) capacityVisits += c.visitsCap; }
    const unplanned = {}; let dueSites = 0;
    for (const s of sites) {
      if (!s.inScope || s.poolKey !== key) continue;
      const r = bySite.get(s.id);
      if (!r) continue;
      if (r.candidate) dueSites += 1;
      if (r.main && ids.has(s.id)) unplanned[r.main.code] = (unplanned[r.main.code] || 0) + 1;
    }
    out.pools[key] = {
      key, eligible: n, coveredBefore, coveredExisting, covered, generatedNewSites: covered - coveredExisting,
      share: n ? covered / n : null, target, targetPct: params.coverageTargetPct, meetsTarget: n > 0 && covered >= target, missing,
      generatedVisits: ps.generated, existingVisits: ps.existing, generatedDays: ps.generatedDays, visitsPerDay: perDay,
      personDays, extraPersons, runningMonths, capacityVisits, yearLeftStart: ps.yearLeftStart, dueSites, unplanned, over: Boolean(ps.over),
      requiredYear: p.frequency != null ? n * Math.round(p.frequency) : null,
    };
  }
  out.stats = { ...out.stats, proposals: out.proposals.length,
    tours: new Set(out.proposals.map((x) => `${x.month}|${x.tour}`)).size,
    journees: Object.values(poolState).reduce((a, ps) => a + (ps.generatedDays || 0), 0),
    sitesPlanned: new Set(out.proposals.map((x) => x.siteId)).size };
  return out;
}

module.exports = { generatePlan, costUnits, mainReason, U, POSTPONE_ORDER, WHY, defaultLevelOf };
