/**
 * Entrées du générateur de plan (lot 5, § 7.1) — assemblage PUR des lignes du chargeur
 * (plan.repository.loadPlanInputsTx), testé (test/planInputs.test.js).
 *
 * Définitions retenues (critique de la v1, points graves 2 à 4) :
 *  - « Réalisé » = visite RÉALISÉE du site, ou donnée rattachée AU SITE (soumission dont
 *    site_id = le site) — une donnée rattachée seulement à la commune n'est jamais une
 *    visite (définitions communes). Plus la date « dernière visite » déclarée du registre
 *    (colonne T du classeur RBM), bornée avant le premier mois planifiable.
 *  - Site actif à M = common/siteActivity.activeAt (lot 1b) : zone interdite jamais ; si le
 *    compte a une grille d'activation cette année-là, seul un « Oui » explicite.
 *  - Pool (capacité) = ligne MMR effective : dérogation du bureau du site, sinon de son
 *    bureau parent, sinon le plan général (même recherche que le Plan de suivi). Une ligne du
 *    plan général est, par défaut, un MODÈLE appliqué à chaque bureau (capacité par bureau
 *    racine) ; le paramètre generalRowMode = 'commune' en fait une capacité unique.
 *  - Nombre de sites d'un pool = sites ÉLIGIBLES du registre (actifs au moins un mois de
 *    l'exercice, hors zone interdite) ; un écart > 10 % avec le nombre saisi au MMR est signalé.
 *  - Sans calendrier d'activité (lot 5 § 3, à venir) : l'activité peut être suivie chaque
 *    mois, au plus « faisable » visites par mois, et la capacité de l'EXERCICE est plafonnée à
 *    faisable × durée d'opération (convention affichée) ; durée 0 = ne tourne pas.
 *
 * Adaptateurs (pour brancher plus tard le § 3 calendrier, le § 4 risque daté et le § 5
 * règles de priorité sans toucher au générateur) : runningMonthsOf, securityAt, urgentOf,
 * levelOf — aujourd'hui : pas de calendrier, sécurité et critères actuels, priorités du RBM.
 */
const { deriveMmr } = require('./mmrMath');
const { scoreSite } = require('./rbmScore');
const { effectiveInterval } = require('./planSettings');
const { costUnits, U } = require('./planGenerator');
const { activeAt } = require('../common/siteActivity');
const { siteDistricts, districtKey } = require('../common/siteDistrict');

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const pad = (m) => String(m).padStart(2, '0');
const asMonth = (v) => { const m = /^(\d{4})-(\d{2})/.exec(String(v ?? '')); return m ? `${m[1]}-${m[2]}` : null; };
const maxMonth = (...ms) => ms.filter(Boolean).reduce((a, b) => (a && a > b ? a : b), null);
const STATUS_RANK = { realise: 3, planifie: 2, annule: 1 };

/** Adaptateur § 3 : mois d'activité d'une ligne MMR pour l'année (null = pas de calendrier). */
const runningMonthsOf = () => null;
/** Adaptateur § 4 : situation sécuritaire du site au mois (aujourd'hui : valeur actuelle). */
const securityAt = (site) => Number(site.security) || 0;

/** Signaux d'une recommandation urgente (raisons « urgentes » du score RBM). */
function urgentOf(site) {
  const sc = scoreSite(site, {});
  const forbidden = Number(site.security) >= 99;
  const signals = sc.reasons.filter((r) => r.urgent).map((r) => ({ code: r.code, value: r.value }));
  return { urgent: sc.urgentFlags && !forbidden, signals, finalScore: sc.finalScore };
}

/** Bureaux : parent et bureau racine (le plus haut de la hiérarchie). */
function officeTree(offices = []) {
  const byId = new Map(offices.map((o) => [o.id, o]));
  const root = (id) => {
    let cur = byId.get(id); const seen = new Set();
    while (cur && cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parentId); }
    return cur ? cur.id : null;
  };
  const ancestors = (id) => {
    const out = []; let cur = byId.get(id); const seen = new Set();
    while (cur && !seen.has(cur.id)) { out.push(cur.id); seen.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null; }
    return out;
  };
  return { byId, root, ancestors, name: (id) => (byId.get(id) || {}).name || null };
}

/** Index MMR : (bureau, activité) → ligne, repli bureau parent puis plan général. */
function mmrIndex(rows = []) {
  const general = new Map(); const byOffice = new Map();
  for (const r of rows) {
    const k = norm(r.activityCategory);
    if (!r.fieldOfficeId) general.set(k, r); else byOffice.set(`${r.fieldOfficeId}|${k}`, r);
  }
  return (officeId, parentId, activity) => {
    const k = norm(activity);
    if (!k) return null;
    return (officeId && byOffice.get(`${officeId}|${k}`)) || (parentId && byOffice.get(`${parentId}|${k}`)) || general.get(k) || null;
  };
}

/** Capacités entières d'un pool (visites / mois, exercice, unités de journées-personne). */
function poolCapacity(row, { marginPct, defaultVpd, eligible, objective, runningMonths }) {
  const derived = deriveMmr({ ...row, numberOfSites: eligible });
  const interval = effectiveInterval({ ...row, numberOfSites: eligible }, objective);
  const feasible = derived.feasible;
  const visitsCap = feasible == null ? 0 : Math.floor((Math.round(Number(feasible) * 100) * marginPct) / 10000);
  const rowVpd = Number(row.visitsPerDay) > 0 ? Number(row.visitsPerDay) : null;
  const vpd = rowVpd || defaultVpd;
  const cost = costUnits(vpd);
  const persons = Number(row.personsToDeploy) > 0 ? Number(row.personsToDeploy) : null;
  const workingDays = Number(row.workingDays) > 0 ? Number(row.workingDays) : null;
  let dayCapUnits; let capacityMode;
  if (persons && workingDays) {
    dayCapUnits = persons * workingDays * (U / 100) * marginPct; // entier : U est divisible par 100
    capacityMode = 'personnes';
  } else {
    // Personnes ou jours inconnus : journées-personne qu'il faut pour faire `visitsCap` visites
    // à `vpd` par jour — un site isolé coûte une journée entière, regrouper libère de la capacité.
    dayCapUnits = Math.ceil((visitsCap * cost) / U) * U;
    capacityMode = 'faisable';
  }
  const months = runningMonths ? runningMonths.size : Math.max(0, Number(row.operationDuration) || 0);
  return {
    derived, interval, feasible, feasibleSource: derived.feasibleSource, visitsCap,
    yearCap: interval.running ? visitsCap * months : 0,
    vpd, vpdSource: rowVpd ? 'mmr' : 'defaut', costUnits: cost, persons, workingDays, dayCapUnits, capacityMode,
    frequency: derived.frequency,
  };
}

/**
 * @param {object} raw lignes du chargeur : { offices, sites, grid, gridKnown, visits, lastBefore, data, mmr }
 * @param {object} opts { year, todayMonth ('AAAA-MM'), from, to (mois 1..12), scope:{officeId,activity,district},
 *                        settings (planSettings complets), objective? (surcharge) }
 * @returns generator input + métadonnées (pools décrits pour l'écran, avertissements)
 */
function assemble(raw, opts) {
  const { year, todayMonth, settings } = opts;
  const objective = opts.objective || settings.objective;
  const scope = opts.scope || {};
  const [ty, tm] = String(todayMonth).split('-').map(Number);
  // Premier mois planifiable : jamais avant le mois courant (un plan ne se fait pas au passé).
  const current = ty * 12 + tm;
  let fromMonth = Math.max(1, Number(opts.from) || 1);
  if (year * 12 + fromMonth < current) fromMonth = year < ty ? 13 : tm;
  const toMonth = Math.min(12, Number(opts.to) || 12);
  const firstMonth = `${year}-${pad(Math.min(fromMonth, 12))}`;

  const tree = officeTree(raw.offices || []);
  const lookup = mmrIndex(raw.mmr || []);
  const districts = siteDistricts(raw.sites || []);
  const gridYears = raw.gridKnown ? [year] : [];

  const statuses = new Map(); // siteId → { 'AAAA-MM': bool }
  for (const g of raw.grid || []) {
    if (!statuses.has(g.siteId)) statuses.set(g.siteId, {});
    statuses.get(g.siteId)[`${year}-${pad(g.month)}`] = g.active === true;
  }
  const visitSt = new Map(); // siteId → Array(12) statut unique (réalisée > prévue > annulée)
  const put = (id, m, status) => {
    if (!visitSt.has(id)) visitSt.set(id, Array(12).fill(null));
    const arr = visitSt.get(id);
    if (!arr[m - 1] || STATUS_RANK[status] > STATUS_RANK[arr[m - 1]]) arr[m - 1] = status;
  };
  for (const v of raw.visits || []) put(v.siteId, Number(v.month), v.status);
  // Donnée rattachée AU SITE = visite réalisée ce mois-là (définitions communes).
  const dataBefore = new Map();
  for (const d of raw.data || []) {
    for (const m of d.months || []) if (String(m).startsWith(`${year}-`)) put(d.siteId, Number(String(m).slice(5, 7)), 'realise');
    if (d.before) dataBefore.set(d.siteId, asMonth(d.before));
  }
  const lastBefore = new Map((raw.lastBefore || []).map((r) => [r.siteId, asMonth(r.month)]));

  // Sites (registre) → entrées du générateur.
  const pre = (raw.sites || []).map((s) => {
    const forbidden = securityAt(s) >= 99;
    const st = statuses.get(s.id) || {};
    const vs = visitSt.get(s.id) || Array(12).fill(null);
    const months = Array.from({ length: 12 }, (_, i) => ({
      active: activeAt(st, `${year}-${pad(i + 1)}`, { forbidden, gridYears }),
      forbidden,
      st: vs[i],
    }));
    const parentId = s.fieldOfficeId ? (tree.byId.get(s.fieldOfficeId) || {}).parentId || null : null;
    const row = lookup(s.fieldOfficeId, parentId, s.activity);
    const d = districts.get(s.id) || { key: '—', name: '—' };
    const communeName = String(s.adm3 || s.commune || '').trim() || '—';
    const communeKey = `${d.key}|${districtKey(communeName) || '—'}`;
    const registry = asMonth(s.lastVisitDate);
    const lv = lastBefore.get(s.id) || null; const ld = dataBefore.get(s.id) || null;
    const lr = registry && registry < firstMonth ? registry : null;
    const lastReal = maxMonth(lv, ld, lr);
    const lastSource = !lastReal ? null : lastReal === lv ? 'visite' : lastReal === ld ? 'donnees' : 'registre';
    const u = urgentOf(s);
    const ancestors = s.fieldOfficeId ? tree.ancestors(s.fieldOfficeId) : [];
    const inScope = (!scope.officeId || ancestors.includes(scope.officeId))
      && (!scope.activity || norm(scope.activity) === norm(s.activity))
      && (!scope.district || districtKey(scope.district) === d.key);
    return { s, row, months, d, communeName, communeKey, lastReal, lastSource, u, inScope };
  });

  // Pools : clé = (bureau de la dérogation | bureau racine du site pour un modèle général) × activité.
  const poolKeyOf = (p) => {
    if (!p.row) return null;
    const cat = norm(p.row.activityCategory);
    if (p.row.fieldOfficeId) return `${p.row.fieldOfficeId}|${cat}`;
    if (settings.generalRowMode === 'commune') return `general|${cat}`;
    const rootId = p.s.fieldOfficeId ? tree.root(p.s.fieldOfficeId) : null;
    return `${rootId || '-'}|${cat}`;
  };
  const poolRows = new Map(); const poolSites = new Map();
  for (const p of pre) {
    p.poolKey = poolKeyOf(p);
    if (!p.poolKey) continue;
    if (!poolRows.has(p.poolKey)) poolRows.set(p.poolKey, p.row);
    if (!poolSites.has(p.poolKey)) poolSites.set(p.poolKey, []);
    poolSites.get(p.poolKey).push(p);
  }
  const pools = {}; const poolInfo = [];
  for (const key of [...poolRows.keys()].sort()) {
    const row = poolRows.get(key);
    const runningMonths = runningMonthsOf(row, year);
    const eligibleAll = poolSites.get(key).filter((p) => p.months.some((c) => c.active && !c.forbidden)).length;
    const cap = poolCapacity(row, { marginPct: settings.capacityMarginPct, defaultVpd: settings.defaultVisitsPerDay, eligible: eligibleAll, objective, runningMonths });
    const officeId = row.fieldOfficeId || (key.startsWith('general|') || key.startsWith('-|') ? null : key.split('|')[0]);
    pools[key] = {
      key, interval: cap.interval, runningMonths, visitsCap: cap.visitsCap, yearCap: cap.yearCap, costUnits: cap.costUnits,
      dayCapUnits: cap.dayCapUnits, frequency: cap.frequency, workingDays: cap.workingDays, vpd: cap.vpd,
    };
    const typed = Number(row.numberOfSites) || 0;
    poolInfo.push({
      key, mmrId: row.id || null, activity: row.activityCategory, officeId, officeName: officeId ? tree.name(officeId) : null,
      general: !row.fieldOfficeId, generalMode: !row.fieldOfficeId ? settings.generalRowMode : null,
      operationDuration: Number(row.operationDuration) || 0, riskLevel: Number(row.riskLevel) || null,
      feasible: cap.feasible, feasibleSource: cap.feasibleSource, visitsCap: cap.visitsCap, yearCap: cap.yearCap,
      vpd: cap.vpd, vpdSource: cap.vpdSource, persons: cap.persons, workingDays: cap.workingDays, capacityMode: cap.capacityMode,
      dayCapUnits: cap.dayCapUnits, mode: cap.interval.mode, modeReason: cap.interval.reason, gateDue: cap.interval.due,
      gateCoverage: cap.interval.coverage, interval: cap.interval.interval, adjustedInterval: cap.interval.adjustedInterval,
      coverageRatio: cap.interval.coverageRatio, calendar: runningMonths ? 'calendrier' : 'duree',
      sitesRegistry: eligibleAll, sitesTyped: typed,
    });
  }
  // Nombre de sites saisi au MMR ↔ registre : par LIGNE MMR (une ligne du plan général servant de
  // modèle à plusieurs bureaux se compare à la somme de ses bureaux) ; écart > 10 % signalé.
  const perRow = new Map();
  for (const pi of poolInfo) {
    const k = pi.mmrId || pi.key;
    const cur = perRow.get(k) || { typed: pi.sitesTyped, registry: 0, pools: [], activity: pi.activity, officeId: pi.general ? null : pi.officeId };
    cur.registry += pi.sitesRegistry; cur.pools.push(pi);
    perRow.set(k, cur);
  }
  for (const r of perRow.values()) {
    const gap = r.registry > 0 && Math.abs(r.typed - r.registry) / r.registry > 0.1;
    for (const pi of r.pools) Object.assign(pi, { sitesGap: gap, rowSitesRegistry: r.registry });
  }

  const sites = pre.map((p) => ({
    id: p.s.id, code: p.s.code || p.s.id, inScope: p.inScope, poolKey: p.poolKey,
    districtKey: p.d.key, communeKey: p.communeKey, placeKey: `${p.communeKey}|${districtKey(p.s.name) || p.s.id}`,
    risk: p.s.riskLevel || 'moyenne', urgent: p.u.urgent, urgentSignals: p.u.signals, finalScore: p.u.finalScore,
    lastReal: p.lastReal, months: p.months,
  }));
  // Ce qui est montré à l'écran pour chaque site (noms, lieux) : séparé des entrées du calcul.
  const siteInfo = new Map(pre.map((p) => [p.s.id, {
    id: p.s.id, code: p.s.code, locationId: p.s.locationId || null, name: p.s.name, activity: p.s.activity || null,
    district: p.d.name, commune: p.communeName, poolKey: p.poolKey, lastReal: p.lastReal, lastSource: p.lastSource,
  }]));
  const warnings = [];
  const noPool = pre.filter((p) => p.inScope && !p.poolKey).length;
  if (noPool) warnings.push({ code: 'sans_mmr', count: noPool });
  for (const [k, r] of perRow) {
    if (r.pools[0].sitesGap) warnings.push({ code: 'mmr_sites_ecart', mmrId: k, pools: r.pools.map((p) => p.key), activity: r.activity, officeId: r.officeId, typed: r.typed, registry: r.registry });
  }
  if (poolInfo.some((pi) => pi.calendar === 'duree')) warnings.push({ code: 'sans_calendrier' });
  if (!raw.gridKnown) warnings.push({ code: 'grille_inconnue' });

  return {
    input: {
      year, fromMonth, toMonth, sites, pools,
      // Niveaux de priorité : adaptateur par défaut du générateur (Priorités du mois du RBM) ;
      // le § 5 (règles configurables) passera ici sa propre fonction. Rien de non clonable :
      // l'entrée peut partir telle quelle dans un fil de calcul.
      params: { ...settings },
    },
    firstMonth, objective, poolInfo, siteInfo, warnings,
  };
}

module.exports = { assemble, poolCapacity, mmrIndex, officeTree, urgentOf, runningMonthsOf, securityAt, norm };
