/**
 * Planification automatique du suivi SUR UNE PÉRIODE (retour n° 82) — logique
 * PURE, testée, sans I/O. Plan RÉALISTE, fidèle au MMR et au RBM.
 *
 * Objectif : un plan FAISABLE, pas des pics impossibles. Par activité (ligne MMR) :
 *   - chaque site est visité `fréquence` fois (MMR), espacées de l'INTERVALLE MMR
 *     (durée/risque, ou l'intervalle « ajusté » CO adjusted) ; sites sans MMR =
 *     fréquence RBM par risque (configurable) ;
 *   - les sites sont REGROUPÉS PAR COMMUNE (tournées) : une commune est suivie le
 *     même mois ; les communes sont réparties en « phases » sur l'intervalle pour
 *     ÉTALER la charge (≈ ciblé/mois), au lieu de tout mettre le même mois ;
 *   - le nombre de visites par mois et par activité est borné par la CAPACITÉ
 *     mensuelle du MMR (faisable = personnes × suivis/jour × jours ouvrés), avec
 *     un DÉBORDEMENT autorisé configurable (%) ; le surplus glisse au mois voisin.
 *
 * Entrée `sites` (sortie de planBoard, enrichie) :
 *   { id, commune, activity, riskLevel, forbidden, mmrKey, parametered, required,
 *     visits:[{month,status}], monthStatus:{m:bool} }
 * `mmrByKey` : { mmrKey: { interval, adjustedInterval, targetedPerMonth, feasible } }
 * `months` : mois de la période (numéros 1..12 de `year`), croissants.
 */
const { frequencyFor, DEFAULT_FREQUENCY } = require('./rbmMath');

const RISK_RANK = { elevee: 3, moyenne: 2, faible: 1 };
// Repli des sites AVEC activité mais SANS paramètre MMR : on suit le RBM (mois entre deux
// visites par niveau de risque), pas un mensuel forcé (gaspillage de ressources) — retour 82.
// Risque élevé = ce que dit le RBM (tous les mois) ; moyen/faible = fréquence RBM. Réglable.

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

/** Reste à planifier d'un site sur la période (MMR : exigées − réalisées − prévues DANS la période). */
function siteRemaining(s, periodStart) {
  const realise = (s.visits || []).filter((v) => v.status === 'realise').map((v) => Number(v.month));
  const planned = (s.visits || []).filter((v) => v.status === 'planifie').map((v) => Number(v.month));
  const plannedInPeriod = planned.filter((m) => m >= periodStart).length;
  const latePlanned = planned.filter((m) => m < periodStart).length;
  const remaining = Math.max(0, (Number(s.required) || 0) - realise.length - plannedInPeriod);
  return { remaining, realise, latePlanned };
}

/** Plan réaliste. @param {number} year année de l'exercice. */
function generatePlan(sites = [], mmrByKey = {}, settings = {}, months = [], year = new Date().getUTCFullYear()) {
  const cfg = normalizeSettings(settings);
  const period = [...new Set((months || []).filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  const excluded = new Set(cfg.excludeMonths);
  const periodOpen = period.filter((m) => !excluded.has(m));
  const periodStart = period[0] || 1;

  const perMonth = new Map(period.map((m) => [m, 0]));
  const perKeyMonth = new Map();
  const kM = (k, m) => `${k || '∅'}|${m}`;
  const bump = (k, m) => { perMonth.set(m, (perMonth.get(m) || 0) + 1); perKeyMonth.set(kM(k, m), (perKeyMonth.get(kM(k, m)) || 0) + 1); };

  const considered = (sites || []).filter((s) => s && s.id);
  const forbidden = considered.filter((s) => s.forbidden);
  // Un site SANS activité ET sans paramètre MMR n'est pas planifié (retour 82 : « inutile de
  // le planifier »). Un site paramétré (ligne MMR) a une activité par construction.
  const noActivity = considered.filter((s) => !s.forbidden && !s.activity && !s.parametered);
  const plannable = considered.filter((s) => !s.forbidden && (s.activity || s.parametered));

  const globalCap = cfg.capacityPerMonth;
  const monthlyKeyCap = (key) => {
    if (!cfg.useMmrCapacity || !key) return Infinity;
    const c = mmrByKey[key];
    const lim = c && (c.feasible != null ? c.feasible : c.targetedPerMonth);
    if (lim == null) return Infinity;
    return Math.max(1, Math.round(lim * (1 + cfg.overflowPct / 100)));
  };
  const hasRoom = (key, m) => (perMonth.get(m) || 0) < (globalCap == null ? Infinity : globalCap)
    && (perKeyMonth.get(kM(key, m)) || 0) < monthlyKeyCap(key);

  // --- Affectation TPM : charge mensuelle par TPM (contrat de suivi de la zone) ---
  // Chaque site porte ses segments de TPM par mois (tpmSegments = [{from,to,providerId,providerName}]).
  // On équilibre la charge de chaque TPM sur la période (tous les moyens utilisés) et on
  // respecte un plafond mensuel par TPM facultatif.
  const perTpmMonth = new Map();     // `${tpmKey}|${m}` → nb de visites
  const tpmInfo = new Map();         // tpmKey → { name }
  const byTpmMap = new Map();        // tpmKey → { name, sites:Set, planned, perMonth:Map }
  const tpmCap = cfg.tpmCapacityPerMonth;
  const tpmAt = (s, m) => {
    const mm = ym(year, m);
    const seg = (s.tpmSegments || []).find((x) => x && x.from <= mm && mm <= x.to);
    const id = seg && seg.providerId ? String(seg.providerId) : null;
    const name = seg && seg.providerName ? String(seg.providerName) : null;
    const key = id ? `id:${id}` : (name ? `nm:${name}` : 'non_affecte');
    if (!tpmInfo.has(key)) tpmInfo.set(key, { name: name || null, assigned: Boolean(id || name) });
    return { key, name: name || null, assigned: Boolean(id || name) };
  };
  const tpmRoom = (tpmKey, m) => tpmCap == null || (perTpmMonth.get(`${tpmKey}|${m}`) || 0) < tpmCap;
  const bumpTpm = (s, m) => {
    const t = tpmAt(s, m);
    perTpmMonth.set(`${t.key}|${m}`, (perTpmMonth.get(`${t.key}|${m}`) || 0) + 1);
    let b = byTpmMap.get(t.key);
    if (!b) { b = { name: t.name, assigned: t.assigned, sites: new Set(), planned: 0, perMonth: new Map() }; byTpmMap.set(t.key, b); }
    b.planned += 1; b.sites.add(s.id); b.perMonth.set(m, (b.perMonth.get(m) || 0) + 1);
  };

  // Clé de regroupement « tournée » : GPS (cellule de grille) quand il existe, sinon commune
  // (retour 82). Sans regroupement, chaque site est sa propre tournée.
  const clusterKeyOf = (s) => {
    if (!cfg.groupByCommune) return `s:${s.id}`;
    if (cfg.useGps && Number.isFinite(Number(s.gpsLat)) && Number.isFinite(Number(s.gpsLng))) {
      return `g:${Math.round(Number(s.gpsLat) / cfg.gpsGridDeg)}:${Math.round(Number(s.gpsLng) / cfg.gpsGridDeg)}`;
    }
    return `c:${s.commune || '∅'}`;
  };

  // Groupe d'activité = ligne MMR (ou, sans MMR, par niveau de risque).
  const groups = new Map();
  for (const s of plannable) {
    const key = s.parametered && s.mmrKey ? s.mmrKey : `∅rbm:${s.riskLevel || 'moyenne'}`;
    if (!groups.has(key)) groups.set(key, { parametered: Boolean(s.parametered && s.mmrKey), mmrKey: s.parametered ? s.mmrKey : null, riskLevel: s.riskLevel, sites: [] });
    groups.get(key).sites.push(s);
  }

  const assignments = [];
  const covered = new Set();
  const byActivity = [];
  let unplaced = 0; let mmrDriven = 0; let rbmFallback = 0; let latePlannedTotal = 0;
  const lastOpenG = periodOpen.length ? periodOpen[periodOpen.length - 1] : periodStart;
  // Charge PROJETÉE (estimation du plan complet) pour ÉTALER les départs de tournées pendant la
  // construction, avant le placement réel : sinon toutes les tournées viseraient le même mois.
  const projKeyMonth = new Map();
  const projTpmMonth = new Map();
  // Dimensionnement des agents : visites réelles par (unité TPM/bureau × activité × mois) et
  // capacité d'un agent/mois par activité (quota journalier × jours ouvrés du MMR).
  const perUnit = new Map();          // tpmKey → Map(gKey → Map(m → nb de visites))
  const agentCapByKey = new Map();    // gKey → visites/agent/mois (null si quota non renseigné)
  const bumpUnit = (tpmKey, gk, m) => {
    let a = perUnit.get(tpmKey); if (!a) { a = new Map(); perUnit.set(tpmKey, a); }
    let b = a.get(gk); if (!b) { b = new Map(); a.set(gk, b); }
    b.set(m, (b.get(m) || 0) + 1);
  };

  for (const [gKey, g] of groups) {
    const c = g.parametered ? (mmrByKey[g.mmrKey] || {}) : {};
    let interval;
    if (g.parametered) {
      interval = cfg.adjusted && c.adjustedInterval ? c.adjustedInterval : (c.interval || frequencyFor(g.riskLevel, cfg.frequency));
    } else interval = frequencyFor(g.riskLevel, cfg.frequency);
    const step = Math.max(1, Math.ceil(interval)); // arrondi au supérieur : l'intervalle minimal n'est jamais réduit (4,5 → 5)
    // MMR « configuré » = la ligne produit des visites (fréquence > 0 → required > 0) ; sinon
    // (durée 0, ligne non remplie) le site est tout de même suivi au repli RBM (pas oublié).
    const mmrConfigured = g.parametered && g.sites.some((s) => Number(s.required) > 0);
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
      let startMonth = periodStart;
      if (periodOpen.length) {
        const reqs = clusterSites.map((s) => (mmrConfigured ? siteRemaining(s, periodStart).remaining : 1)).filter((r) => r > 0);
        const maxReq = reqs.length ? Math.max(...reqs) : 1;
        const latestStart = lastOpenG - (maxReq - 1) * step;
        let window = periodOpen.filter((m) => m <= latestStart);
        if (!window.length) window = [periodOpen[0]];
        let best = null;
        for (const m of window) {
          // Coût de la tournée = charge PROJETÉE cumulée sur TOUS ses mois de visite (m, m+step, …) :
          // un départ qui remplit des mois encore peu chargés (fin d'année comprise) est préféré.
          let tLoad = 0; let aLoad = 0;
          for (let i = 0; i < maxReq; i += 1) {
            const vm = m + i * step;
            if (vm > lastOpenG) break;
            const t = tpmAt(rep, vm);
            if (cfg.balanceByTpm && t.assigned) tLoad += projTpmMonth.get(`${t.key}|${vm}`) || 0;
            aLoad += projKeyMonth.get(kM(aKey, vm)) || 0;
          }
          const score = [tLoad, aLoad, m];
          if (best === null || score[0] < best.score[0]
            || (score[0] === best.score[0] && (score[1] < best.score[1]
            || (score[1] === best.score[1] && score[2] < best.score[2])))) best = { m, score };
        }
        startMonth = best ? best.m : periodStart;
      }

      for (const s of clusterSites) {
        const { remaining, realise, latePlanned } = siteRemaining(s, periodStart);
        latePlannedTotal += latePlanned;
        const busy = new Set((s.visits || []).map((v) => Number(v.month)));
        const inactive = new Set(Object.entries(s.monthStatus || {}).filter(([, a]) => a === false).map(([m]) => Number(m)));
        const allowed = periodOpen.filter((m) => !busy.has(m) && !inactive.has(m));
        if (!allowed.length) continue;
        const lastRealise = realise.length ? Math.max(...realise) : null;
        const cursor = lastRealise != null ? Math.max(startMonth, lastRealise + step) : startMonth;
        const openFromCursor = allowed.filter((m) => m >= cursor).length;
        let maxCount;
        if (mmrConfigured) { maxCount = remaining; if (remaining > 0) mmrDriven += 1; }
        else { maxCount = Math.max(1, Math.ceil(openFromCursor / step)); rbmFallback += 1; } // repli RBM
        if (!maxCount) continue;
        states.push({ s, allowed, maxCount, nextMin: cursor, placed: 0, placedMonths: [] });
        // Projection : réserver l'empreinte estimée de ce site pour étaler les tournées suivantes.
        let vm = cursor;
        for (let i = 0; i < maxCount && vm <= lastOpenG; i += 1) {
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
    //    Priorité au risque élevé. Chaque visite respecte l'intervalle (nextMin) et la capacité.
    states.sort((a, b) => (RISK_RANK[b.s.riskLevel] || 0) - (RISK_RANK[a.s.riskLevel] || 0)
      || String(a.s.id).localeCompare(String(b.s.id)));
    for (let round = 0; round < 12; round += 1) {
      let any = false;
      for (const st of states) {
        if (st.placed >= st.maxCount) continue;
        // « Couvrir tous les sites au moins une fois » : le 1er passage ignore la capacité (forcé) ;
        // les visites suivantes la respectent toujours.
        const forceOnce = cfg.coverAllOnce && st.placed === 0;
        const m = st.allowed.find((x) => x >= st.nextMin && !st.placedMonths.includes(x)
          && (forceOnce || (hasRoom(aKey, x) && tpmRoom(tpmAt(st.s, x).key, x))));
        if (m == null) continue;
        st.placedMonths.push(m); st.nextMin = m + step; st.placed += 1;
        bump(aKey, m);
        bumpTpm(st.s, m);
        const tp = tpmAt(st.s, m);
        bumpUnit(tp.key, aKey, m);
        assignments.push({ siteId: st.s.id, month: ym(year, m), monthNum: m, activity: st.s.activity || null, riskLevel: st.s.riskLevel || null, source: mmrConfigured ? 'mmr' : 'rbm', tpm: tp.name });
        covered.add(st.s.id); gCovered.add(st.s.id); gPlanned += 1;
        any = true;
      }
      if (!any) break;
    }
    for (const st of states) unplaced += Math.max(0, st.maxCount - st.placed);

    // Aperçu par activité (ligne MMR) : paramètres de base + résultat du groupe.
    const activities = [...new Set(g.sites.map((s) => s.activity).filter(Boolean))];
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
      intervalUsed: Math.round(interval * 100) / 100,
      stepUsed: step,
      sites: g.sites.length,
      planned: gPlanned,
      covered: gCovered.size,
      // Dimensionnement des agents pour CETTE activité (quota journalier × jours ouvrés) :
      // agents d'un mois = ⌈visites du mois ÷ (quota × jours)⌉ ; le pic est l'effectif à prévoir.
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
    assignments: assignments.map(({ monthNum: _m, ...a }) => a),
    byActivity,
    byTpm,
    perMonth: period.map((m) => ({ month: ym(year, m), count: perMonth.get(m) || 0 })),
    summary: {
      sitesConsidered: considered.length,
      forbidden: forbidden.length,
      noActivity: noActivity.length,     // sites non planifiés faute d'activité
      planned: assignments.length,
      sitesCovered: covered.size,
      sitesActivePlannable: plannable.length,
      mmrDriven,
      rbmFallback,
      latePlanned: latePlannedTotal,
      unplaced,
      targetCoverage: cfg.targetCoverage,
      coverageRate: plannable.length ? Math.round((covered.size / plannable.length) * 1000) / 10 : null,
      // Dimensionnement des agents (à partir du quota journalier × jours ouvrés du MMR).
      agentsTotalPeak,                 // effectif total à mobiliser au pic (somme des pics par unité)
      agentsTotalKnown,                // true si toutes les activités ont leur quota (sinon plancher)
      activitiesNeedingQuota,          // activités planifiées sans quota journalier renseigné
    },
  };
}

module.exports = { generatePlan, normalizeSettings, siteRemaining, DEFAULT_SETTINGS: normalizeSettings() };
