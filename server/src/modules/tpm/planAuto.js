/**
 * Planification automatique du suivi SUR UNE PÉRIODE (retour n° 82) — logique
 * PURE, testée, sans I/O. Plan RÉALISTE, fidèle au MMR et au RBM.
 *
 * Objectif : un plan FAISABLE, pas des pics impossibles. Par activité (ligne MMR) :
 *   - chaque site est visité `fréquence` fois (MMR), espacées de l'INTERVALLE MMR
 *     (durée/risque, ou l'intervalle « ajusté » CO adjusted) ; sites sans MMR (ou ligne
 *     MMR de durée 0) = fréquence RBM selon le risque DU SITE (configurable) ;
 *   - les sites sont REGROUPÉS PAR COMMUNE (tournées) : une commune est suivie le
 *     même mois ; les communes sont réparties en « phases » sur l'intervalle pour
 *     ÉTALER la charge (≈ ciblé/mois), au lieu de tout mettre le même mois ;
 *   - le nombre de visites par mois et par activité est borné par la CAPACITÉ
 *     mensuelle du MMR (faisable = personnes × suivis/jour × jours ouvrés), avec
 *     un DÉBORDEMENT autorisé configurable (%) ; le surplus glisse au mois voisin.
 *
 * Garde-fous (P1, revue du 16/10) :
 *   - « site actif au mois M » = LA règle commune (siteActivity.isActiveMonth) : l'exercice a
 *     une grille → seul un « Oui » explicite est planifiable ; une case vide ne l'est pas ;
 *   - l'intervalle est respecté face à CHAQUE visite existante (prévue ou réalisée, avant ou
 *     après) et à la dernière visite effective (visite, données ou registre, exercice précédent
 *     compris — rbmMath.visitState) ; un mois d'une visite ANNULÉE n'est jamais repris ;
 *   - les capacités (MMR, globale, par TPM) partent des visites DÉJÀ prévues ou réalisées du
 *     mois : un deuxième passage n'ajoute rien de plus qu'un plan unique ;
 *   - jamais un mois échu (`opts.fromMonth`, le mois courant, donné par le serveur) ;
 *   - un site est « couvert » s'il a une visite dans la période ou si rien ne lui est dû ;
 *     chaque site non couvert porte sa VRAIE raison (capacité, intervalle, inactif, annulée,
 *     période).
 *
 * Entrée `sites` (sortie de planBoard, enrichie) :
 *   { id, commune, activity, riskLevel, forbidden, mmrKey, parametered, required, inScope,
 *     lastVisitMonth, visits:[{month,status}], cancelledMonths:[m], monthStatus:{m:bool} }
 * `mmrByKey` : { mmrKey: { interval, adjustedInterval, targetedPerMonth, feasible } }
 * `months` : mois de la période (numéros 1..12 de `year`), croissants.
 * `opts` : { yearHasGrid?: boolean (déduit des sites sinon), fromMonth?: 'AAAA-MM' }.
 */
const { frequencyFor, DEFAULT_FREQUENCY } = require('./rbmMath');
const { isActiveMonth } = require('../common/siteActivity');

const RISK_RANK = { elevee: 3, moyenne: 2, faible: 1 };
const REASONS = ['capacity', 'inactive', 'cancelled', 'gap', 'period'];

function normalizeSettings(s = {}) {
  const f = s.frequency || {};
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  const cap = s.capacityPerMonth;
  const tcap = s.tpmCapacityPerMonth;
  const ov = Number(s.overflowPct);
  const grid = Number(s.gpsGridDeg);
  return {
    frequency: {
      elevee: n(f.elevee, DEFAULT_FREQUENCY.elevee),
      moyenne: n(f.moyenne, DEFAULT_FREQUENCY.moyenne),
      faible: n(f.faible, DEFAULT_FREQUENCY.faible),
    },
    capacityPerMonth: cap == null || cap === '' || !(Number(cap) > 0) ? null : Math.floor(Number(cap)),
    overflowPct: Number.isFinite(ov) && ov >= 0 ? Math.min(100, ov) : 0,
    excludeMonths: [...new Set((s.excludeMonths || []).map((m) => Number(String(m).slice(5, 7)) || Number(m)).filter((m) => m >= 1 && m <= 12))],
    useMmrCapacity: s.useMmrCapacity !== false,
    adjusted: Boolean(s.adjusted),
    groupByCommune: s.groupByCommune !== false,
    // Regroupement « au plus proche » : GPS quand il existe, sinon commune (retour 82).
    useGps: s.useGps !== false,
    gpsGridDeg: Number.isFinite(grid) && grid > 0 ? grid : 0.1,   // ~11 km par cellule
    // Couvrir CHAQUE site au moins une fois, même si la capacité mensuelle est dépassée (retour 82) :
    // le 1er passage est forcé, les visites suivantes respectent la capacité.
    coverAllOnce: Boolean(s.coverAllOnce),
    // Affectation TPM : équilibrer la charge mensuelle par TPM pour que tous soient utilisés.
    balanceByTpm: s.balanceByTpm !== false,
    tpmCapacityPerMonth: tcap == null || tcap === '' || !(Number(tcap) > 0) ? null : Math.floor(Number(tcap)),
    targetCoverage: Number.isFinite(Number(s.targetCoverage)) ? Math.min(1, Math.max(0, Number(s.targetCoverage))) : 0.8,
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
const LIVE = new Set(['planifie', 'realise']);

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

/** Plan réaliste. @param {number} year année de l'exercice. */
function generatePlan(sites = [], mmrByKey = {}, settings = {}, months = [], year = new Date().getUTCFullYear(), opts = {}) {
  const cfg = normalizeSettings(settings);
  const requested = [...new Set((months || []).map(Number).filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  // Jamais un mois échu : le plan commence au mois courant (le serveur le dit).
  const firstMonth = firstPlannableMonth(year, opts.fromMonth);
  const period = requested.filter((m) => m >= firstMonth);
  const pastMonths = requested.filter((m) => m < firstMonth);
  const excluded = new Set(cfg.excludeMonths);
  const periodOpen = period.filter((m) => !excluded.has(m));
  const periodSet = new Set(period);
  const periodStart = period[0] || requested[0] || 1;

  // Ordre d'entrée sans effet : sites triés par identifiant.
  const all = (sites || []).filter((s) => s && s.id).sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  // LA règle « actif au mois M » : l'exercice a une grille dès qu'un site a un statut.
  const yearHasGrid = opts.yearHasGrid != null ? Boolean(opts.yearHasGrid)
    : all.some((s) => s.monthStatus && Object.keys(s.monthStatus).length > 0);
  const activeAt = (s, m) => isActiveMonth((s.monthStatus || {})[m] ?? (s.monthStatus || {})[String(m)], yearHasGrid);

  const perMonth = new Map(period.map((m) => [m, 0]));        // visites NOUVELLES par mois
  const loadMonth = new Map(period.map((m) => [m, 0]));       // existantes + nouvelles (capacité)
  const existingMonth = new Map(period.map((m) => [m, 0]));   // existantes (prévues ou réalisées)
  const perKeyMonth = new Map();
  const kM = (k, m) => `${k || '∅'}|${m}`;
  const groupKeyOf = (s) => (s.parametered && s.mmrKey ? s.mmrKey : `∅rbm:${s.riskLevel || 'moyenne'}`);

  const considered = all.filter((s) => s.inScope !== false);
  const forbidden = considered.filter((s) => s.forbidden);
  // Un site SANS activité ET sans paramètre MMR n'est pas planifié (retour 82 : « inutile de
  // le planifier »). Un site paramétré (ligne MMR) a une activité par construction.
  const noActivity = considered.filter((s) => !s.forbidden && !s.activity && !s.parametered);
  const candidates = considered.filter((s) => !s.forbidden && (s.activity || s.parametered));
  // Un site inactif TOUS les mois de la période n'a rien à couvrir (compté à part).
  const inactiveAll = candidates.filter((s) => !period.some((m) => activeAt(s, m)));
  const inactiveIds = new Set(inactiveAll.map((s) => s.id));
  const plannable = candidates.filter((s) => !inactiveIds.has(s.id));

  const globalCap = cfg.capacityPerMonth;
  const monthlyKeyCap = (key) => {
    if (!cfg.useMmrCapacity || !key) return Infinity;
    const c = mmrByKey[key];
    const lim = c && (c.feasible != null ? c.feasible : c.targetedPerMonth);
    if (lim == null) return Infinity;
    return Math.max(1, Math.round(lim * (1 + cfg.overflowPct / 100)));
  };
  const hasRoom = (key, m) => (loadMonth.get(m) || 0) < (globalCap == null ? Infinity : globalCap)
    && (perKeyMonth.get(kM(key, m)) || 0) < monthlyKeyCap(key);

  // --- Affectation TPM : charge mensuelle par TPM (contrat de suivi de la zone) ---
  // Chaque site porte ses segments de TPM par mois (tpmSegments = [{from,to,providerId,providerName}]).
  // On équilibre la charge de chaque TPM sur la période (tous les moyens utilisés) et on
  // respecte un plafond mensuel par TPM facultatif.
  const perTpmMonth = new Map();     // `${tpmKey}|${m}` → nb de visites (existantes + nouvelles)
  const byTpmMap = new Map();        // tpmKey → { name, sites:Set, planned, perMonth:Map }
  const tpmCap = cfg.tpmCapacityPerMonth;
  const tpmAt = (s, m) => {
    const mm = ym(year, m);
    const seg = (s.tpmSegments || []).find((x) => x && x.from <= mm && mm <= x.to);
    const id = seg && seg.providerId ? String(seg.providerId) : null;
    const name = seg && seg.providerName ? String(seg.providerName) : null;
    const key = id ? `id:${id}` : (name ? `nm:${name}` : 'non_affecte');
    return { key, name: name || null, assigned: Boolean(id || name) };
  };
  const tpmRoom = (tpmKey, m) => tpmCap == null || (perTpmMonth.get(`${tpmKey}|${m}`) || 0) < tpmCap;
  const bumpTpmLoad = (key, m) => perTpmMonth.set(`${key}|${m}`, (perTpmMonth.get(`${key}|${m}`) || 0) + 1);
  const bumpTpm = (s, m) => {
    const t = tpmAt(s, m);
    bumpTpmLoad(t.key, m);
    let b = byTpmMap.get(t.key);
    if (!b) { b = { name: t.name, assigned: t.assigned, sites: new Set(), planned: 0, perMonth: new Map() }; byTpmMap.set(t.key, b); }
    b.planned += 1; b.sites.add(s.id); b.perMonth.set(m, (b.perMonth.get(m) || 0) + 1);
  };

  // Les capacités partent des visites DÉJÀ prévues ou réalisées de chaque mois de la période,
  // tous sites confondus (hors périmètre compris : ils consomment les mêmes moyens).
  for (const s of all) {
    for (const v of s.visits || []) {
      const m = Number(v.month);
      if (!LIVE.has(v.status) || !periodSet.has(m)) continue;
      existingMonth.set(m, (existingMonth.get(m) || 0) + 1);
      loadMonth.set(m, (loadMonth.get(m) || 0) + 1);
      perKeyMonth.set(kM(groupKeyOf(s), m), (perKeyMonth.get(kM(groupKeyOf(s), m)) || 0) + 1);
      bumpTpmLoad(tpmAt(s, m).key, m);
    }
  }

  // Clé de regroupement « tournée » : GPS (cellule de grille) quand il existe, sinon commune
  // (retour 82). Sans regroupement, chaque site est sa propre tournée.
  const clusterKeyOf = (s) => {
    if (!cfg.groupByCommune) return `s:${s.id}`;
    if (cfg.useGps && Number.isFinite(Number(s.gpsLat)) && Number.isFinite(Number(s.gpsLng))
      && s.gpsLat !== null && s.gpsLng !== null) {
      return `g:${Math.round(Number(s.gpsLat) / cfg.gpsGridDeg)}:${Math.round(Number(s.gpsLng) / cfg.gpsGridDeg)}`;
    }
    return `c:${s.commune || '∅'}`;
  };

  // Site piloté par le MMR = ligne paramétrée qui EXIGE des visites (fréquence > 0) ; sinon
  // (pas de ligne, ou ligne de durée 0) repli RBM au risque DU SITE.
  const mmrDrivenSite = (s) => Boolean(s.parametered && s.mmrKey && Number(s.required) > 0);
  const mmrIntervalOf = (c) => (cfg.adjusted && c.adjustedInterval ? c.adjustedInterval : c.interval);
  const stepOf = (s) => {
    if (mmrDrivenSite(s)) {
      const iv = mmrIntervalOf(mmrByKey[s.mmrKey] || {}) || frequencyFor(s.riskLevel, cfg.frequency);
      return Math.max(1, Math.ceil(iv)); // arrondi au supérieur : l'intervalle minimal n'est jamais réduit (4,5 → 5)
    }
    return Math.max(1, Math.ceil(frequencyFor(s.riskLevel, cfg.frequency)));
  };

  // Groupe d'activité = ligne MMR (ou, sans MMR, par niveau de risque). Ordre fixe (clé).
  const groups = new Map();
  for (const s of plannable) {
    const key = groupKeyOf(s);
    if (!groups.has(key)) groups.set(key, { parametered: Boolean(s.parametered && s.mmrKey), mmrKey: s.parametered ? s.mmrKey : null, riskLevel: s.riskLevel, sites: [] });
    groups.get(key).sites.push(s);
  }
  const groupKeys = [...groups.keys()].sort();

  const assignments = [];
  const siteResults = new Map();      // id → { needed, placed, hasVisitInPeriod, reason }
  const byActivity = [];
  let mmrDriven = 0; let rbmFallback = 0; let latePlannedTotal = 0;
  const lastOpenG = periodOpen.length ? periodOpen[periodOpen.length - 1] : periodStart;
  // Charge PROJETÉE (estimation du plan complet) pour ÉTALER les départs de tournées pendant la
  // construction, avant le placement réel : sinon toutes les tournées viseraient le même mois.
  const projKeyMonth = new Map();
  const projTpmMonth = new Map();
  // Dimensionnement des agents : visites (existantes + nouvelles) par (unité TPM/bureau × activité
  // × mois) et capacité d'un agent/mois par activité (quota journalier × jours ouvrés du MMR).
  const perUnit = new Map();          // tpmKey → Map(gKey → Map(m → nb de visites))
  const agentCapByKey = new Map();    // gKey → visites/agent/mois (null si quota non renseigné)
  const bumpUnit = (tpmKey, gk, m) => {
    let a = perUnit.get(tpmKey); if (!a) { a = new Map(); perUnit.set(tpmKey, a); }
    let b = a.get(gk); if (!b) { b = new Map(); a.set(gk, b); }
    b.set(m, (b.get(m) || 0) + 1);
  };
  for (const s of all) {
    for (const v of s.visits || []) {
      const m = Number(v.month);
      if (LIVE.has(v.status) && periodSet.has(m)) bumpUnit(tpmAt(s, m).key, groupKeyOf(s), m);
    }
  }

  for (const gKey of groupKeys) {
    const g = groups.get(gKey);
    const c = g.parametered ? (mmrByKey[g.mmrKey] || {}) : {};
    const mmrConfigured = g.parametered && g.sites.some(mmrDrivenSite);
    // Clé d'activité pour la capacité, la répartition et les agents = la clé du groupe (tous les
    // sites d'un groupe la partagent). Cohérente partout : capacité, projection, agents.
    const aKey = gKey;
    // Capacité d'un agent/mois pour cette activité = quota journalier × jours ouvrés (MMR).
    const perAgentPerMonth = (Number(c.visitsPerDay) > 0 && Number(c.workingDays) > 0)
      ? Number(c.visitsPerDay) * Number(c.workingDays) : null;
    if (perAgentPerMonth) agentCapByKey.set(aKey, perAgentPerMonth);
    let gPlanned = 0; const gCovered = new Set();  // compteurs de l'activité (ligne MMR)

    // Tournées : sites regroupés au plus proche (GPS/commune).
    const byCluster = new Map();
    for (const s of g.sites) {
      const k = clusterKeyOf(s);
      if (!byCluster.has(k)) byCluster.set(k, []);
      byCluster.get(k).push(s);
    }
    const clusters = [...byCluster.keys()].sort((a, b) => String(a).localeCompare(String(b), 'fr'));

    // 1) Construire l'état de chaque site (mois de départ de sa tournée, visites à placer).
    const states = [];
    for (const clusterKey of clusters) {
      const clusterSites = byCluster.get(clusterKey);
      // Mois de départ de la tournée : celui qui ÉQUILIBRE le mieux la charge du TPM de la zone
      // (pour utiliser tous les TPM) sur TOUS ses mois de visite, puis l'activité, puis au plus tôt.
      const rep = clusterSites[0];
      const repStep = stepOf(rep);
      let startMonth = periodStart;
      if (periodOpen.length) {
        const spans = clusterSites.map((s) => {
          const req = mmrDrivenSite(s) ? siteRemaining(s, periodStart).remaining : 1;
          return req > 0 ? (req - 1) * stepOf(s) : 0;
        });
        const latestStart = lastOpenG - Math.max(0, ...spans);
        let window = periodOpen.filter((m) => m <= latestStart);
        if (!window.length) window = [periodOpen[0]];
        const maxReq = Math.max(1, ...clusterSites.map((s) => (mmrDrivenSite(s) ? siteRemaining(s, periodStart).remaining : 1)));
        let best = null;
        for (const m of window) {
          // Coût de la tournée = charge PROJETÉE cumulée sur TOUS ses mois de visite (m, m+step, …) :
          // un départ qui remplit des mois encore peu chargés (fin d'année comprise) est préféré.
          let tLoad = 0; let aLoad = 0;
          for (let i = 0; i < maxReq; i += 1) {
            const vm = m + i * repStep;
            if (vm > lastOpenG) break;
            const t = tpmAt(rep, vm);
            if (cfg.balanceByTpm && t.assigned) tLoad += (projTpmMonth.get(`${t.key}|${vm}`) || 0) + (perTpmMonth.get(`${t.key}|${vm}`) || 0);
            aLoad += (projKeyMonth.get(kM(aKey, vm)) || 0) + (perKeyMonth.get(kM(aKey, vm)) || 0);
          }
          const score = [tLoad, aLoad, m];
          if (best === null || score[0] < best.score[0]
            || (score[0] === best.score[0] && (score[1] < best.score[1]
            || (score[1] === best.score[1] && score[2] < best.score[2])))) best = { m, score };
        }
        startMonth = best ? best.m : periodStart;
      }

      for (const s of clusterSites) {
        const driven = mmrDrivenSite(s);
        const step = stepOf(s);
        const { remaining, latePlanned } = siteRemaining(s, periodStart);
        latePlannedTotal += latePlanned;
        const anchors = anchorsOf(s, year);
        // Mois occupés : une visite existante (prévue/réalisée) ou ANNULÉE (une décision).
        const visitBusy = new Set((s.visits || []).map((v) => Number(v.month)));
        const cancelled = new Set([...(s.cancelledMonths || []).map(Number),
          ...(s.visits || []).filter((v) => v.status === 'annule').map((v) => Number(v.month))]);
        const allowed = periodOpen.filter((m) => !visitBusy.has(m) && !cancelled.has(m) && activeAt(s, m));
        const hasVisitInPeriod = (s.visits || []).some((v) => LIVE.has(v.status) && periodSet.has(Number(v.month)));
        // Besoin sur la période : MMR = visites restantes exigées ; RBM = une visite si elle est
        // DUE dans la période (un mois de la période respecte l'intervalle face aux visites).
        let needed;
        if (driven) { needed = remaining; if (remaining > 0) mmrDriven += 1; } else {
          const free = periodOpen.filter((m) => !visitBusy.has(m) && !cancelled.has(m));
          needed = fitCount(year, free, anchors, step, 1);
          rbmFallback += 1;
        }
        const maxCount = driven ? remaining : Infinity; // repli RBM : autant que l'intervalle le permet
        const st = { s, step, anchors, allowed, cancelled, visitBusy, needed, maxCount, nextMin: startMonth, placed: 0, placedMonths: [], capBlocked: false, hasVisitInPeriod };
        siteResults.set(s.id, st);
        if (!maxCount || !allowed.length) continue;
        states.push(st);
        // Projection : réserver l'empreinte estimée de ce site pour étaler les tournées suivantes.
        let vm = startMonth;
        const proj = driven ? remaining : Math.max(1, Math.ceil(allowed.length / step));
        for (let i = 0; i < proj && vm <= lastOpenG; i += 1) {
          projKeyMonth.set(kM(aKey, vm), (projKeyMonth.get(kM(aKey, vm)) || 0) + 1);
          const t = tpmAt(s, vm);
          if (cfg.balanceByTpm && t.assigned) projTpmMonth.set(`${t.key}|${vm}`, (projTpmMonth.get(`${t.key}|${vm}`) || 0) + 1);
          vm += step;
        }
      }
    }

    // 2) Placement EN LARGEUR (couverture d'abord) : à chaque tour, une visite par site —
    //    tous les 1ers passages avant les 2es, etc. → la capacité couvre un MAXIMUM de sites
    //    distincts au lieu d'épuiser les créneaux sur les visites répétées des premiers sites.
    //    Priorité au risque élevé. Chaque visite respecte l'intervalle (face à toutes les visites
    //    existantes et déjà placées) et la capacité ; on cherche d'abord à partir du départ de la
    //    tournée, puis plus tôt dans la période.
    states.sort((a, b) => (RISK_RANK[b.s.riskLevel] || 0) - (RISK_RANK[a.s.riskLevel] || 0)
      || String(a.s.id).localeCompare(String(b.s.id)));
    for (let round = 0; round < 12; round += 1) {
      let any = false;
      for (const st of states) {
        if (st.placed >= st.maxCount) continue;
        // « Couvrir tous les sites au moins une fois » : le 1er passage ignore la capacité (forcé) ;
        // les visites suivantes la respectent toujours.
        const forceOnce = cfg.coverAllOnce && st.placed === 0 && !st.hasVisitInPeriod;
        const order = [...st.allowed.filter((x) => x >= st.nextMin), ...st.allowed.filter((x) => x < st.nextMin)];
        let m = null;
        for (const x of order) {
          if (st.placedMonths.includes(x) || !gapOk(year, x, st.anchors, st.step)) continue;
          if (forceOnce || (hasRoom(aKey, x) && tpmRoom(tpmAt(st.s, x).key, x))) { m = x; break; }
          st.capBlocked = true;
        }
        if (m == null) continue;
        st.placedMonths.push(m); st.anchors.push(monthIdx(year, m)); st.nextMin = m + st.step; st.placed += 1;
        perMonth.set(m, (perMonth.get(m) || 0) + 1);
        loadMonth.set(m, (loadMonth.get(m) || 0) + 1);
        perKeyMonth.set(kM(aKey, m), (perKeyMonth.get(kM(aKey, m)) || 0) + 1);
        bumpTpm(st.s, m);
        const tp = tpmAt(st.s, m);
        bumpUnit(tp.key, aKey, m);
        assignments.push({ siteId: st.s.id, month: ym(year, m), monthNum: m, activity: st.s.activity || null, riskLevel: st.s.riskLevel || null, source: mmrDrivenSite(st.s) ? 'mmr' : 'rbm', tpm: tp.name });
        gCovered.add(st.s.id); gPlanned += 1;
        any = true;
      }
      if (!any) break;
    }
    for (const s of g.sites) if ((siteResults.get(s.id) || {}).hasVisitInPeriod) gCovered.add(s.id);

    // Aperçu par activité (ligne MMR) : paramètres de base + résultat du groupe.
    const activities = [...new Set(g.sites.map((s) => s.activity).filter(Boolean))];
    const steps = [...new Set(g.sites.map(stepOf))].sort((a, b) => a - b);
    const interval = mmrConfigured ? (mmrIntervalOf(c) || frequencyFor(g.riskLevel, cfg.frequency))
      : (steps.length === 1 ? steps[0] : null);
    byActivity.push({
      activity: c.activity || (activities.length === 1 ? activities[0] : (activities[0] || null)),
      fieldOffice: g.parametered ? (c.fieldOffice || null) : null,  // null = plan général (tous bureaux)
      mixedActivities: activities.length > 1,
      parametered: g.parametered,
      riskLevel: g.riskLevel || null,
      mmr: g.parametered ? {
        operationDuration: c.operationDuration ?? null,
        numberOfSites: c.numberOfSites ?? null,
        frequency: c.frequency ?? null,
        interval: c.interval ?? null,
        adjustedInterval: c.adjustedInterval ?? null,
        targetedPerMonth: c.targetedPerMonth ?? null,
        feasible: c.feasible ?? null,
        feasibleOverridden: Boolean(c.feasibleOverridden),
      } : null,
      intervalUsed: interval == null ? null : Math.round(interval * 100) / 100,
      stepUsed: mmrConfigured ? Math.max(1, Math.ceil(interval)) : (steps.length === 1 ? steps[0] : null),
      stepsUsed: steps,               // repli RBM : un pas par niveau de risque des sites
      sites: g.sites.length,
      planned: gPlanned,
      covered: gCovered.size,
      // Dimensionnement des agents pour CETTE activité (quota journalier × jours ouvrés) :
      // agents d'un mois = ⌈visites du mois (existantes + nouvelles) ÷ (quota × jours)⌉ ; le pic
      // est l'effectif à prévoir.
      staffing: (() => {
        const visitsPerDay = Number(c.visitsPerDay) || null;
        const workingDays = Number(c.workingDays) || null;
        const perAgent = perAgentPerMonth; // null si quota/jours non renseignés
        let agentsPeak = null; let agentMonths = null;
        if (perAgent) {
          agentsPeak = 0;
          agentMonths = period.map((m) => {
            const v = perKeyMonth.get(kM(aKey, m)) || 0;
            const agents = Math.ceil(v / perAgent);
            if (agents > agentsPeak) agentsPeak = agents;
            return { month: ym(year, m), agents };
          });
        }
        return {
          visitsPerDay, workingDays, perAgentPerMonth: perAgent,
          personsToDeployMmr: Number(c.personsToDeploy) || null,
          agentsPeak, agentMonths,
        };
      })(),
    });
  }

  byActivity.sort((a, b) => Number(b.parametered) - Number(a.parametered)
    || String(a.activity || '').localeCompare(String(b.activity || ''), 'fr')
    || String(a.fieldOffice || '').localeCompare(String(b.fieldOffice || ''), 'fr')
    || (b.planned - a.planned));

  // Couverture et raisons. Un site est COUVERT s'il a une visite dans la période (existante ou
  // nouvelle) ou si rien ne lui est dû ; sinon, sa raison : la capacité a bloqué un mois possible,
  // ses mois sont inactifs ou annulés, l'intervalle face à ses visites l'empêche, ou la période
  // (mois restants, mois exclus) est trop courte. Les visites non placées ont la même raison.
  const reasonOf = (st) => {
    if (st.capBlocked) return 'capacity';
    const limit = st.needed;
    const free = periodOpen.filter((m) => !st.visitBusy.has(m));
    const baseAnchors = anchorsOf(st.s, year);
    const withAllowed = fitCount(year, st.allowed, baseAnchors, st.step, limit);
    const withoutInactive = fitCount(year, free.filter((m) => !st.cancelled.has(m)), baseAnchors, st.step, limit);
    if (withoutInactive > withAllowed) return 'inactive';
    const withoutCancelled = fitCount(year, free, baseAnchors, st.step, limit);
    if (withoutCancelled > withoutInactive) return 'cancelled';
    const withoutAnchors = fitCount(year, free, [], st.step, limit);
    if (withoutAnchors > withoutCancelled) return 'gap';
    return 'period';
  };
  const uncoveredByReason = Object.fromEntries(REASONS.map((r) => [r, 0]));
  const unplacedByReason = Object.fromEntries(REASONS.map((r) => [r, 0]));
  const uncovered = [];
  let covered = 0; let unplaced = 0;
  for (const s of plannable) {
    const st = siteResults.get(s.id);
    if (!st) continue;
    const short = Math.max(0, (Number.isFinite(st.needed) ? st.needed : 0) - st.placed);
    const isCovered = st.hasVisitInPeriod || st.placed > 0 || st.needed === 0;
    if (short > 0) {
      const reason = reasonOf(st);
      unplaced += short; unplacedByReason[reason] += short;
      if (!isCovered) { uncoveredByReason[reason] += 1; uncovered.push({ siteId: s.id, reason, needed: st.needed, placed: st.placed }); }
    }
    if (isCovered) covered += 1;
  }

  // Répartition par TPM (contrat de suivi de la zone) : charge mensuelle, total et AGENTS.
  // Agents d'une unité un mois = Σ sur ses activités ⌈visites ÷ (quota × jours)⌉ ; le pic est
  // l'effectif à mobiliser. « connu » seulement si toutes ses activités ont un quota renseigné.
  const unitStaffing = (tpmKey) => {
    const acts = perUnit.get(tpmKey);
    if (!acts) return { agentsPeak: null, agentMonths: null, known: true };
    let agentsPeak = 0; let known = true; let hasCap = false;
    const agentMonths = period.map((m) => {
      let agents = 0;
      for (const [gk, byMonth] of acts) {
        const v = byMonth.get(m) || 0;
        if (v <= 0) continue;
        const cap = agentCapByKey.get(gk);
        if (cap) { agents += Math.ceil(v / cap); hasCap = true; } else known = false;
      }
      if (agents > agentsPeak) agentsPeak = agents;
      return { month: ym(year, m), agents };
    });
    // Aucun quota renseigné pour aucune activité de cette unité → effectif inconnu.
    if (!hasCap) return { agentsPeak: null, agentMonths: null, known: false };
    return { agentsPeak, agentMonths, known };
  };
  const byTpm = [...byTpmMap.entries()].map(([tpmKey, b]) => {
    const st = unitStaffing(tpmKey);
    return {
      tpm: b.name, assigned: b.assigned,
      sites: b.sites.size, planned: b.planned,
      perMonth: period.map((m) => ({ month: ym(year, m), count: b.perMonth.get(m) || 0 })),
      agentsPeak: st.agentsPeak, agentMonths: st.agentMonths, agentsKnown: st.known,
    };
  }).sort((a, b) => Number(b.assigned) - Number(a.assigned) || (b.planned - a.planned)
    || String(a.tpm || '').localeCompare(String(b.tpm || ''), 'fr'));
  // Activités planifiées dont le quota journalier n'est pas renseigné (agents non calculables).
  const activitiesNeedingQuota = byActivity.filter((a) => a.planned > 0 && !a.staffing.perAgentPerMonth).length;
  // Effectif total à mobiliser (pic) = somme des pics par TPM/bureau (chacun se dote pour son pic).
  // « connu » seulement si toutes les activités planifiées ont leur quota renseigné ; sinon c'est un plancher.
  const agentsTotalPeak = byTpm.some((t) => t.agentsPeak != null)
    ? byTpm.reduce((s, t) => s + (t.agentsPeak || 0), 0) : null;
  const agentsTotalKnown = activitiesNeedingQuota === 0 && byTpm.every((t) => t.agentsKnown);

  assignments.sort((a, b) => a.monthNum - b.monthNum
    || (RISK_RANK[b.riskLevel] || 0) - (RISK_RANK[a.riskLevel] || 0)
    || String(a.siteId).localeCompare(String(b.siteId)));

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
    perMonth: period.map((m) => ({ month: ym(year, m), count: perMonth.get(m) || 0, existing: existingMonth.get(m) || 0 })),
    summary: {
      sitesConsidered: considered.length,
      forbidden: forbidden.length,
      noActivity: noActivity.length,     // sites non planifiés faute d'activité
      inactive: inactiveAll.length,      // sites inactifs tous les mois de la période
      planned: assignments.length,
      sitesCovered: covered,
      sitesUncovered: plannable.length - covered,
      sitesActivePlannable: plannable.length,
      mmrDriven,
      rbmFallback,
      latePlanned: latePlannedTotal,
      unplaced,
      unplacedByReason,
      uncoveredByReason,
      existingInPeriod: [...existingMonth.values()].reduce((a, b) => a + b, 0),
      pastMonths: pastMonths.length,
      targetCoverage: cfg.targetCoverage,
      coverageRate: plannable.length ? Math.round((covered / plannable.length) * 1000) / 10 : null,
      // Dimensionnement des agents (à partir du quota journalier × jours ouvrés du MMR).
      agentsTotalPeak,                 // effectif total à mobiliser au pic (somme des pics par unité)
      agentsTotalKnown,                // true si toutes les activités ont leur quota (sinon plancher)
      activitiesNeedingQuota,          // activités planifiées sans quota journalier renseigné
    },
  };
}

module.exports = {
  generatePlan, normalizeSettings, siteRemaining, anchorsOf, fitCount, firstPlannableMonth, monthIdx,
  REASONS, DEFAULT_SETTINGS: normalizeSettings(),
};
