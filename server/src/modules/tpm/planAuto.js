/**
 * Planification automatique du suivi SUR UNE PÉRIODE (retours 82, 107, 108) — logique PURE,
 * déterministe, testée, sans I/O.
 *
 * Le plan part des BESOINS du MMR (stratégie « besoins », par défaut) : chaque visite exigée est
 * placée ; la capacité déclarée (faisable du MMR) et les personnes déclarées sont COMPARÉES et
 * signalées, jamais un plafond silencieux. La stratégie « capacite » (« Limiter à la capacité
 * déclarée ») garde le plan dans le faisable du MMR (intervalle ajusté CO adjusted) et dit ce qui
 * n'a pas pu être placé.
 *
 * Ce que MEMS sait déjà n'est jamais redemandé :
 *   - exigence : MMR (visites par site = fréquence, écart minimal = intervalle arrondi au mois
 *     supérieur, sites à suivre par mois = ciblé/mois, PLANCHER de chaque mois) ; un site sans
 *     ligne MMR (ou ligne de durée 0) suit la fréquence RBM de SON risque (élevé 1, moyen 2,
 *     faible 3 mois) ;
 *   - univers : règle commune « site actif au mois M » (siteActivity.isActiveMonth), zones
 *     interdites exclues ; priorité : RBM (urgent, score final, jamais visité, en retard, plus
 *     longue absence) ; TPM : contrat de la zone (retour 58).
 *
 * Zones (retour 108 : « prioriser les mêmes communes sans distinction d'activités ») : un groupe
 * = une COMMUNE de son district (GPS en second, quand la commune manque), TOUTES activités. Chaque
 * mois, une commune est visitée en ENTIER : tous ses sites dont la visite est due et permise
 * (intervalle de CHAQUE activité respecté) partent dans la même tournée. Une tournée est déclenchée
 * par le site le plus exigeant de la commune (plus petit écart), ou par un site dont c'est le
 * dernier mois possible (« échéance ») ; les autres s'y joignent. Les communes sont prises dans
 * l'ordre du RBM ; chaque mois vise au moins la part équilibrée des visites restantes et le
 * plancher ciblé/mois du MMR (manque signalé).
 *
 * Garde-fous : intervalle face à CHAQUE visite existante (prévue ou réalisée, avant ou après) et à
 * la dernière visite effective (exercice précédent compris) ; un mois de visite annulée n'est
 * jamais repris ; jamais un mois échu ; capacités et charges partent des visites existantes ; un
 * 2ᵉ passage n'ajoute rien ; chaque site non couvert a sa raison.
 *
 * Entrée `sites` (planAuto.repository.loadInputsTx) :
 *   { id, district, commune, activity, riskLevel, urgent, finalScore, forbidden, mmrKey,
 *     parametered, required, inScope, lastVisitMonth, visits:[{month,status}], cancelledMonths,
 *     monthStatus:{m:bool}, gpsLat, gpsLng, tpmSegments }
 * `mmrByKey` : { mmrKey: { interval, adjustedInterval, targetedPerMonth, feasible, visitsPerDay,
 *   workingDays, personsToDeploy, … } } ; `months` : numéros 1..12 de `year`, croissants ;
 * `opts` : { yearHasGrid?: boolean (déduit des sites sinon), fromMonth?: 'AAAA-MM' }.
 */
const { frequencyFor, DEFAULT_FREQUENCY } = require('./rbmMath');
const { isActiveMonth } = require('../common/siteActivity');
const { planResources } = require('./planResources');

const RISK_RANK = { elevee: 3, moyenne: 2, faible: 1 };
const REASONS = ['capacity', 'inactive', 'cancelled', 'gap', 'period'];
const STRATEGIES = ['besoins', 'capacite'];
const LIVE = new Set(['planifie', 'realise']);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

/** Clé d'une commune de son district (communes inaccessibles, regroupement). */
const communeKey = (district, commune) => `${norm(district)}|${norm(commune)}`;

const intIn = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
};

function normalizeSettings(s = {}) {
  const seen = new Set(); const excludedCommunes = [];
  for (const c of s.excludedCommunes || []) {
    const district = String((c && c.district) || '').trim(); const commune = String((c && c.commune) || '').trim();
    const k = communeKey(district, commune);
    if (!commune || seen.has(k)) continue;
    seen.add(k); excludedCommunes.push({ district, commune });
  }
  excludedCommunes.sort((a, b) => cmp(communeKey(a.district, a.commune), communeKey(b.district, b.commune)));
  const strategy = STRATEGIES.includes(s.strategy) ? s.strategy : 'besoins';
  return {
    strategy,
    // « Limiter à la capacité déclarée » suit l'intervalle AJUSTÉ du MMR (CO adjusted).
    adjusted: strategy === 'capacite',
    // Renfort : un site signalé urgent par le RBM reçoit une visite au premier mois possible de la
    // période, sans attendre l'intervalle (en plus des visites exigées).
    reinforceUrgent: Boolean(s.reinforceUrgent),
    excludedCommunes,
    // Ressources (retour 108) : agents qui partent ensemble dans un véhicule ; jours de terrain
    // par agent et par mois, utilisés SEULEMENT si le MMR ne donne pas les jours ouvrés.
    agentsPerVehicle: intIn(s.agentsPerVehicle, 1, 10, 4),
    fieldDaysPerMonth: intIn(s.fieldDaysPerMonth, 1, 26, 20),
  };
}

const ym = (year, m) => `${year}-${String(m).padStart(2, '0')}`;
/** Index absolu d'un mois (année × 12 + mois − 1) : écarts entre exercices compris. */
const monthIdx = (year, m) => Number(year) * 12 + (Number(m) - 1);
const idxOf = (v) => {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}/.test(s)) return null;
  const y = Number(s.slice(0, 4)); const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12 ? monthIdx(y, m) : null;
};

/** Reste à planifier d'un site sur la période (MMR : exigées − réalisées − prévues DANS la période). */
function siteRemaining(s, periodStart) {
  const realise = (s.visits || []).filter((v) => v.status === 'realise').map((v) => Number(v.month));
  const planned = (s.visits || []).filter((v) => v.status === 'planifie').map((v) => Number(v.month));
  const plannedInPeriod = planned.filter((m) => m >= periodStart).length;
  const latePlanned = planned.filter((m) => m < periodStart).length;
  const remaining = Math.max(0, (Number(s.required) || 0) - realise.length - plannedInPeriod);
  return { remaining, realise, latePlanned };
}

/**
 * Ancrages de l'intervalle d'un site (index absolus) : chaque visite existante prévue ou
 * réalisée de l'exercice, avant OU après, et la dernière visite effective (visite réalisée,
 * collecte de données ou registre — exercice précédent compris).
 */
function anchorsOf(s, year) {
  const out = new Set();
  for (const v of s.visits || []) if (LIVE.has(v.status)) out.add(monthIdx(year, v.month));
  const last = idxOf(s.lastVisitMonth);
  if (last != null && last <= monthIdx(year, 12)) out.add(last);
  return [...out];
}

/** L'intervalle `step` est-il respecté au mois `m` face à tous les ancrages ? */
const gapOk = (year, m, anchors, step) => {
  const x = monthIdx(year, m);
  return anchors.every((a) => Math.abs(x - a) >= step);
};

/**
 * Nombre MAXIMAL de visites plaçables (au plus `limit`) dans `months` en respectant l'intervalle
 * face aux ancrages et entre elles — glouton au plus tôt, optimal sur une ligne de mois.
 */
function fitCount(year, months, anchors, step, limit = Infinity) {
  const chosen = [...anchors];
  let n = 0;
  for (const m of months) {
    if (n >= limit) break;
    if (gapOk(year, m, chosen, step)) { chosen.push(monthIdx(year, m)); n += 1; }
  }
  return n;
}

/** Premier mois du plan (numéro dans `year`) d'après le mois courant `fromMonth` (AAAA-MM). */
function firstPlannableMonth(year, fromMonth) {
  const f = idxOf(fromMonth);
  if (f == null) return 1;
  const start = monthIdx(year, 1);
  if (f <= start) return 1;
  return Math.min(13, f - start + 1); // 13 = exercice entièrement échu
}

/** Regroupement : la commune dans son district ; GPS en second (commune absente) ; sinon le site seul. */
function clusterKeyOf(s) {
  const d = norm(s.district);
  if (norm(s.commune)) return `${d}|c:${norm(s.commune)}`;
  const lat = Number(s.gpsLat); const lng = Number(s.gpsLng);
  if (s.gpsLat != null && s.gpsLng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${d}|g:${Math.round(lat / 0.1)}:${Math.round(lng / 0.1)}`;
  }
  return `${d}|s:${s.id}`;
}

/** TPM de la zone d'un site au mois `m` (segments du Plan de suivi). */
function tpmAt(s, year, m) {
  const mm = ym(year, m);
  const seg = (s.tpmSegments || []).find((x) => x && x.from <= mm && mm <= x.to);
  const id = seg && seg.providerId ? String(seg.providerId) : null;
  const name = seg && seg.providerName ? String(seg.providerName) : null;
  return { key: id ? `id:${id}` : (name ? `nm:${name}` : 'bureau'), name: name || null, assigned: Boolean(id || name) };
}

/** Plan. @param {number} year année de l'exercice. */
function generatePlan(sites = [], mmrByKey = {}, settings = {}, months = [], year = new Date().getUTCFullYear(), opts = {}) {
  const cfg = normalizeSettings(settings);
  const needsMode = cfg.strategy === 'besoins';
  const requested = [...new Set((months || []).map(Number).filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  // Jamais un mois échu : le plan commence au mois courant (le serveur le dit).
  const firstMonth = firstPlannableMonth(year, opts.fromMonth);
  const period = requested.filter((m) => m >= firstMonth);
  const pastMonths = requested.filter((m) => m < firstMonth);
  const periodSet = new Set(period);
  const periodStart = period[0] || requested[0] || 1;

  // Ordre d'entrée sans effet : sites triés par identifiant.
  const all = (sites || []).filter((s) => s && s.id).sort((a, b) => cmp(String(a.id), String(b.id)));
  // LA règle « actif au mois M » : l'exercice a une grille dès qu'un site a un statut.
  const yearHasGrid = opts.yearHasGrid != null ? Boolean(opts.yearHasGrid)
    : all.some((s) => s.monthStatus && Object.keys(s.monthStatus).length > 0);
  const activeAt = (s, m) => isActiveMonth((s.monthStatus || {})[m] ?? (s.monthStatus || {})[String(m)], yearHasGrid);
  const excluded = new Set(cfg.excludedCommunes.map((c) => communeKey(c.district, c.commune)));
  const groupKeyOf = (s) => (s.parametered && s.mmrKey ? s.mmrKey : `∅rbm:${s.riskLevel || 'moyenne'}`);
  const mmrDrivenSite = (s) => Boolean(s.parametered && s.mmrKey && Number(s.required) > 0);
  const mmrIntervalOf = (c) => (cfg.adjusted && c.adjustedInterval ? c.adjustedInterval : c.interval);
  const stepOf = (s) => {
    if (mmrDrivenSite(s)) {
      const iv = mmrIntervalOf(mmrByKey[s.mmrKey] || {}) || frequencyFor(s.riskLevel, DEFAULT_FREQUENCY);
      return Math.max(1, Math.ceil(iv)); // arrondi au supérieur : l'intervalle minimal n'est jamais réduit (4,5 → 5)
    }
    return Math.max(1, Math.ceil(frequencyFor(s.riskLevel, DEFAULT_FREQUENCY)));
  };

  // ---- Univers ----------------------------------------------------------------------------
  const considered = all.filter((s) => s.inScope !== false);
  const forbidden = considered.filter((s) => s.forbidden);
  // Un site SANS activité ET sans paramètre MMR n'est pas planifié (retour 82).
  const noActivity = considered.filter((s) => !s.forbidden && !s.activity && !s.parametered);
  const withActivity = considered.filter((s) => !s.forbidden && (s.activity || s.parametered));
  // Communes inaccessibles (option S&E) : sites non planifiés, comptés à part.
  const access = withActivity.filter((s) => excluded.has(communeKey(s.district, s.commune)));
  const candidates = withActivity.filter((s) => !excluded.has(communeKey(s.district, s.commune)));
  // Un site inactif TOUS les mois de la période n'a rien à couvrir (compté à part).
  const inactiveAll = candidates.filter((s) => !period.some((m) => activeAt(s, m)));
  const inactiveIds = new Set(inactiveAll.map((s) => s.id));
  const plannable = candidates.filter((s) => !inactiveIds.has(s.id));

  // ---- Charges existantes (tous sites : ils consomment les mêmes moyens) ---------------------
  const kM = (k, m) => `${k}|${m}`;
  const perMonth = new Map(period.map((m) => [m, 0]));        // visites NOUVELLES par mois
  const existingMonth = new Map(period.map((m) => [m, 0]));   // existantes (prévues ou réalisées)
  const keyLoad = new Map();                                  // clé × mois → existantes + nouvelles
  const keyExisting = new Map();                              // clé × mois → existantes
  const keyNew = new Map();                                   // clé × mois → nouvelles
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  for (const s of all) {
    for (const v of s.visits || []) {
      const m = Number(v.month);
      if (!LIVE.has(v.status) || !periodSet.has(m)) continue;
      bump(existingMonth, m);
      bump(keyLoad, kM(groupKeyOf(s), m)); bump(keyExisting, kM(groupKeyOf(s), m));
    }
  }
  const capOf = (key) => {
    const c = mmrByKey[key];
    const lim = c && c.feasible != null ? Number(c.feasible) : null;
    return lim != null && Number.isFinite(lim) ? Math.max(0, Math.floor(lim)) : null;
  };
  const floorOf = (key) => {
    const c = mmrByKey[key];
    const t = c && c.targetedPerMonth != null ? Number(c.targetedPerMonth) : null;
    return t != null && t > 0 ? Math.ceil(t) : null;
  };

  // ---- État de chaque site planifiable --------------------------------------------------------
  const states = new Map();
  let latePlannedTotal = 0; let mmrDriven = 0; let rbmFallback = 0;
  for (const s of plannable) {
    const driven = mmrDrivenSite(s);
    const step = stepOf(s);
    const { remaining, latePlanned } = siteRemaining(s, periodStart);
    latePlannedTotal += latePlanned;
    const anchors = anchorsOf(s, year);
    // Mois occupés : une visite existante (prévue/réalisée) ou ANNULÉE (une décision).
    const visitBusy = new Set((s.visits || []).map((v) => Number(v.month)));
    const cancelled = new Set([...(s.cancelledMonths || []).map(Number),
      ...(s.visits || []).filter((v) => v.status === 'annule').map((v) => Number(v.month))]);
    const allowed = period.filter((m) => !visitBusy.has(m) && !cancelled.has(m) && activeAt(s, m));
    const liveInPeriod = (s.visits || []).filter((v) => LIVE.has(v.status) && periodSet.has(Number(v.month))).map((v) => Number(v.month));
    // Besoin sur la période : MMR = visites restantes exigées ; RBM = les visites que sa fréquence
    // appelle dans ses mois actifs (aucune si sa dernière visite est trop récente).
    let needed;
    if (driven) { needed = remaining; if (remaining > 0) mmrDriven += 1; } else {
      needed = fitCount(year, allowed, anchors, step);
      rbmFallback += 1;
    }
    const last = idxOf(s.lastVisitMonth);
    states.set(s.id, {
      s, driven, step, gKey: groupKeyOf(s), cluster: clusterKeyOf(s), anchors: [...anchors], baseAnchors: anchors,
      allowed, allowedSet: new Set(allowed), visitBusy, cancelled, needed, needLeft: needed, placed: 0, placedMonths: [],
      capBlocked: false, hasVisitInPeriod: liveInPeriod.length > 0, last,
      urgent: Boolean(s.urgent), finalScore: Number(s.finalScore) || 0,
      // Renfort : seulement si aucune visite existante de la période ne tombe avant ou au 1er mois possible.
      renfortPending: Boolean(cfg.reinforceUrgent && s.urgent && allowed.length && !liveInPeriod.some((m) => m <= allowed[0])),
      renfort: 0,
    });
  }

  // ---- Placement mois par mois, par commune entière ---------------------------------------
  const clusters = new Map();
  for (const st of states.values()) {
    if (!clusters.has(st.cluster)) clusters.set(st.cluster, []);
    clusters.get(st.cluster).push(st);
  }
  const clusterKeys = [...clusters.keys()].sort();
  const assignments = [];
  const absence = (st, m) => (st.last == null ? Infinity : monthIdx(year, m) - st.last);
  const neverVisited = (st) => st.last == null && !st.baseAnchors.length;
  const eligible = (st, m) => st.needLeft > 0 && st.allowedSet.has(m) && !st.placedMonths.includes(m) && gapOk(year, m, st.anchors, st.step);
  const firstPassage = (x) => x.el && !x.st.hasVisitInPeriod && x.st.placedMonths.length === 0;
  const fitFrom = (st, m, strict) => fitCount(year, st.allowed.filter((x) => (strict ? x > m : x >= m) && !st.placedMonths.includes(x)), st.anchors, st.step, st.needLeft);

  for (const m of period) {
    const monthsLeft = period.filter((x) => x >= m).length;
    // Part équilibrée par activité : ⌈visites restantes plaçables ÷ mois restants⌉, au moins le
    // plancher ciblé/mois du MMR (moins les visites existantes du mois).
    const placeable = new Map();
    for (const st of states.values()) {
      if (st.needLeft <= 0) continue;
      const f = fitFrom(st, m, false);
      if (f > 0) placeable.set(st.gKey, (placeable.get(st.gKey) || 0) + Math.min(st.needLeft, f));
    }
    // La charge TOTALE (visites existantes des mois restants comprises) est étalée : un mois déjà
    // chargé par des visites prévues reçoit d'autant moins de nouvelles visites.
    const target = new Map();
    for (const [key, n] of placeable) {
      const existingLeft = period.filter((x) => x >= m).reduce((a, x) => a + (keyExisting.get(kM(key, x)) || 0), 0);
      const here = keyExisting.get(kM(key, m)) || 0;
      const share = Math.max(0, Math.ceil((n + existingLeft) / monthsLeft) - here);
      const fl = floorOf(key);
      target.set(key, Math.max(share, fl != null ? fl - here : 0));
    }
    const generated = new Map();

    // Communes candidates : un site « déclencheur » (échéance, plus petit écart de la commune, renfort).
    const cands = [];
    for (const ck of clusterKeys) {
      const list = clusters.get(ck);
      const needing = list.filter((st) => st.needLeft > 0 && fitFrom(st, m, false) > 0);
      const leadStep = needing.length ? Math.min(...needing.map((st) => st.step)) : null;
      const info = list.map((st) => {
        const el = eligible(st, m);
        const must = el && fitFrom(st, m, true) < st.needLeft;
        const ren = st.renfortPending && st.allowedSet.has(m) && !st.placedMonths.includes(m);
        return { st, el, must, ren, trigger: (el && (must || st.step === leadStep)) || ren };
      }).filter((x) => x.el || x.ren);
      if (!info.some((x) => x.trigger)) continue;
      const anyMust = info.some((x) => x.must);
      const anyRen = info.some((x) => x.ren);
      const urgent = info.some((x) => x.st.urgent);
      const score = Math.max(...info.map((x) => x.st.finalScore));
      const never = info.some((x) => neverVisited(x.st));
      const overdue = info.some((x) => absence(x.st, m) >= x.st.step);
      const abs = Math.max(...info.map((x) => absence(x.st, m)));
      // Capacité déclarée : un 1er passage (site sans visite dans la période) passe avant une visite
      // répétée — la capacité couvre d'abord un maximum de sites.
      const first = info.some((x) => firstPassage(x));
      const rbm = [Number(anyMust), Number(anyRen), Number(urgent), score, Number(never), Number(overdue), abs];
      cands.push({ ck, info, key: needsMode ? rbm : [Number(first), ...rbm] });
    }
    // Ordre du RBM : échéance, renfort, urgent, score final, jamais visité, en retard, plus longue absence.
    cands.sort((a, b) => {
      for (let i = 0; i < a.key.length; i += 1) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
      return cmp(a.ck, b.ck);
    });
    const sitePriority = (x) => [needsMode ? 0 : Number(firstPassage(x)), Number(x.must), Number(x.ren), Number(x.st.urgent), x.st.finalScore, Number(neverVisited(x.st)), absence(x.st, m), RISK_RANK[x.st.s.riskLevel] || 0];
    for (const c of cands) {
      const wanted = c.info.some((x) => x.trigger && (x.must || x.ren || (generated.get(x.st.gKey) || 0) < (target.get(x.st.gKey) || 0)));
      if (!wanted) continue;
      let take = c.info;
      if (!needsMode) {
        // Capacité déclarée : la commune entière si elle tient ; sinon ses sites par priorité du RBM
        // tant que l'activité a de la place (les autres attendent, raison « capacité »).
        const room = new Map();
        const roomOf = (key) => { const cap = capOf(key); return cap == null ? Infinity : cap - (keyLoad.get(kM(key, m)) || 0); };
        for (const x of c.info) if (!room.has(x.st.gKey)) room.set(x.st.gKey, roomOf(x.st.gKey));
        const need = new Map();
        for (const x of c.info) need.set(x.st.gKey, (need.get(x.st.gKey) || 0) + 1);
        if (![...need].every(([k, n]) => n <= room.get(k))) {
          const ordered = [...c.info].sort((a, b) => {
            const pa = sitePriority(a); const pb = sitePriority(b);
            for (let i = 0; i < pa.length; i += 1) if (pa[i] !== pb[i]) return pb[i] - pa[i];
            return cmp(String(a.st.s.id), String(b.st.s.id));
          });
          take = [];
          for (const x of ordered) {
            if (room.get(x.st.gKey) > 0) { take.push(x); room.set(x.st.gKey, room.get(x.st.gKey) - 1); } else x.st.capBlocked = true;
          }
          if (!take.some((x) => x.trigger)) { for (const x of take) x.st.capBlocked = true; continue; }
        }
      }
      for (const x of take) {
        const st = x.st;
        const regular = eligible(st, m);
        if (!regular && !x.ren) continue;
        st.placedMonths.push(m); st.placed += regular ? 1 : 0;
        if (regular) { st.needLeft -= 1; st.anchors.push(monthIdx(year, m)); } else st.renfort += 1;
        st.renfortPending = false;
        bump(perMonth, m); bump(keyLoad, kM(st.gKey, m)); bump(keyNew, kM(st.gKey, m)); bump(generated, st.gKey);
        const tp = tpmAt(st.s, year, m);
        assignments.push({
          siteId: st.s.id, month: ym(year, m), monthNum: m, activity: st.s.activity || null, riskLevel: st.s.riskLevel || null,
          source: regular ? (st.driven ? 'mmr' : 'rbm') : 'renfort', tpm: tp.name, district: st.s.district || null, commune: st.s.commune || null,
        });
      }
    }
  }

  // ---- Couverture et raisons -----------------------------------------------------------------
  // Un site est COUVERT s'il a une visite dans la période (existante ou nouvelle) ou si rien ne lui
  // est dû ; sinon, sa raison : la capacité a bloqué un mois possible, ses mois sont inactifs ou
  // annulés, l'intervalle face à ses visites l'empêche, ou la période est trop courte.
  const reasonOf = (st) => {
    if (st.capBlocked) return 'capacity';
    const limit = st.needed;
    const free = period.filter((m) => !st.visitBusy.has(m));
    const withAllowed = fitCount(year, st.allowed, st.baseAnchors, st.step, limit);
    const withoutInactive = fitCount(year, free.filter((m) => !st.cancelled.has(m)), st.baseAnchors, st.step, limit);
    if (withoutInactive > withAllowed) return 'inactive';
    const withoutCancelled = fitCount(year, free, st.baseAnchors, st.step, limit);
    if (withoutCancelled > withoutInactive) return 'cancelled';
    const withoutAnchors = fitCount(year, free, [], st.step, limit);
    if (withoutAnchors > withoutCancelled) return 'gap';
    return withAllowed > st.placed ? 'capacity' : 'period';
  };
  const uncoveredByReason = Object.fromEntries(REASONS.map((r) => [r, 0]));
  const unplacedByReason = Object.fromEntries(REASONS.map((r) => [r, 0]));
  const uncovered = [];
  let covered = 0; let unplaced = 0; let renfortTotal = 0;
  // Sites couverts par leurs seules visites existantes (prévues ou réalisées) : conservés, rien
  // n'est ajouté (retour 82 : re-générer sur un plan appliqué n'affiche jamais 0 %).
  let alreadyCovered = 0;
  for (const s of plannable) {
    const st = states.get(s.id);
    renfortTotal += st.renfort;
    const short = Math.max(0, st.needed - st.placed);
    const isCovered = st.hasVisitInPeriod || st.placedMonths.length > 0 || st.needed === 0;
    if (short > 0) {
      const reason = reasonOf(st);
      unplaced += short; unplacedByReason[reason] += short;
      if (!isCovered) { uncoveredByReason[reason] += 1; uncovered.push({ siteId: s.id, reason, needed: st.needed, placed: st.placed }); }
    }
    if (isCovered) covered += 1;
    if (st.hasVisitInPeriod && st.placedMonths.length === 0) alreadyCovered += 1;
  }

  // ---- Ressources nécessaires (planResources : une seule règle d'agents et de véhicules) ------
  const toDo = [];
  const pushVisit = (s, m, isNew) => {
    const key = groupKeyOf(s); const c = mmrByKey[key] || {}; const tp = tpmAt(s, year, m);
    toDo.push({
      siteId: s.id, month: ym(year, m), unitKey: tp.key, unitName: tp.name, assigned: tp.assigned,
      district: s.district || null, commune: s.commune || null, activityKey: key,
      visitsPerDay: c.visitsPerDay, workingDays: c.workingDays, isNew,
    });
  };
  for (const s of all) for (const v of s.visits || []) if (v.status === 'planifie' && periodSet.has(Number(v.month))) pushVisit(s, Number(v.month), false);
  const byId = new Map(all.map((s) => [s.id, s]));
  for (const a of assignments) pushVisit(byId.get(a.siteId), a.monthNum, true);
  const declared = {};
  for (const [k, c] of Object.entries(mmrByKey)) if (Number(c.personsToDeploy) > 0) declared[k] = Number(c.personsToDeploy);
  const resources = planResources(toDo, { agentsPerVehicle: cfg.agentsPerVehicle, fieldDaysPerMonth: cfg.fieldDaysPerMonth, declared });

  // ---- Par activité (ligne MMR, ou repli RBM par risque) -------------------------------------
  const groups = new Map();
  for (const st of states.values()) {
    if (!groups.has(st.gKey)) groups.set(st.gKey, []);
    groups.get(st.gKey).push(st);
  }
  const byActivity = [...groups.keys()].sort().map((gKey) => {
    const list = groups.get(gKey);
    const g = list[0].s;
    const parametered = Boolean(g.parametered && g.mmrKey);
    const c = parametered ? (mmrByKey[gKey] || {}) : {};
    const mmrConfigured = parametered && list.some((st) => st.driven);
    const activities = [...new Set(list.map((st) => st.s.activity).filter(Boolean))];
    const steps = [...new Set(list.map((st) => st.step))].sort((a, b) => a - b);
    const interval = mmrConfigured ? (mmrIntervalOf(c) || frequencyFor(g.riskLevel, DEFAULT_FREQUENCY)) : (steps.length === 1 ? steps[0] : null);
    const feasible = capOf(gKey); const floor = floorOf(gKey);
    const months2 = period.map((m) => {
      const existing = keyExisting.get(kM(gKey, m)) || 0; const planned = keyNew.get(kM(gKey, m)) || 0;
      const total = existing + planned;
      return {
        month: ym(year, m), existing, planned, total,
        overCapacity: feasible != null && total > feasible,
        belowTarget: floor != null && total < floor,
      };
    });
    const act = resources.activities[gKey] || { agentDays: {} };
    const wd = Number(c.workingDays) > 0 ? Number(c.workingDays) : cfg.fieldDaysPerMonth;
    const agentMonths = period.map((m) => ({ month: ym(year, m), agentDays: act.agentDays[ym(year, m)] || 0, agents: Math.ceil((act.agentDays[ym(year, m)] || 0) / wd) }));
    const agentsPeak = agentMonths.reduce((a, x) => Math.max(a, x.agents), 0);
    return {
      key: gKey,
      activity: c.activity || (activities.length === 1 ? activities[0] : (activities[0] || null)),
      fieldOffice: parametered ? (c.fieldOffice || null) : null,  // null = plan général (tous bureaux)
      mixedActivities: activities.length > 1,
      parametered,
      riskLevel: g.riskLevel || null,
      mmr: parametered ? {
        operationDuration: c.operationDuration ?? null,
        numberOfSites: c.numberOfSites ?? null,
        frequency: c.frequency ?? null,
        interval: c.interval ?? null,
        adjustedInterval: c.adjustedInterval ?? null,
        targetedPerMonth: c.targetedPerMonth ?? null,
        feasible: c.feasible ?? null,
        visitsPerDay: c.visitsPerDay ?? null,
        workingDays: c.workingDays ?? null,
        personsToDeploy: c.personsToDeploy ?? null,
      } : null,
      intervalUsed: interval == null ? null : Math.round(interval * 100) / 100,
      stepUsed: mmrConfigured ? Math.max(1, Math.ceil(interval)) : (steps.length === 1 ? steps[0] : null),
      stepsUsed: steps,               // repli RBM : un pas par niveau de risque des sites
      sites: list.length,
      planned: months2.reduce((a, x) => a + x.planned, 0),
      covered: list.filter((st) => st.hasVisitInPeriod || st.placedMonths.length > 0 || st.needed === 0).length,
      perMonth: months2,
      monthsOverCapacity: months2.filter((x) => x.overCapacity).length,
      monthsBelowTarget: months2.filter((x) => x.belowTarget).length,
      staffing: {
        visitsPerDay: Number(c.visitsPerDay) || null,
        workingDays: Number(c.workingDays) || null,
        workingDaysUsed: wd,
        personsToDeployMmr: Number(c.personsToDeploy) || null,
        agentsPeak: agentMonths.some((x) => x.agentDays > 0) ? agentsPeak : null,
        agentMonths,
      },
    };
  });
  byActivity.sort((a, b) => Number(b.parametered) - Number(a.parametered)
    || String(a.activity || '').localeCompare(String(b.activity || ''), 'fr')
    || String(a.fieldOffice || '').localeCompare(String(b.fieldOffice || ''), 'fr')
    || (b.planned - a.planned));

  // ---- Par unité (TPM de la zone, ou bureau) : charge et ressources --------------------------
  const sitesByUnit = new Map();
  for (const a of assignments) {
    const k = tpmAt(byId.get(a.siteId), year, a.monthNum).key;
    if (!sitesByUnit.has(k)) sitesByUnit.set(k, new Set());
    sitesByUnit.get(k).add(a.siteId);
  }
  const byTpm = resources.units.map((u) => ({
    unitKey: u.unitKey, tpm: u.name, assigned: u.assigned,
    sites: (sitesByUnit.get(u.unitKey) || new Set()).size,
    planned: u.newVisits, visits: u.visits, agentDays: u.agentDays,
    perMonth: period.map((m) => {
      const r = u.months.find((x) => x.month === ym(year, m));
      return {
        month: ym(year, m), count: r ? r.newVisits : 0, visits: r ? r.visits : 0, agentDays: r ? r.agentDays : 0,
        agents: r ? r.agentsNeeded : 0, vehiclesPeak: r ? r.vehiclesPeak : 0, vehiclesAvg: r ? r.vehiclesAvg : 0,
        workingDays: r ? r.workingDays : null, workingDaysSource: r ? r.workingDaysSource : null,
      };
    }),
    agentsPeak: u.agentsPeak, agentsAvg: u.agentsAvg, vehiclesPeak: u.vehiclesPeak,
    workingDaysSource: u.workingDaysSource,
  }));

  // Activités planifiées dont les suivis/jour ne sont pas renseignés (1 visite par journée comptée).
  const activitiesNeedingQuota = byActivity.filter((a) => a.planned > 0 && !a.staffing.visitsPerDay).length;
  const peakMonth = resources.months.find((x) => x.month === resources.peak.agentsMonth) || null;

  assignments.sort((a, b) => a.monthNum - b.monthNum
    || (RISK_RANK[b.riskLevel] || 0) - (RISK_RANK[a.riskLevel] || 0)
    || cmp(String(a.siteId), String(b.siteId)));

  return {
    settings: cfg,
    year,
    months: period,
    yearHasGrid,
    // Mois demandés mais échus : jamais planifiés (le plan commence au mois courant).
    pastMonths: pastMonths.map((m) => ym(year, m)),
    assignments: assignments.map(({ monthNum: _m, ...a }) => a),
    uncovered,
    byActivity,
    byTpm,
    resources: {
      agentsPerVehicle: resources.agentsPerVehicle, fieldDaysPerMonth: resources.fieldDaysPerMonth,
      months: resources.months, peak: resources.peak, visitsWithoutRate: resources.visitsWithoutRate,
    },
    slots: resources.slots,
    perMonth: period.map((m) => ({ month: ym(year, m), count: perMonth.get(m) || 0, existing: existingMonth.get(m) || 0 })),
    summary: {
      strategy: cfg.strategy,
      sitesConsidered: considered.length,
      forbidden: forbidden.length,
      noActivity: noActivity.length,     // sites non planifiés faute d'activité
      access: access.length,             // sites des communes inaccessibles (option)
      inactive: inactiveAll.length,      // sites inactifs tous les mois de la période
      planned: assignments.length,
      renfort: renfortTotal,
      sitesCovered: covered,
      sitesUncovered: plannable.length - covered,
      sitesActivePlannable: plannable.length,
      mmrDriven,
      rbmFallback,
      alreadyCovered,                  // sites déjà couverts par des visites existantes (non re-planifiés)
      latePlanned: latePlannedTotal,
      unplaced,
      unplacedByReason,
      uncoveredByReason,
      existingInPeriod: [...existingMonth.values()].reduce((a, b) => a + b, 0),
      pastMonths: pastMonths.length,
      coverageRate: plannable.length ? Math.round((covered / plannable.length) * 1000) / 10 : null,
      // Capacité déclarée (faisable du MMR) et plancher ciblé/mois : comparés, jamais un plafond
      // silencieux (stratégie « besoins »).
      monthsOverCapacity: byActivity.reduce((a, x) => a + x.monthsOverCapacity, 0),
      monthsBelowTarget: byActivity.reduce((a, x) => a + x.monthsBelowTarget, 0),
      // Ressources nécessaires (planResources).
      agentsTotalPeak: resources.peak.agents,
      agentsPeakMonth: resources.peak.agentsMonth,
      agentsAvg: resources.peak.agentsAvg,
      agentsDeclared: peakMonth ? peakMonth.declared : null,
      agentsGap: peakMonth ? peakMonth.gap : null,
      vehiclesPeak: resources.peak.vehicles,
      vehiclesPeakMonth: resources.peak.vehiclesMonth,
      agentsTotalKnown: activitiesNeedingQuota === 0 && byTpm.every((t) => t.workingDaysSource !== 'parametre'),
      activitiesNeedingQuota,
    },
  };
}

module.exports = {
  generatePlan, normalizeSettings, siteRemaining, anchorsOf, fitCount, firstPlannableMonth, monthIdx, clusterKeyOf,
  communeKey, tpmAt, REASONS, STRATEGIES, DEFAULT_SETTINGS: normalizeSettings(),
};
