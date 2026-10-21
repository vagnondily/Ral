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
 * l'ordre du RBM ; chaque mois vise la part ÉQUILIBRÉE des visites restantes (au total, les mêmes
 * agents faisant toutes les activités, et par activité) ; une commune part plus tôt seulement si
 * attendre ferait perdre une visite (« échéance »). Le plancher ciblé/mois du MMR est atteint dès
 * que les visites dues le permettent, sinon le manque est signalé — jamais des visites avancées
 * pour l'atteindre un mois en vidant les suivants. Un complément final rend le plan MAXIMAL.
 *
 * Garde-fous : intervalle face à CHAQUE visite réalisée et à chaque visite PRÉVUE À VENIR (avant ou
 * après, exercices voisins compris) et à la dernière visite effective ; une visite prévue d'un mois
 * échu, jamais faite, n'est ni un ancrage ni comptée : elle est à replanifier (« prévues
 * antérieures ») ; un mois de visite annulée n'est jamais repris ; jamais un mois échu ; capacités
 * et charges partent des visites existantes ; un 2ᵉ passage n'ajoute rien ; plusieurs passages sur
 * des sous-périodes (semestres, trimestres) ne dépassent jamais l'exigence ; chaque site non
 * couvert a sa raison.
 *
 * Écart et exigence (MMR) : écart = intervalle du MMR arrondi au mois supérieur (4,5 → 5), ramené
 * au plus grand écart qui laisse tenir les visites exigées dans la durée de l'opération
 * (⌊(durée − 1) ÷ (exigées − 1)⌋) — sans quoi la dernière visite exigée ne tiendrait jamais.
 * Stratégie « capacite » : exigées = ⌈fréquence ajustée (CO adjusted)⌉ sans dépasser la fréquence
 * du MMR, écart = intervalle AJUSTÉ arrondi au supérieur, ramené de même ; jamais sous l'écart du
 * MMR.
 * Capacité déclarée (faisable du MMR) : arrondie à l'entier INFÉRIEUR (2,5 → 2) ; 0 = aucune
 * capacité (rien n'est placé en stratégie « capacite », raison « capacité ») ; vide = sans limite.
 *
 * Entrée `sites` (planAuto.repository.loadInputsTx) :
 *   { id, district, commune, activity, riskLevel, urgent, finalScore, forbidden, mmrKey,
 *     parametered, required, inScope, lastVisitMonth, visits:[{month,status,date,agent,providerId,
 *     providerName,monitoredBy}], cancelledMonths, unitOfficeId, unitOfficeName,
 *     outsideVisits:[{month:'AAAA-MM',status}], monthStatus:{m:bool}, gpsLat, gpsLng, tpmSegments }
 * `mmrByKey` : { mmrKey: { interval, adjustedInterval, targetedPerMonth, feasible, visitsPerDay,
 *   workingDays, personsToDeploy, … } } ; `months` : numéros 1..12 de `year`, croissants ;
 * `opts` : { yearHasGrid?: boolean (déduit des sites sinon), fromMonth?: 'AAAA-MM' }.
 */
const { frequencyFor, DEFAULT_FREQUENCY } = require('./rbmMath');
const { isActiveMonth } = require('../common/siteActivity');
const { planResources, agentNumber } = require('./planResources');

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

/**
 * Reste à planifier d'un site sur l'exercice (MMR) : exigées − réalisées − prévues À VENIR (mois
 * courant ou suivants, dans la période ou non). « Échu » se mesure au mois courant (premier mois
 * planifiable), JAMAIS au début de la période : planifier le 2ᵉ semestre après le 1ᵉʳ ne replanifie
 * pas les visites prévues du 1ᵉʳ. Une prévue d'un mois échu, jamais faite, est à replanifier.
 * @param {number} firstMonth premier mois planifiable de l'exercice (1..13)
 * @param {number} [required] exigées (défaut : s.required)
 */
function siteRemaining(s, firstMonth = 1, required = Number(s.required) || 0) {
  const realise = (s.visits || []).filter((v) => v.status === 'realise').map((v) => Number(v.month));
  const planned = (s.visits || []).filter((v) => v.status === 'planifie').map((v) => Number(v.month));
  const upcoming = planned.filter((m) => m >= firstMonth).length;
  const latePlanned = planned.filter((m) => m < firstMonth).length;
  const remaining = Math.max(0, required - realise.length - upcoming);
  return { remaining, realise, upcoming, latePlanned };
}

/**
 * Ancrages de l'intervalle d'un site (index absolus) : chaque visite RÉALISÉE, chaque visite
 * PRÉVUE À VENIR (à partir du mois courant `fromMonth`) — de l'exercice ou des exercices voisins
 * (`outsideVisits`), avant OU après — et la dernière visite effective (visite réalisée, collecte de
 * données ou registre). Une prévue d'un mois échu jamais faite n'est pas un ancrage (elle est à
 * replanifier, comme « Générer depuis le RBM » le fait).
 */
function anchorsOf(s, year, fromMonth = null) {
  const now = idxOf(fromMonth);
  const keep = (status, idx) => idx != null && (status === 'realise' || (status === 'planifie' && (now == null || idx >= now)));
  const out = new Set();
  for (const v of s.visits || []) {
    const m = Number(v.month);
    if (m >= 1 && m <= 12 && keep(v.status, monthIdx(year, m))) out.add(monthIdx(year, m));
  }
  for (const v of s.outsideVisits || []) if (v && keep(v.status, idxOf(v.month))) out.add(idxOf(v.month));
  const last = idxOf(s.lastVisitMonth);
  if (last != null && last <= monthIdx(year, 12)) out.add(last);
  return [...out].sort((a, b) => a - b);
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

/** Écart RBM (mois) d'un niveau de risque : élevé 1, moyen 2, faible 3 (rbmMath). */
const rbmStep = (riskLevel) => Math.max(1, Math.ceil(frequencyFor(riskLevel, DEFAULT_FREQUENCY) - 1e-9));

/**
 * Exigence et écart d'un site piloté par le MMR (règle du préambule), à partir de la ligne MMR
 * dérivée (deriveMmr : interval, adjustedInterval, frequency, operationDuration).
 * @param {number} required exigées du Plan de suivi (⌈fréquence ajustée⌉ en stratégie « capacite »)
 * @returns {{ required: number, step: number }}
 */
function mmrRule(c = {}, required = 0, adjusted = false, riskLevel = null) {
  let req = Math.max(0, Math.round(Number(required) || 0));
  const freq = Number(c.frequency);
  // « Limiter à la capacité déclarée » : jamais plus de visites que la fréquence du MMR.
  if (adjusted && freq > 0) req = Math.min(req, Math.max(1, Math.round(freq)));
  const base = Number(c.interval) > 0 ? Number(c.interval) : frequencyFor(riskLevel, DEFAULT_FREQUENCY);
  let step = Math.max(1, Math.ceil(base - 1e-9));
  if (adjusted && Number(c.adjustedInterval) > 0) step = Math.max(step, Math.ceil(Number(c.adjustedInterval) - 1e-9));
  // Les visites exigées doivent tenir dans la durée de l'opération : 1 + (exigées − 1) × écart ≤ durée.
  const dur = Math.round(Number(c.operationDuration) || 0);
  if (dur > 1 && req > 1) step = Math.max(1, Math.min(step, Math.floor((dur - 1) / (req - 1))));
  return { required: req, step };
}

/** Capacité déclarée (faisable du MMR) en visites par mois : entier inférieur ; null = sans limite. */
function capacityOf(c) {
  const lim = c && c.feasible != null && c.feasible !== '' ? Number(c.feasible) : null;
  return lim != null && Number.isFinite(lim) ? Math.max(0, Math.floor(lim + 1e-9)) : null;
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

/**
 * Unité de suivi d'un site au mois `m` : le TPM de sa zone (segments du Plan de suivi), sinon le
 * BUREAU en suivi interne — son bureau racine (l'équipe d'un bureau suit les sites de toutes ses
 * antennes), jamais un « bureau » unique pour tout le compte.
 */
function tpmAt(s, year, m) {
  const mm = ym(year, m);
  const seg = (s.tpmSegments || []).find((x) => x && x.from <= mm && mm <= x.to);
  const id = seg && seg.providerId ? String(seg.providerId) : null;
  const name = seg && seg.providerName ? String(seg.providerName) : null;
  if (id || name) return { key: id ? `id:${id}` : `nm:${name}`, name: name || null, assigned: true, officeName: null };
  return { key: `bureau:${s.unitOfficeId || 'none'}`, name: null, assigned: false, officeName: s.unitOfficeName || null };
}

/**
 * Unité d'une visite EXISTANTE : le TPM que la visite porte (site_visits.provider_id — écart motivé
 * « visite », visite facturée ou figée comprise), sinon l'équipe interne de son bureau racine quand
 * la visite est suivie en interne (monitored_by 'interne' : TPM retiré avec une raison, zone sans
 * TPM ou TPM indisponible) — la même clé « qui suit » que les résumés, matrices et rapports attendus
 * (tpmAttribution.monitorKeySql). Une visite « non affectée » (antérieure à la règle) suit sa zone.
 * Les visites NOUVELLES suivent toujours la zone (tpmAt) : la base les estampille ainsi.
 */
function visitUnitAt(s, v, year, m) {
  if (v && v.providerId) {
    return { key: `id:${String(v.providerId)}`, name: v.providerName ? String(v.providerName) : null, assigned: true, officeName: null };
  }
  if (v && v.monitoredBy === 'interne') {
    return { key: `bureau:${s.unitOfficeId || 'none'}`, name: null, assigned: false, officeName: s.unitOfficeName || null };
  }
  return tpmAt(s, year, m);
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

  // Ordre d'entrée sans effet : sites triés par identifiant.
  const all = (sites || []).filter((s) => s && s.id).sort((a, b) => cmp(String(a.id), String(b.id)));
  // LA règle « actif au mois M » : l'exercice a une grille dès qu'un site a un statut.
  const yearHasGrid = opts.yearHasGrid != null ? Boolean(opts.yearHasGrid)
    : all.some((s) => s.monthStatus && Object.keys(s.monthStatus).length > 0);
  const activeAt = (s, m) => isActiveMonth((s.monthStatus || {})[m] ?? (s.monthStatus || {})[String(m)], yearHasGrid);
  const excluded = new Set(cfg.excludedCommunes.map((c) => communeKey(c.district, c.commune)));
  const groupKeyOf = (s) => (s.parametered && s.mmrKey ? s.mmrKey : `∅rbm:${s.riskLevel || 'moyenne'}`);
  const mmrDrivenSite = (s) => Boolean(s.parametered && s.mmrKey && Number(s.required) > 0);
  const rule = (s) => mmrRule(mmrByKey[s.mmrKey] || {}, Number(s.required) || 0, cfg.adjusted, s.riskLevel);
  const requiredOf = (s) => (mmrDrivenSite(s) ? rule(s).required : 0);
  const stepOf = (s) => (mmrDrivenSite(s) ? rule(s).step : rbmStep(s.riskLevel));

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
  const capOf = (key) => capacityOf(mmrByKey[key]);
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
    const { remaining, latePlanned } = siteRemaining(s, firstMonth, requiredOf(s));
    latePlannedTotal += latePlanned;
    const anchors = anchorsOf(s, year, opts.fromMonth);
    // Mois occupés : une visite existante prévue ou réalisée (liveBusy) ; un mois de visite
    // ANNULÉE n'est jamais repris (une annulation est une décision).
    const liveBusy = new Set((s.visits || []).filter((v) => LIVE.has(v.status)).map((v) => Number(v.month)));
    const cancelled = new Set([...(s.cancelledMonths || []).map(Number),
      ...(s.visits || []).filter((v) => v.status === 'annule').map((v) => Number(v.month))]);
    const free = period.filter((m) => !liveBusy.has(m));
    const allowed = free.filter((m) => !cancelled.has(m) && activeAt(s, m));
    const liveInPeriod = (s.visits || []).filter((v) => LIVE.has(v.status) && periodSet.has(Number(v.month))).map((v) => Number(v.month));
    // Besoin sur la période : MMR = visites restantes exigées ; RBM = les visites que sa fréquence
    // appelle dans ses mois ACTIFS de la période (aucune si sa dernière visite est trop récente) —
    // un mois annulé reste dû : s'il était le seul possible, le site n'est PAS couvert (raison
    // « annulée »), jamais compté couvert parce que rien ne serait dû.
    const domain = driven ? free : free.filter((m) => activeAt(s, m));
    const renfortMonthOf = period.find((m) => activeAt(s, m) && !cancelled.has(m)) ?? null;
    let needed;
    if (driven) { needed = remaining; if (remaining > 0) mmrDriven += 1; } else {
      needed = fitCount(year, domain, anchors, step);
      rbmFallback += 1;
    }
    const last = idxOf(s.lastVisitMonth);
    states.set(s.id, {
      s, driven, step, gKey: groupKeyOf(s), cluster: clusterKeyOf(s), anchors: [...anchors], baseAnchors: anchors,
      allowed, allowedSet: new Set(allowed), domain, cancelled, needed, needLeft: needed, placed: 0, placedMonths: [],
      hasVisitInPeriod: liveInPeriod.length > 0, last,
      urgent: Boolean(s.urgent), finalScore: Number(s.finalScore) || 0,
      // Renfort : au PREMIER mois possible de la période (actif, non annulé) et à lui seul (sans
      // place ce mois-là, pas de renfort : un 2ᵉ passage n'en ajoute jamais), seulement si aucune
      // visite existante de la période ne tombe avant ou à ce mois.
      renfortMonth: renfortMonthOf,
      renfortPending: Boolean(cfg.reinforceUrgent && s.urgent && renfortMonthOf != null && !liveInPeriod.some((m) => m <= renfortMonthOf)),
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
  const placeVisit = (st, m, regular) => {
    st.placedMonths.push(m); st.placed += regular ? 1 : 0;
    if (regular) { st.needLeft -= 1; st.anchors.push(monthIdx(year, m)); } else st.renfort += 1;
    st.renfortPending = false;
    bump(perMonth, m); bump(keyLoad, kM(st.gKey, m)); bump(keyNew, kM(st.gKey, m));
    const tp = tpmAt(st.s, year, m);
    assignments.push({
      siteId: st.s.id, month: ym(year, m), monthNum: m, activity: st.s.activity || null, riskLevel: st.s.riskLevel || null,
      source: regular ? (st.driven ? 'mmr' : 'rbm') : 'renfort', tpm: tp.name, office: tp.officeName, district: st.s.district || null, commune: st.s.commune || null,
    });
  };
  const hasRoom = (st, m) => {
    if (needsMode) return true;
    const cap = capOf(st.gKey);
    return cap == null || (keyLoad.get(kM(st.gKey, m)) || 0) < cap;
  };

  for (const m of period) {
    const monthsLeft = period.filter((x) => x >= m).length;
    // Répartition ÉQUILIBRÉE (les mêmes agents font toutes les activités) : chaque mois vise
    // ⌈visites encore plaçables ÷ mois restants⌉, au total ET par activité, visites existantes des
    // mois restants comprises. Le plancher « sites à suivre par mois » du MMR est atteint chaque mois
    // dès que les visites dues de la période le permettent (la part équilibrée le dépasse alors) ;
    // sinon le manque est SIGNALÉ (monthsBelowTarget) — jamais des visites avancées pour l'atteindre
    // un mois au prix des suivants (pic d'agents puis mois vides).
    const placeable = new Map();
    const fitNow = new Map();       // visites encore plaçables à partir de m (une fois par site et par mois)
    for (const st of states.values()) {
      if (st.needLeft <= 0) continue;
      const f = fitFrom(st, m, false);
      fitNow.set(st, f);
      if (f > 0) placeable.set(st.gKey, (placeable.get(st.gKey) || 0) + Math.min(st.needLeft, f));
    }
    // La charge TOTALE (visites existantes des mois restants comprises) est étalée : un mois déjà
    // chargé par des visites prévues reçoit d'autant moins de nouvelles visites.
    const left = period.filter((x) => x >= m);
    const target = new Map();
    let placeableAll = 0;
    for (const [key, n] of placeable) {
      placeableAll += n;
      const existingLeft = left.reduce((a, x) => a + (keyExisting.get(kM(key, x)) || 0), 0);
      const here = keyExisting.get(kM(key, m)) || 0;
      target.set(key, Math.max(0, Math.ceil((n + existingLeft) / monthsLeft) - here));
    }
    const existingLeftAll = left.reduce((a, x) => a + (existingMonth.get(x) || 0), 0);
    const monthTarget = Math.max(0, Math.ceil((placeableAll + existingLeftAll) / monthsLeft) - (existingMonth.get(m) || 0));
    const generated = new Map();
    let generatedAll = 0;

    // Communes candidates : un site « déclencheur » (échéance, plus petit écart de la commune, renfort).
    const cands = [];
    for (const ck of clusterKeys) {
      const list = clusters.get(ck);
      const needing = list.filter((st) => (fitNow.get(st) || 0) > 0);
      const leadStep = needing.length ? Math.min(...needing.map((st) => st.step)) : null;
      const info = list.map((st) => {
        const el = eligible(st, m);
        // Échéance : attendre ferait perdre une visite (après m, on en placerait moins qu'à partir
        // de m) — jamais parce que le besoin ne tiendra de toute façon pas dans la période.
        const must = el && Math.min(st.needLeft, fitFrom(st, m, true)) < Math.min(st.needLeft, fitNow.get(st) || 0);
        const ren = st.renfortPending && m === st.renfortMonth && st.allowedSet.has(m) && !st.placedMonths.includes(m);
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
      // Une commune part si un de ses sites ne peut plus attendre (échéance, renfort), ou si le mois
      // n'a pas encore sa part équilibrée et qu'une de ses activités non plus.
      const forced = c.info.some((x) => (x.trigger && x.must) || x.ren);
      const wanted = forced || (generatedAll < monthTarget
        && c.info.some((x) => x.el && (generated.get(x.st.gKey) || 0) < (target.get(x.st.gKey) || 0)));
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
            if (room.get(x.st.gKey) > 0) { take.push(x); room.set(x.st.gKey, room.get(x.st.gKey) - 1); }
          }
          if (!take.some((x) => x.trigger)) continue;
        }
      }
      for (const x of take) {
        const regular = eligible(x.st, m);
        if (!regular && !x.ren) continue;
        placeVisit(x.st, m, regular);
        bump(generated, x.st.gKey); generatedAll += 1;
      }
    }
  }

  // ---- Complément : le plan est MAXIMAL ----------------------------------------------------
  // Un site encore en manque (une commune attendue au-delà de la capacité restante) reçoit, dans
  // l'ordre du RBM, chaque mois permis qui respecte encore l'intervalle et la capacité (jamais un
  // mois plein) : aucune visite plaçable n'est laissée de côté, un 2ᵉ passage n'ajoute rien.
  const fillOrder = [...states.values()].filter((st) => st.needLeft > 0).sort((a, b) => Number(b.urgent) - Number(a.urgent)
    || b.finalScore - a.finalScore || Number(neverVisited(b)) - Number(neverVisited(a))
    || (RISK_RANK[b.s.riskLevel] || 0) - (RISK_RANK[a.s.riskLevel] || 0) || cmp(String(a.s.id), String(b.s.id)));
  for (const st of fillOrder) {
    for (const m of st.allowed) {
      if (st.needLeft <= 0) break;
      if (eligible(st, m) && hasRoom(st, m)) placeVisit(st, m, true);
    }
  }

  // ---- Couverture et raisons -----------------------------------------------------------------
  // Un site est COUVERT s'il a une visite dans la période (existante ou nouvelle) ou si rien ne lui
  // est dû ; sinon, sa raison : la capacité a bloqué un mois possible, ses mois sont inactifs ou
  // annulés, l'intervalle face à ses visites l'empêche, ou la période est trop courte.
  // Raison = contrefactuel, de la plus concrète à la plus générale : la capacité n'est en cause
  // que si, sans elle, ses mois permis acceptaient plus de visites que placées (jamais une
  // étiquette collante) ; puis inactivité, annulation, intervalle face aux visites, période.
  // Domaine : mois libres de la période (repli RBM : ses mois actifs seulement, où il est dû).
  const reasonOf = (st) => {
    const limit = st.needed;
    const withAllowed = fitCount(year, st.allowed, st.baseAnchors, st.step, limit);
    if (withAllowed > st.placed) return 'capacity';
    const withoutInactive = fitCount(year, st.domain.filter((m) => !st.cancelled.has(m)), st.baseAnchors, st.step, limit);
    if (withoutInactive > withAllowed) return 'inactive';
    const withoutCancelled = fitCount(year, st.domain, st.baseAnchors, st.step, limit);
    if (withoutCancelled > withoutInactive) return 'cancelled';
    const withoutAnchors = fitCount(year, st.domain, [], st.step, limit);
    if (withoutAnchors > withoutCancelled) return 'gap';
    return 'period';
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
  // Même clé de regroupement que les tournées du moteur (commune de son district, GPS en second) ;
  // une visite existante déjà datée et affectée (« Agent N ») garde son créneau, réservé.
  const placeKeys = new Map();   // site → { district, cluster } : calculés une fois par site
  // Unité : la zone pour une visite nouvelle, celle que porte la visite pour une visite existante.
  const pushVisit = (s, m, isNew, v = null) => {
    const key = groupKeyOf(s); const c = mmrByKey[key] || {}; const tp = isNew ? tpmAt(s, year, m) : visitUnitAt(s, v, year, m);
    if (!placeKeys.has(s.id)) placeKeys.set(s.id, { districtKey: norm(s.district), clusterKey: clusterKeyOf(s) });
    const pk = placeKeys.get(s.id);
    toDo.push({
      siteId: s.id, month: ym(year, m), unitKey: tp.key, unitName: tp.name, officeName: tp.officeName, assigned: tp.assigned,
      district: s.district || null, commune: s.commune || null, districtKey: pk.districtKey, clusterKey: pk.clusterKey,
      activityKey: key, visitsPerDay: c.visitsPerDay, workingDays: c.workingDays, isNew,
      date: v && v.date ? String(v.date) : null, agent: v && v.agent ? String(v.agent) : null,
    });
  };
  for (const s of all) {
    for (const v of s.visits || []) {
      if (!periodSet.has(Number(v.month))) continue;
      if (v.status === 'planifie') pushVisit(s, Number(v.month), false, v);
      // Une visite réalisée datée et affectée à un agent générique (« Agent N ») garde son créneau
      // (jamais réattribué), sans être à faire ; un agent nommé ne réserve rien (planFingerprint).
      else if (v.status === 'realise' && v.date && agentNumber(v.agent) != null) { pushVisit(s, Number(v.month), false, v); toDo[toDo.length - 1].reserveOnly = true; }
    }
  }
  const byId = new Map(all.map((s) => [s.id, s]));
  for (const a of assignments) pushVisit(byId.get(a.siteId), a.monthNum, true);
  const declared = {};
  for (const [k, c] of Object.entries(mmrByKey)) if (Number(c.personsToDeploy) > 0) declared[k] = Number(c.personsToDeploy);
  // Le mois en cours ne compte que ses jours de terrain restants (jamais une date passée).
  const resources = planResources(toDo, { agentsPerVehicle: cfg.agentsPerVehicle, fieldDaysPerMonth: cfg.fieldDaysPerMonth, declared, today: opts.today || null });

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
    const drivenSt = list.find((st) => st.driven) || null;
    const interval = mmrConfigured ? ((cfg.adjusted && c.adjustedInterval ? c.adjustedInterval : c.interval) || frequencyFor(g.riskLevel, DEFAULT_FREQUENCY))
      : (steps.length === 1 ? steps[0] : null);
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
      // Source des valeurs (lecture seule) : ligne MMR complète, ou repli RBM (risque de chaque site
      // — aussi pour une ligne MMR sans durée ni risque, « à compléter »).
      source: mmrConfigured ? 'mmr' : 'rbm',
      mmrIncomplete: parametered && !mmrConfigured,
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
      // Écart appliqué et visites exigées par site (règle du préambule : mmrRule).
      stepUsed: drivenSt ? drivenSt.step : (steps.length === 1 ? steps[0] : null),
      requiredUsed: drivenSt ? requiredOf(drivenSt.s) : null,
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
  // Sites = sites de l'unité avec une visite à faire dans la période (prévue ou nouvelle), comme
  // « Visites » ; sitesNew = ceux qui reçoivent une visite nouvelle.
  const byTpm = resources.units.map((u) => ({
    unitKey: u.unitKey, tpm: u.name, officeName: u.officeName || null, assigned: u.assigned,
    sites: u.sites, sitesNew: u.newSites,
    planned: u.newVisits, visits: u.visits, agentDays: u.agentDays,
    perMonth: period.map((m) => {
      const r = u.months.find((x) => x.month === ym(year, m));
      return {
        month: ym(year, m), count: r ? r.newVisits : 0, visits: r ? r.visits : 0, agentDays: r ? r.agentDays : 0,
        agents: r ? r.agentsNeeded : 0, vehiclesPeak: r ? r.vehiclesPeak : 0, vehiclesAvg: r ? r.vehiclesAvg : 0,
        workingDays: r ? r.workingDays : null, workingDaysSource: r ? r.workingDaysSource : null,
        firstFieldDate: r ? r.firstFieldDate : null, reservedSlots: r ? r.reservedSlots : 0,
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
    // Règles appliquées (lecture seule, affichées avec leur source) : repli RBM = mois entre deux
    // visites selon le risque du site ; le reste vient du MMR ligne par ligne (byActivity.mmr).
    rules: { rbmMonths: { ...DEFAULT_FREQUENCY }, agentsPerVehicle: cfg.agentsPerVehicle, fieldDaysPerMonth: cfg.fieldDaysPerMonth },
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
  communeKey, tpmAt, visitUnitAt, mmrRule, rbmStep, capacityOf, REASONS, STRATEGIES, DEFAULT_SETTINGS: normalizeSettings(),
};
